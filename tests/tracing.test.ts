import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { simulateMorning } from "../lesson-14-tracing/day.ts";
import { QUESTIONS, score } from "../lesson-14-tracing/questions.ts";
import { childrenOf, costOfSubtree, rootsOf, subtree, tokensOfSubtree } from "../lesson-14-tracing/trace.ts";

const { recorder, roots } = simulateMorning();
const spans = recorder.spans;
const log = recorder.sortedLog();

describe("the two records（Lesson 14）", () => {
	/**
	 * The comparison is only honest if both recorders saw the same thing. A log
	 * that had been given less would make spans look better for the wrong reason.
	 */
	test("the log has one entry per span, carrying the same attributes", () => {
		assert.equal(log.length, spans.length);
		const spanTokens = spans.reduce((total, span) => total + (span.attributes.tokens ?? 0), 0);
		const logTokens = log.reduce((total, line) => total + (line.attributes.tokens ?? 0), 0);
		assert.equal(logTokens, spanTokens);
	});

	test("the only thing the log lacks is the parent pointer", () => {
		assert.ok(spans.some((span) => span.parentSpanId !== undefined));
		for (const line of log) {
			assert.ok(!("parentSpanId" in line));
		}
	});
});

describe("the shape of the morning（Lesson 14）", () => {
	test("four independent requests, each its own root", () => {
		assert.equal(rootsOf(spans).length, 4);
	});

	/** The case the first draft was missing, pinned so it cannot be dropped again. */
	test("one person has two concurrent requests, which is what breaks the actor proxy", () => {
		const danaRoots = rootsOf(spans).filter((span) => span.actor === "dana");
		assert.equal(danaRoots.length, 2);
		const [first, second] = danaRoots;
		assert.ok(first && second);
		assert.ok(second.startedAt < (first.endedAt ?? Number.POSITIVE_INFINITY), "they must overlap in time");
	});

	test("the subagent hangs under the request that caused it", () => {
		const sub = spans.find((span) => span.type === "subagent_run");
		assert.ok(sub);
		assert.equal(sub.parentSpanId, roots.dana);
	});

	test("three retries are three children of one parent, not three steps", () => {
		const attempts = subtree(spans, roots.dana).filter((span) => span.attributes.tool === "stripe_create_refund");
		assert.equal(attempts.length, 3);
		assert.equal(new Set(attempts.map((span) => span.parentSpanId)).size, 1);
	});
});

describe("what a tree can compute（Lesson 14）", () => {
	test("a request's cost is the sum of its subtree", () => {
		assert.equal(costOfSubtree(spans, roots.dana), 30);
		assert.equal(costOfSubtree(spans, roots.sam), 1);
		assert.equal(costOfSubtree(spans, roots.danaSecond), 9);
	});

	test("the subagent's tokens are attributed to the request above it", () => {
		const sub = spans.find((span) => span.type === "subagent_run");
		assert.ok(sub);
		assert.equal(tokensOfSubtree(spans, sub.id), 39_300);
		assert.ok(tokensOfSubtree(spans, roots.dana) >= tokensOfSubtree(spans, sub.id));
	});

	test("a subtree contains itself, so a leaf costs what the leaf costs", () => {
		const leaf = childrenOf(spans, roots.sam)[0];
		assert.ok(leaf);
		assert.deepEqual(subtree(spans, leaf.id), [leaf]);
	});
});

describe("why the log cannot（Lesson 14）", () => {
	/**
	 * The number that makes the lesson true rather than asserted: summing Dana's
	 * log lines returns 39, and Dana's refund cost 30. If this ever becomes 30 the
	 * scenario has lost the concurrent second request and the demo is claiming
	 * something its own data contradicts.
	 */
	test("summing the log by actor returns the wrong number, not no number", () => {
		const byActor = log
			.filter((line) => line.actor === "dana")
			.reduce((total, line) => total + (line.attributes.costCents ?? 0), 0);
		assert.equal(byActor, 39);
		assert.notEqual(byActor, costOfSubtree(spans, roots.dana));
	});

	test("a time window around Dana's refund also catches Sam's request", () => {
		const window = log.filter((line) => line.at >= 1_800_000_060_000 && line.at <= 1_800_000_230_000);
		assert.ok(window.some((line) => line.actor === "sam"));
	});
});

describe("the six questions（Lesson 14）", () => {
	test("the log answers the event questions and the tree answers all of them", () => {
		const result = score(spans, log, roots);
		assert.equal(result.total, 6);
		assert.equal(result.spans, 6);
		assert.equal(result.log, 3, "if this reaches 6 the comparison has stopped being about structure");
	});

	test("every question is answerable from the tree, or the question is not fair", () => {
		for (const question of QUESTIONS) {
			assert.notEqual(question.fromSpans(spans, roots), undefined, `${question.id} unanswerable from spans`);
		}
	});

	test("at least two questions favour the log, so the comparison is not rigged", () => {
		const logAnswers = QUESTIONS.filter((question) => question.fromLog(log) !== undefined);
		assert.ok(logAnswers.length >= 2);
	});
});
