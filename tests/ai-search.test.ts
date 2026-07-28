/**
 * AI Search 篇（Lesson 20-27）。
 *
 * 這裡的每一個測試都對應到**一個實測踩過的坑**，不是為了覆蓋率而寫的。
 * 每個 test 的註解會標出它鎖住的是哪一課的哪個 bug——
 * 這樣半年後看到測試失敗，你會知道自己正在把什麼東西弄壞。
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
		// Lesson 20 Step 4：中文查詢在 BM25 下回 0 筆，
		// 這個行為是整個 Lesson 22 dense retrieval 的動機。
		assert.deepEqual(corpusTokenize("把影片動作轉到人形機器人"), []);
		assert.ok(corpusTokenize("unitree g1 retargeting").length > 0);
	});

	test("停用詞被濾掉——但那份清單是手寫的，不完整", () => {
		assert.deepEqual(corpusTokenize("the and for"), []);
		// "of" 不在清單裡，所以它會活下來。寫這個測試的時候才發現。
		// **停用詞表是一份手工清單，不是完備的語言學規則**，
		// 這一行就是拿來提醒未來的自己不要以為它涵蓋了所有虛詞。
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
		// Lesson 21 Step 5：只取 <p> 的版本讓模型燒掉兩次 16 步上限。
		// 這裡鎖住「丟掉了要回報」這個行為。
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
			// 不能切在段落中間：每一塊都該以某個 "Paragraph n" 開頭
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
		// Lesson 22 Step 5：第一版只看比例，25 字的 LICENSE 檔重複 4 次
		// "license" 就被判成農場，害 q8 從 nDCG 1.000 崩到 0.131。
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
		// 跑兩次要一樣，否則回歸測試沒有意義
		assert.equal(fresh, signalsFor(page({ published: "2026-07-20" })).freshness);
	});

	test("RRF 只看名次，而且「第 1 + 第 3」贏過「第 2 + 第 2」", () => {
		const fused = rrf([
			["a", "b", "c"],
			["c", "b", "a"],
		]);

		// 對稱的兩個一定同分
		assert.equal(fused.get("a"), fused.get("c"));

		// ⚠️ 這一條跟直覺相反，我第一次也寫錯了斷言。
		//
		//   a: 1/61 + 1/63 = 0.032266
		//   b: 1/62 + 1/62 = 0.032258
		//
		// 因為 1/x 是凸函數，所以「一邊很前面、一邊普通」會**贏過**
		// 「兩邊都中間」。
		//
		// 實務上這是好事：**它獎勵「至少有一個來源非常確定」的結果**，
		// 而不是獎勵「大家都覺得還好」的結果。
		// 但你要知道有這個性質，不然調 K 的時候會調到反效果。
		assert.ok((fused.get("a") ?? 0) > (fused.get("b") ?? 0));
	});

	test("近似重複的相似度要遠高於不相關的一對", () => {
		// Lesson 22：門檻我第一次憑印象設 0.5，實測鏡像對只有 0.17。
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
		// prompt 裡寫了「不要重複」，但假 provider 第一次跑就重複兩條，
		// 所以這件事寫進程式。
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
		// Lesson 25 坑 1：第一版的佔位符壞掉，**每一條 claim 的引用都變成空的**，
		// 而程式照樣跑完，看起來像「這份報告爛透了」。
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
		// 真實報告裡的那一條：授權句掛了一個從沒提過授權的論壇網址。
		const verdict = verifyClaim(
			"程式碼採用 MIT 授權",
			["https://example.com/repo", "https://example.com/forum"],
			corpus,
		);
		assert.deepEqual(verdict.graftedSources, ["https://example.com/forum"]);
	});

	test("英文月份要對得上中文的月份數字", () => {
		// Lesson 25 坑 3：去空白讓 "June 2026" 變成 "62026"，
		// 於是原子 6 被判成查無來源。
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
