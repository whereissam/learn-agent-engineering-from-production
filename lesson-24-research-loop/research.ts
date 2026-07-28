/**
 * Research loop 本體。
 *
 * 整個檔案沒有一個 `while (true)`，也沒有任何一個地方問模型
 * 「你還要繼續嗎」。研究會結束，是因為 `depth` 會歸零。
 *
 * ```text
 * research(seed, breadth=3, depth=2)
 *   ├─ query A ─ 搜尋 → 抓 2 頁 → 萃取 → research(followUps, breadth=2, depth=1)
 *   │                                        ├─ query A1 ─ 搜 → 抓 → 萃取 → 停（depth=0）
 *   │                                        └─ query A2 ─ ...
 *   ├─ query B ─ ...
 *   └─ query C ─ ...
 * ```
 *
 * 對照 Lesson 22 的 agent：那個迴圈的終點是「模型不再呼叫工具」
 * 或「撞到 MAX_STEPS」。前者不可控，後者是熔斷器不是預算。
 *
 * 這裡的終點是**你在呼叫前就算得出來的**。
 */

import { fetchPage } from "../lesson-21-crawl/fetcher.ts";
import { extractMain } from "../lesson-21-crawl/extract/html.ts";
import { ALL_STAGES, retrieve } from "../lesson-22-retrieval/retrieve/pipeline.ts";
import type { StreamingProvider } from "../shared/streaming/types.ts";
import {
	type PageContent,
	extractLearnings,
	generateQueries,
} from "./steps.ts";
import { type ResearchState, isLastLayer, nextBreadth, normalizeQuery } from "./state.ts";

export interface ResearchOptions {
	breadth: number;
	depth: number;
	/** 每條 query 最多抓幾頁。這是成本影響最大的旋鈕。 */
	pagesPerQuery: number;
	/** 同時最多幾條 query 在跑。抄 deep-research 的 ConcurrencyLimit（`:30`），預設也是 2。 */
	concurrency: number;
}

export const DEFAULT_OPTIONS: ResearchOptions = {
	breadth: 3,
	depth: 2,
	pagesPerQuery: 2,
	concurrency: 2,
};

/**
 * 上界是算得出來的——這正是重點。
 *
 * 有了這個函式，「要不要多跑一層」就變成一個可以用數字回答的問題，
 * 而不是「試試看跑到撞上限」。
 */
export function estimateCost(options: ResearchOptions): {
	searches: number;
	fetches: number;
	llmCalls: number;
} {
	let searches = 0;
	let breadth = options.breadth;
	let depth = options.depth;
	let layerQueries = 1;

	while (depth > 0) {
		layerQueries *= breadth;
		searches += layerQueries;
		breadth = nextBreadth(breadth);
		depth -= 1;
	}

	return {
		searches,
		fetches: searches * options.pagesPerQuery,
		// 每層每個分支一次 generateQueries + 每條 query 一次 extractLearnings，
		// 最後一次 writeReport
		llmCalls: searches + Math.ceil(searches / options.breadth) + 1,
	};
}

/** 最小的並行限制器。不裝 p-limit，因為這個系列刻意不加依賴。 */
function createLimiter(max: number) {
	let active = 0;
	const queue: Array<() => void> = [];

	return async function run<T>(task: () => Promise<T>): Promise<T> {
		if (active >= max) await new Promise<void>((resolve) => queue.push(resolve));
		active++;
		try {
			return await task();
		} finally {
			active--;
			queue.shift()?.();
		}
	};
}

/**
 * 跑一條 query：搜尋 → 過濾已讀過的 → 抓頁 → 萃取 → 決定要不要再深一層。
 *
 * 三個防護是這一課的重點，每一個都對應到前面某一課的傷：
 *
 *   1. 已讀過的 URL 直接跳過        ← Lesson 22 Step 8（一直重複搜同樣的東西）
 *   2. 任何一步失敗只影響這條 query  ← deep-research.ts:282
 *   3. 抓不到內容不算「沒有內容」    ← Lesson 21 Step 3（JS 空殼那個坑）
 */
