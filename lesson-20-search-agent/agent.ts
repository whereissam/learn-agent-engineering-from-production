/**
 * Lesson 20: the smallest search agent
 *
 * This lesson's `runTurn` is identical to Lesson 6's, and Lesson 6's is identical to Lesson 3's.
 * What changes is still those two things: **the tools** and **the system prompt**.
 *
 *   Lesson 3   read_file / write_file / bash      → coding agent
 *   Lesson 6   query_telemetry / find_anomalies   → an incident analysis agent
 *   Lesson 20  web_search                          → search agent
 *
 * A whole AI Search part is beginning, and the opening move is not a new architecture
 * but a loop with one tool. **See what is missing before filling it in.**
 *
 * Run:
 *   bun run lesson-20                     with a real model
 *   PROVIDER=fake bun run lesson-20       no key needed; a hardcoded trajectory
 */

import { resolve } from "node:path";
import { LineReader } from "../shared/repl.ts";
import { selectStreamingProvider } from "../shared/streaming/index.ts";
import type { Message, StreamingProvider, ToolResult } from "../shared/streaming/types.ts";
import {
	type ApprovalRequest,
	type ToolContext,
	ToolRegistry,
} from "../shared/tools/index.ts";
import { fakeSearchProvider } from "./fake-provider.ts";
import { webSearchTool } from "./tools/search.ts";

const MAX_TOKENS = 8000;
const MAX_STEPS = 12;

/**
 * Half of this lesson's system prompt is about what to do when you do not know.
 *
 * Because a search agent's biggest risk is not failing to find data but **starting to fill in the gaps**.
 * The model holds only snippets, and they read like complete answers, so it naturally
 * states a snippet as if it were the page's conclusion.
 *
 * Note rule 4: this is the search version of Lesson 6's "a conclusion needs evidence".
 * The difference is an extra level for "cannot confirm" — because in search,
 * "I only saw a snippet and cannot confirm" is itself a correct answer.
 */
const SYSTEM_PROMPT = `You are a research assistant. You answer questions using web search.

## Your only tool
web_search returns ranked results: title, URL, publication date, and a short snippet.
You cannot open pages in this session. Snippets are all you get.

## Rules
1. Search before you answer. Do not answer from memory: these pages are not in your
   training data, and the user is asking about what is on the web.
2. The index is keyword-based and English-only. Turn the user's question into English
   keyword queries. If a query returns nothing, try different words rather than giving up.
3. One query is rarely enough. A good search session uses several queries that attack the
   question from different angles (project name, capability, robot model, license).
4. Label every claim you make:
   - CONFIRMED: a snippet you retrieved literally says it. Quote the URL.
   - UNVERIFIED: it looks likely from a title or a partial snippet, but no snippet states it.
   Never present UNVERIFIED as fact. "I could not verify this from snippets alone" is a
   correct and useful answer.
5. Prefer primary sources (project repository, official docs, release notes) over roundup
   articles. Check the publication date: in a fast-moving area a listicle from last year is
   often wrong.
6. If two sources disagree, say so explicitly and give both URLs. Do not silently pick one.

Answer in the same language the user writes in.`;

const registry = new ToolRegistry([webSearchTool]);

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;

const AUTO_APPROVE = process.env.AUTO_APPROVE === "1";
const alwaysAllow = new Set<string>();

let currentRun: AbortController | undefined;

function handleInterrupt(): void {
	if (currentRun && !currentRun.signal.aborted) {
		currentRun.abort();
		return;
	}
	console.log(dim("\nGoodbye."));
	process.exit(0);
}

// ─────────────────────────────────────────────────────────────
// The agent loop: identical to Lesson 3's and Lesson 6's, not one line changed
// ─────────────────────────────────────────────────────────────

