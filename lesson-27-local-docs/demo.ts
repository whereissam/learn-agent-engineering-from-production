/**
 * The hybrid retrieval CLI.
 *
 *   bun run lesson-27                          run a set of demonstration queries
 *   bun run lesson-27 -- "your question"       query one thing
 *
 * No key needed: the local side is pure BM25 and the web side's embeddings are cached,
 * and with neither available it degrades to pure keyword automatically (and says so).
 */

import { hybridSearch } from "./hybrid.ts";

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;

/**
 * Three demonstration queries, each representing a situation.
 *
 * These three were chosen because their **source distributions differ**, and that distribution is itself information:
 * a query that returns only local results means the web index does not cover this topic (or the reverse).
 */
const DEMOS = [
	{ query: "how to choose a chunk size", note: "expected: local only (the web corpus is about robots)" },
	{
		query: "unitree g1 retargeting deprecated",
		note: "expected: both (the lessons discuss this corpus too)",
	},
	{ query: "BM25 RRF fusion ranking", note: "expected: local only" },
];

async function show(query: string, note?: string): Promise<void> {
	console.log(bold(`\n${query}`));
	if (note) console.log(dim(`  ${note}`));

	const result = await hybridSearch(query, 6);

	if (!result.denseAvailable) {
		console.log(yellow("  ⚠ dense is unavailable (no key and not cached); degraded to keywords only"));
	}

	console.log(
		dim(
			`  ${result.counts.local} local, ${result.counts.web} web` +
				` (the floor blocked ${result.filtered.local} local, ${result.filtered.web} web)\n`,
		),
	);

	for (const hit of result.hits) {
		const tag = hit.kind === "local" ? cyan("[local]") : dim("[web]  ");
		const from = [
			hit.localRank ? `local#${hit.localRank}` : "",
			hit.webRank ? `web#${hit.webRank}` : "",
		]
			.filter(Boolean)
			.join(" ");
		console.log(`  ${hit.rank}. ${tag} ${hit.title.slice(0, 52)}`);
		console.log(dim(`     ${hit.source}  ${from}`));
		if (hit.snippet) console.log(dim(`     ${hit.snippet.slice(0, 96)}`));
	}
}

const custom = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));

if (custom.length > 0) {
	for (const query of custom) await show(query);
} else {
	for (const demo of DEMOS) await show(demo.query, demo.note);
	console.log(
		dim(
			"\nThe source distribution is itself a signal: local-only means the web index does not cover this topic,\n" +
				"web-only means your own documents have not been written yet. **Both are useful information.**",
		),
	);
}
