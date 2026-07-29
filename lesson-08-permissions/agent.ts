/**
 * Lesson 8 - 權限引擎接進真的 agent loop
 *
 * `table.ts` 把寫死的工具呼叫餵進引擎，印出決策表。那張表告訴你
 * 「引擎會說不」，但它學不到最重要的一件事：
 *
 *     引擎說不之後，那個「不」會變成 tool result 回到模型手上。
 *     **模型接下來做什麼？**
 *
 * 乖乖停手、換個寫法繞過去、還是硬 retry？這是行為問題，
 * 看表格永遠看不出來，只能真的跑。
 *
 * 執行：
 *   bun run lesson-08                          # 腳本化示範（不用 key）
 *   MODE=auto bun run lesson-08                # 換模式，看哪些還是擋得住
 *   DENY_HINT=1 bun run lesson-08              # 拒絕訊息裡加上「不要繞道」
 *   PROVIDER=gemini bun run lesson-08          # 真模型，自己打字問它
 *
 * 核心 loop 跟 Lesson 3 一樣（設計原則 6）。唯一的差別在
 * `registry.execute` 之前多了一段判斷，見下面「權限閘門」。
 */

import { resolve } from "node:path";
import { LineReader } from "../shared/repl.ts";
import {
	classify,
	type Decision,
	isConsequential,
	Mode,
	PermissionEngine,
	RiskClass,
	type ToolRiskMetadata,
} from "../shared/permissions/engine.ts";
import { selectStreamingProvider } from "../shared/streaming/index.ts";
import type { Message, StreamingProvider, ToolResult } from "../shared/streaming/types.ts";
import {
	editFileTool,
	listFilesTool,
	readFileTool,
	runCommandTool,
	type ToolContext,
	ToolRegistry,
	writeFileTool,
} from "../shared/tools/index.ts";
import { permissionFakeProvider } from "./fake-provider.ts";

const ROOT = resolve(import.meta.dirname, "workspace");
const MAX_TOKENS = 8000;
const MAX_STEPS = 12;

/**
 * 拒絕訊息裡要不要加一句「不要繞過去」。
 *
 * 預設**不加**，因為預設要能觀察到模型的原始行為。
 * 加了之後再跑一次，比較兩邊的差異，那是這一課的實驗。
 *
 * （Lesson 21 Step 5 有一次相反方向的實證：在工具輸出裡拜託模型
 * 「這頁有表格沒抽到」完全沒有用。所以這裡的預期是「加了也沒差」，
 * 實測結果見 README。）
 */
const DENY_HINT = process.env.DENY_HINT === "1";

/** 非互動示範用：使用者被問到時固定怎麼回答。 */
const ANSWER = process.env.ANSWER?.toLowerCase();

const MODE = (process.env.MODE?.toLowerCase() as Mode | undefined) ?? Mode.INTERACTIVE;

const SYSTEM_PROMPT = `You are a coding agent working in a small TypeScript workspace.

Available tools: list_files, read_file, write_file, edit_file, run_command.

Working rules:
- Explore with list_files before guessing at file names.
- Always read_file before you edit it.

Answer in the same language the user writes in.`;

const registry = new ToolRegistry([
	listFilesTool,
	readFileTool,
	writeFileTool,
	editFileTool,
	runCommandTool,
]);

/**
 * 工具的風險 metadata。
 *
 * 內建工具的等級已經在 `shared/permissions/risk.ts` 的 BASE 表裡了，
 * 這裡留一個空殼是為了讓你看到接口在哪，真實系統裡
 * MCP 工具、connector 工具會從這裡帶 `requiresApproval: true` 進來
 * （Lesson 12）。
 */
const METADATA: Record<string, ToolRiskMetadata> = {};

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;

// ─────────────────────────────────────────────────────────────
// 權限閘門
//
// 這是整個 Lesson 8 的接縫，而且它**不在引擎裡**。
//
// 引擎只回傳一個 Decision（資料）。要不要問人、怎麼問、
// 被拒絕之後要跟模型說什麼，全部是這裡的責任。
// README Step 6 解釋了為什麼要這樣拆。
// ─────────────────────────────────────────────────────────────

interface Gate {
	/** undefined = 放行。有值 = 這段字會變成 tool result 送回模型。 */
	denial?: string;
	decision: Decision;
	risk: RiskClass;
}

