/**
 * Four agents that do the same work, assembled four different ways.
 *
 * Each builder produces the sequence of requests a five-turn conversation would
 * send. They differ only in **where** the volatile parts sit, and that is the
 * entire subject of the lesson.
 *
 * Three of the four are not inventions. They are the shapes this series already
 * taught, reproduced faithfully enough to measure:
 *
 *   `memoryFirst`  Lesson 15 builds recalled memories into `buildSystemPrompt()`
 *   `toolsGrowing` Lesson 32's `session.requestTools()` gains a tool per turn
 *   `volatileLast` the same information, moved — which is the whole fix
 */

import type { Message, ToolSpec } from "../shared/providers/types.ts";
import type { RequestShape } from "./prefix.ts";

export const TURNS = 5;

/**
 * A value that is different every time this program runs.
 *
 * Without it the experiment measures the wrong thing, and it took a second run
 * to notice. The volatile fields below were originally deterministic — a fixed
 * `21:0N:00Z` timestamp — so that runs would be reproducible. The consequence is
 * that run 2 sends **byte-identical** requests to run 1, hits the cache run 1
 * populated, and reports 99% for every configuration including the broken ones.
 *
 * > A prompt-cache experiment that is perfectly repeatable is not measuring a
 * > cache. Repeatability has to live in the offline half (`demo.ts`), and the
 * > online half has to be genuinely cold each time.
 *
 * The nonce goes at a **stable position in every builder** — the first line of
 * the system prompt, which never changes within a run. That is what makes each
 * configuration cold across runs without disturbing prefix stability inside one.
 * Putting it only in the volatile builders was the first attempt and it was
 * wrong: the untouched configurations then went on hitting the previous run's
 * cache and reported 99% whatever they did.
 */
export const RUN_ID = Math.random().toString(36).slice(2, 10);

/**
 * A long, stable instruction block.
 *
 * It has to be long for the experiment to mean anything: OpenAI does not cache
 * below roughly 1024 tokens, so a short system prompt would report zero cached
 * tokens in every configuration and prove nothing. Being forced to write this
 * comment is itself the first finding — **a small agent cannot observe this
 * effect at all**, which is why it goes unnoticed until the bill arrives.
 */
export const SYSTEM_RULES = [
	"You are an operations agent for a payments company.",
	...Array.from(
		{ length: 400 },
		(_, i) =>
			`Rule ${i}: for case class ${i}, confirm the account identifier, check the ledger for a prior ` +
			`entry, and record the outcome with the operator's name attached.`,
	),
].join("\n");

/**
 * What every builder actually sends as the stable head of its system prompt.
 *
 * The nonce is first and constant for the life of the process, so it is part of
 * the cacheable prefix rather than a hole in it.
 */
export const SYSTEM_BASE = `Session ${RUN_ID}\n${SYSTEM_RULES}`;

/** A small stable tool set. Lesson 32 has the 200-tool version; five is enough here. */
export const BASE_TOOLS: ToolSpec[] = [
	"lookup_account",
	"read_ledger",
	"write_ledger",
	"notify_operator",
	"close_case",
].map((name) => ({
	name,
	description: `Operations tool: ${name.replace(/_/g, " ")}. Takes a case id and returns the result.`,
	parameters: { type: "object", properties: { case_id: { type: "string" } }, required: ["case_id"] },
}));

/** Tools that arrive later, the way Lesson 32's `load_tool` adds them mid-conversation. */
export const LATER_TOOLS: ToolSpec[] = [
	"escalate_case",
	"refund_charge",
	"freeze_account",
	"export_report",
	"schedule_review",
].map((name) => ({
	name,
	description: `Operations tool: ${name.replace(/_/g, " ")}. Takes a case id and returns the result.`,
	parameters: { type: "object", properties: { case_id: { type: "string" } }, required: ["case_id"] },
}));

/** What the user says on turn n. Identical across all four builders, so it cannot explain any difference. */
export function userTurn(n: number): string {
	return `Case ${n}: the operator asks what to check first. Answer in one sentence.`;
}