export async function runTurn(
	provider: StreamingProvider,
	messages: Message[],
	ctx: ToolContext,
	signal: AbortSignal,
	quiet = false,
): Promise<void> {
	for (let step = 0; step < MAX_STEPS; step++) {
		let response: Awaited<ReturnType<StreamingProvider["call"]>> | undefined;
		let streamError: { message: string; aborted: boolean } | undefined;
		let partialText = "";

		for await (const event of provider.stream(
			{ system: SYSTEM_PROMPT, messages, tools: registry.specs(), maxTokens: MAX_TOKENS },
			signal,
		)) {
			switch (event.type) {
				case "text_start":
					if (!quiet) process.stdout.write("\n");
					break;
				case "text_delta":
					partialText += event.delta;
					if (!quiet) process.stdout.write(event.delta);
					break;
				case "text_end":
					if (!quiet) process.stdout.write("\n");
					break;
				case "tool_call":
					if (!quiet) console.log(dim(`  → ${event.name}(${summarizeArgs(event.args)})`));
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
			if (streamError.aborted) {
				if (!quiet) console.log(yellow("\n\n[interrupted]"));
				if (partialText.trim()) {
					messages.push({
						role: "assistant",
						blocks: [{ type: "text", text: partialText }],
						raw: { role: "assistant", content: partialText },
					});
					messages.push({
						role: "user",
						text: "[I interrupted your last reply. Wait for my next instruction.]",
					});
				}
				return;
			}
			if (!quiet) console.log(red(`\n[stream failed] ${streamError.message}`));
			throw new Error(streamError.message);
		}

		if (!response) throw new Error("Stream ended without a response");

		messages.push({ role: "assistant", blocks: response.blocks, raw: response.raw });

		if (response.stopReason === "refusal") {
			if (!quiet) console.log(red("\n[the model refused this request]"));
			return;
		}
		if (response.stopReason === "max_tokens") {
			if (!quiet) console.log(red(`\n[output hit the ${MAX_TOKENS} token cap]`));
			return;
		}

		const toolCalls = response.blocks.filter((b) => b.type === "toolCall");
		if (toolCalls.length === 0) return;

		const results: ToolResult[] = [];
		for (const call of toolCalls) {
			if (signal.aborted) {
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
				if (!quiet) console.log(dim(`  ${green("✓")} ${firstLine(content)}`));
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				results.push({ toolCallId: call.id, toolName: call.name, content: message, isError: true });
				if (!quiet) console.log(`  ${red("✗")} ${red(firstLine(message))}`);
			}
		}

		messages.push({ role: "toolResult", results });

		if (signal.aborted) {
			if (!quiet) console.log(yellow("\n[interrupted]"));
			return;
		}
	}

	if (!quiet) console.log(red(`\n[hit the ${MAX_STEPS}-step cap]`));
}

export { registry, SYSTEM_PROMPT };

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
			return `${key}=${text.length > 60 ? `${text.slice(0, 60)}…` : text}`;
		})
		.join(" ");
}

function firstLine(text: string): string {
	const line = text.split("\n")[0] ?? "";
	return line.length > 90 ? `${line.slice(0, 90)}…` : line;
}

/**
 * This lesson has its own fake provider.
 *
 * `shared/streaming/fake.ts` was written for the Lesson 1-5 coding agent;
 * it calls list_files / read_file, which here only earns "Unknown tool".
 *
 * Design principle 1 says every lesson must run without a key, so this lesson brings its own
 * hardcoded trajectory. What it acts out is not "how clever the model is" but the opposite —
 * **what answering from snippets alone gets wrong**.
 */
function selectProvider(): StreamingProvider {
	if (process.env.PROVIDER?.toLowerCase() === "fake") return fakeSearchProvider();
	return selectStreamingProvider();
}

async function main(): Promise<void> {
	const provider = selectProvider();
	const messages: Message[] = [];
	const reader = new LineReader();
	reader.raw.on("SIGINT", handleInterrupt);
	process.on("SIGINT", handleInterrupt);

	const ctx: ToolContext = {
			// This lesson has no file sandbox; the tool only reads its own corpus
		root: resolve(import.meta.dirname, "corpus"),
		approve: createApprover(reader),
		log: (line) => console.log(dim(`    │ ${line}`)),
	};

	console.log(dim(`provider: ${provider.name}  model: ${provider.model}`));
	console.log(dim(`tools:    ${registry.specs().map((t) => t.name).join(", ")}`));
	console.log(
		dim("Try: which open source projects can retarget video motion onto a Unitree G1?\n"),
	);

	try {
		while (true) {
			const line = await reader.next("\x1b[36m> \x1b[0m");
			if (line === null) break;
			const input = line.trim();
			if (!input) continue;
			if (input === "/exit") break;

			messages.push({ role: "user", text: input });
			currentRun = new AbortController();
			try {
				await runTurn(provider, messages, ctx, currentRun.signal);
			} catch (error) {
				console.log(red(`\n[error] ${(error as Error).message}`));
			} finally {
				currentRun = undefined;
			}
			console.log();
		}
	} finally {
		reader.close();
	}
}

// Later lessons import this agent as a module, and must not start a REPL then
if (import.meta.main) {
	try {
		await main();
	} catch (error) {
		console.error(`\n${error instanceof Error ? error.message : String(error)}`);
		process.exit(1);
	}
}
