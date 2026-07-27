/**
 * 檢索評估執行器。
 *
 * Lesson 7 教的是「量測 → 發現問題 → 修 → 確認沒退步」，
 * 那一課量的是 agent 的報告。這一課量的是**排序**。
 *
 * 用法：
 *   bun run lesson-22:eval              六種組態各跑一次，印比較表
 *   bun run lesson-22:eval --show q1    看某一題的實際排序和每一筆的來歷
 *   bun run lesson-22:embed             重算 embedding 快取（要金鑰）
 *
 * 沒有金鑰也能跑，因為 embedding 已經算好放在 `embed/cache.json`。
 */

import { loadCorpus, warmCorpusEmbeddings } from "../retrieve/dense.ts";
import { cacheStats, embed } from "../embed/provider.ts";
import { type Stages, retrieve } from "../retrieve/pipeline.ts";
import { jaccard } from "../retrieve/rank.ts";
import { QUERIES } from "./queries.ts";

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;

/**
 * nDCG@k：排序品質最常用的指標。
 *
 * 它同時回答兩件事：**相關的有沒有被找到**，以及**有沒有排在前面**。
 * 一個相關度 3 的頁面排第 1 拿滿分，排第 5 只拿一半左右。
 *
 * 公式裡的 `2^rel - 1` 是在放大高相關度的重要性：
 * 一個 rel=3 的結果值 7 分，三個 rel=1 的結果加起來才 3 分。
 * **這符合使用者的實際感受**：一個完全正確的答案，勝過三個沾到邊的。
 *
 * 分母 `log2(i+1)` 是位置折扣：越後面的位置，就算相關也拿不到多少分。
 */
function ndcg(rankedUrls: string[], relevance: Record<string, number>, k = 5): number {
	const gains = rankedUrls.slice(0, k).map((url) => relevance[url] ?? 0);
	const dcg = gains.reduce((sum, rel, i) => sum + (2 ** rel - 1) / Math.log2(i + 2), 0);

	const ideal = Object.values(relevance)
		.sort((a, b) => b - a)
		.slice(0, k);
	const idcg = ideal.reduce((sum, rel, i) => sum + (2 ** rel - 1) / Math.log2(i + 2), 0);

	return idcg === 0 ? 0 : dcg / idcg;
}

/** 前 k 名裡有幾個是相關的（rel >= 1）。比 nDCG 粗糙，但很直觀。 */
function recall(rankedUrls: string[], relevance: Record<string, number>, k = 5): number {
	const total = Object.keys(relevance).length;
	if (total === 0) return 1;
	const found = rankedUrls.slice(0, k).filter((url) => (relevance[url] ?? 0) > 0).length;
	return found / Math.min(total, k);
}

/**
 * novelty@k：前 k 名裡，有幾個不是前面某一筆的近似重複。
 *
 * **這個指標是後來才加的，因為 nDCG 看不到我在乎的事。**
 *
 * nDCG 只問「相關嗎、排得夠前面嗎」。兩份幾乎一樣的內容如果都相關，
 * 它會給兩份都算分——但對使用者來說第二份的價值接近零，
 * 對 agent 來說更糟：它要多花一次 `fetch_page` 才發現自己讀了同一篇。
 *
 * 學術界處理這件事的指標叫 α-nDCG（把已經看過的資訊打折）。
 * 這裡用一個更好懂的版本：**直接數有幾筆是新的。**
 *
 * 教訓：**當既有指標看不到你在乎的東西時，就再加一個指標**，
 * 不要為了讓數字好看去改評估集。
 */
function novelty(rankedUrls: string[], texts: Map<string, string>, k = 5): number {
	const top = rankedUrls.slice(0, k);
	if (top.length === 0) return 1;

	const seen: Array<Set<string>> = [];
	let fresh = 0;

	for (const url of top) {
		const fingerprint = shingle(texts.get(url) ?? "");
		const duplicate = seen.some((other) => jaccard(fingerprint, other) >= 0.15);
		if (!duplicate) fresh++;
		seen.push(fingerprint);
	}

	return fresh / top.length;
}

function shingle(text: string, n = 3): Set<string> {
	const words = text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
	const set = new Set<string>();
	for (let i = 0; i + n <= words.length; i++) set.add(words.slice(i, i + n).join(" "));
	return set;
}

/**
 * 課程裡會示範到的 query，也要一起放進 embedding 快取。
 *
 * 不然沒有金鑰的人一跑 `PROVIDER=fake bun run lesson-22` 就會炸，
 * 因為 dense retrieval 需要 query 的向量。
 * **「離線也能跑」不是只有評估要顧，示範用的輸入也要顧。**
 */
const DEMO_QUERIES = [
	"有哪些 open source 專案可以把影片動作 retarget 到 Unitree G1？",
	"把影片動作 retarget 到 Unitree G1 的開源專案",
	"unitree g1 retargeting",
	"open source video to humanoid retargeting",
	"humanoid-mimic g1 support",
	"retarget-anything 還能用在 2026 SDK 嗎",
];

