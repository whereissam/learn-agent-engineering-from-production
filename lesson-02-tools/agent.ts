/**
 * Lesson 2 - more tools
 *
 * The loop itself is nearly identical to Lesson 1's. What changed is around it:
 *   - 1 tool became 5, managed by a registry rather than if/else
 *   - tool output is truncated (or the context explodes)
 *   - tools that change things ask the user first (the approval gate)
 *
 * Run: bun run lesson-02-tools/agent.ts
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

/** How many tool calls the model may make per turn. Stops an infinite loop burning money. */
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
// Colours
// ─────────────────────────────────────────────────────────────

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;

// ─────────────────────────────────────────────────────────────
// The approval mechanism
//
// This is Lesson 2's most important addition. read is safe; write and run_command are not.
//
// The key design: a refusal is **not** an error but a normal result. When the user says no,
// the model should ask "what would you like instead" rather than rephrasing and trying again.
// ─────────────────────────────────────────────────────────────

/** Tools the user chose "allow all" for during this conversation. */
const alwaysAllow = new Set<string>();

/**
 * AUTO_APPROVE=1 skips every prompt.
 *
 * This corresponds to Claude Code's --dangerously-skip-permissions.
 * Convenient, and you have removed the safety net entirely; use it only in a sandbox you trust.
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
				// stdin is closed (input from a pipe, or the user pressed Ctrl+D).
				// With nobody to answer, treat it as a refusal: "cannot confirm" must never equal "agreed".
			console.log(dim("  (沒有輸入可讀，視為拒絕)"));
			return false;
		}
		const answer = line.trim().toLowerCase();

		if (answer === "a") {
			alwaysAllow.add(request.toolName);
			return true;
		}
			// The default is no. Only y allows it, and that default is deliberate.
		return answer === "y" || answer === "yes";
	};
}

// ─────────────────────────────────────────────────────────────
// Agent loop
//
// Against Lesson 1: a step ceiling and a registry were added; everything else is identical.
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

		// Hit the step ceiling. Tell the user, and leave the conversation in a state that can continue.
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
