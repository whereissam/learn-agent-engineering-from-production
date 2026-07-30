/**
 * Uses Node's built-in test runner; nothing to install.
 *
 *   node --test test/store.test.ts     （Node 22+）
 *   bun test                           （Bun）
 */

import assert from "node:assert/strict";
import { test } from "node:test";
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
	// This test catches the case-sensitivity bug: one run may pass by luck, and 50 runs certainly will not.
	const urls = Array.from({ length: 50 }, (_, i) => `https://example.com/item/${i}`);
	const codes = urls.map(save);

	for (const [i, code] of codes.entries()) {
		assert.equal(lookup(code), urls[i], `link ${i} (code ${code}) must resolve`);
	}
});
