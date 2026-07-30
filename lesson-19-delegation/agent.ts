/**
 * Lesson 19 - 一個 agent 做三件事 vs 三個 agent 各做一件
 *
 * 這是 CrewAI 那類框架真正該被問的問題，而且**先把預期寫下來再跑**
 * （`docs/TODO.md` 那一列原話）：
 *
 *   > 多 agent 不會比較聰明，它是把狀態邊界變明確；
 *   > 沒有真的隔離需求時只是多付溝通成本。
 *
 * 量四件事，全部是確定性判定：
 *
 *   正確   三個服務的最常見錯誤碼有沒有答對（includes）
 *   遺失   那個「舊編號方案」的但書有沒有活著跨過邊界
 *   成本   token（父 + 所有子）
 *   定位   出錯的時候看不看得出是哪一步
 *
 * 執行：
 *   PROVIDER=gemini bun run lesson-19:agent            # solo
 *   MODE=delegate PROVIDER=gemini bun run lesson-19:agent
 *   RUNS=3 MODE=delegate PROVIDER=gemini bun run lesson-19:agent
 */

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { selectStreamingProvider } from "../shared/streaming/index.ts";
import type { Message, ModelResponse, StreamingProvider, ToolResult, ToolSpec } from "../shared/streaming/types.ts";
import { DELEGATE_TOOL, runChild } from "./delegate.ts";
import { mentionsCaveat, resetWorkspace, scoreCodes, WORKSPACE } from "./workspace.ts";

const MODE = (process.env.MODE ?? "solo").toLowerCase();
const RUNS = Number(process.env.RUNS ?? 1);
const MAX_STEPS = 12;

const QUESTION =
	"logs/ 底下有三個服務的錯誤日誌。" +
	"幫我看一下每個服務**最常出現**的錯誤碼是哪一個，做成一份簡短的報告。";

const SOLO_SYSTEM = `You are an operations agent. Use the tools to inspect files under the
workspace and answer the user's question. Be concrete: name the error codes.`;

const PARENT_SYSTEM = `You are an operations agent coordinating sub-agents.

Your own context is small, so for work that requires reading large files, use
delegate_task: one sub-task per service. A sub-agent starts with NO knowledge of
this conversation — whatever it needs must be in goal/context — and you only get
its final summary back.

When you have the sub-agents' summaries, write the report yourself.`;

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;

const FILE_TOOLS: ToolSpec[] = [
	{
		name: "list_files",
		description: "List files under the workspace.",
		parameters: { type: "object", properties: { path: { type: "string" } } },
	},
	{
		name: "read_file",
		description: "Read a text file from the workspace.",
		parameters: {
			type: "object",
			properties: { path: { type: "string" } },
			required: ["path"],
		},
	},
];

