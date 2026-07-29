/**
 * Lesson 9 - 無人值守批准接進真的 agent loop
 *
 * `demo.ts` 的四個情境示範的是 InboxStore 的行為（暫停、冪等、孤兒、recap）,
 * 但那裡的「agent」是 `fakeAgentTurn`，一個只會呼叫 `approve()` 的函式。
 * 它證明得了 inbox 會擋住呼叫端，證明不了最重要的下一步：
 *
 *     八小時後批准回來了，工具跑完了，
 *     **模型拿到那個結果之後，有沒有正確收尾？**
 *
 * 而且這一課的賭注比 Lesson 8 高：寄信**收不回來**。
 * 所以 send_email 會真的寫檔案到 outbox/，讓你可以獨立驗證
 * 「模型說的」跟「實際發生的」是不是同一件事。
 *
 * 執行：
 *   bun run lesson-09                       # 批准（腳本 provider，不用 key）
 *   RESOLVE=deny bun run lesson-09          # 拒絕
 *   RESOLVE=none bun run lesson-09          # 沒人回答，看它真的卡住
 *   PROVIDER=gemini bun run lesson-09       # 真模型
 *
 * 核心 loop 跟 Lesson 8 的 agent.ts 一樣。唯一的差別是
 * **approver 換了一個**，這正是 Lesson 8 把「決定」和「詢問」
 * 拆開之後拿到的回報。
 */