/**
 * What Lesson 15's memory layer would have recalled by turn n.
 *
 * Growing, and different every turn — which is correct behaviour for a memory
 * system and catastrophic for a prefix, depending only on where it is put.
 */
export function recalledMemories(n: number): string[] {
	return Array.from(
		{ length: n },
		(_, i) => `Recalled: on case ${i}, the operator preferred the ledger check first.`,
	);
}

export type Builder = (turn: number) => RequestShape;

/** Messages accumulate by appending, which is the one growth pattern a prefix cache tolerates. */
function historyUpTo(turn: number): Message[] {
	const messages: Message[] = [];
	for (let i = 1; i <= turn; i++) {
		messages.push({ role: "user", text: userTurn(i) });
		if (i < turn) messages.push({ role: "assistant", blocks: [{ type: "text", text: `Checked case ${i}.` }], raw: null });
	}
	return messages;
}

/** The control. Nothing volatile anywhere; the request only grows at the end. */
export const stable: Builder = (turn) => ({
	system: SYSTEM_BASE,
	tools: BASE_TOOLS,
	messages: historyUpTo(turn),
});

/**
 * One timestamp, at the front.
 *
 * The most common single line in a production system prompt, and the reason this
 * lesson exists.
 */
export const timestampFirst: Builder = (turn) => ({
	system: `Current time: 2026-09-09T21:${String(turn).padStart(2, "0")}:00Z\n${SYSTEM_BASE}`,
	tools: BASE_TOOLS,
	messages: historyUpTo(turn),
});

/** Lesson 15's shape: recalled memory built into the system prompt. */
export const memoryFirst: Builder = (turn) => ({
	system: `${recalledMemories(turn).join("\n")}\n${SYSTEM_BASE}`,
	tools: BASE_TOOLS,
	messages: historyUpTo(turn),
});

/**
 * Lesson 32's shape: the active tool set grows as tools are loaded.
 *
 * Predicted to break the cache, because the tool list is part of the prefix.
 * It does not, and the measured reason is the lesson: this grows by
 * **appending**, exactly like the message list. See `toolsReordered` for the
 * shape that does break.
 */
export const toolsGrowing: Builder = (turn) => ({
	system: SYSTEM_BASE,
	tools: [...BASE_TOOLS, ...LATER_TOOLS.slice(0, turn - 1)],
	messages: historyUpTo(turn),
});

/**
 * The same five tools every turn, in a different order.
 *
 * Nothing is added and nothing is removed — a reader diffing the two requests
 * would call them identical, and every tool the model can call is the same. This
 * is what a tool list assembled from a `Set`, a directory listing, an object's
 * key order, or a relevance ranking looks like from one turn to the next.
 */
export const toolsReordered: Builder = (turn) => ({
	system: SYSTEM_BASE,
	tools: [...BASE_TOOLS.slice(turn % BASE_TOOLS.length), ...BASE_TOOLS.slice(0, turn % BASE_TOOLS.length)],
	messages: historyUpTo(turn),
});

/**
 * The fix, and the point of the lesson: the same volatile content, last.
 *
 * The time and the recalled memories are still present and the model still sees
 * all of it. Only the position changed.
 */
export const volatileLast: Builder = (turn) => {
	const messages = historyUpTo(turn);
	messages.push({
		role: "user",
		text: [
			`Current time: 2026-09-09T21:${String(turn).padStart(2, "0")}:00Z`,
			...recalledMemories(turn),
		].join("\n"),
	});
	return { system: SYSTEM_BASE, tools: BASE_TOOLS, messages };
};

export const BUILDERS: Array<{ id: string; label: string; build: Builder; from: string }> = [
	{ id: "stable", label: "stable prefix", build: stable, from: "the control" },
	{ id: "timestamp", label: "timestamp first", build: timestampFirst, from: "one line in a system prompt" },
	{ id: "memory", label: "memory in system", build: memoryFirst, from: "Lesson 15's shape" },
	{ id: "tools", label: "tool list grows", build: toolsGrowing, from: "Lesson 32's shape" },
	{ id: "reorder", label: "tool list reordered", build: toolsReordered, from: "same tools, different order" },
	{ id: "fixed", label: "volatile last", build: volatileLast, from: "the same content, moved" },
];
