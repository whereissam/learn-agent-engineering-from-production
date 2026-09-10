/**
 * The six things an operator asks a week later, and whether each record can
 * answer them.
 *
 * The scoring rule is the part that has to be fair, so it is stated here rather
 * than buried: **a record answers a question if the answer can be computed from
 * it without guessing.** Not "a clever person could probably work it out" — that
 * is the same standard Lesson 29 applies to evidence, and the reason two of
 * these six are answerable from a flat log.
 *
 * If every question favoured spans this file would be an advertisement. Three do
 * not.
 */

import { childrenOf, costOfSubtree, type LogLine, type Span, subtree, tokensOfSubtree } from "./trace.ts";

export interface Question {
	id: string;
	text: string;
	/** Computed from the span tree. `undefined` means the tree cannot answer either. */
	fromSpans(spans: Span[], roots: Record<string, string>): string | undefined;
	/** Computed from the flat log alone. `undefined` means it cannot be answered. */
	fromLog(log: LogLine[]): string | undefined;
	/** Why the log can or cannot, in one line. */
	note: string;
}

export const QUESTIONS: Question[] = [
	{
		id: "what-happened",
		text: "What did the agent do between 08:00 and 08:04?",
		fromSpans: (spans) => `${spans.length} operations`,
		fromLog: (log) => `${log.length} operations`,
		note: "a log is exactly this. Both answer it, and the log is the simpler tool",
	},
	{
		id: "approvals",
		text: "Which actions were auto-allowed and which were asked about?",
		fromSpans: (spans) => {
			const decisions = spans.filter((span) => span.attributes.decision);
			return decisions.map((span) => `${span.name}=${span.attributes.decision}`).join(", ");
		},
		fromLog: (log) => {
			const decisions = log.filter((line) => line.attributes.decision);
			return decisions.map((line) => `${line.message}=${line.attributes.decision}`).join(", ");
		},
		note: "Lesson 8's Exercise 4 already answers this, and a log answers it fine",
	},
	{
		id: "whose-request",
		text: "That stripe_create_refund call — which user request was it part of?",
		fromSpans: (spans) => {
			const call = spans.find((span) => span.attributes.tool === "stripe_create_refund");
			if (!call?.parentSpanId) return undefined;
			return spans.find((span) => span.id === call.parentSpanId)?.name;
		},
		// The actor is on the line, but "which request" is not the same as "which
		// person" — one person can have several requests running.
		fromLog: () => undefined,
		note: "a log line records an event; 'which event caused me' is not a property of an event",
	},
	{
		id: "cost-of-request",
		text: "What did Dana's refund request cost in total?",
		fromSpans: (spans, roots) => `${costOfSubtree(spans, roots.dana ?? "")}c`,
		fromLog: (log) => {
			// Summing by actor is the workaround everyone reaches for, so it is
			// actually attempted here rather than dismissed. It returns a number, and
			// the number is wrong: Dana has two requests open and the log cannot tell
			// which line belongs to which. A wrong answer is not an answer.
			const byActor = log
				.filter((line) => line.actor === "dana")
				.reduce((total, line) => total + (line.attributes.costCents ?? 0), 0);
			return byActor === 30 ? `${byActor}c` : undefined;
		},
		note: "summing by actor returns 39c — Dana's second request folded in. One person, two tabs, and the proxy is gone",
	},
	{
		id: "subagent-attribution",
		text: "The subagent's model call burned 38,400 tokens. On whose behalf?",
		fromSpans: (spans, roots) => {
			const sub = spans.find((span) => span.type === "subagent_run");
			if (!sub) return undefined;
			const total = tokensOfSubtree(spans, sub.id);
			const parent = spans.find((span) => span.id === sub.parentSpanId);
			return `${total} tokens including its own tool, under "${parent?.name ?? "?"}"`;
		},
		fromLog: () => undefined,
		note: "the delegation edge is the thing being asked about, and it is the thing a log does not store",
	},
	{
		id: "retries",
		text: "stripe_create_refund appears three times. Three refunds, or one retried?",
		fromSpans: (spans, roots) => {
			const attempts = subtree(spans, roots.dana ?? "").filter(
				(span) => span.attributes.tool === "stripe_create_refund",
			);
			const parents = new Set(attempts.map((span) => span.parentSpanId));
			return parents.size === 1 ? `one step, ${attempts.length} attempts` : `${parents.size} separate steps`;
		},
		fromLog: (log) => {
			const lines = log.filter((line) => line.attributes.tool === "stripe_create_refund");
			// `attempt` is on the line, so this one IS answerable — as long as whoever
			// wrote the tool remembered to log it. The span tree knows regardless.
			const numbered = lines.filter((line) => line.attributes.attempt !== undefined);
			return numbered.length === lines.length ? `one step, ${lines.length} attempts` : undefined;
		},
		note: "answerable from a log only because the tool author remembered an `attempt` field; the tree knows from its shape",
	},
];

export interface Score {
	spans: number;
	log: number;
	total: number;
}

export function score(spans: Span[], log: LogLine[], roots: Record<string, string>): Score {
	let spanAnswers = 0;
	let logAnswers = 0;
	for (const question of QUESTIONS) {
		if (question.fromSpans(spans, roots) !== undefined) spanAnswers++;
		if (question.fromLog(log) !== undefined) logAnswers++;
	}
	return { spans: spanAnswers, log: logAnswers, total: QUESTIONS.length };
}

/** Used by the README's Step 3 and by the tests. */
export { childrenOf };
