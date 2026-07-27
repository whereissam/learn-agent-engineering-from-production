/**
 * Lesson 2 - 更多工具
 *
 * loop 本身跟 Lesson 1 幾乎一模一樣。變的是它周圍：
 *   - 工具從 1 個變 5 個，用 registry 管理而不是 if/else
 *   - 工具輸出會截斷（不然 context 會爆）
 *   - 會改東西的工具要先問使用者（approval gate）
 *
 * 執行：bun run lesson-02-tools/agent.ts
 */

import { resolve } from "node:path";
import { LineReader } from "../shared/repl.ts";
import { selectProvider } from "../shared/providers/index.ts";
import type { Message, Provider, ToolResult } from "../shared/providers/types.ts";
import {
	type ApprovalRequest,
	editFileTool,
	listFilesTool,
	readFileTool,
	runCommandTool,
	type ToolContext,
	ToolRegistry,
	writeFileTool,
} from "../shared/tools/index.ts";

const ROOT = resolve(import.meta.dirname, "playground");
const MAX_TOKENS = 16000;

/** 一輪最多讓模型呼叫幾次工具。防止無限迴圈燒錢。 */
const MAX_STEPS = 25;

const SYSTEM_PROMPT = `You are a coding agent working in a small TypeScript project.

Available tools: list_files, read_file, write_file, edit_file, run_command.

Working rules:
- Explore with list_files before guessing at file names.
- Always read_file before you edit it - you need the exact text.
- Prefer edit_file over write_file for changes to existing files.
- After changing code, run the tests with run_command to verify your work.
- If the user declines an action, do not retry it. Ask what they want instead.

Answer in the same language the user writes in.`;

const registry = new ToolRegistry([
	listFilesTool,
	readFileTool,
	writeFileTool,
	editFileTool,
	runCommandTool,
]);

// ─────────────────────────────────────────────────────────────
// 顏色
// ─────────────────────────────────────────────────────────────

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;

// ─────────────────────────────────────────────────────────────
// 批准機制
//
// 這是 Lesson 2 最重要的新東西。read 是安全的，write / run_command 不是。
//
// 關鍵設計：拒絕「不是」錯誤，是一個正常結果。使用者說不要，
// 模型就該問「那你想怎麼做」，而不是換個寫法再試一次。
// ─────────────────────────────────────────────────────────────

/** 這一輪對話中，使用者選擇「全部允許」的工具。 */
const alwaysAllow = new Set<string>();

/**
 * AUTO_APPROVE=1 會跳過所有詢問。
 *
 * 這對應到 Claude Code 的 --dangerously-skip-permissions。
 * 方便，但你就是把安全網整個拆掉了，只在你信任的沙箱裡用。
 */
const AUTO_APPROVE = process.env.AUTO_APPROVE === "1";

function createApprover(reader: LineReader) {
	return async (request: ApprovalRequest): Promise<boolean> => {
		if (AUTO_APPROVE || alwaysAllow.has(request.toolName)) return true;

		console.log(`\n${yellow("┌ 需要批准")}`);
		console.log(`${yellow("│")} ${request.summary}`);
		if (request.detail) {
			for (const line of request.detail.split("\n")) {
				console.log(`${yellow("│")} ${dim(line)}`);
			}
		}
		console.log(yellow("└"));

		const line = await reader.next(
			`  ${yellow("[y]")} 允許  ${yellow("[a]")} 這個工具都允許  ${yellow("[n]")} 拒絕 › `,
		);
		if (line === null) {
			// stdin 已經關掉（管線餵輸入、或使用者按了 Ctrl+D）。
			// 沒人能回答就當作拒絕，「無法確認」永遠不該等於「同意」。
			console.log(dim("  (沒有輸入可讀，視為拒絕)"));
			return false;
		}
		const answer = line.trim().toLowerCase();

		if (answer === "a") {
			alwaysAllow.add(request.toolName);
			return true;
		}
		// 預設是「否」。要按 y 才算允許，這個預設值是刻意的。
		return answer === "y" || answer === "yes";
	};
}

