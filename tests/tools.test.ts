/**
 * The tool layer's invariants.
 *
 * Why these tests exist: **behaviour the lessons claim needs something stopping it being broken.**
 * Every test name matches a sentence some lesson stated.
 *
 * Run: bun test
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { resolveInRoot } from "../shared/tools/paths.ts";
import { truncateHead, truncateTail } from "../shared/tools/truncate.ts";

const ROOT = "/tmp/agent-lessons-test-root";

describe("path limits (Lessons 1-2)", () => {
	test("allows a relative path under root", () => {
		assert.equal(resolveInRoot(ROOT, "notes.md"), `${ROOT}/notes.md`);
		assert.equal(resolveInRoot(ROOT, "src/a/b.ts"), `${ROOT}/src/a/b.ts`);
	});

	test("allows a winding path that still lands inside root", () => {
		assert.equal(resolveInRoot(ROOT, "src/../notes.md"), `${ROOT}/notes.md`);
	});

	test("blocks escaping upwards", () => {
		assert.throws(() => resolveInRoot(ROOT, "../../../etc/passwd"), /escapes/);
		assert.throws(() => resolveInRoot(ROOT, ".."), /escapes/);
		assert.throws(() => resolveInRoot(ROOT, "src/../../secrets.txt"), /escapes/);
	});

	test("blocks absolute paths", () => {
		assert.throws(() => resolveInRoot(ROOT, "/etc/passwd"), /escapes/);
	});

	test("blocks a path sharing a prefix but in a different directory", () => {
			// /tmp/agent-lessons-test-root-evil shares a prefix with ROOT,
			// so startsWith without a separator would allow it through
		assert.throws(() => resolveInRoot(ROOT, "/tmp/agent-lessons-test-root-evil/x"), /escapes/);
	});

	test("rejects non-strings and the empty string", () => {
		assert.throws(() => resolveInRoot(ROOT, undefined), /non-empty string/);
		assert.throws(() => resolveInRoot(ROOT, ""), /non-empty string/);
		assert.throws(() => resolveInRoot(ROOT, 42), /non-empty string/);
	});
});

describe("output truncation (Lesson 2)", () => {
	test("returns the text unchanged when under the limits", () => {
		const { text, info } = truncateHead("short");
		assert.equal(text, "short");
		assert.equal(info.truncated, false);
	});

	test("truncateHead keeps the head", () => {
		const input = Array.from({ length: 1000 }, (_, i) => `line ${i}`).join("\n");
		const { text, info } = truncateHead(input, 10);
		assert.equal(info.truncated, true);
		assert.ok(text.startsWith("line 0"));
		assert.ok(!text.includes("line 999"));
	});

	test("truncateTail keeps the tail (test failures are at the bottom)", () => {
		const input = [
			...Array.from({ length: 1000 }, (_, i) => `(pass) test ${i}`),
			"AssertionError: the thing that actually matters",
		].join("\n");

		const { text } = truncateTail(input, 10);
		assert.ok(
			text.includes("AssertionError"),
			"Shell output must keep the tail, or the agent never sees why it failed",
		);
	});

	test("the truncation notice must tell the model what it can do next", () => {
		const input = Array.from({ length: 1000 }, (_, i) => `line ${i}`).join("\n");
		const { text } = truncateHead(input, 10);
		assert.ok(text.includes("offset"), "the notice must say how to get the rest");
	});

	test("truncates when the byte cap trips before the line cap", () => {
		const input = Array.from({ length: 5 }, () => "x".repeat(10_000)).join("\n");
		const { info } = truncateHead(input, 1000, 1000);
		assert.equal(info.truncated, true);
	});
});
