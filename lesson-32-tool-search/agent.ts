/**
 * Lesson 32, the real-model half: with 200 tools in front of it, does the model
 * call the right one — and what does that cost?
 *
 * `demo.ts` measured bytes and BM25 ranks. Both are deterministic and neither is
 * the thing you care about. This program runs the same 12 tasks against a real
 * provider in three modes:
 *
 *   ceiling  all 200 tool schemas in one request, once. This is the mechanism
 *            switched off, and on some providers it does not reach the model at
 *            all. Whatever comes back is recorded verbatim.
 *   flat     the largest tool list the provider will accept, containing the
 *            expected tool plus a deterministic sample of the rest. This is the
 *            fair accuracy baseline: one call, no retrieval, no excuses.
 *   search   2 meta-tools. The model writes its own query, reads five names,
 *            loads one, and only then calls it. Three or four calls.
 *
 * Two things this measures that demo.ts cannot:
 *
 *   1. **the model writes the query.** demo.ts fed BM25 the user's raw sentence.
 *      A model asked to search will not type the sentence verbatim, and whether
 *      that closes the gap is the whole question.
 *   2. **whether the request is legal.** A tool list has a maximum length, and a
 *      request that is rejected has no accuracy at all.
 *
 * Run:
 *   PROVIDER=openai bun run lesson-32:agent
 *   MODE=search bun run lesson-32:agent    # one mode only
 *   FLAT_LIMIT=64 bun run lesson-32:agent  # shrink the flat baseline
 */

import { CATALOG, type Task, TASKS } from "./catalog.ts";
import { selectStreamingProvider } from "../shared/streaming/index.ts";
import { drain } from "../shared/streaming/types.ts";
import type { Message, ModelResponse, StreamingProvider, ToolSpec } from "../shared/streaming/types.ts";
import { ToolIndex, ToolSearchSession } from "./tool-search.ts";

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;

const SYSTEM =
	"You are an operations agent. Use exactly one tool to do what the user asks, then stop. " +
	"Do not ask clarifying questions; pick the most appropriate tool and invent reasonable arguments.";

/**
 * Mastra's injected instruction, copied from `tool-search.ts:438-440`.
 *
 * It is one sentence of prompt and it is not decoration — the `search-bare` mode
 * exists to measure what happens without it. A model handed two unfamiliar
 * meta-tools has no reason to believe there is a catalogue behind them.
 */
const SEARCH_INSTRUCTION =
	"To discover available tools, call search_tools with a keyword query. " +
	"To add one or more tools to the conversation, call load_tool with a toolName or toolNames array. " +
	"Tools must be loaded before they can be used.";

/**
 * The output budget for one call.
 *
 * This number is not a detail. A reasoning model spends this allowance on thinking
 * before it emits anything, so too small a budget produces a response with no text
 * and no tool call — which reads exactly like "the model declined to use a tool"
 * and is nothing of the sort. Lesson 26 measured the same trap from the cost side.
 */
const MAX_TOKENS = Number(process.env.MAX_TOKENS ?? 8192);
/** How many search/load rounds the model gets before we give up on it. */
const MAX_ROUNDS = 6;
/** The flat baseline's size. 128 is OpenAI's documented ceiling and the reason this number is here. */
const FLAT_LIMIT = Number(process.env.FLAT_LIMIT ?? 128);

const specs: ToolSpec[] = CATALOG.map(({ service: _service, ...spec }) => spec);
const index = new ToolIndex(specs);

interface Outcome {
	task: Task;
	/** The catalogue tool the model finally called, or null if it never called one. */
	called: string | null;
	correct: boolean;
	inputTokens: number;
	calls: number;
	/** Search mode only: the query the model wrote for itself. */
	query?: string;
	/** What the model said instead of calling a tool. The diagnostic that matters when `called` is null. */
	text?: string;
	error?: string;
}

/**
 * The flat baseline's tool list.
 *
 * It **always contains the expected tool**. Truncating a catalogue to fit and
 * hoping the answer survived is what people actually do, but measuring accuracy
 * that way measures the truncation, not the model. Everything else is a
 * deterministic stride through the catalogue so every task sees the same
 * distractor mix.
 */
