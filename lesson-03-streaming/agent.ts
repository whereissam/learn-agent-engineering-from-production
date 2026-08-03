/**
 * Lesson 3 - streaming and interruption
 *
 * Two new things:
 *   1. text is printed as it arrives, without waiting for the whole passage
 *   2. Ctrl+C can stop it, and the conversation continues afterwards
 *
 * The second is much harder than it looks. An interruption can happen at three different moments,
 * each leaving the conversation history in a different half-broken state. See the README.
 *
 * Run: bun run lesson-03-streaming/agent.ts
 */

import { resolve } from "node:path";
import { LineReader } from "../shared/repl.ts";
import { selectStreamingProvider } from "../shared/streaming/index.ts";
import type { Message, StreamingProvider, ToolResult } from "../shared/streaming/types.ts";
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
const MAX_STEPS = 25;

const SYSTEM_PROMPT = `You are a coding agent working in a small TypeScript project.

Available tools: list_files, read_file, write_file, edit_file, run_command.

Working rules:
- Explore with list_files before guessing at file names.
- Always read_file before you edit it.
- After changing code, run the tests with run_command to verify.
- If the user declines an action, do not retry it.

Answer in the same language the user writes in.`;

const registry = new ToolRegistry([
	listFilesTool,
	readFileTool,
	writeFileTool,
	editFileTool,
	runCommandTool,
]);

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;

const AUTO_APPROVE = process.env.AUTO_APPROVE === "1";
const alwaysAllow = new Set<string>();

// ─────────────────────────────────────────────────────────────
// Interruption control
//
// Each turn creates a new AbortController. Ctrl+C triggers abort,
// and the signal reaches both the running model request and any running tool.
// ─────────────────────────────────────────────────────────────

let currentRun: AbortController | undefined;

function handleInterrupt(): void {
	if (currentRun && !currentRun.signal.aborted) {
		// Something is running → interrupt it without exiting the program
		currentRun.abort();
		return;
	}
	// Ctrl+C while idle → really leave
	console.log(dim("\nGoodbye."));
	process.exit(0);
}

/**
 * The interrupt signal has to be caught in **two** places.
 *
 * - rl.on("SIGINT"): when stdin is a terminal and readline is waiting for input,
 *   readline intercepts SIGINT and the process level never sees it.
 * - process.on("SIGINT"): every other case, especially during runTurn
 *   (readline is not waiting), and when stdin is not a TTY (pipes, CI).
 *
 * Installing only one leaves situations where Ctrl+C does nothing. This was found by measurement:
 * the first version installed only the rl handler, and Ctrl+C during streaming did nothing at all.
 */
function installSigintHandler(reader: LineReader): void {
	reader.raw.on("SIGINT", handleInterrupt);
	process.on("SIGINT", handleInterrupt);
}

// ─────────────────────────────────────────────────────────────
// Agent loop
// ─────────────────────────────────────────────────────────────

interface TurnOutcome {
	aborted: boolean;
}

