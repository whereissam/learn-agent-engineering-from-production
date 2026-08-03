/**
 * The research loop itself.
 *
 * There is not one `while (true)` in this file, and nowhere does it ask the model
 * "do you want to continue". Research ends because `depth` reaches zero.
 *
 * ```text
 * research(seed, breadth=3, depth=2)
 *   ├─ query A ─ search → fetch 2 pages → extract → research(followUps, breadth=2, depth=1)
 *   │                                        ├─ query A1 ─ search → fetch → extract → stop (depth=0)
 *   │                                        └─ query A2 ─ ...
 *   ├─ query B ─ ...
 *   └─ query C ─ ...
 * ```
 *
 * Against Lesson 22's agent: that loop ends when "the model stops calling tools"
 * or when it hits MAX_STEPS. The former is uncontrollable and the latter is a circuit breaker, not a budget.
 *
 * Here the end is **computable before you call it**.
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
	/** How many pages one query may fetch. The knob with the largest cost impact. */
	pagesPerQuery: number;
	/** How many queries run at once. Copied from deep-research's ConcurrencyLimit (`:30`), also 2 by default. */
	concurrency: number;
}

export const DEFAULT_OPTIONS: ResearchOptions = {
	breadth: 3,
	depth: 2,
	pagesPerQuery: 2,
	concurrency: 2,
};

/**
 * The bound is computable — which is exactly the point.
 *
 * With this function, "should I run another level" becomes a question answerable with numbers
 * rather than "try it and see whether it hits the ceiling".
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
		// One generateQueries per branch per level, one extractLearnings per query,
		// and one writeReport at the end
		llmCalls: searches + Math.ceil(searches / options.breadth) + 1,
	};
}

/** A minimal concurrency limiter. No p-limit, because this series deliberately adds no dependencies. */
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
 * Run one query: search → filter what was already read → fetch → extract → decide whether to go deeper.
 *
 * The three guards are this lesson's point, and each matches an injury from an earlier lesson:
 *
 *   1. skip URLs already read          ← Lesson 22 Step 8 (searching for the same thing repeatedly)
 *   2. any failure affects only this query ← deep-research.ts:282
 *   3. failing to fetch is not "there is no content" ← Lesson 21 Step 3 (the JS shell trap)
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

	// This query's trace lines are collected in their own array and written out at the end.
	// Without that, parallel branches interleave each other's lines and it is unreadable.
	const lines: string[] = [`${indent}  ? ${query}`];

	const { hits } = await retrieve(query, ALL_STAGES, options.pagesPerQuery + 3);

	const pages: PageContent[] = [];
	for (const hit of hits) {
		if (pages.length >= options.pagesPerQuery) break;

		// gpt-researcher's _get_new_urls: ask "have I read this" before fetching.
		// This Set is shared across the whole research tree.
		if (state.visited.has(hit.url)) {
			state.budget.skippedDuplicates++;
			continue;
		}
		state.visited.add(hit.url);

		const result = fetchPage(hit.url);
		state.budget.fetches++;

		if (!result.ok) {
				// Record a failed fetch rather than treating it as "this page has no information".
			lines.push(`${indent}      ✗ ${hit.url} (${result.reason})`);
			continue;
		}

		const { title, text } = extractMain(result.html, { includeStructures: true });
		if (text.trim().length === 0) {
			lines.push(`${indent}      ✗ ${hit.url} (no body text extracted; possibly JS-rendered)`);
			continue;
		}

		pages.push({ url: hit.url, title, text });
		lines.push(`${indent}      ✓ ${hit.url}`);
	}

	if (pages.length === 0) {
		lines.push(`${indent}      → no new pages to read (all seen already, or none could be fetched)`);
		state.trace.push(...lines);
		return [];
	}

	const extraction = await extractLearnings(provider, state, query, pages, depth);
	const { learnings, followUps } = extraction;
	state.learnings.push(...learnings);

	// When extraction produces nothing, the reason must be stated.
	// "Read four pages and produced 0 conclusions" with no message is the hardest kind of failure to diagnose.
	const why =
		extraction.failure === "parse-failed"
			? "(the model did not return parseable JSON)"
			: extraction.failure === "sources-filtered"
				? `(${extraction.droppedForSources} dropped: they cited URLs that were never fetched)`
				: extraction.failure === "no-learnings"
					? "(the model found no usable conclusion on these pages)"
					: "";
	lines.push(
		`${indent}      → ${learnings.length} conclusions, ${followUps.length} follow-up questions ${why}`,
	);
	state.trace.push(...lines);

	// The seed for the next level: the shape copied from deep-research.ts:252.
	// Note it is not the original question but "the previous round's goal plus what it did not answer".
	if (followUps.length === 0) return [];
	return [
		`Previous research goal: ${goal || query}\nFollow-up directions:\n${followUps.map((q) => `- ${q}`).join("\n")}`,
	];
}

/**
 * The recursive body.
 *
 * `breadth` halves per level and `depth` decrements per level, ending at zero.
 * **The model never gets a chance to say "let me search once more".**
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
	state.trace.push(`${indent}[depth=${depth} breadth=${breadth}] ${queries.length} queries`);

		// Queries already run are blocked outright. The prompt says so too, and a prompt is only a plea.
	const seen = new Set(state.queriesRun.map(normalizeQuery));
	const fresh = queries.filter((planned) => {
		const key = normalizeQuery(planned.query);
		if (seen.has(key)) {
			state.budget.skippedQueries++;
			state.trace.push(`${indent}  ↺ skipped a duplicate query: ${planned.query}`);
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
						// One failed query must not take down the whole research run.
						// deep-research.ts:275-285 does the same: catch, return an empty result, and other branches continue.
					const message = error instanceof Error ? error.message : String(error);
					state.trace.push(`${indent}  ✗ query failed: ${message.slice(0, 80)}`);
				}
			}),
		),
	);
}
