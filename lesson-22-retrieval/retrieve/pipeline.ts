/**
 * 檢索管線：把每一個階段串起來，而且每一個都可以單獨關掉。
 *
 *   BM25            關鍵字，便宜、精確、看不懂同義詞
 *   Dense           語義，跨語言，但精確字串會被稀釋
 *   RRF             把兩份名次合成一份
 *   Dedupe          近似重複只留一個
 *   Signals         新鮮度、權威度、關鍵字堆砌
 *   Diversity       同一個網域最多兩筆
 *
 * **每個階段都能關掉**，這不是為了做設定檔，是為了做評估：
 * 你要能回答「加這個階段之後，nDCG 到底有沒有變好」。
 * 沒有這個開關，你只能一次改一堆然後憑感覺。
 */

import { search as bm25Search } from "../../lesson-20-search-agent/search/engine.ts";
import type { IndexedPage } from "../../lesson-20-search-agent/corpus/generate.ts";
import { denseRank, loadCorpus } from "./dense.ts";
import { type DuplicateGroup, applySignals, dedupe, diversify, rrf, type Signals } from "./rank.ts";
import { llmRerank } from "./rerank.ts";

export interface Stages {
	bm25: boolean;
	dense: boolean;
	dedupe: boolean;
	signals: boolean;
	diversity: boolean;
	/** 最後讓模型重排前幾筆。要金鑰，預設關閉，見 rerank.ts。 */
	rerank?: boolean;
}

export const ALL_STAGES: Stages = {
	bm25: true,
	dense: true,
	dedupe: true,
	signals: true,
	diversity: true,
	rerank: false,
};

export interface RetrievedHit {
	rank: number;
	id: string;
	url: string;
	title: string;
	published: string;
	score: number;
	/** 這一筆在各階段的名次，用來解釋「為什麼它在這裡」。 */
	bm25Rank?: number;
	denseRank?: number;
	/**
	 * 跟 query 的 cosine 相似度（0-1）。
	 *
	 * ⚠️ 這是整個回傳值裡**唯一有絕對意義**的分數。
	 *
	 * `score` 是候選集內 min-max 正規化過的，所以最高分永遠接近 1，
	 * **不管那一批候選到底相不相關**。單一來源的時候沒差（使用者自己會
	 * 看出來前五名都是垃圾），但要跟另一個來源融合的時候就會出事：
	 * 一個完全不相關的來源，它的「第 1 名」還是會被當成第 1 名。
	 *
	 * Lesson 27 就是因此被一篇 sous vide 烹飪指南汙染的。
	 */
	denseScore?: number;
	signals?: Signals;
}

export interface RetrieveResult {
	hits: RetrievedHit[];
	duplicates: DuplicateGroup[];
	/** BM25 有沒有完全沒東西（例如中文 query）。 */
	bm25Empty: boolean;
}

/** 每一路各取幾筆進融合。取太少會漏，取太多會讓後面的階段做白工。 */
const CANDIDATES = 10;

/** rerank 只看前幾筆。這個數字直接決定那一步的成本。 */
const RERANK_DEPTH = 8;

export async function retrieve(
	query: string,
	stages: Stages = ALL_STAGES,
	limit = 5,
): Promise<RetrieveResult> {
	const pages = loadCorpus();
	const byId = new Map<string, IndexedPage>(pages.map((p) => [p.id, p]));
	const idByUrl = new Map(pages.map((p) => [p.url, p.id]));

	const lists: string[][] = [];
	const bm25Position = new Map<string, number>();
	const densePosition = new Map<string, number>();

	if (stages.bm25) {
		const hits = bm25Search(query, CANDIDATES);
		const ids = hits.map((h) => idByUrl.get(h.url) ?? "").filter(Boolean);
		ids.forEach((id, i) => bm25Position.set(id, i + 1));
		if (ids.length > 0) lists.push(ids);
	}

	const denseScores = new Map<string, number>();
	if (stages.dense) {
		const ranked = (await denseRank(query)).slice(0, CANDIDATES);
		const ids = ranked.map((r) => r.id);
		ids.forEach((id, i) => densePosition.set(id, i + 1));
		for (const item of ranked) denseScores.set(item.id, item.score);
		lists.push(ids);
	}

	const bm25Empty = stages.bm25 && bm25Position.size === 0;

	// 兩路都沒有東西：直接回空，不要假裝有結果
	if (lists.length === 0) return { hits: [], duplicates: [], bm25Empty };

	const fused = rrf(lists);

	let ordered = [...fused.entries()]
		.sort((a, b) => b[1] - a[1])
		.map(([id]) => id);

	let duplicates: DuplicateGroup[] = [];
	if (stages.dedupe) {
		// 去重要在加訊號**之前**做。
		// 反過來的話，你可能會留下鏡像站而砍掉原始 repo，只因為鏡像站比較新。
		const result = dedupe(ordered, byId);
		ordered = result.ids;
		duplicates = result.groups;
	}

	let scored: Array<{ id: string; score: number; signals?: Signals }>;
	if (stages.signals) {
		const kept = new Map([...fused].filter(([id]) => ordered.includes(id)));
		scored = applySignals(kept, byId);
	} else {
		scored = ordered.map((id, i) => ({ id, score: 1 / (i + 1) }));
	}

	if (stages.diversity) scored = diversify(scored, byId);

	// rerank 只看前面幾筆。這是整條管線最貴的一步，
	// 所以它要在候選已經被縮到很小之後才出場。
	if (stages.rerank) {
		const head = scored.slice(0, RERANK_DEPTH);
		const llmScores = await llmRerank(
			query,
			head.map((item) => {
				const page = byId.get(item.id);
				return {
					id: item.id,
					title: page?.title ?? "",
					url: page?.url ?? "",
					text: page?.text ?? "",
				};
			}),
		);
		// 模型沒給分的當 0。排序時 LLM 分數優先，同分時保留原本的順序，
		// 這樣模型只需要「修正明顯錯的」，不需要重新發明整個排序。
		const rescored = head
			.map((item, i) => ({ item, llm: llmScores.get(item.id) ?? 0, original: i }))
			.sort((a, b) => b.llm - a.llm || a.original - b.original)
			.map((entry) => entry.item);
		scored = [...rescored, ...scored.slice(RERANK_DEPTH)];
	}

	const hits: RetrievedHit[] = scored.slice(0, limit).map((item, i) => {
		const page = byId.get(item.id);
		return {
			rank: i + 1,
			id: item.id,
			url: page?.url ?? item.id,
			title: page?.title ?? "",
			published: page?.published ?? "",
			score: Math.round(item.score * 1000) / 1000,
			bm25Rank: bm25Position.get(item.id),
			denseRank: densePosition.get(item.id),
			denseScore: denseScores.get(item.id),
			signals: item.signals,
		};
	});

	return { hits, duplicates, bm25Empty };
}
