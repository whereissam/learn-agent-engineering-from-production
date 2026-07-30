/**
 * 完成的證據（Lesson 29）。
 *
 * 兩組測試，守的東西不一樣：
 *
 *   snapshot  影子 git 真的量得到檔案系統的變化（會真的開 git，用暫存目錄）
 *   compare   三份紀錄的集合運算
 *
 * `compare` 那一組每一條都對應到一個實際跑出來的情境（`bun run lesson-29`），
 * 不是為了覆蓋率。特別是 `read_file` 那一條：少了 `mutating` 欄位的話，
 * **每一次唯讀探索都會生出一條假的 unbacked-write**，而那種假陽性
 * 會讓整個檢查器變成雜訊。
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
	claim = "做完了。",
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

describe("三份紀錄的比對（Lesson 29）", () => {
	test("工具改了、檔案也變了 → 沒有結構性分歧", () => {
		const findings = compare(record([edit("src/app.ts")], ["src/app.ts"], "已經改好 src/app.ts。"));
		assert.equal(hasStructuralDivergence(findings), false);
	});

	test("被拒絕、什麼都沒變 → no-evidence（Lesson 8 那個謊報）", () => {
		const findings = compare(
			record([edit("src/app.ts", false)], [], "已經為您將 src/app.ts 重構並簡化。"),
		);
		assert.deepEqual(
			findings.map((f) => f.kind),
			["no-evidence"],
		);
	});

	test("改完又改回去 → unbacked-write，而且 snapshot 才是對的", () => {
		const findings = compare(record([edit("src/app.ts"), edit("src/app.ts")], []));
		const kinds = findings.map((f) => f.kind);
		assert.ok(kinds.includes("unbacked-write"));
		assert.equal(hasStructuralDivergence(findings), true);
	});

	test("沒有工具承認的變更 → unreported-change", () => {
		const findings = compare(record([], ["notes.md"], "我看完了。"));
		assert.deepEqual(
			findings.filter((f) => f.strength === "structural").map((f) => f.kind),
			["unreported-change"],
		);
	});

	test("read_file 不算「聲稱改過」", () => {
		// 少了 mutating 這個欄位，這一條會冒出一個假的 unbacked-write。
		const read: ToolRecord = {
			name: "read_file",
			path: "src/app.ts",
			mutating: false,
			ok: true,
			summary: "1 import …",
		};
		const findings = compare(record([read], [], "我看過了，沒有需要改的地方。"));
		assert.deepEqual(
			findings.map((f) => f.kind),
			["no-evidence"],
		);
	});

	test("改了兩個檔案只提一個 → unmentioned-change，而且只是啟發式", () => {
		const findings = compare(
			record(
				[edit("src/app.ts"), edit("src/util.ts")],
				["src/app.ts", "src/util.ts"],
				"已經整理好 src/app.ts。",
			),
		);
		assert.deepEqual(
			findings.map((f) => f.kind),
			["unmentioned-change"],
		);
		// 這條不該讓判定變成「有結構性分歧」。工具跟檔案系統是一致的，
		// 不一致的只有那段自然語言，而那條比對本來就會有假陰性。
		assert.equal(hasStructuralDivergence(findings), false);
	});

	test("沒有變更也沒有說話 → 不報 no-evidence", () => {
		// 使用者只是問問題，模型沒回半個字的情況不該被算成謊報。
		const findings = compare(record([], [], ""));
		assert.deepEqual(findings, []);
	});

	test("mentions 認得完整路徑與檔名", () => {
		assert.equal(mentions("我改了 src/app.ts", "src/app.ts"), true);
		assert.equal(mentions("我改了 app.ts", "src/app.ts"), true);
		assert.equal(mentions("我改了那個處理函式", "src/app.ts"), false);
	});
});

// ─────────────────────────────────────────────────────────────
// Snapshot（會真的呼叫 git）
// ─────────────────────────────────────────────────────────────

describe("影子 git snapshot（Lesson 29）", () => {
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

	test("gitdir 在 workspace 裡面時直接拒絕建構", () => {
		assert.throws(
			() => new Snapshot({ workspace, gitdir: join(workspace, ".shadow") }),
			/outside the workspace/,
		);
	});

	test("沒有變更時 patch 是空的", async () => {
		const snapshot = new Snapshot({ workspace, gitdir });
		const hash = await snapshot.track();
		assert.match(hash, /^[0-9a-f]{40}$/);
		assert.deepEqual((await snapshot.patch(hash)).files, []);
	});

	test("修改、新增、刪除都看得到", async () => {
		const snapshot = new Snapshot({ workspace, gitdir });
		const hash = await snapshot.track();

		await writeFile(join(workspace, "a.txt"), "two\n", "utf8");
		await mkdir(join(workspace, "sub"), { recursive: true });
		await writeFile(join(workspace, "sub/b.txt"), "new\n", "utf8");

		assert.deepEqual((await snapshot.patch(hash)).files, ["a.txt", "sub/b.txt"]);

		// 刪除也要算。少了 `add --all`，這一條會過不了。
		const after = await snapshot.track();
		await rm(join(workspace, "sub/b.txt"));
		assert.deepEqual((await snapshot.patch(after)).files, ["sub/b.txt"]);
	});

	test("改完又改回去 → patch 是空的（這一課的重點情境）", async () => {
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
			"淨變化為零時 patch 必須是空的 —— tool result 會說改了兩次",
		);
	});
});
