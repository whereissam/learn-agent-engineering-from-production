/**
 * 用 Node 內建的 test runner，不需要裝任何東西。
 *
 *   node --test test/store.test.ts     （Node 22+）
 *   bun test                           （Bun）
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { record, statsFor } from "../src/analytics.ts";
import { generateCode, lookup, save, size } from "../src/store.ts";

test("save then lookup returns the original url", () => {
	const url = "https://example.com/a-very-long-path";
	const code = save(url);
	assert.equal(lookup(code), url, "a freshly created short link must resolve");
});

test("generateCode produces codes of the configured length", () => {
	const code = generateCode();
	assert.equal(code.length, 6);
});

test("lookup returns undefined for an unknown code", () => {
	assert.equal(lookup("nosuch"), undefined);
});

test("save increases the number of stored links", () => {
	const before = size();
	save("https://example.com/one");
	assert.equal(size(), before + 1);
});

test("round-trips many links without losing any", () => {
	// 這個測試會抓到大小寫的 bug ， 只跑一次可能剛好過，跑 50 次一定爆。
	const urls = Array.from({ length: 50 }, (_, i) => `https://example.com/item/${i}`);
	const codes = urls.map(save);

	for (const [i, code] of codes.entries()) {
		assert.equal(lookup(code), urls[i], `link ${i} (code ${code}) must resolve`);
	}
});

// ─────────────────────────────────────────────────────────────
// 分析（新增）
// ─────────────────────────────────────────────────────────────

test("stats count the clicks that actually happened", () => {
	const code = save("https://example.com/tracked");

	record(code);
	record(code);

	assert.equal(
		statsFor(code).clicks,
		2,
		"a link that was followed twice must not report zero clicks",
	);
});

test("stats are case-insensitive for the caller", () => {
	const code = save("https://example.com/case");
	record(code);

	assert.equal(
		statsFor(code.toUpperCase()).clicks,
		statsFor(code).clicks,
		"asking for stats in a different case must give the same answer",
	);
});
