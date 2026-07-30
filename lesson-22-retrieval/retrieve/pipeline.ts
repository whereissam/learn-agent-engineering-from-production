/**
 * The retrieval pipeline: every stage strung together, and every stage individually switchable.
 *
 *   BM25            keywords: cheap, precise, blind to synonyms
 *   Dense           semantics: cross-language, and precise strings get diluted
 *   RRF             combine two rankings into one
 *   Dedupe          keep one of each near-duplicate
 *   Signals         freshness, authority, keyword stuffing
 *   Diversity       at most two results per domain
 *
 * **Every stage can be switched off**, which is not for configurability but for evaluation:
 * you have to be able to answer "did nDCG actually improve after adding this stage".
 * Without that switch, all you can do is change several things and go by feel.
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
		/** Have the model re-rank the top few at the end. Needs a key, off by default, see rerank.ts. */
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
		/** This result's rank at each stage, for explaining "why is it here". */
	bm25Rank?: number;
	denseRank?: number;
	/**
		 * The cosine similarity to the query (0-1).
	 *
		 * ⚠️ This is the **only score in the whole return value with absolute meaning**.
	 *
		 * `score` is min-max normalised within the candidate set, so the top is always near 1
		 * **regardless of whether that batch is relevant at all**. Within one source that does not matter (the user
		 * sees for themselves that the top five are rubbish), and it goes wrong the moment you fuse with another source:
		 * a wholly irrelevant source's "rank 1" is still treated as rank 1.
	 *
		 * That is how Lesson 27 got contaminated by a sous vide cooking guide.
	 */
	denseScore?: number;
	signals?: Signals;
}

export interface RetrieveResult {
	hits: RetrievedHit[];
	duplicates: DuplicateGroup[];
		/** Did BM25 return nothing at all (a Chinese query, say). */
	bm25Empty: boolean;
}

/** How many each path contributes to the fusion. Too few misses things; too many makes later stages work for nothing. */
const CANDIDATES = 10;

/** rerank only sees the top few. This number directly decides that step's cost. */
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

	// Neither path has anything: return empty rather than pretending there are results
	if (lists.length === 0) return { hits: [], duplicates: [], bm25Empty };

	const fused = rrf(lists);

	let ordered = [...fused.entries()]
		.sort((a, b) => b[1] - a[1])
		.map(([id]) => id);

	let duplicates: DuplicateGroup[] = [];
	if (stages.dedupe) {
		// Dedup must happen **before** the signals.
		// The other way round, you may keep a mirror site and cut the original repo, purely because the mirror is newer.
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

	// rerank only sees the top few. It is the most expensive step in the pipeline,
	// so it appears only once the candidates have been narrowed a lot.
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
			// An unscored result counts as 0. Sorting puts the LLM score first and keeps the original order on ties,
			// so the model only has to "fix what is obviously wrong" rather than reinventing the whole ranking.
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
