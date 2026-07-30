/**
 * The AI Search part (Lessons 20-27).
 *
 * Every test here matches **a trap hit in a measurement**, rather than being written for coverage.
 * Each test's comment names the lesson and the bug it locks down —
 * so when a test fails six months from now, you know what you are breaking.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { tokenize as corpusTokenize } from "../lesson-20-search-agent/search/engine.ts";
import { chunkText } from "../lesson-21-crawl/extract/chunk.ts";
import { extractMain, stripTags } from "../lesson-21-crawl/extract/html.ts";
import { jaccard, rrf, signalsFor } from "../lesson-22-retrieval/retrieve/rank.ts";
import type { IndexedPage } from "../lesson-20-search-agent/corpus/generate.ts";
import { normalizeQuery, nextBreadth } from "../lesson-24-research-loop/state.ts";
import { estimateCost } from "../lesson-24-research-loop/research.ts";
import { parseReport } from "../lesson-25-citations/report.ts";
import { extractAtoms, verifyClaim } from "../lesson-25-citations/verify.ts";
import { Bm25Index } from "../lesson-27-local-docs/bm25.ts";
import { chunkMarkdown } from "../lesson-27-local-docs/ingest.ts";

// ─────────────────────────────────────────────────────────────

describe("Lesson 20：關鍵字檢索", () => {
	test("中文 query 斷不出任何詞（這是限制，不是 bug）", () => {
			// Lesson 20 Step 4: a Chinese query returns 0 results under BM25,
			// and that behaviour is the entire motivation for Lesson 22's dense retrieval.
		assert.deepEqual(corpusTokenize("把影片動作轉到人形機器人"), []);
		assert.ok(corpusTokenize("unitree g1 retargeting").length > 0);
	});

	test("停用詞被濾掉——但那份清單是手寫的，不完整", () => {
		assert.deepEqual(corpusTokenize("the and for"), []);
			// "of" is not in the list, so it survives. Discovered while writing this test.
			// **A stopword list is a hand-made list, not a complete linguistic rule**,
			// and this line reminds a future reader not to assume it covers every function word.
		assert.deepEqual(corpusTokenize("of"), ["of"]);
	});
});

describe("Lesson 21：抽取與切塊", () => {
	const html = `<!doctype html><html><head><title>T</title></head><body>
		<nav><a href="/">Home</a><a href="/pricing">Pricing</a></nav>
		<div class="cookie">Accept all cookies</div>
		<article>
			<p>Real body sentence one.</p>
			<table><tr><td>waist_yaw</td><td>1</td><td>13</td></tr></table>
			<ul><li>list item</li></ul>
		</article>
		<aside class="ad">Sponsored: buy this</aside>
		<footer>All rights reserved</footer>
	</body></html>`;

	test("樸素的 stripTags 會把導覽和廣告一起吃進來", () => {
		const naive = stripTags(html);
		assert.ok(naive.includes("Pricing"));
		assert.ok(naive.includes("Sponsored"));
	});

	test("extractMain 砍掉 boilerplate", () => {
		const { text } = extractMain(html);
		assert.ok(text.includes("Real body sentence one."));
		for (const noise of ["Pricing", "Sponsored", "Accept all cookies", "All rights reserved"]) {
			assert.ok(!text.includes(noise), `不該出現：${noise}`);
		}
	});

	test("預設會丟掉表格和清單，而且要說出來", () => {
			// Lesson 21 Step 5: the <p>-only version made the model burn the 16-step ceiling twice.
			// This locks down the behaviour "what was dropped must be reported".
		const result = extractMain(html);
		assert.ok(!result.text.includes("waist_yaw"));
		assert.equal(result.dropped.tables, 1);
		assert.equal(result.dropped.lists, 1);
	});

	test("includeStructures 之後表格內容抽得到", () => {
		const result = extractMain(html, { includeStructures: true });
		assert.ok(result.text.includes("waist_yaw"));
		assert.ok(result.text.includes("13"), "表格裡的數字要保留");
		assert.ok(result.text.includes("list item"));
	});

	test("切塊在段落邊界，而且每一塊知道自己是第幾塊", () => {
		const text = Array.from({ length: 12 }, (_, i) => `Paragraph ${i} ${"x".repeat(200)}`).join("\n\n");
		const chunks = chunkText(text, { maxChars: 600 });
		assert.ok(chunks.length > 1);
		for (const chunk of chunks) {
			assert.equal(chunk.total, chunks.length);
				// It must not cut mid-paragraph: every chunk should begin with some "Paragraph n"
			assert.match(chunk.text, /^Paragraph \d/);
		}
	});
});

describe("Lesson 22：排序訊號", () => {
	const page = (over: Partial<IndexedPage>): IndexedPage => ({
		id: "x",
		url: "https://example.com/x",
		site: "example.com",
		title: "t",
		published: "2026-07-01",
		kind: "blog",
		text: "",
		html: "x.html",
		...over,
	});

	test("短文件不該因為重複幾個字就被判成關鍵字堆砌", () => {
			// Lesson 22 Step 5: the first version looked only at the ratio, and a 25-word LICENSE file
			// repeating "license" 4 times was judged a farm, collapsing q8 from nDCG 1.000 to 0.131.
		const license = page({
			text: "Apache License, Version 2.0. Licensed under the License; you may not use this file except in compliance with the License.",
		});
		assert.equal(signalsFor(license).stuffing, 0);
	});

	test("真正的關鍵字農場還是抓得到", () => {
		const farm = page({
			text: Array.from({ length: 14 }, () => "retargeting").join(" ") + " open source guide",
		});
		assert.ok(signalsFor(farm).stuffing > 0.5);
	});

	test("新鮮度是固定的「今天」算出來的（不能用 Date.now）", () => {
		const fresh = signalsFor(page({ published: "2026-07-20" })).freshness;
		const old = signalsFor(page({ published: "2023-01-01" })).freshness;
		assert.ok(fresh > old);
			// Two runs must agree, or regression testing is meaningless
		assert.equal(fresh, signalsFor(page({ published: "2026-07-20" })).freshness);
	});

	test("RRF 只看名次，而且「第 1 + 第 3」贏過「第 2 + 第 2」", () => {
		const fused = rrf([
			["a", "b", "c"],
			["c", "b", "a"],
		]);

			// Two symmetric ones must score equally
		assert.equal(fused.get("a"), fused.get("c"));

			// ⚠️ This one is counter-intuitive, and the assertion was written backwards the first time.
		//
		//   a: 1/61 + 1/63 = 0.032266
		//   b: 1/62 + 1/62 = 0.032258
		//
			// Because 1/x is convex, "very high on one side and ordinary on the other" **beats**
			// "middling on both".
		//
			// In practice that is good: **it rewards results where at least one source is very sure**,
			// rather than results everybody finds acceptable.
			// But you have to know the property, or tuning K will have the opposite effect.
		assert.ok((fused.get("a") ?? 0) > (fused.get("b") ?? 0));
	});

	test("近似重複的相似度要遠高於不相關的一對", () => {
			// Lesson 22: the threshold was first set to 0.5 from intuition, and mirror pairs measure only 0.17.
		const shingle = (text: string): Set<string> => {
			const words = text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
			const set = new Set<string>();
			for (let i = 0; i + 3 <= words.length; i++) set.add(words.slice(i, i + 3).join(" "));
			return set;
		};
		const original = shingle("the pipeline has three stages pose estimation kinematic solve and physics pass");
		const mirror = shingle("the pipeline has three stages pose estimation kinematic solve plus a physics pass");
		const unrelated = shingle("sous vide is the technique of cooking food sealed in a bag");
		assert.ok(jaccard(original, mirror) > jaccard(original, unrelated) * 3);
	});
});

describe("Lesson 24：研究預算", () => {
	test("廣度砍半、上界算得出來", () => {
		assert.equal(nextBreadth(4), 2);
		assert.equal(nextBreadth(3), 2);
		assert.equal(nextBreadth(1), 1);

		const cheap = estimateCost({ breadth: 2, depth: 1, pagesPerQuery: 2, concurrency: 2 });
		const deep = estimateCost({ breadth: 3, depth: 2, pagesPerQuery: 2, concurrency: 2 });
		assert.ok(deep.searches > cheap.searches);
		assert.equal(cheap.fetches, cheap.searches * 2);
	});

	test("換句話說的同一條 query 算重複", () => {
			// The prompt says "do not repeat", and the fake provider repeated two on its first run,
			// so this went into code.
		assert.equal(
			normalizeQuery("unitree g1 retargeting"),
			normalizeQuery("Retargeting  UNITREE   g1!"),
		);
		assert.notEqual(normalizeQuery("unitree g1"), normalizeQuery("unitree h1"));
	});
});

describe("Lesson 25：引用驗證", () => {
	const corpus = new Map([
		[
			"https://example.com/repo",
			"humanoid-mimic 0.7 released June 2026 adds a Unitree G1 profile. License: MIT.",
		],
		["https://example.com/forum", "We saw foot sliding and slowed playback to 0.8x."],
	]);

	test("報告解析要抓得到句尾括號裡的網址", () => {
			// Lesson 25's trap 1: the first version's placeholders broke and **every claim's citations became empty**,
			// while the program still ran through, making it look like "this report is terrible".
		const claims = parseReport(
			"* 這個專案採用 MIT 授權，於 2026 年 6 月釋出 (https://example.com/repo)。",
		);
		assert.equal(claims.length, 1);
		assert.deepEqual(claims[0]?.sources, ["https://example.com/repo"]);
		assert.ok(!claims[0]?.text.includes("http"));
	});

	test("抽得出數字與識別字，不抽網址", () => {
		const atoms = extractAtoms("humanoid-mimic 0.7 採用 MIT 授權 (https://example.com/repo)");
		const values = atoms.map((a) => a.value);
		assert.ok(values.includes("0.7"));
		assert.ok(values.includes("mit"));
		assert.ok(!values.some((v) => v.includes("example")));
	});

	test("引用嫁接抓得到", () => {
			// The one in the real report: a licensing sentence carrying a forum URL that never mentions licensing.
		const verdict = verifyClaim(
			"程式碼採用 MIT 授權",
			["https://example.com/repo", "https://example.com/forum"],
			corpus,
		);
		assert.deepEqual(verdict.graftedSources, ["https://example.com/forum"]);
	});

	test("英文月份要對得上中文的月份數字", () => {
			// Lesson 25's trap 3: stripping whitespace turned "June 2026" into "62026",
			// so the atom 6 was judged unsourced.
		const verdict = verifyClaim("於 2026 年 6 月釋出", ["https://example.com/repo"], corpus);
		assert.deepEqual(verdict.unsupportedAtoms, []);
	});

	test("數字被改掉就抓得到", () => {
		const verdict = verifyClaim("把播放速度降到 0.5x", ["https://example.com/forum"], corpus);
		assert.ok(verdict.unsupportedAtoms.some((a) => a.value === "0.5"));
	});

	test("引用不存在的網址算 unknown，不算嫁接", () => {
		const verdict = verifyClaim("MIT 授權", ["https://example.com/nope"], corpus);
		assert.equal(verdict.sources[0]?.known, false);
	});
});

describe("Lesson 27：本地文件", () => {
	test("chunk 帶得回行號，而且 id 看得懂", () => {
		const content = ["# 標題", "", "第一段內容。".repeat(20), "", "## 小節", "", "第二段內容。".repeat(20)].join("\n");
		const chunks = chunkMarkdown("docs/x.md", content);
		assert.ok(chunks.length >= 1);
		for (const chunk of chunks) {
			assert.match(chunk.id, /^docs\/x\.md#L\d+-L\d+$/);
			assert.ok(chunk.startLine >= 1);
			assert.ok(chunk.endLine >= chunk.startLine);
		}
	});

	test("通用 BM25 排序正確且標題有加權", () => {
		const index = new Bm25Index([
			{ id: "a", title: "chunking strategy", text: "how to split long documents" },
			{ id: "b", title: "unrelated", text: "sous vide cooking times for steak" },
		]);
		const hits = index.search("chunking documents");
		assert.equal(hits[0]?.id, "a");
		assert.ok(!hits.some((h) => h.id === "b"));
	});

	test("查不到東西時回空陣列，不是丟例外", () => {
		const index = new Bm25Index([{ id: "a", title: "t", text: "hello world" }]);
		assert.deepEqual(index.search("完全不相關的中文"), []);
	});
});