async function gate(
	engine: PermissionEngine,
	toolName: string,
	args: Record<string, unknown>,
	ask: (decision: Decision, toolName: string, args: Record<string, unknown>) => Promise<boolean>,
): Promise<Gate> {
	const metadata = METADATA[toolName];
	const risk = classify(toolName, metadata);
	const decision = engine.evaluate(toolName, args, metadata);

	// 純讀取：引擎連問都不用問。
	if (!isConsequential(risk) && decision.allowed) return { decision, risk };

	// 引擎自己就否決了（路徑逃逸、PLAN 模式下的副作用……）。
	// 注意這一支**不會去問人**，有些拒絕是不可協商的。
	if (!decision.allowed && !decision.needsUser) {
		return { decision, risk, denial: denialText(decision.reason) };
	}

	// 引擎不能自己決定 → 去問。「去哪裡問」是呼叫端的自由，
	// Lesson 9 就是把這一行換成「丟進 inbox」。
	if (decision.needsUser) {
		const approved = await ask(decision, toolName, args);
		if (!approved) {
			return { decision, risk, denial: denialText(`使用者拒絕了。（${decision.reason}）`) };
		}
	}

	return { decision, risk };
}

/**
 * 拒絕要怎麼講給模型聽。
 *
 * 這段字很重要，因為它是模型**唯一**知道發生什麼事的管道。
 * 它看不到你的權限設定、看不到終端機上那個紅色的 ✗，
 * 它只看得到這個字串。
 */
function denialText(reason: string): string {
	const base = `Denied by the permission engine: ${reason}`;
	if (!DENY_HINT) return base;
	return `${base}\n\nDo not retry this call and do not look for a way around the restriction. Either take a different approach that does not need this permission, or stop and explain the situation to the user.`;
}

// ─────────────────────────────────────────────────────────────
// Agent loop（跟 Lesson 3 相同，只多了 gate）
// ─────────────────────────────────────────────────────────────

async function runTurn(
	provider: StreamingProvider,
	engine: PermissionEngine,
	messages: Message[],
	ctx: ToolContext,
	ask: (decision: Decision, toolName: string, args: Record<string, unknown>) => Promise<boolean>,
	signal: AbortSignal,
): Promise<void> {
	for (let step = 0; step < MAX_STEPS; step++) {
		let response: Awaited<ReturnType<StreamingProvider["call"]>> | undefined;
		let streamError: { message: string; aborted: boolean } | undefined;

		for await (const event of provider.stream(
			{ system: SYSTEM_PROMPT, messages, tools: registry.specs(), maxTokens: MAX_TOKENS },
			signal,
		)) {
			switch (event.type) {
				case "text_start":
					process.stdout.write("\n");
					break;
				case "text_delta":
					process.stdout.write(event.delta);
					break;
				case "text_end":
					process.stdout.write("\n");
					break;
				case "done":
					response = event.response;
					break;
				case "error":
					streamError = { message: event.message, aborted: event.aborted };
					break;
			}
		}

		if (streamError) {
			console.log(red(`\n[${streamError.aborted ? "已中斷" : "串流失敗"}] ${streamError.message}`));
			return;
		}
		if (!response) {
			console.log(red("\n[串流沒有正常結束]"));
			return;
		}

		messages.push({ role: "assistant", blocks: response.blocks, raw: response.raw });

		const toolCalls = response.blocks.filter((b) => b.type === "toolCall");
		if (toolCalls.length === 0) return;

		const results: ToolResult[] = [];

		for (const call of toolCalls) {
			const { denial, decision, risk } = await gate(engine, call.name, call.args, ask);

			console.log(
				dim(`  → ${call.name}(${summarize(call.args)})  ${riskTag(risk)}`),
			);

			// ── 被拒絕：工具「沒有執行」，但一定要有一則結果 ──────
			//
			// 這是 Lesson 3 學到的硬規則：每個 tool call 都必須有對應的結果，
			// 否則下一次請求會被 API 打回 400。
			//
			// 而且結果的內容就是模型接下來唯一的依據。
			if (denial) {
				results.push({
					toolCallId: call.id,
					toolName: call.name,
					content: denial,
					isError: true,
				});
				console.log(`  ${red("✗ 擋下來了")} ${dim(decision.reason)}`);
				console.log(dim(`    模型會收到：${JSON.stringify(firstLine(denial))}`));
				continue;
			}

			try {
				const content = await registry.execute(call.name, call.args, ctx);
				results.push({ toolCallId: call.id, toolName: call.name, content });
				console.log(
					`  ${green("✓ 放行")} ${dim(decision.rule ? `（規則：${decision.rule}）` : decision.reason)}`,
				);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				results.push({
					toolCallId: call.id,
					toolName: call.name,
					content: message,
					isError: true,
				});
				console.log(`  ${red("✗ 執行失敗")} ${red(firstLine(message))}`);
			}
		}

		messages.push({ role: "toolResult", results });
	}

	console.log(red(`\n[已達 ${MAX_STEPS} 步上限]`));
}