async function runQuery(
	provider: StreamingProvider,
	state: ResearchState,
	query: string,
	goal: string,
	options: ResearchOptions,
	depth: number,
	indent: string,
): Promise<string[]> {
	state.queriesRun.push(query);
	state.budget.searches++;

	// 這條 query 的所有 trace 先收在自己的陣列裡，最後一次寫進去。
	// 不這樣做的話，並行的分支會把彼此的行交錯在一起，完全沒辦法讀。
	const lines: string[] = [`${indent}  ? ${query}`];

	const { hits } = await retrieve(query, ALL_STAGES, options.pagesPerQuery + 3);

	const pages: PageContent[] = [];
	for (const hit of hits) {
		if (pages.length >= options.pagesPerQuery) break;

		// gpt-researcher 的 _get_new_urls：抓之前先問「讀過了嗎」。
		// 這個 Set 是整棵研究樹共用的。
		if (state.visited.has(hit.url)) {
			state.budget.skippedDuplicates++;
			continue;
		}
		state.visited.add(hit.url);

		const result = fetchPage(hit.url);
		state.budget.fetches++;

		if (!result.ok) {
			// 抓不到就記下來，不要當成「這一頁沒有資訊」。
			lines.push(`${indent}      ✗ ${hit.url} (${result.reason})`);
			continue;
		}

		const { title, text } = extractMain(result.html, { includeStructures: true });
		if (text.trim().length === 0) {
			lines.push(`${indent}      ✗ ${hit.url} (抽不到正文，可能是 JS 渲染)`);
			continue;
		}

		pages.push({ url: hit.url, title, text });
		lines.push(`${indent}      ✓ ${hit.url}`);
	}

	if (pages.length === 0) {
		lines.push(`${indent}      → 沒有新頁面可讀（都讀過了或都抓不到）`);
		state.trace.push(...lines);
		return [];
	}

	const extraction = await extractLearnings(provider, state, query, pages, depth);
	const { learnings, followUps } = extraction;
	state.learnings.push(...learnings);

	// 萃取沒有產出的時候，一定要講得出原因。
	// 「讀了四頁然後 0 條結論」而且沒有任何訊息，是最難查的那種失敗。
	const why =
		extraction.failure === "parse-failed"
			? "（模型沒有回出可解析的 JSON）"
			: extraction.failure === "sources-filtered"
				? `（${extraction.droppedForSources} 條被丟掉：引用了沒抓過的網址）`
				: extraction.failure === "no-learnings"
					? "（模型認為這幾頁沒有可用的結論）"
					: "";
	lines.push(
		`${indent}      → ${learnings.length} 條結論，${followUps.length} 個後續問題 ${why}`,
	);
	state.trace.push(...lines);

	// 下一層的種子：抄 deep-research.ts:252 的形狀。
	// 注意它不是原始問題，是「上一輪的目標 + 這一輪沒答到的東西」。
	if (followUps.length === 0) return [];
	return [
		`Previous research goal: ${goal || query}\nFollow-up directions:\n${followUps.map((q) => `- ${q}`).join("\n")}`,
	];
}

/**
 * 遞迴主體。
 *
 * `breadth` 每層砍半、`depth` 每層減一，歸零就結束。
 * **模型全程沒有機會說「再讓我搜一次」。**
 */
export async function research(
	provider: StreamingProvider,
	state: ResearchState,
	seed: string,
	options: ResearchOptions,
	breadth = options.breadth,
	depth = options.depth,
): Promise<void> {
	if (depth <= 0) return;

	const indent = "  ".repeat(options.depth - depth);
	const queries = await generateQueries(provider, state, seed, breadth);
	state.trace.push(`${indent}[depth=${depth} breadth=${breadth}] ${queries.length} 條 query`);

	// 已經下過的 query 直接擋掉。prompt 裡也寫了，但 prompt 只是拜託。
	const seen = new Set(state.queriesRun.map(normalizeQuery));
	const fresh = queries.filter((planned) => {
		const key = normalizeQuery(planned.query);
		if (seen.has(key)) {
			state.budget.skippedQueries++;
			state.trace.push(`${indent}  ↺ 跳過重複的 query：${planned.query}`);
			return false;
		}
		seen.add(key);
		return true;
	});

	const limit = createLimiter(options.concurrency);

	await Promise.all(
		fresh.map((planned) =>
			limit(async () => {
				try {
					const seeds = await runQuery(
						provider,
						state,
						planned.query,
						planned.goal,
						options,
						options.depth - depth + 1,
						indent,
					);

					if (isLastLayer(depth)) return;

					for (const next of seeds) {
						await research(provider, state, next, options, nextBreadth(breadth), depth - 1);
					}
				} catch (error) {
					// 一條 query 失敗不能弄垮整輪研究。
					// deep-research.ts:275-285 也是這樣：catch 之後回空結果，其他分支照跑。
					const message = error instanceof Error ? error.message : String(error);
					state.trace.push(`${indent}  ✗ query 失敗：${message.slice(0, 80)}`);
				}
			}),
		),
	);
}