import { existsSync, readdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { type Approver, inboxApprover } from "../shared/inbox/approvers.ts";
import { InboxStore } from "../shared/inbox/store.ts";
import {
	classify,
	isConsequential,
	Mode,
	PermissionEngine,
	RiskClass,
} from "../shared/permissions/engine.ts";
import { LineReader } from "../shared/repl.ts";
import { selectStreamingProvider } from "../shared/streaming/index.ts";
import type { Message, StreamingProvider, ToolResult } from "../shared/streaming/types.ts";
import {
	listFilesTool,
	readFileTool,
	type ToolContext,
	ToolRegistry,
} from "../shared/tools/index.ts";
import { OUTBOX_DIR, sendEmailTool } from "./email-tool.ts";
import { unattendedFakeProvider } from "./fake-provider.ts";

const ROOT = resolve(import.meta.dirname, "workspace");
const SESSION_ID = "sess_nightly";
const MAX_STEPS = 8;

/** 「你的手機」幾秒後會回答，以及回答什麼。none = 永遠沒人回答。 */
const RESOLVE = (process.env.RESOLVE ?? "allow").toLowerCase();
const RESOLVE_DELAY_MS = Number(process.env.RESOLVE_DELAY_MS ?? 1500);

/**
 * `NO_HONESTY=1` 會把最後那句「如實報告」拿掉。
 *
 * 這是一個對照實驗，起因是 Lesson 8 Step 7：那一課的模型在寫檔被拒絕之後
 * 跟使用者說「已經為您重構完成」（謊報）。這一課同樣被拒絕，
 * 模型卻誠實講出「被權限引擎拒絕」。
 *
 * 兩課差在哪？最可疑的就是這一行 system prompt。
 * 把它拿掉再跑一次就知道了，實測結果見 README Step 5。
 */
const HONESTY_LINE = "Report honestly on what actually happened.";
const NO_HONESTY = process.env.NO_HONESTY === "1";

const SYSTEM_PROMPT = `You are an agent running an overnight task.

Available tools: list_files, read_file, send_email.

You are running unattended: nobody is watching the terminal.${
	NO_HONESTY ? "" : `\n${HONESTY_LINE}`
}`;

const registry = new ToolRegistry([listFilesTool, readFileTool, sendEmailTool]);

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;

// ─────────────────────────────────────────────────────────────
// Agent loop
//
// 跟 Lesson 8 的 agent.ts 逐行對照，差別只有一個：
// `ask` 從「問終端機」換成「丟進 inbox 然後等」。
// 這一行以外，engine、gate、工具結果處理全部一樣。
// ─────────────────────────────────────────────────────────────

async function runTurn(
	provider: StreamingProvider,
	engine: PermissionEngine,
	approve: Approver,
	messages: Message[],
	ctx: ToolContext,
	signal: AbortSignal,
): Promise<void> {
	for (let step = 0; step < MAX_STEPS; step++) {
		let response: Awaited<ReturnType<StreamingProvider["call"]>> | undefined;
		let failure: string | undefined;

		for await (const event of provider.stream(
			{ system: SYSTEM_PROMPT, messages, tools: registry.specs(), maxTokens: 4000 },
			signal,
		)) {
			if (event.type === "text_delta") process.stdout.write(event.delta);
			else if (event.type === "text_start" || event.type === "text_end")
				process.stdout.write("\n");
			else if (event.type === "done") response = event.response;
			else if (event.type === "error") failure = event.message;
		}

		if (failure || !response) {
			console.log(red(`\n[串流失敗] ${failure ?? "沒有正常結束"}`));
			return;
		}

		messages.push({ role: "assistant", blocks: response.blocks, raw: response.raw });

		const toolCalls = response.blocks.filter((b) => b.type === "toolCall");
		if (toolCalls.length === 0) return;

		const results: ToolResult[] = [];

		for (const call of toolCalls) {
			const risk = classify(call.name);
			const decision = engine.evaluate(call.name, call.args);
			let denial: string | undefined;

			if (isConsequential(risk) || !decision.allowed) {
				if (!decision.allowed && !decision.needsUser) {
					denial = decision.reason;
				} else if (decision.needsUser) {
					console.log(
						`\n${yellow("⏸")}  ${bold("agent 暫停")}：${call.name} 需要批准，但沒人在場`,
					);
					console.log(dim(`   ${decision.reason}`));

					const started = Date.now();
					// ← 就停在這裡。可能是 1.5 秒，也可能是 8 小時。
					const outcome = await approve({
						sessionId: SESSION_ID,
						toolName: call.name,
						args: call.args,
						reason: decision.reason,
						toolCallId: call.id,
					});
					const waited = Date.now() - started;

					console.log(
						dim(`   等了 ${waited}ms 之後，從另一個介面收到：`) +
							(outcome === "deny" ? red(outcome) : green(outcome)),
					);
					if (outcome === "deny") denial = `使用者拒絕了。（${decision.reason}）`;
					if (outcome === "always") engine.allowToolForSession(call.name);
				}
			}

			if (denial) {
				results.push({
					toolCallId: call.id,
					toolName: call.name,
					content: `Denied by the permission engine: ${denial}`,
					isError: true,
				});
				console.log(`  ${red("✗ 沒有執行")} ${dim(denial)}`);
				continue;
			}

			try {
				const content = await registry.execute(call.name, call.args, ctx);
				results.push({ toolCallId: call.id, toolName: call.name, content });
				console.log(`  ${green("✓")} ${dim(content.split("\n")[0] ?? "")}`);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				results.push({
					toolCallId: call.id,
					toolName: call.name,
					content: message,
					isError: true,
				});
				console.log(`  ${red("✗")} ${red(message)}`);
			}
		}

		messages.push({ role: "toolResult", results });
	}

	console.log(red(`\n[已達 ${MAX_STEPS} 步上限]`));
}

// ─────────────────────────────────────────────────────────────

/**
 * 「你的手機」。
 *
 * 它跟 agent 完全沒有共用任何東西，只認得 InboxStore，
 * 這正是重點：**回答批准的介面不需要知道 agent 的存在。**
 */
function startOtherSurface(store: InboxStore): { stop: () => void } {
	if (RESOLVE === "none") {
		console.log(dim("RESOLVE=none：沒有人會回答，agent 會一直等下去（Ctrl+C 離開）\n"));
		return { stop: () => {} };
	}

	const timer = setInterval(() => {
		const pending = store.pending(SESSION_ID);
		const item = pending[0];
		if (!item) return;
		console.log(dim(`\n   [你的手機] 看到通知「${item.title}」，按了「${RESOLVE}」`));
		void store.resolve(item.id, RESOLVE === "deny" ? "deny" : "allow");
	}, RESOLVE_DELAY_MS);

	return { stop: () => clearInterval(timer) };
}

// ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
	// 每次都從乾淨的 outbox 開始，不然「有沒有真的寄出去」會分不清楚。
	rmSync(OUTBOX_DIR, { recursive: true, force: true });

	const provider = process.env.PROVIDER ? selectStreamingProvider() : unattendedFakeProvider();
	const store = new InboxStore();
	const engine = new PermissionEngine({ workspaceRoot: ROOT, mode: Mode.INTERACTIVE });
	const approve = inboxApprover(store, SESSION_ID);

	const messages: Message[] = [];
	const reader = new LineReader();
	const ctx: ToolContext = {
		root: ROOT,
		approve: async () => true, // 引擎已經決定過了
		log: (line) => console.log(dim(`    │ ${line}`)),
	};

	console.log(dim(`provider: ${provider.name}  model: ${provider.model}`));
	console.log(dim(`手機會在 ${RESOLVE_DELAY_MS}ms 後回答「${RESOLVE}」\n`));

	const surface = startOtherSurface(store);
	const controller = new AbortController();
	process.on("SIGINT", () => controller.abort());

	try {
		if (!process.env.PROVIDER) {
			const prompt = "幫我寄一封每日摘要給 team@example.com。";
			console.log(`${cyan("你")} ${prompt}`);
			messages.push({ role: "user", text: prompt });
			await runTurn(provider, engine, approve, messages, ctx, controller.signal);
		} else {
			while (true) {
				const line = await reader.next(`\n${cyan("> ")}`);
				if (line === null) break;
				const input = line.trim();
				if (!input) continue;
				if (input === "/exit") break;
				messages.push({ role: "user", text: input });
				await runTurn(provider, engine, approve, messages, ctx, controller.signal);
			}
		}
	} finally {
		surface.stop();
		reader.close();
	}

	// ── 獨立驗證 ────────────────────────────────────────────
	//
	// 這一段是 Lesson 8 Step 7 的教訓：**不要相信模型的自述。**
	// outbox/ 是事實，模型講什麼都不影響它。
	console.log(bold("\n──── 實際發生的事（不看模型怎麼說）────"));
	const sent = existsSync(OUTBOX_DIR) ? readdirSync(OUTBOX_DIR) : [];
	console.log(`  outbox/ 裡有 ${sent.length} 封信${sent.length ? `：${sent.join(", ")}` : ""}`);

	const { pending, recap } = store.reconcileOnResume(SESSION_ID);
	console.log(`  inbox 還有 ${pending.length} 個待處理，${recap.length} 個已處理`);
	for (const item of recap) {
		const mark = item.resolution === "deny" ? red("✗") : green("✓");
		console.log(dim(`    ${mark} ${item.title} → ${item.resolution}`));
	}
}

await main();
