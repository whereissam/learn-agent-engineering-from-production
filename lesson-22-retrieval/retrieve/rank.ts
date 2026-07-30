/**
 * Fusion, dedup, quality signals, source diversity.
 *
 * This file is what "ranking" really looks like. Many people think ranking is computing a
 * score and sorting; in practice the score is only the first step and the rest is **correction**:
 *
 *   two nearly identical documents take two slots  → dedup
 *   a two-year-old listicle still ranks high       → freshness
 *   a keyword-stuffed farm ranks first             → anti-spam
 *   the whole top five comes from one site         → source diversity
 *
 * Each line was added by somebody burned by a real result.
 */

import type { IndexedPage } from "../../lesson-20-search-agent/corpus/generate.ts";

// ─────────────────────────────────────────────────────────────
// 1. RRF: combining two rankings into one
// ─────────────────────────────────────────────────────────────

/**
 * Reciprocal Rank Fusion。
 *
 *   score(d) = Σ  1 / (K + rank_i(d))
 *
 * The key is that it **looks only at rank, not at score**. That matters, because a BM25 score
 * (2.771) and a cosine similarity (0.83) are not on the same scale at all; a weighted sum
 * needs normalisation first, and the choice of normalisation becomes another parameter to tune.
 *
 * RRF sidesteps it: **first on BM25 and third on dense is 1/61 + 1/63.**
 * No weights to tune, and it usually beats a tuned weighted sum.
 *
 * K=60 is the value from the original paper (Cormack et al., 2009), and practically everyone
 * copies it. The larger K is, the flatter the gaps between ranks.
 */
export function rrf(lists: string[][], k = 60): Map<string, number> {
	const scores = new Map<string, number>();
	for (const list of lists) {
		list.forEach((id, index) => {
			scores.set(id, (scores.get(id) ?? 0) + 1 / (k + index + 1));
		});
	}
	return scores;
}

// ─────────────────────────────────────────────────────────────
// 2. Near-duplicates
// ─────────────────────────────────────────────────────────────

/**
 * Cut the text into fragments of n consecutive words (shingles).
 *
 * Why not "how similar are the two documents' word sets"? Because then "我愛你" and "你愛我"
 * would be judged identical. **Shingles preserve word order**, which is crucial for detecting
 * plagiarism and mirror sites.
 */
function shingles(text: string, n = 3): Set<string> {
	const words = text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
	const set = new Set<string>();
	for (let i = 0; i + n <= words.length; i++) {
		set.add(words.slice(i, i + n).join(" "));
	}
	return set;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
	if (a.size === 0 || b.size === 0) return 0;
	let shared = 0;
	for (const item of a) if (b.has(item)) shared++;
	return shared / (a.size + b.size - shared);
}

export interface DuplicateGroup {
	kept: string;
	dropped: string[];
	similarity: number;
}

/**
 * Find near-duplicates and keep one per group.
 *
 * Which one? **The one ranked higher** (the caller has already sorted).
 * That beats "keep the longer one" or "keep the newer one", because the earlier stages already
 * weighed relevance; this step should not overturn that, only cut the surplus.
 *
 * ## The 0.15 threshold is measured, and the first guess was wrong
 *
 * It was originally 0.5 from intuition — surely a mirror site is at least half identical. Measured:
 *
 *   shingle length   mirror pair   next most similar pair   gap
 *        2         0.346       0.118       0.228
 *        3         0.266       0.065       0.201
 *        4         0.215       0.048       0.167
 *        5         0.174       0.040       0.133
 *
 * **Mirror pairs are only 0.17-0.35, far below intuition.** Because the docs site in the corpus
 * is not copy-paste but a rewritten, condensed version (7 sections down to 5, with shortened
 * sentences) — most real-world mirrors look like that, and verbatim copies are rarer.
 *
 * The consequence of a 0.5 threshold is that **dedup never fires once**, and nDCG will never
 * tell you, because "did nothing" and "did something with no effect" look identical in an average.
 *
 * n=3 was chosen because its gap is large enough (0.266 vs 0.065, four times), and a threshold
 * of 0.15 is safe on both sides.
 *
 * > A real system does not compare pairwise like this (O(n²)); it uses SimHash or MinHash plus
 * > LSH to shrink the candidates into small buckets first. 14 documents do not need it, and the
 * > concept is the same: **narrow the field with the cheap method first.**
 */
