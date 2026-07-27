/**
 * 工具層的不變條件。
 *
 * 這些測試存在的理由：**課程裡宣稱的行為，要有東西擋著它不被改壞。**
 * 每一個 test 名稱都對應某一課講過的一句話。
 *
 * 執行：bun test
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { resolveInRoot } from "../shared/tools/paths.ts";
import { truncateHead, truncateTail } from "../shared/tools/truncate.ts";

const ROOT = "/tmp/agent-lessons-test-root";

describe("路徑限制（Lesson 1-2）", () => {
	test("允許 root 底下的相對路徑", () => {
		assert.equal(resolveInRoot(ROOT, "notes.md"), `${ROOT}/notes.md`);
		assert.equal(resolveInRoot(ROOT, "src/a/b.ts"), `${ROOT}/src/a/b.ts`);
	});

	test("允許繞路但最終仍在 root 內的路徑", () => {
		assert.equal(resolveInRoot(ROOT, "src/../notes.md"), `${ROOT}/notes.md`);
	});

	test("擋掉向上逃逸", () => {
		assert.throws(() => resolveInRoot(ROOT, "../../../etc/passwd"), /escapes/);
		assert.throws(() => resolveInRoot(ROOT, ".."), /escapes/);
		assert.throws(() => resolveInRoot(ROOT, "src/../../secrets.txt"), /escapes/);
	});

	test("擋掉絕對路徑", () => {
		assert.throws(() => resolveInRoot(ROOT, "/etc/passwd"), /escapes/);
	});

	test("擋掉字首相同但不同目錄的路徑", () => {
		// /tmp/agent-lessons-test-root-evil 的字首跟 ROOT 一樣，
		// 用 startsWith 而沒加分隔符的話會被放行
		assert.throws(() => resolveInRoot(ROOT, "/tmp/agent-lessons-test-root-evil/x"), /escapes/);
	});

	test("拒絕非字串與空字串", () => {
		assert.throws(() => resolveInRoot(ROOT, undefined), /non-empty string/);
		assert.throws(() => resolveInRoot(ROOT, ""), /non-empty string/);
		assert.throws(() => resolveInRoot(ROOT, 42), /non-empty string/);
	});
});

describe("輸出截斷（Lesson 2）", () => {
	test("沒超過上限就原樣回傳", () => {
		const { text, info } = truncateHead("short");
		assert.equal(text, "short");
		assert.equal(info.truncated, false);
	});

	test("truncateHead 保留開頭", () => {
		const input = Array.from({ length: 1000 }, (_, i) => `line ${i}`).join("\n");
		const { text, info } = truncateHead(input, 10);
		assert.equal(info.truncated, true);
		assert.ok(text.startsWith("line 0"));
		assert.ok(!text.includes("line 999"));
	});

	test("truncateTail 保留結尾（測試錯誤訊息在後面）", () => {
		const input = [
			...Array.from({ length: 1000 }, (_, i) => `(pass) test ${i}`),
			"AssertionError: the thing that actually matters",
		].join("\n");

		const { text } = truncateTail(input, 10);
		assert.ok(
			text.includes("AssertionError"),
			"shell 輸出必須保留結尾，否則 agent 永遠看不到失敗原因",
		);
	});

	test("截斷提示要告訴模型下一步能做什麼", () => {
		const input = Array.from({ length: 1000 }, (_, i) => `line ${i}`).join("\n");
		const { text } = truncateHead(input, 10);
		assert.ok(text.includes("offset"), "提示必須包含如何取得剩餘內容的方法");
	});

	test("位元組上限比行數上限先觸發時也要截斷", () => {
		const input = Array.from({ length: 5 }, () => "x".repeat(10_000)).join("\n");
		const { info } = truncateHead(input, 1000, 1000);
		assert.equal(info.truncated, true);
	});
});
