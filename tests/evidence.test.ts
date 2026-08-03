/**
 * Evidence of completion (Lesson 29).
 *
 * Two groups guarding different things:
 *
 *   snapshot  the shadow git really measures filesystem changes (it really invokes git, in a temp directory)
 *   compare   the set operations over the three records
 *
 * Every case in the `compare` group matches a scenario that really ran (`bun run lesson-29`),
 * rather than existing for coverage. The `read_file` one especially: without the `mutating` field,
 * **every read-only exploration produces a false unbacked-write**, and that kind of false positive
 * turns the whole checker into noise.
 */

import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import {
	compare,
	hasStructuralDivergence,
	mentions,
	type ToolRecord,
} from "../lesson-29-evidence/evidence.ts";
import { Snapshot } from "../lesson-29-evidence/snapshot.ts";

// ─────────────────────────────────────────────────────────────
// compare()
// ─────────────────────────────────────────────────────────────

function record(
	toolResults: ToolRecord[],
	files: string[],
	claim = "Done.",
) {
	return { claim, toolResults, patch: { hash: "BASE", files } };
}

const edit = (path: string, ok = true): ToolRecord => ({
	name: "edit_file",
	path,
	mutating: true,
	ok,
	summary: ok ? `Edited ${path}` : "denied",
});

describe("comparing the three records (Lesson 29)", () => {
	test("the tool edited and the file changed → no structural divergence", () => {
		const findings = compare(record([edit("src/app.ts")], ["src/app.ts"], "src/app.ts has been updated."));
		assert.equal(hasStructuralDivergence(findings), false);
	});

	test("denied and nothing changed → no-evidence (Lesson 8's false report)", () => {
		const findings = compare(
			record([edit("src/app.ts", false)], [], "I have refactored and simplified src/app.ts for you."),
		);
		assert.deepEqual(
			findings.map((f) => f.kind),
			["no-evidence"],
		);
	});

	test("changed and changed back → unbacked-write, and the snapshot is the one that is right", () => {
		const findings = compare(record([edit("src/app.ts"), edit("src/app.ts")], []));
		const kinds = findings.map((f) => f.kind);
		assert.ok(kinds.includes("unbacked-write"));
		assert.equal(hasStructuralDivergence(findings), true);
	});

	test("a change no tool admits to → unreported-change", () => {
		const findings = compare(record([], ["notes.md"], "I have read it."));
		assert.deepEqual(
			findings.filter((f) => f.strength === "structural").map((f) => f.kind),
			["unreported-change"],
		);
	});

	test('read_file does not count as "claiming to have edited"', () => {
			// Without the mutating field, this case produces a false unbacked-write.
		const read: ToolRecord = {
			name: "read_file",
			path: "src/app.ts",
			mutating: false,
			ok: true,
			summary: "1 import …",
		};
		const findings = compare(record([read], [], "I read it; nothing needs changing."));
		assert.deepEqual(
			findings.map((f) => f.kind),
			["no-evidence"],
		);
	});

	test("two files changed, one mentioned → unmentioned-change, and only a heuristic", () => {
		const findings = compare(
			record(
				[edit("src/app.ts"), edit("src/util.ts")],
				["src/app.ts", "src/util.ts"],
				"src/app.ts has been tidied up.",
			),
		);
		assert.deepEqual(
			findings.map((f) => f.kind),
			["unmentioned-change"],
		);
			// This must not make the verdict "there is structural divergence". The tool and the filesystem agree;
			// only the natural language disagrees, and that comparison has false negatives by design.
		assert.equal(hasStructuralDivergence(findings), false);
	});

	test("no change and nothing said → no-evidence is not reported", () => {
			// The user only asked a question, and the model saying nothing must not count as a false report.
		const findings = compare(record([], [], ""));
		assert.deepEqual(findings, []);
	});

	test("mentions recognises both a full path and a bare filename", () => {
		assert.equal(mentions("I edited src/app.ts", "src/app.ts"), true);
		assert.equal(mentions("I edited app.ts", "src/app.ts"), true);
		assert.equal(mentions("I edited that handler function", "src/app.ts"), false);
	});
});

// ─────────────────────────────────────────────────────────────
// Snapshot (really calls git)
// ─────────────────────────────────────────────────────────────

describe("the shadow git snapshot (Lesson 29)", () => {
	let base: string;
	let workspace: string;
	let gitdir: string;

	before(async () => {
		base = await mkdtemp(join(tmpdir(), "lesson-29-"));
		workspace = join(base, "workspace");
		gitdir = join(base, "shadow");
		await mkdir(workspace, { recursive: true });
		await writeFile(join(workspace, "a.txt"), "one\n", "utf8");
	});

	after(async () => {
		await rm(base, { recursive: true, force: true });
	});

	test("constructing with the gitdir inside the workspace is refused outright", () => {
		assert.throws(
			() => new Snapshot({ workspace, gitdir: join(workspace, ".shadow") }),
			/outside the workspace/,
		);
	});

	test("with no change the patch is empty", async () => {
		const snapshot = new Snapshot({ workspace, gitdir });
		const hash = await snapshot.track();
		assert.match(hash, /^[0-9a-f]{40}$/);
		assert.deepEqual((await snapshot.patch(hash)).files, []);
	});

	test("edits, additions and deletions are all visible", async () => {
		const snapshot = new Snapshot({ workspace, gitdir });
		const hash = await snapshot.track();

		await writeFile(join(workspace, "a.txt"), "two\n", "utf8");
		await mkdir(join(workspace, "sub"), { recursive: true });
		await writeFile(join(workspace, "sub/b.txt"), "new\n", "utf8");

		assert.deepEqual((await snapshot.patch(hash)).files, ["a.txt", "sub/b.txt"]);

			// Deletions count too. Without `add --all`, this case fails.
		const after = await snapshot.track();
		await rm(join(workspace, "sub/b.txt"));
		assert.deepEqual((await snapshot.patch(after)).files, ["sub/b.txt"]);
	});

	test("changed and changed back → the patch is empty (this lesson's key scenario)", async () => {
		const snapshot = new Snapshot({ workspace, gitdir });
		const original = "round trip\n";
		await writeFile(join(workspace, "a.txt"), original, "utf8");

		const hash = await snapshot.track();
		await writeFile(join(workspace, "a.txt"), "changed\n", "utf8");
		assert.deepEqual((await snapshot.patch(hash)).files, ["a.txt"]);

		await writeFile(join(workspace, "a.txt"), original, "utf8");
		assert.deepEqual(
			(await snapshot.patch(hash)).files,
			[],
			"With zero net change the patch must be empty — the tool results say it was edited twice",
		);
	});
});