export function dedupe(
	orderedIds: string[],
	pages: Map<string, IndexedPage>,
	threshold = 0.15,
): { ids: string[]; groups: DuplicateGroup[] } {
	const kept: string[] = [];
	const groups: DuplicateGroup[] = [];
	const fingerprints = new Map<string, Set<string>>();

	for (const id of orderedIds) {
		const page = pages.get(id);
		if (!page) continue;
		const fingerprint = shingles(page.text);

		let duplicateOf: { id: string; similarity: number } | undefined;
		for (const keptId of kept) {
			const other = fingerprints.get(keptId);
			if (!other) continue;
			const similarity = jaccard(fingerprint, other);
			if (similarity >= threshold) {
				duplicateOf = { id: keptId, similarity };
				break;
			}
		}

		if (duplicateOf) {
			const group = groups.find((g) => g.kept === duplicateOf.id);
			if (group) group.dropped.push(id);
			else groups.push({ kept: duplicateOf.id, dropped: [id], similarity: duplicateOf.similarity });
			continue;
		}

		kept.push(id);
		fingerprints.set(id, fingerprint);
	}

	return { ids: kept, groups };
}

// ─────────────────────────────────────────────────────────────
// 3. Quality signals
// ─────────────────────────────────────────────────────────────

/**
 * "Today" is hardcoded.
 *
 * Because freshness affects ranking, and with `Date.now()` this lesson's evaluation numbers
 * would differ every day, so the README's tables would be wrong tomorrow.
 *
 * This is not merely pedagogical convenience: **any time-dependent ranking must be able to fix
 * time in tests**, or regression testing is meaningless.
 */
export const TODAY = new Date("2026-07-27T00:00:00Z").getTime();

/** Per-domain prior weights. */
const HOST_PRIOR: Record<string, number> = {
	"github.com": 0.9,
	"arxiv.org": 0.9,
	"unitree.com": 1.0,
	"www.unitree.com": 1.0,
	"discourse.ros.org": 0.7,
	"huggingface.co": 0.8,
	"openmotion.dev": 0.8,
	"blog.kinelabs.dev": 0.7,
	"robotblog.example.com": 0.3,
	"technews.example.com": 0.3,
	"top-robotics-tools.example.net": 0.1,
	"cookingwith.example.com": 0.3,
};

export interface Signals {
	/** 0-1, higher is newer. */
	freshness: number;
	/** 0-1, a hand-maintained domain prior. */
	authority: number;
	/** 0-1, how much keyword stuffing there is; higher is more suspicious. */
	stuffing: number;
}

export function signalsFor(page: IndexedPage): Signals {
	return {
		freshness: freshness(page.published),
		authority: HOST_PRIOR[hostOf(page.url)] ?? 0.5,
		stuffing: stuffing(page.text),
	};
}

function hostOf(url: string): string {
	try {
		return new URL(url).host;
	} catch {
		return "";
	}
}

/**
 * Freshness: exponential decay with an 18-month half-life.
 *
 * Why decay rather than "discard anything over a year old"? Because old is not wrong.
 * An arXiv paper is useful after three years; an SDK document can be stale in three months.
 * **Decay is a mild preference, not a threshold.**
 *
 * A real system also tunes it per topic: news might have a half-life of days, and a mathematical
 * theorem an infinite one.
 */
function freshness(published: string): number {
	const days = (TODAY - new Date(published).getTime()) / 86_400_000;
	if (!Number.isFinite(days)) return 0.5;
	return Math.exp((-Math.LN2 * Math.max(days, 0)) / 540);
}

/**
 * How many times a word must repeat before it qualifies as "stuffing".
 *
 * **This threshold was found by the evaluation, not thought of up front.**
 *
 * The first version looked only at the ratio, and the nDCG average rose from 0.720 to 0.768
 * (which looks good) while one query collapsed from 1.000 to 0.131. It turned out the ratio is
 * **systematically biased against short documents**:
 *
 *   a 60-word SEO farm      "retargeting" × 12 → 20.0%   ← genuinely stuffing
 *   a 28-word dataset page  "clips"       ×  3 → 10.7%   ← a false positive
 *   a 25-word LICENSE       "license"     ×  4 → 16.0%   ← a false positive
 *
 * A 25-word licence file is going to keep saying license; that is not cheating, that is how short
 * it is. With the "absolute count" condition added, both false positives go to zero and the farm
 * is still caught.
 *
 * The full account is in README Step 5. It is this lesson's most important passage:
 * **a rising average does not mean nothing broke.**
 */
