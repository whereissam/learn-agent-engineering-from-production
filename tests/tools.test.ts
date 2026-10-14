/**
 * The tool layer's invariants.
 *
 * Why these tests exist: **behaviour the lessons claim needs something stopping it being broken.**
 * Every test name matches a sentence some lesson stated.
 *
 * Run: bun test
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { createIncidentReportTool } from "../lesson-06-domain-tools/tools/report.ts";
import { resolveInRoot } from "../shared/tools/paths.ts";
import { describeCall } from "../shared/tools/registry.ts";
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

describe("path limits follow symbolic links (Lessons 2 and 35)", () => {
	test("a link inside root that points outside it is refused, for reads and for new files", async () => {
		const base = await mkdtemp(join(tmpdir(), "paths-"));
		const root = join(base, "root");
		await mkdir(root);
		await writeFile(join(base, "secret.txt"), "outside\n", "utf8");
		await symlink(join(base, "secret.txt"), join(root, "notes.md"));
		await symlink(base, join(root, "up"));
		try {
			assert.throws(() => resolveInRoot(root, "notes.md"), /symbolic link/);
			assert.throws(() => resolveInRoot(root, "up/new.txt"), /symbolic link/);
			assert.equal(resolveInRoot(root, "fresh/new.txt"), join(root, "fresh/new.txt"));
		} finally {
			await rm(base, { recursive: true, force: true });
		}
	});

	test("a model-supplied session id cannot steer the report write out of reports/ (Lesson 6)", async () => {
		const ctx = { root: "/", approve: async () => true, log() {} };
		const args = { classification: "nominal", confidence: "low", summary: "x", evidence: [] };
		await assert.rejects(
			createIncidentReportTool.execute({ ...args, session_id: "../../package" }, ctx),
			/Invalid session_id/,
		);
	});
});

describe("approval shows what will run (Lessons 2, 8 and 29)", () => {
	test("a summary that had to cut a value comes with every argument in full", () => {
		const shown = describeCall("run_command", { command: `echo ok${" ".repeat(60)}; touch PWNED` });
		assert.doesNotMatch(shown.summary, /touch/);
		assert.match(shown.detail ?? "", /touch PWNED/);
	});

	test("a call that fits on the line needs no detail", () => {
		assert.equal(describeCall("run_command", { command: "ls" }).detail, undefined);
	});

	test("control characters are shown, not obeyed", () => {
		const shown = describeCall("run_command", { command: "touch x;\r\u001b[2K│ npm test" });
		assert.doesNotMatch(shown.summary, /[\r\u001b]/);
		assert.match(shown.summary, /\\u001b/);
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
