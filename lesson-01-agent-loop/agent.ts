/**
 * Lesson 1 - the smallest working agent loop
 *
 * This file is an AI agent. No framework, no provider SDK —
 * it knows only the neutral interface defined in ../shared/providers/types.ts.
 *
 * Against Pi: runLoop() in packages/agent/src/agent-loop.ts (lines 155-275)
 *
 * Run: bun run lesson-01-agent-loop/agent.ts
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { selectProvider } from "../shared/providers/index.ts";
import { LineReader } from "../shared/repl.ts";
import type { Message, Provider, ToolResult, ToolSpec } from "../shared/providers/types.ts";

// ─────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────

/** The agent may only read things under this directory. The most primitive sandbox there is. */
const ROOT = resolve(import.meta.dirname, "playground");

const MAX_TOKENS = 16000;

const SYSTEM_PROMPT = `You are a coding agent exploring a small project.

You can read files with the read_file tool. Paths are relative to the project root.
If you don't know where to look, start by reading README.md.
Always read a file before making claims about it - never guess at its contents.
Answer in the same language the user writes in.`;

// ─────────────────────────────────────────────────────────────
// Tool definitions
//
// A description is not a comment but part of the prompt. The model decides whether to call and how
// to fill the arguments from name plus description plus parameters alone. Write it badly and it is used badly.
//
// Against Pi: packages/agent/src/harness/tools/read.ts:50
// ─────────────────────────────────────────────────────────────

const readFileTool: ToolSpec = {
	name: "read_file",
	description:
		"Read the full contents of a text file in the project. " +
		"Use this before answering any question about what the code does.",
	parameters: {
		type: "object",
		properties: {
			path: {
				type: "string",
				description: "File path relative to the project root, e.g. 'src/server.ts'",
			},
		},
		required: ["path"],
	},
};

const TOOLS: ToolSpec[] = [readFileTool];

// ─────────────────────────────────────────────────────────────
// Tool execution
//
// The contract: return a string on success, throw on failure.
// Do not disguise an error message as a normal result — the loop below wraps a throw into
// an isError result and sends it back, and only then does the model know to try another way.
//
// Against Pi: types.ts:388 "Throw on failure instead of encoding errors in content."
// ─────────────────────────────────────────────────────────────

async function executeTool(name: string, args: Record<string, unknown>): Promise<string> {
	if (name !== "read_file") {
		throw new Error(`Unknown tool: ${name}`);
	}

	const path = args.path;
	if (typeof path !== "string") {
		throw new Error("read_file requires a string 'path' argument");
	}

	const target = resolve(ROOT, path);

	// args comes from the model, so it is untrusted input like everything else.
	// Without these three lines, the model writes "../../../.ssh/id_rsa" and you dutifully read it out.
	if (target !== ROOT && !target.startsWith(`${ROOT}/`)) {
		throw new Error(`Path escapes the project root: ${path}`);
	}

	return await readFile(target, "utf8");
}

// ─────────────────────────────────────────────────────────────
// The agent loop — these 50 lines are all there is to an "AI agent"
// ─────────────────────────────────────────────────────────────

async function runTurn(provider: Provider, messages: Message[]): Promise<void> {
	while (true) {
			// 1. Call the model. This is the only place in the whole agent that talks to an LLM.
		const response = await provider.call({
			system: SYSTEM_PROMPT,
			messages,
			tools: TOOLS,
			maxTokens: MAX_TOKENS,
		});

			// 2. Push the model's reply back into history. blocks for us to read, raw to hand back to the provider later.
		messages.push({ role: "assistant", blocks: response.blocks, raw: response.raw });

			// 3. Look at stopReason before reading the content.
			//    On a refusal or a truncation, blocks may be empty or half-formed.
		if (response.stopReason === "refusal") {
			console.log("\n[the model refused this request]");
			return;
		}
		if (response.stopReason === "max_tokens") {
			console.log(`\n[output hit the ${MAX_TOKENS} token cap; this turn is not trustworthy]`);
			return;
		}

			// 4. Print what the model said and which tools it wants to call.
		for (const block of response.blocks) {
			if (block.type === "text") {
				console.log(`\n${block.text}`);
			} else {
				console.log(dim(`  → ${block.name}(${JSON.stringify(block.args)})`));
			}
		}

			// 5. No tool calls → this turn ends and control returns to the user.
		//
			//    Note this checks whether there **are** tool calls, not stopReason === "tool_use".
			//    stopReason is the provider's account; blocks are the fact. Go with the fact.
		const toolCalls = response.blocks.filter((b) => b.type === "toolCall");
		if (toolCalls.length === 0) {
			return;
		}

			// 6. Execute every tool. One assistant message may hold several tool calls
			//    (models call in parallel); run them all and send the results back together.
		const results: ToolResult[] = [];
		for (const call of toolCalls) {
			try {
				results.push({
					toolCallId: call.id,
					toolName: call.name,
					content: await executeTool(call.name, call.args),
				});
			} catch (error) {
					// A failed tool must still return a result and must not be silently dropped.
					// Without a matching tool result, the next request is rejected by the API with a 400.
				const message = error instanceof Error ? error.message : String(error);
				results.push({
					toolCallId: call.id,
					toolName: call.name,
					content: message,
					isError: true,
				});
				console.log(`  \x1b[31m✗ ${message}\x1b[0m`);
			}
		}

		messages.push({ role: "toolResult", results });

			// 7. Back to step 1, so the model can continue with the tool results in view.
	}
}

// ─────────────────────────────────────────────────────────────
// REPL
// ─────────────────────────────────────────────────────────────

function dim(text: string): string {
	return `\x1b[2m${text}\x1b[0m`;
}

async function main(): Promise<void> {
	const provider = selectProvider();

		// messages is the "session". It lives only in memory and vanishes when the program exits.
		// Lesson 4 persists it to disk.
	const messages: Message[] = [];

	const reader = new LineReader();

	console.log(dim(`provider: ${provider.name}  model: ${provider.model}`));
	console.log(dim("Ask a question. /exit or Ctrl+C to leave\n"));

	try {
		while (true) {
			const line = await reader.next("\x1b[36m> \x1b[0m");
			if (line === null) break; // stdin closed (Ctrl+D, or piped input ran out)

			const input = line.trim();
			if (!input) continue;
			if (input === "/exit") break;

			messages.push({ role: "user", text: input });
			await runTurn(provider, messages);
			console.log();
		}
	} finally {
		reader.close();
	}
}

// On a configuration error (a missing API key, say), say one clear sentence rather than spraying a stack trace.
try {
	await main();
} catch (error) {
	console.error(`\n${error instanceof Error ? error.message : String(error)}`);
	process.exit(1);
}