function flatTools(task: Task, limit: number): ToolSpec[] {
	const expected = specs.find((s) => s.name === task.expected);
	if (!expected) throw new Error(`${task.expected} not in catalogue`);
	const others = specs.filter((s) => s.name !== task.expected);
	const stride = Math.max(1, Math.floor(others.length / (limit - 1)));
	const picked: ToolSpec[] = [];
	for (let i = 0; picked.length < limit - 1 && i < others.length; i += stride) {
		const spec = others[i];
		if (spec) picked.push(spec);
	}
	for (const spec of others) {
		if (picked.length >= limit - 1) break;
		if (!picked.includes(spec)) picked.push(spec);
	}
	return [expected, ...picked];
}

async function runFlat(provider: StreamingProvider, task: Task, tools: ToolSpec[]): Promise<Outcome> {
	const messages: Message[] = [{ role: "user", text: task.prompt }];
	try {
		const response = await drain(
			provider.stream({ system: SYSTEM, messages, tools, maxTokens: MAX_TOKENS }),
		);
		const call = response.blocks.find((b) => b.type === "toolCall");
		const called = call?.type === "toolCall" ? call.name : null;
		return {
			task,
			called,
			correct: called === task.expected,
			inputTokens: response.usage?.input ?? 0,
			calls: 1,
			text: called ? undefined : `(stopReason=${response.stopReason})`,
		};
	} catch (error) {
		return {
			task,
			called: null,
			correct: false,
			inputTokens: 0,
			calls: 1,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

/**
 * Search mode. This is a real agent loop, and the two meta-tools are executed by
 * us exactly like any other tool — that is the point of the design. Nothing in the
 * provider knows tool search exists.
 */
async function runSearch(provider: StreamingProvider, task: Task, system: string): Promise<Outcome> {
	const session = new ToolSearchSession(index, () => true, 5);
	const messages: Message[] = [{ role: "user", text: task.prompt }];
	let inputTokens = 0;
	let calls = 0;
	let query: string | undefined;

	for (let round = 0; round < MAX_ROUNDS; round++) {
		let response: ModelResponse;
		try {
			response = await drain(
				provider.stream({
					system,
					messages,
					tools: session.requestTools(),
					maxTokens: MAX_TOKENS,
				}),
			);
		} catch (error) {
			return {
				task,
				called: null,
				correct: false,
				inputTokens,
				calls,
				query,
				error: error instanceof Error ? error.message : String(error),
			};
		}

		calls++;
		inputTokens += response.usage?.input ?? 0;
		messages.push({ role: "assistant", blocks: response.blocks, raw: response.raw });

		const toolCalls = response.blocks.filter((b) => b.type === "toolCall");
		if (toolCalls.length === 0) {
			const text = response.blocks
				.filter((b) => b.type === "text")
				.map((b) => (b.type === "text" ? b.text : ""))
				.join(" ")
				.trim();
			return {
				task,
				called: null,
				correct: false,
				inputTokens,
				calls,
				query,
				text: text || `(empty response, stopReason=${response.stopReason})`,
			};
		}

		const results: Array<{ toolCallId: string; toolName: string; content: string }> = [];
		for (const call of toolCalls) {
			if (call.type !== "toolCall") continue;

			if (call.name === "search_tools") {
				const q = String(call.args.query ?? "");
				query ??= q;
				results.push({ toolCallId: call.id, toolName: call.name, content: session.search(q).text });
				continue;
			}

			if (call.name === "load_tool") {
				const names = Array.isArray(call.args.toolNames) ? call.args.toolNames.map(String) : [];
				const { loaded, rejected } = session.load(names);
				const parts: string[] = [];
				if (loaded.length > 0) parts.push(`Loaded and now callable: ${loaded.join(", ")}`);
				if (rejected.length > 0) parts.push(`Not available: ${rejected.join(", ")}`);
				results.push({ toolCallId: call.id, toolName: call.name, content: parts.join("\n") });
				continue;
			}

			// Anything else is a catalogue tool: the run is over the moment it is called.
			return { task, called: call.name, correct: call.name === task.expected, inputTokens, calls, query };
		}

		messages.push({ role: "toolResult", results });
	}

	return { task, called: null, correct: false, inputTokens, calls, query, error: "gave up after MAX_ROUNDS" };
}

// ─────────────────────────────────────────────────────────────

const provider = selectStreamingProvider();
const ALL_MODES = ["ceiling", "flat", "search-bare", "search"] as const;
type Mode = (typeof ALL_MODES)[number];
const modes = (process.env.MODE ? [process.env.MODE] : ALL_MODES) as Mode[];

const MODE_LABEL: Record<Mode, string> = {
	ceiling: `all ${specs.length} tools in one request`,
	flat: `${FLAT_LIMIT} tools, expected tool always present`,
	"search-bare": "2 meta-tools, nothing telling the model they exist",
	search: "2 meta-tools + Mastra's injected instruction",
};

console.log(bold("Lesson 32: 200 tools against a real model"));
console.log(
	dim(`provider: ${provider.name}  model: ${provider.model}  catalogue: ${specs.length}  tasks: ${TASKS.length}\n`),
);

const summary: Record<string, { correct: number; tokens: number; calls: number; failed: number }> = {};

for (const mode of modes) {
	// ── The mechanism switched off. One request is enough to learn the answer. ──
	if (mode === "ceiling") {
		console.log(bold(`Mode: ceiling — all ${specs.length} tools in one request`));
		const task = TASKS[0];
		if (!task) throw new Error("no tasks");
		const outcome = await runFlat(provider, task, specs);
		if (outcome.error) {
			console.log(`  ${red("rejected")}  ${outcome.error}`);
			console.log(
				dim(
					"  The mechanism is not off because it is slow or expensive. At this catalogue\n" +
						"  size the request is not a legal request.\n",
				),
			);
		} else {
			console.log(`  ${green("accepted")}  called ${outcome.called}, input tokens ${outcome.inputTokens}`);
			console.log(dim("  This provider takes the whole catalogue. The cost argument still applies.\n"));
		}
		continue;
	}

	console.log(bold(`Mode: ${mode} — ${MODE_LABEL[mode]}`));
	console.log(`  ${"task".padEnd(14)}${"in tok".padStart(8)}${"calls".padStart(7)}  called`);
	console.log(dim(`  ${"─".repeat(74)}`));

	const totals = { correct: 0, tokens: 0, calls: 0, failed: 0 };

	for (const task of TASKS) {
		const outcome =
			mode === "flat"
				? await runFlat(provider, task, flatTools(task, FLAT_LIMIT))
				: await runSearch(provider, task, mode === "search" ? `${SYSTEM}\n\n${SEARCH_INSTRUCTION}` : SYSTEM);
		totals.tokens += outcome.inputTokens;
		totals.calls += outcome.calls;
		if (outcome.correct) totals.correct++;
		if (outcome.error) totals.failed++;

		const label = outcome.error
			? red(outcome.error.slice(0, 60))
			: outcome.correct
				? green(outcome.called ?? "—")
				: `${red(outcome.called ?? "no tool call")} ${dim(`want ${task.expected}`)}`;

		console.log(
			`  ${task.id.padEnd(14)}${String(outcome.inputTokens).padStart(8)}${String(outcome.calls).padStart(7)}  ${label}`,
		);
		if (outcome.query) console.log(dim(`  ${" ".repeat(29)}query: "${outcome.query}"`));
		if (outcome.text) console.log(dim(`  ${" ".repeat(29)}said:  "${outcome.text.replace(/\s+/g, " ").slice(0, 150)}"`));
	}

	console.log(dim(`  ${"─".repeat(74)}`));
	console.log(
		`  correct ${totals.correct}/${TASKS.length}   input tokens ${totals.tokens}   model calls ${totals.calls}` +
			(totals.failed > 0 ? red(`   failures ${totals.failed}`) : ""),
	);
	console.log();
	summary[mode] = totals;
}

const measured = modes.filter((m) => m !== "ceiling" && summary[m]);
if (measured.length > 1) {
	console.log(bold("Side by side"));
	console.log(`  ${"".padEnd(13)}${"correct".padStart(9)}${"in tok".padStart(10)}${"calls".padStart(8)}`);
	for (const mode of measured) {
		const t = summary[mode];
		if (!t) continue;
		const name = mode === "flat" ? `flat(${FLAT_LIMIT})` : mode;
		console.log(
			`  ${name.padEnd(13)}${`${t.correct}/${TASKS.length}`.padStart(9)}` +
				`${String(t.tokens).padStart(10)}${String(t.calls).padStart(8)}`,
		);
	}
	const flat = summary.flat;
	const search = summary.search;
	if (flat && search && search.correct < flat.correct) {
		console.log(
			yellow(
				"\n  Search mode is less accurate than the flat baseline. The index is not the\n" +
					"  reason — read the queries the model wrote, and the README's Step 4.",
			),
		);
	}
}