async function runTurn(
	provider: StreamingProvider,
	messages: Message[],
	ctx: ToolContext,
	signal: AbortSignal,
): Promise<TurnOutcome> {
	for (let step = 0; step < MAX_STEPS; step++) {
		// ── 1. Stream the model's response ───────────────────
		//
		// Print and accumulate at once. On an interruption, what was accumulated is still valid.
		let printedText = false;
		let response: Awaited<ReturnType<StreamingProvider["call"]>> | undefined;
		let streamError: { message: string; aborted: boolean } | undefined;
		let partialText = "";

		for await (const event of provider.stream(
			{ system: SYSTEM_PROMPT, messages, tools: registry.specs(), maxTokens: MAX_TOKENS },
			signal,
		)) {
			switch (event.type) {
				case "text_start":
					if (!printedText) {
						process.stdout.write("\n");
						printedText = true;
					}
					break;

				case "text_delta":
					partialText += event.delta;
					// This one line is the entire typewriter effect.
					process.stdout.write(event.delta);
					break;

				case "text_end":
					process.stdout.write("\n");
					break;

				case "tool_call":
					console.log(dim(`  → ${event.name}(${summarizeArgs(event.args)})`));
					break;

				case "done":
					response = event.response;
					break;

				case "error":
					streamError = { message: event.message, aborted: event.aborted };
					break;
			}
		}

		// ── 2. Handle a stream failure or interruption ──────
		//
		// This is the most important passage in the lesson.
		if (streamError) {
			if (streamError.aborted) {
				console.log(yellow("\n\n[interrupted]"));

				// Interruption point A: the model is mid-sentence.
				//
				// Text already printed has been **seen** by the user. Discarding it makes the
				// conversation history disagree with what the user saw, and the model will later
				// contradict itself.
				//
				// So: if anything was said, store it and mark it as truncated.
				if (partialText.trim()) {
					messages.push({
						role: "assistant",
						blocks: [{ type: "text", text: partialText }],
						raw: { role: "assistant", content: partialText },
					});
					messages.push({
						role: "user",
						text: "[I interrupted your last reply. Wait for my next instruction; do not resume on your own.]",
					});
				}
				// Interrupted before saying anything → the history is unpolluted and nothing needs doing.
				return { aborted: true };
			}

			console.log(red(`\n[stream failed] ${streamError.message}`));
			return { aborted: false };
		}

		if (!response) {
			console.log(red("\n[the stream did not end cleanly]"));
			return { aborted: false };
		}

		// ── 3. The normal path, as in Lessons 1-2 ───────────
		messages.push({ role: "assistant", blocks: response.blocks, raw: response.raw });

		if (response.stopReason === "refusal") {
			console.log(red("\n[the model refused this request]"));
			return { aborted: false };
		}
		if (response.stopReason === "max_tokens") {
			console.log(red(`\n[output hit the ${MAX_TOKENS} token cap]`));
			return { aborted: false };
		}

		const toolCalls = response.blocks.filter((b) => b.type === "toolCall");
		if (toolCalls.length === 0) return { aborted: false };

		// ── 4. Execute the tools ────────────────────────────
		//
		// Interruption point B: a tool is mid-execution.
		//
		// There is a hard rule here: **every tool call must have a matching result**,
		// or the next request comes back from the API as a 400.
		//
		// So even when interrupted, the tools that did not run still need a "cancelled" result.
		const results: ToolResult[] = [];
		let abortedDuringTools = false;

		for (const call of toolCalls) {
			if (abortedDuringTools || signal.aborted) {
				// Already interrupted → append a cancellation result rather than executing
				abortedDuringTools = true;
				results.push({
					toolCallId: call.id,
					toolName: call.name,
					content: "Cancelled: the user interrupted before this tool ran.",
					isError: true,
				});
				continue;
			}

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

		// Push only **after** every result is complete, so the history is always in a legal state.
		messages.push({ role: "toolResult", results });

		if (abortedDuringTools || signal.aborted) {
			console.log(yellow("\n[interrupted]"));
			// Interruption point C: the tool results are complete and the history is legal.
			// Add a user message describing what happened, so the model knows next round.
			messages.push({
				role: "user",
				text: "[I interrupted your tool execution. Wait for my next instruction.]",
			});
			return { aborted: true };
		}
	}

	console.log(red(`\n[hit the ${MAX_STEPS}-step cap. Type "continue" to let it carry on.]`));
	return { aborted: false };
}

// ─────────────────────────────────────────────────────────────

function createApprover(reader: LineReader) {
	return async (request: ApprovalRequest): Promise<boolean> => {
		if (AUTO_APPROVE || alwaysAllow.has(request.toolName)) return true;

		console.log(`\n${yellow("┌ approval needed")}`);
		console.log(`${yellow("│")} ${request.summary}`);
		console.log(yellow("└"));

		const line = await reader.next(
			`  ${yellow("[y]")} allow  ${yellow("[a]")} always  ${yellow("[n]")} deny › `,
		);
		if (line === null) {
			console.log(dim("  (no input to read; treated as a denial)"));
			return false;
		}
		const answer = line.trim().toLowerCase();

		if (answer === "a") {
			alwaysAllow.add(request.toolName);
			return true;
		}
		return answer === "y" || answer === "yes";
	};
}

function summarizeArgs(args: Record<string, unknown>): string {
	return Object.entries(args)
		.map(([key, value]) => {
			const text = typeof value === "string" ? value : JSON.stringify(value);
			return `${key}: ${JSON.stringify(text.length > 50 ? `${text.slice(0, 50)}…` : text)}`;
		})
		.join(", ");
}

function firstLine(text: string): string {
	const line = text.split("\n")[0] ?? "";
	return line.length > 100 ? `${line.slice(0, 100)}…` : line;
}

// ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
	const provider = selectStreamingProvider();
	const messages: Message[] = [];
	const reader = new LineReader();

	installSigintHandler(reader);

	const ctx: ToolContext = {
		root: ROOT,
		approve: createApprover(reader),
		log: (line) => console.log(dim(`    │ ${line}`)),
	};

	console.log(dim(`provider: ${provider.name}  model: ${provider.model}`));
	console.log(dim("Ctrl+C interrupts while it is generating; Ctrl+C when idle exits\n"));

	try {
		while (true) {
			const line = await reader.next("\x1b[36m> \x1b[0m");
			if (line === null) break; // stdin ended
			const input = line.trim();
			if (!input) continue;
			if (input === "/exit") break;

			messages.push({ role: "user", text: input });

				// A new controller per turn. An interruption belongs to **this** turn
				// and does not affect the next.
			currentRun = new AbortController();
			try {
				await runTurn(provider, messages, ctx, currentRun.signal);
			} finally {
				currentRun = undefined;
			}
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