// ─────────────────────────────────────────────────────────────

function riskTag(risk: RiskClass): string {
	const colour =
		risk === RiskClass.READ
			? dim
			: risk === RiskClass.WRITE_LOCAL
				? cyan
				: risk === RiskClass.EXEC
					? yellow
					: red;
	return colour(`[${risk}]`);
}

function makeAsker(reader: LineReader) {
	return async (
		decision: Decision,
		toolName: string,
		args: Record<string, unknown>,
	): Promise<boolean> => {
		console.log(`\n${yellow("┌ 需要批准")}`);
		console.log(`${yellow("│")} ${toolName}(${summarize(args)})`);
		console.log(`${yellow("│")} ${dim(decision.reason)}`);
		console.log(yellow("└"));

		if (ANSWER) {
			console.log(dim(`  （ANSWER=${ANSWER}，自動回答）`));
			return ANSWER === "y" || ANSWER === "yes";
		}

		const line = await reader.next(`  ${yellow("[y]")} 允許  ${yellow("[n]")} 拒絕 › `);
		if (line === null) return false;
		return line.trim().toLowerCase().startsWith("y");
	};
}

function summarize(args: Record<string, unknown>): string {
	return Object.entries(args)
		.map(([key, value]) => {
			const text = typeof value === "string" ? value : JSON.stringify(value);
			return `${key}: ${JSON.stringify(text.length > 40 ? `${text.slice(0, 40)}…` : text)}`;
		})
		.join(", ");
}

function firstLine(text: string): string {
	const line = text.split("\n")[0] ?? "";
	return line.length > 90 ? `${line.slice(0, 90)}…` : line;
}

// ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
	// PROVIDER 沒設就用這一課自己的腳本 provider，
	// 因為共用的那份不會踩到任何危險工具。
	const provider = process.env.PROVIDER
		? selectStreamingProvider()
		: permissionFakeProvider();

	const engine = new PermissionEngine({
		workspaceRoot: ROOT,
		mode: MODE,
		allowedCommands: ["ls", "git status", "cat"],
	});

	const messages: Message[] = [];
	const reader = new LineReader();
	const ask = makeAsker(reader);

	const ctx: ToolContext = {
		root: ROOT,
		// 引擎已經決定過了，registry 不該再問一次。
		approve: async () => true,
		log: (line) => console.log(dim(`    │ ${line}`)),
	};

	console.log(dim(`provider: ${provider.name}  model: ${provider.model}`));
	console.log(dim(`模式: ${engine.mode}   允許清單: ls, git status, cat`));
	console.log(dim(`拒絕訊息${DENY_HINT ? "有" : "沒有"}加「不要繞道」的指示（DENY_HINT）`));
	console.log();

	const controller = new AbortController();
	process.on("SIGINT", () => controller.abort());

	try {
		// 腳本模式：自動問一句，把整段演完就結束。
		if (!process.env.PROVIDER) {
			const prompt = "src/app.ts 寫得很亂，幫我砍掉重來。";
			console.log(`${cyan("你")} ${prompt}`);
			messages.push({ role: "user", text: prompt });
			await runTurn(provider, engine, messages, ctx, ask, controller.signal);
			console.log(dim("\n（這是腳本化的示範。用 PROVIDER=gemini 換成真模型自己問。）"));
			return;
		}

		while (true) {
			const line = await reader.next(`\n${cyan("> ")}`);
			if (line === null) break;
			const input = line.trim();
			if (!input) continue;
			if (input === "/exit") break;

			messages.push({ role: "user", text: input });
			await runTurn(provider, engine, messages, ctx, ask, controller.signal);
		}
	} finally {
		reader.close();
	}
}

await main();
