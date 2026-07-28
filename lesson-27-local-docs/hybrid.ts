/**
 * 把本地文件和網頁放進同一份排序。
 *
 * ## 為什麼這件事沒有想像中難
 *
 * 因為 Lesson 22 選了 RRF。
 *
 * RRF **只看名次，不看分數**——當初的理由是「BM25 的 2.771 和 cosine 的
 * 0.83 不在同一個尺度上」。現在同一個性質順便解決了另一個問題：
 * 本地 chunk 的 BM25 分數和網頁的融合分數也不在同一個尺度上，
 * 但**名次永遠可以比**。
 *
 * ```text
 * 本地第 1 名 + 網頁第 3 名  →  1/61 + 1/63
 * ```
 *
 * 如果當初選的是加權相加，這一課就要重新設計正規化。
 * **好的抽象會在你沒預期的地方付利息。**
 *
 * ## 真正難的是別的東西
 *
 *   本地文件沒有 URL      → 來源識別要自己造（ingest.ts）
 *   本地文件沒有權威度    → Lesson 22 的訊號公式不能照抄
 *   本地文件會變          → 索引要能增量更新（ingest.ts）
 *   兩邊講的不一樣時信誰  → 見 README Step 4
 */

import { ALL_STAGES, retrieve } from "../lesson-22-retrieval/retrieve/pipeline.ts";
import { rrf } from "../lesson-22-retrieval/retrieve/rank.ts";
import { Bm25Index } from "./bm25.ts";
import { type LocalChunk, readIndex } from "./ingest.ts";

export interface HybridHit {
	rank: number;
	kind: "local" | "web";
	/** 網頁是 URL，本地是 `path#L12-L48`。兩者都能點開、都能驗證。 */
	source: string;
	title: string;
	snippet: string;
	localRank?: number;
	webRank?: number;
}

export interface HybridResult {
	hits: HybridHit[];
	/** dense 有沒有真的跑起來。沒金鑰又沒快取的時候會退化成純關鍵字。 */
	denseAvailable: boolean;
	counts: { local: number; web: number };
	/** 被相關性門檻擋掉的筆數（本地 / 網頁）。 */
	filtered: { local: number; web: number };
}

/**
 * 相關性門檻：低於最高分這個比例的就丟掉。
 *
 * ## 這條是實測逼出來的
 *
 * 第一版沒有門檻，兩邊各取前 N 名直接融合。結果查
 * 「chunk 大小要怎麼選」的時候，**一篇 sous vide 烹飪指南排到第 4 名**。
 *
 * 原因不是排序壞了，是 **RRF 只看名次**：網頁那一側跟這個問題完全無關，
 * 但它還是交出了一份「前五名」，而 RRF 看到「第 1 名」就給高分。
 * 相關性的絕對高低在融合的時候被丟掉了。
 *
 * ```text
 * 單一來源  top-k 沒事：爛結果排在後面，使用者自己會忽略
 * 跨來源    top-k 有害：爛來源的第 1 名會被當成「第 1 名」對待
 * ```
 *
 * 這正好是 Lesson 23 Step 3 讀到、當時只是「記下來」的那個差異：
 * gpt-researcher 用**相似度門檻**過濾（`SIMILARITY_THRESHOLD = 0.35`），
 * 而不是取 top-k。當時寫「對 agent 來說門檻常常更好」，
 * 現在知道**跨來源融合的時候它不是更好，是必要**。
 *
 * ## 而且門檻要用「絕對」的分數
 *
 * 第一版的門檻是相對的（低於最高分的 35% 就丟），結果**一筆都沒擋掉**。
 * 因為 Lesson 22 的 `score` 是候選集內 min-max 正規化過的，
 * **最高分永遠接近 1**，不管那一批到底相不相關。相對門檻對它沒有意義。
 *
 * 所以網頁那一側改用 `denseScore`（cosine 相似度）——那是整個回傳值裡
 * 唯一有絕對意義的分數。
 *
 * ## 門檻不能照抄別人的
 *
 * 第二版我直接抄 gpt-researcher 的 `SIMILARITY_THRESHOLD = 0.35`
 * （`context/compression.py:123`），結果**還是一筆都沒擋掉**。
 *
 * 量一下才知道為什麼——`gemini-embedding-001` 的無關基線就很高：
 *
 * ```text
 * query                        web 結果的 cosine 範圍
 * "unitree g1 retargeting…"    0.70 - 0.79    ← 真的相關
 * "chunk 大小要怎麼選"          0.45 - 0.50    ← 完全不相關
 * "BM25 RRF 融合 排序"          0.47 - 0.52    ← 完全不相關
 * ```
 *
 * **不相關的東西也有 0.45-0.52。** gpt-researcher 那個 0.35 是配
 * OpenAI embedding 的，換一個模型就完全失效。
 *
 * 分界很乾淨（0.52 vs 0.70），所以取中間的 0.60。
 *
 * > **教訓：門檻是模型的性質，不是通則。抄別人的常數之前先量自己的分佈。**
 * > 這跟 Lesson 22 猜錯去重門檻（憑印象 0.5，實際 0.17）是同一種錯，
 * > 只是這次我抄的是「權威來源」，更容易讓人放心地不去驗證。
 *
 * 本地那一側沒有 embedding，所以還是用相對門檻。BM25 分數在同一個索引裡
 * 是可比的，跨索引才不可比。
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
	// dense 沒跑成功的時候沒有絕對分數可用，只好全收，
	// 但呼叫端會看到 denseAvailable=false，知道這批結果比較髒。
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

export async function hybridSearch(query: string, limit = 8): Promise<HybridResult> {
	const { chunks, bm25 } = localIndex();

	const localRaw = bm25.search(query, limit + 4);
	const { kept: localHits, dropped: localDropped } = applyLocalFloor(localRaw);
	const byId = new Map(chunks.map((chunk) => [chunk.id, chunk]));

	// 網頁那一側直接用 Lesson 22 的完整管線。
	// 沒有金鑰而且 query 不在 embedding 快取裡時，dense 會丟例外——
	// 那時候退回純 BM25，而不是整個查詢失敗。
	// **降級要能自動發生，而且要說出來**（見回傳的 denseAvailable）。
	let webRaw: Awaited<ReturnType<typeof retrieve>>["hits"] = [];
	let denseAvailable = true;
	try {
		webRaw = (await retrieve(query, ALL_STAGES, limit)).hits;
	} catch {
		denseAvailable = false;
		webRaw = (await retrieve(query, { ...ALL_STAGES, dense: false }, limit)).hits;
	}
	const { kept: webHits, dropped: webDropped } = applyWebFloor(webRaw, denseAvailable);

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
