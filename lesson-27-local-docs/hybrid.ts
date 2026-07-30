/**
 * Putting local documents and web pages into one ranking.
 *
 * ## Why this is easier than it sounds
 *
 * Because Lesson 22 chose RRF.
 *
 * RRF **looks only at rank, not at score** — the original reason being "BM25's 2.771 and a
 * cosine's 0.83 are not on the same scale". That same property now solves another problem:
 * a local chunk's BM25 score and a web page's fusion score are not on the same scale either,
 * but **ranks are always comparable**.
 *
 * ```text
 * local 1st + web 3rd  →  1/61 + 1/63
 * ```
 *
 * Had a weighted sum been chosen back then, this lesson would have to redesign normalisation.
 * **A good abstraction pays interest where you did not expect it.**
 *
 * ## What is genuinely hard is elsewhere
 *
 *   local documents have no URL   → source identity has to be constructed (ingest.ts)
 *   local documents have no authority → Lesson 22's signal formula cannot be copied as is
 *   local documents change        → the index needs incremental updates (ingest.ts)
 *   who to believe when they disagree → see README Step 4
 */

import { ALL_STAGES, retrieve } from "../lesson-22-retrieval/retrieve/pipeline.ts";
import { rrf } from "../lesson-22-retrieval/retrieve/rank.ts";
import { Bm25Index } from "./bm25.ts";
import { type LocalChunk, readIndex } from "./ingest.ts";

export interface HybridHit {
	rank: number;
	kind: "local" | "web";
	/** A URL for the web, `path#L12-L48` for local. Both are clickable and verifiable. */
	source: string;
	title: string;
	snippet: string;
	localRank?: number;
	webRank?: number;
}

export interface HybridResult {
	hits: HybridHit[];
	/** Whether dense actually ran. Without a key and without a cache it degrades to pure keyword. */
	denseAvailable: boolean;
	counts: { local: number; web: number };
	/** How many were blocked by the relevance floor (local / web). */
	filtered: { local: number; web: number };
}

/**
 * The relevance floor: drop anything below this fraction of the top score.
 *
 * ## This line was forced out by measurement
 *
 * The first version had no floor, taking the top N from each side and fusing. Querying
 * "how do you choose chunk size" then put **a sous vide cooking guide in 4th place**.
 *
 * The cause is not broken ranking but that **RRF looks only at rank**: the web side is wholly
 * unrelated to this question and still hands over a "top five", and RRF gives anything called
 * "rank 1" a high score. The absolute level of relevance is discarded during fusion.
 *
 * ```text
 * single source  top-k is fine: bad results rank low and the user ignores them
 * cross-source   top-k is harmful: a bad source's 1st place is treated as "1st place"
 * ```
 *
 * This is exactly the difference read in Lesson 23 Step 3 and merely noted at the time:
 * gpt-researcher filters by a **similarity threshold** (`SIMILARITY_THRESHOLD = 0.35`)
 * rather than taking top-k. What was written then was "a threshold is often better for an
 * agent"; **for cross-source fusion it is not better, it is necessary**.
 *
 * ## And the threshold must use an absolute score
 *
 * The first version's floor was relative (drop below 35% of the top score) and **blocked
 * nothing**. Because Lesson 22's `score` is min-max normalised within the candidate set,
 * **the top score is always near 1** regardless of whether that batch is relevant. A relative
 * floor means nothing against it.
 * So the web side switched to `denseScore` (the cosine similarity) — the only score in the
 * whole return value with absolute meaning.
 *
 * ## A threshold cannot be copied from somebody else
 *
 * The second version copied gpt-researcher's `SIMILARITY_THRESHOLD = 0.35`
 * (`context/compression.py:123`), and it **still blocked nothing**.
 *
 * Measuring shows why — `gemini-embedding-001`'s irrelevant baseline is already high:
 *
 * ```text
 * query                        cosine range of the web results
 * "unitree g1 retargeting…"    0.70 - 0.79    ← genuinely relevant
 * "how do you choose chunk size" 0.45 - 0.50   ← wholly irrelevant
 * "BM25 RRF fusion ranking"     0.47 - 0.52   ← wholly irrelevant
 * ```
 *
 * **Irrelevant things score 0.45-0.52 too.** gpt-researcher's 0.35 is calibrated for OpenAI
 * embeddings and stops working the moment the model changes.
 *
 * The separation is clean (0.52 vs 0.70), so take the middle: 0.60.
 *
 * > **The lesson: a threshold is a property of the model, not a general rule. Measure your own
 * > distribution before copying somebody's constant.** Same error as Lesson 22's wrong dedup
 * > threshold (0.5 from intuition, 0.17 in reality), except this time what was copied came
 * > from an authoritative source, which makes it more comfortable not to verify.
 *
 * The local side has no embeddings, so it keeps a relative floor. BM25 scores are comparable
 * within one index and not across indexes.
 */
