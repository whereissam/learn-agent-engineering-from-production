import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	BREAKPOINT_CAP,
	budget,
	commonPrefix,
	diverge,
	newBreakpoints,
	OPENAI_ORDER,
	SECTIONS,
	serialise,
	type RequestShape,
} from "../lesson-38-prompt-cache/prefix.ts";
import {
	BASE_TOOLS,
	memoryFirst,
	RUN_ID,
	stable,
	SYSTEM_BASE,
	timestampFirst,
	toolsGrowing,
	toolsReordered,
	volatileLast,
} from "../lesson-38-prompt-cache/turns.ts";

describe("prefix comparison（Lesson 38）", () => {
	test("counts the shared head, not the shared content", () => {
		assert.equal(commonPrefix("abcdef", "abcxyz"), 3);
		assert.equal(commonPrefix("xabc", "abc"), 0, "same content, different position, shares nothing");
		assert.equal(commonPrefix("abc", "abc"), 3);
		assert.equal(commonPrefix("", "abc"), 0);
	});

	test("serialisation is order-sensitive, which is the property being taught", () => {
		const base: RequestShape = { system: "s", tools: BASE_TOOLS, messages: [] };
		const flipped: RequestShape = { ...base, tools: [...BASE_TOOLS].reverse() };
		assert.notEqual(serialise(base), serialise(flipped));
	});

	test("the section order changes what a serialised request looks like", () => {
		const shape: RequestShape = { system: "s", tools: BASE_TOOLS, messages: [{ role: "user", text: "hi" }] };
		assert.notEqual(serialise(shape, SECTIONS), serialise(shape, OPENAI_ORDER));
	});
});

describe("where each configuration breaks（Lesson 38）", () => {
	test("a stable prefix only ever diverges in the message block", () => {
		const d = diverge(stable(1), stable(2));
		assert.equal(d.section, "messages");
		assert.ok(d.ratio > 0.9, `ratio was ${d.ratio}`);
	});

	test("a timestamp at the front diverges in the system block and reuses almost nothing", () => {
		const d = diverge(timestampFirst(1), timestampFirst(2));
		assert.equal(d.section, "system");
		assert.ok(d.ratio < 0.05, `ratio was ${d.ratio}`);
	});

	test("Lesson 15's memory shape fails the same way", () => {
		const d = diverge(memoryFirst(1), memoryFirst(2));
		assert.equal(d.section, "system");
		assert.ok(d.ratio < 0.05, `ratio was ${d.ratio}`);
	});

	test("the same content moved to the end keeps the prefix", () => {
		const d = diverge(volatileLast(1), volatileLast(2));
		assert.equal(d.section, "messages");
		assert.ok(d.ratio > 0.9, `ratio was ${d.ratio}`);
	});

	/**
	 * The finding that corrected the plan: a tool list that grows by appending is
	 * not a volatile prefix. Growth is not the problem; rewriting what came before
	 * is.
	 */
	test("appending tools costs far less than rewriting the system prompt", () => {
		const appended = diverge(toolsGrowing(1), toolsGrowing(2));
		const rewritten = diverge(memoryFirst(1), memoryFirst(2));
		assert.ok(
			appended.total - appended.stable < (rewritten.total - rewritten.stable) / 10,
			"appending a tool should cost an order of magnitude less than a system-prompt rewrite",
		);
	});

	test("reordering the tool list is a real change even though the tool set is identical", () => {
		const before = toolsReordered(1);
		const after = toolsReordered(2);
		assert.equal(before.tools.length, after.tools.length);
		assert.deepEqual(
			[...before.tools].map((t) => t.name).sort(),
			[...after.tools].map((t) => t.name).sort(),
			"the same tools",
		);
		assert.ok(diverge(before, after).stable < serialise(after).length, "and yet a different prefix");
	});

	test("under the measured section order, tool churn no longer invalidates the history", () => {
		const naive = diverge(toolsReordered(1), toolsReordered(2), SECTIONS);
		const measured = diverge(toolsReordered(1), toolsReordered(2), OPENAI_ORDER);
		assert.equal(naive.section, "tools");
		assert.equal(measured.section, "messages");
		assert.ok(measured.total - measured.stable < naive.total - naive.stable);
	});
});

describe("the experiment's own methodology（Lesson 38）", () => {
	/**
	 * This pins the fix for the bug described in README Step 5. Without a nonce at
	 * a stable position in every builder, a second run replays the first run's
	 * byte-identical requests, hits the cache it warmed, and reports a high hit
	 * rate for configurations that are in fact broken.
	 */
	test("every builder's system prompt carries the per-run nonce", () => {
		for (const build of [stable, timestampFirst, memoryFirst, toolsGrowing, toolsReordered, volatileLast]) {
			assert.ok(build(1).system.includes(RUN_ID), "a builder without the nonce would hit a previous run's cache");
		}
	});

	test("the nonce sits in the stable head, not in the volatile part", () => {
		assert.ok(SYSTEM_BASE.startsWith(`Session ${RUN_ID}`));
		assert.equal(stable(1).system, stable(5).system, "the control must not change within a run");
	});
});

describe("the breakpoint budget（Lesson 38）", () => {
	test("places exactly four markers and then drops silently", () => {
		const breakpoints = newBreakpoints();
		const placed = Array.from({ length: 6 }, () => budget(breakpoints));
		assert.deepEqual(placed, [true, true, true, true, false, false]);
		assert.equal(breakpoints.remaining, 0);
		assert.equal(breakpoints.dropped, 2);
	});

	test("dropping does not throw, which is exactly why it needs counting", () => {
		const breakpoints = newBreakpoints(0);
		assert.doesNotThrow(() => budget(breakpoints));
		assert.equal(breakpoints.dropped, 1);
	});

	test("the cap matches the one OpenCode enforces", () => {
		assert.equal(BREAKPOINT_CAP, 4);
	});
});