// 六種組態，一層一層疊上去。
// 這個順序就是這一課的敘事順序，也是實際開發時該有的順序：
// **一次只加一個東西，然後看數字。**
const CONFIGS: Array<{ label: string; stages: Stages }> = [
	{
		label: "BM25 only（Lesson 20）",
		stages: { bm25: true, dense: false, dedupe: false, signals: false, diversity: false },
	},
	{
		label: "Dense only",
		stages: { bm25: false, dense: true, dedupe: false, signals: false, diversity: false },
	},
	{
		label: "+ RRF 融合",
		stages: { bm25: true, dense: true, dedupe: false, signals: false, diversity: false },
	},
	{
		label: "+ 去重",
		stages: { bm25: true, dense: true, dedupe: true, signals: false, diversity: false },
	},
	{
		label: "+ 品質訊號",
		stages: { bm25: true, dense: true, dedupe: true, signals: true, diversity: false },
	},
	{
		label: "+ 來源多樣性",
		stages: { bm25: true, dense: true, dedupe: true, signals: true, diversity: true },
	},
];

// LLM rerank 要金鑰，所以只有 --rerank 才加進來比較
if (process.argv.includes("--rerank")) {
	CONFIGS.push({
		label: "+ LLM rerank",
		stages: { bm25: true, dense: true, dedupe: true, signals: true, diversity: true, rerank: true },
	});
}

async function showOne(queryId: string): Promise<void> {
	const query = QUERIES.find((q) => q.id === queryId || q.id.startsWith(queryId));
	if (!query) {
		throw new Error(`找不到 ${queryId}。可用：${QUERIES.map((q) => q.id).join(", ")}`);
	}

	console.log(bold(`\n${query.query}`));
	console.log(dim(`測的是：${query.tests}\n`));

	for (const config of CONFIGS) {
		const result = await retrieve(query.query, config.stages, 5);
		const urls = result.hits.map((h) => h.url);
		const score = ndcg(urls, query.relevant);

		console.log(`${bold(config.label.padEnd(24))} nDCG@5 = ${score.toFixed(3)}`);
		if (result.bm25Empty) console.log(dim("    BM25 回 0 筆（query 斷不出英文字）"));

		for (const hit of result.hits) {
			const rel = query.relevant[hit.url] ?? 0;
			const mark = rel >= 3 ? "★" : rel > 0 ? "·" : " ";
			const from = [
				hit.bm25Rank ? `bm25#${hit.bm25Rank}` : "",
				hit.denseRank ? `dense#${hit.denseRank}` : "",
			]
				.filter(Boolean)
				.join(" ");
			const sig = hit.signals
				? ` fresh=${hit.signals.freshness.toFixed(2)} auth=${hit.signals.authority.toFixed(2)} stuff=${hit.signals.stuffing.toFixed(2)}`
				: "";
			console.log(
				`  ${mark} ${hit.rank}. ${hit.title.slice(0, 52).padEnd(54)}${dim(`${from}${sig}`)}`,
			);
		}
		for (const group of result.duplicates) {
			console.log(dim(`    去重：${group.dropped.join(", ")} ≈ ${group.kept} (${group.similarity.toFixed(2)})`));
		}
		console.log();
	}
}

async function runAll(): Promise<void> {
	const stats = cacheStats();
	console.log(dim(`embedding: ${stats.model || "(快取)"}  ${stats.dims} 維  ${stats.count} 筆\n`));

	const header = `${"query".padEnd(18)}${CONFIGS.map((c) => c.label.slice(0, 10).padStart(12)).join("")}`;
	console.log(dim(header));

	const totals = CONFIGS.map(() => ({ ndcg: 0, recall: 0, novelty: 0 }));
	const texts = new Map(loadCorpus().map((p) => [p.url, p.text]));

	for (const query of QUERIES) {
		const cells: string[] = [];
		for (let i = 0; i < CONFIGS.length; i++) {
			const config = CONFIGS[i];
			if (!config) continue;
			const result = await retrieve(query.query, config.stages, 5);
			const urls = result.hits.map((h) => h.url);
			const score = ndcg(urls, query.relevant);
			const total = totals[i];
			if (total) {
				total.ndcg += score;
				total.recall += recall(urls, query.relevant);
				total.novelty += novelty(urls, texts);
			}
			cells.push(score.toFixed(3).padStart(12));
		}
		console.log(`${query.id.padEnd(18)}${cells.join("")}`);
	}

	const n = QUERIES.length;
	console.log(dim("─".repeat(18 + 12 * CONFIGS.length)));
	console.log(
		`${bold("平均 nDCG@5".padEnd(18))}${totals.map((t) => (t.ndcg / n).toFixed(3).padStart(12)).join("")}`,
	);
	console.log(
		`${"平均 recall@5".padEnd(18)}${totals.map((t) => (t.recall / n).toFixed(3).padStart(12)).join("")}`,
	);
	console.log(
		`${"平均 novelty@5".padEnd(17)}${totals.map((t) => (t.novelty / n).toFixed(3).padStart(12)).join("")}`,
	);
	console.log();
	console.log(dim('看某一題的細節：bun run lesson-22:eval --show q1'));
}

if (import.meta.main) {
	const args = process.argv.slice(2);

	if (args.includes("--warm")) {
		// 把語料和評估 query 的向量全部算好寫進快取
		await warmCorpusEmbeddings();
		await embed([...QUERIES.map((q) => q.query), ...DEMO_QUERIES]);
		const stats = cacheStats();
		console.log(`embedding 快取已更新：${stats.count} 筆，${stats.dims} 維，model=${stats.model}`);
	} else if (args.includes("--show")) {
		const id = args[args.indexOf("--show") + 1];
		if (!id) throw new Error("--show 後面要接 query id，例如 q1");
		await showOne(id);
	} else {
		await runAll();
	}
}