const MIN_REPEATS = 5;

/**
 * Keyword stuffing detection.
 *
 * **The point: this signal is computed, not labelled in the corpus.**
 *
 * It would be easy to write `kind: "spam"` in `pages.ts` and read that field while ranking, and
 * that would be cheating — a real page never confesses to being a farm. So only things computable
 * from the page itself are used: **how often the most frequent word repeats, and what fraction
 * of the text that is.**
 *
 * A normal article sits around 2-4% and a farm reaches 8% or more, because the whole page repeats
 * one set of keywords. The threshold is measured, not guessed (see README Steps 4 and 5).
 */
function stuffing(text: string): number {
	const words = text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3);
	if (words.length === 0) return 0;

	const counts = new Map<string, number>();
	for (const word of words) counts.set(word, (counts.get(word) ?? 0) + 1);
	const top = Math.max(...counts.values());

	// Too few repeats is never stuffing, however high the ratio.
	// Without this line, short documents are systematically wronged.
	if (top < MIN_REPEATS) return 0;

	const ratio = top / words.length;

	// Below 4% counts as normal, 10% and above as maximally suspicious, linear in between
	return Math.min(Math.max((ratio - 0.04) / 0.06, 0), 1);
}

// ─────────────────────────────────────────────────────────────
// 4. Folding the signals into the score
// ─────────────────────────────────────────────────────────────

export const WEIGHTS = { relevance: 1.0, freshness: 0.15, authority: 0.2, stuffing: 0.35 };

/**
 * Normalise the RRF score to 0-1, then add the quality signals linearly.
 *
 * Why normalise? Because RRF scores land around 0.016-0.033, and adding a 0-1 signal directly
 * would bury relevance entirely.
 * **Scores from different sources must be on one scale before they can be added**, which is the
 * awkward part of a weighted sum, and the reason RRF above looks only at rank.
 */
export function applySignals(
	fused: Map<string, number>,
	pages: Map<string, IndexedPage>,
): Array<{ id: string; score: number; signals: Signals; relevance: number }> {
	const values = [...fused.values()];
	const min = Math.min(...values);
	const max = Math.max(...values);
	const span = max - min || 1;

	return [...fused.entries()]
		.map(([id, raw]) => {
			const page = pages.get(id);
			const signals = page
				? signalsFor(page)
				: { freshness: 0.5, authority: 0.5, stuffing: 0 };
			const relevance = (raw - min) / span;
			const score =
				WEIGHTS.relevance * relevance +
				WEIGHTS.freshness * signals.freshness +
				WEIGHTS.authority * signals.authority -
				WEIGHTS.stuffing * signals.stuffing;
			return { id, score, signals, relevance };
		})
		.sort((a, b) => b.score - a.score);
}

// ─────────────────────────────────────────────────────────────
// 5. Source diversity
// ─────────────────────────────────────────────────────────────

/**
 * How many times one domain may appear near the top.
 *
 * Why limit it? Because when the user asks "which projects exist", a top five of five pages
 * from one repo carries the information content of one.
 *
 * Note this **deliberately sacrifices relevance** for coverage. The pages pushed out may
 * genuinely score higher. This is a product decision, not a ranking bug.
 */
export function diversify<T extends { id: string }>(
	ranked: T[],
	pages: Map<string, IndexedPage>,
	maxPerHost = 2,
): T[] {
	const seen = new Map<string, number>();
	const kept: T[] = [];
	const overflow: T[] = [];

	for (const item of ranked) {
		const page = pages.get(item.id);
		const host = page ? hostOf(page.url) : "";
		const count = seen.get(host) ?? 0;
		if (count >= maxPerHost) {
			overflow.push(item);
			continue;
		}
		seen.set(host, count + 1);
		kept.push(item);
	}

		// The surplus is not discarded but pushed back. A user on page two still sees it.
	return [...kept, ...overflow];
}