async function execute(name: string, args: Record<string, unknown>): Promise<string> {
	if (name === "list_files") {
		const dir = join(WORKSPACE, String(args.path ?? "."));
		const entries = await readdir(dir, { withFileTypes: true, recursive: true });
		return entries
			.filter((e) => e.isFile())
			.map((e) => join(e.parentPath.replace(WORKSPACE, "").replace(/^\//, ""), e.name))
			.sort()
			.join("\n");
	}
	if (name === "read_file") {
		return await readFile(join(WORKSPACE, String(args.path)), "utf8");
	}
	throw new Error(`Unknown tool ${name}`);
}

interface RunResult {
	answer: string;
	modelCalls: number;
	children: number;
	usage: { input: number; output: number; total: number };
	toolCalls: string[];
	/** 子 agent 的摘要，用來看資訊在哪一層掉的。 */
	summaries: string[];
	steps: number;
}

async function runOnce(provider: StreamingProvider): Promise<RunResult> {
	await resetWorkspace();

	const delegating = MODE === "delegate";
	const tools = delegating ? [...FILE_TOOLS, DELEGATE_TOOL] : FILE_TOOLS;
	const messages: Message[] = [{ role: "user", text: QUESTION }];

	const out: RunResult = {
		answer: "",
		modelCalls: 0,
		children: 0,
		usage: { input: 0, output: 0, total: 0 },
		toolCalls: [],
		summaries: [],
		steps: 0,
	};

	for (let step = 0; step < MAX_STEPS; step++) {
		out.steps = step + 1;
		let response: ModelResponse | undefined;

		for await (const event of provider.stream({
			system: delegating ? PARENT_SYSTEM : SOLO_SYSTEM,
			messages,
			tools,
			maxTokens: 6000,
		})) {
			if (event.type === "done") response = event.response;
			if (event.type === "error") {
				console.log(red(`  [串流失敗] ${event.message}`));
				return out;
			}
		}
		if (!response) return out;

		out.modelCalls++;
		if (response.usage) {
			out.usage.input += response.usage.input;
			out.usage.output += response.usage.output;
			out.usage.total += response.usage.total;
		}

		messages.push({ role: "assistant", blocks: response.blocks, raw: response.raw });
		const text = response.blocks
			.filter((b) => b.type === "text")
			.map((b) => b.text)
			.join("");
		if (text.trim()) out.answer = text.trim();

		const calls = response.blocks.filter((b) => b.type === "toolCall");
		if (calls.length === 0) break;

		const results: ToolResult[] = [];
		for (const call of calls) {
			out.toolCalls.push(call.name);

			if (call.name === "delegate_task") {
				out.children++;
				const goal = String(call.args.goal ?? "");
				console.log(`  ${cyan("→ delegate_task")} ${dim(goal.slice(0, 70))}`);

				const child = await runChild(
					{ goal, context: call.args.context ? String(call.args.context) : undefined },
					{
						provider,
						tools: [...FILE_TOOLS, DELEGATE_TOOL],
						execute,
						log: (line) => console.log(dim(line)),
					},
				);

				out.modelCalls += child.steps;
				out.usage.input += child.usage.input;
				out.usage.output += child.usage.output;
				out.usage.total += child.usage.total;
				out.summaries.push(child.summary);

				console.log(dim(`      ← 摘要 ${child.summary.length} 字，工具 ${child.toolCalls.length} 次`));
				results.push({
					toolCallId: call.id,
					toolName: call.name,
					// ⚠️ 父 agent 拿到的**只有這個字串**。
					content: child.error ? `Sub-agent failed: ${child.error}` : child.summary,
					isError: Boolean(child.error),
				});
				continue;
			}

			console.log(`  ${dim(`→ ${call.name}(${JSON.stringify(call.args).slice(0, 50)})`)}`);
			try {
				results.push({
					toolCallId: call.id,
					toolName: call.name,
					content: await execute(call.name, call.args),
				});
			} catch (error) {
				results.push({
					toolCallId: call.id,
					toolName: call.name,
					content: error instanceof Error ? error.message : String(error),
					isError: true,
				});
			}
		}
		messages.push({ role: "toolResult", results });
	}

	return out;
}

async function main(): Promise<void> {
	if (!process.env.PROVIDER) {
		console.log(
			yellow("這支程式量的是模型行為，需要 PROVIDER。") +
				dim("\n離線的機制示範在 `bun run lesson-19`。"),
		);
		return;
	}

	const provider = selectStreamingProvider();
	console.log(dim(`provider: ${provider.name}  model: ${provider.model}  MODE=${MODE}`));
	console.log(`\n${cyan("你")} ${QUESTION}`);

	const rows: (RunResult & { run: number; codes: ReturnType<typeof scoreCodes>; caveat: boolean })[] =
		[];

	for (let run = 1; run <= RUNS; run++) {
		console.log(`\n${bold(`── 第 ${run} 次`)}`);
		const result = await runOnce(provider);
		rows.push({
			...result,
			run,
			codes: scoreCodes(result.answer),
			caveat: mentionsCaveat(result.answer),
		});
		console.log(dim(`\n  答案（${result.answer.length} 字）：${result.answer.slice(0, 160)}…`));
	}

	console.log(`\n${bold("── 總表")}`);
	console.log(dim("   次數  模型呼叫  子agent  token(total)  錯誤碼  但書"));
	for (const row of rows) {
		console.log(
			`   ${String(row.run).padEnd(6)}${String(row.modelCalls).padEnd(10)}` +
				`${String(row.children).padEnd(9)}${String(row.usage.total).padEnd(14)}` +
				`${row.codes.missed.length === 0 ? green("3/3") : red(`${row.codes.hit.length}/3`)}     ` +
				`${row.caveat ? green("有") : red("沒有")}`,
		);
		if (row.codes.missed.length > 0) {
			console.log(dim(`         漏掉：${row.codes.missed.join(", ")}`));
		}
	}

	if (MODE === "delegate" && rows.some((r) => r.summaries.length > 0)) {
		console.log(`\n${bold("  子 agent 的摘要裡有沒有那個但書")}`);
		for (const row of rows) {
			for (const [index, summary] of row.summaries.entries()) {
				const has = mentionsCaveat(summary);
				console.log(
					`    第 ${row.run} 次 · 子 ${index + 1}　${has ? green("有") : dim("沒有")}　${dim(summary.slice(0, 64).replace(/\s+/g, " "))}…`,
				);
			}
		}
		console.log(
			dim(
				"\n  但書在子 agent 的摘要裡就掉了的話，父 agent **沒有任何辦法**補回來——\n" +
					"  它看不到原文。這就是那條資訊邊界的代價。",
			),
		);
	}
}

await main();