const DENSE_FLOOR = 0.6;
const LOCAL_RELATIVE_FLOOR = 0.35;

function applyLocalFloor<T extends { score: number }>(hits: T[]): { kept: T[]; dropped: number } {
	const top = hits[0]?.score ?? 0;
	if (top <= 0) return { kept: [], dropped: hits.length };
	const kept = hits.filter((hit) => hit.score >= top * LOCAL_RELATIVE_FLOOR);
	return { kept, dropped: hits.length - kept.length };
}

function applyWebFloor<T extends { denseScore?: number }>(
	hits: T[],
	denseAvailable: boolean,
): { kept: T[]; dropped: number } {
		// With dense unavailable there is no absolute score, so everything is kept,
		// and the caller sees denseAvailable=false and knows this batch is dirtier.
	if (!denseAvailable) return { kept: hits, dropped: 0 };
	const kept = hits.filter((hit) => (hit.denseScore ?? 0) >= DENSE_FLOOR);
	return { kept, dropped: hits.length - kept.length };
}

let index: { chunks: LocalChunk[]; bm25: Bm25Index } | undefined;

function localIndex() {
	if (index) return index;
	const { chunks } = readIndex();
	const bm25 = new Bm25Index(
		chunks.map((chunk) => ({ id: chunk.id, title: chunk.heading, text: chunk.text })),
	);
	index = { chunks, bm25 };
	return index;
}

function snippetOf(text: string, limit = 150): string {
	const flat = text.replace(/\s+/g, " ").trim();
	return flat.length <= limit ? flat : `${flat.slice(0, limit)}…`;
}

export interface HybridOptions {
	/**
		 * Turn the relevance floor off, taking the top N from each side and fusing directly.
	 *
		 * **This option exists for one purpose: letting you see what the floor blocks.**
		 * A real system should not have this switch.
	 *
		 * (The same purpose as Lesson 17's `disableSourceWeighting`. The best way to explain
		 * whether a mechanism deserves to exist is switching it off and running once.)
	 */
	disableFloor?: boolean;
}

export async function hybridSearch(
	query: string,
	limit = 8,
	options: HybridOptions = {},
): Promise<HybridResult> {
	const { chunks, bm25 } = localIndex();

	const localRaw = bm25.search(query, limit + 4);
	const { kept: localHits, dropped: localDropped } = options.disableFloor
		? { kept: localRaw, dropped: 0 }
		: applyLocalFloor(localRaw);
	const byId = new Map(chunks.map((chunk) => [chunk.id, chunk]));

	// The web side goes straight through Lesson 22's full pipeline.
	// Without a key and with the query absent from the embedding cache, dense throws —
	// and then it falls back to pure BM25 rather than failing the whole query.
	// **Degradation must happen automatically and be stated** (see denseAvailable in the return).
	let webRaw: Awaited<ReturnType<typeof retrieve>>["hits"] = [];
	let denseAvailable = true;
	try {
		webRaw = (await retrieve(query, ALL_STAGES, limit)).hits;
	} catch {
		denseAvailable = false;
		webRaw = (await retrieve(query, { ...ALL_STAGES, dense: false }, limit)).hits;
	}
	const { kept: webHits, dropped: webDropped } = options.disableFloor
		? { kept: webRaw, dropped: 0 }
		: applyWebFloor(webRaw, denseAvailable);

	const localIds = localHits.map((hit) => `local:${hit.id}`);
	const webIds = webHits.map((hit) => `web:${hit.url}`);

	const fused = rrf([localIds, webIds]);

	const localPosition = new Map(localIds.map((id, i) => [id, i + 1]));
	const webPosition = new Map(webIds.map((id, i) => [id, i + 1]));

	const hits: HybridHit[] = [...fused.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, limit)
		.map(([key], i) => {
			const isLocal = key.startsWith("local:");
			const id = key.slice(isLocal ? 6 : 4);

			if (isLocal) {
				const chunk = byId.get(id);
				return {
					rank: i + 1,
					kind: "local" as const,
					source: id,
					title: chunk?.heading || chunk?.path || id,
					snippet: snippetOf(chunk?.text ?? ""),
					localRank: localPosition.get(key),
				};
			}

			const page = webHits.find((hit) => hit.url === id);
			return {
				rank: i + 1,
				kind: "web" as const,
				source: id,
				title: page?.title ?? id,
				snippet: page?.published ? `published ${page.published}` : "",
				webRank: webPosition.get(key),
			};
		});

	return {
		hits,
		denseAvailable,
		counts: {
			local: hits.filter((h) => h.kind === "local").length,
			web: hits.filter((h) => h.kind === "web").length,
		},
		filtered: { local: localDropped, web: webDropped },
	};
}