// ─────────────────────────────────────────────────────────────
// Agent loop
//
// 跟 Lesson 1 比：多了 step 上限、多了 registry、其他一模一樣。
// ─────────────────────────────────────────────────────────────

async function runTurn(provider: Provider, messages: Message[], ctx: ToolContext): Promise<void> {
	for (let step = 0; step < MAX_STEPS; step++) {
		const response = await provider.call({
			system: SYSTEM_PROMPT,
			messages,
			tools: registry.specs(),
			maxTokens: MAX_TOKENS,
		});

		messages.push({ role: "assistant", blocks: response.blocks, raw: response.raw });

		if (response.stopReason === "refusal") {
			console.log(red("\n[模型拒絕了這個請求]"));
			return;
		}
		if (response.stopReason === "max_tokens") {
			console.log(red(`\n[輸出撞到 ${MAX_TOKENS} token 上限，這一輪的結果不可信]`));
			return;
		}

		for (const block of response.blocks) {
			if (block.type === "text") {
				console.log(`\n${block.text}`);
			} else {
				console.log(dim(`  → ${block.name}(${summarizeArgs(block.args)})`));
			}
		}

		const toolCalls = response.blocks.filter((b) => b.type === "toolCall");
		if (toolCalls.length === 0) return;

		const results: ToolResult[] = [];
		for (const call of toolCalls) {
			try {
				const content = await registry.execute(call.name, call.args, ctx);
				results.push({ toolCallId: call.id, toolName: call.name, content });
				console.log(dim(`  ${green("✓")} ${firstLine(content)}`));
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				results.push({
					toolCallId: call.id,
					toolName: call.name,
					content: message,
					isError: true,
				});
				console.log(`  ${red("✗")} ${red(firstLine(message))}`);
			}
		}

		messages.push({ role: "toolResult", results });
	}

	// 撞到步數上限。告訴使用者，並且讓對話保持在可以繼續的狀態。
	console.log(red(`\n[已達 ${MAX_STEPS} 步上限，停下來了。輸入「繼續」可以讓它接著做。]`));
}

function summarizeArgs(args: Record<string, unknown>): string {
	return Object.entries(args)
		.map(([key, value]) => {
			const text = typeof value === "string" ? value : JSON.stringify(value);
			const short = text.length > 50 ? `${text.slice(0, 50)}…` : text;
			return `${key}: ${JSON.stringify(short)}`;
		})
		.join(", ");
}

function firstLine(text: string): string {
	const line = text.split("\n")[0] ?? "";
	return line.length > 100 ? `${line.slice(0, 100)}…` : line;
}

// ─────────────────────────────────────────────────────────────
// REPL
// ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
	const provider = selectProvider();
	const messages: Message[] = [];
	const reader = new LineReader();

	const ctx: ToolContext = {
		root: ROOT,
		approve: createApprover(reader),
		log: (line) => console.log(dim(`    │ ${line}`)),
	};

	console.log(dim(`provider: ${provider.name}  model: ${provider.model}`));
	console.log(dim(`sandbox:  ${ROOT}`));
	console.log(dim(`tools:    ${registry.specs().map((t) => t.name).join(", ")}`));
	console.log(dim("輸入問題，/exit 或 Ctrl+C 離開\n"));

	try {
		while (true) {
			const line = await reader.next("\x1b[36m> \x1b[0m");
			if (line === null) break; // stdin 結束
			const input = line.trim();
			if (!input) continue;
			if (input === "/exit") break;

			messages.push({ role: "user", text: input });
			await runTurn(provider, messages, ctx);
			console.log();
		}
	} finally {
		reader.close();
	}
}

try {
	await main();
} catch (error) {
	console.error(`\n${error instanceof Error ? error.message : String(error)}`);
	process.exit(1);
}
