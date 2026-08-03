/**
 * The retrieval evaluation runner.
 *
 * Lesson 7 teaches "measure → find the problem → fix → confirm nothing regressed";
 * that lesson measured the agent's reports. This one measures **ranking**.
 *
 * Usage:
 *   bun run lesson-22:eval              run all six configurations and print a comparison table
 *   bun run lesson-22:eval --show q1    see one query's actual ranking and where each result came from
 *   bun run lesson-22:embed             recompute the embedding cache (needs a key)
 *
 * It runs without a key, because the embeddings are precomputed in `embed/cache.json`.
 */

import { loadCorpus, warmCorpusEmbeddings } from "../retrieve/dense.ts";
import { cacheStats, embed } from "../embed/provider.ts";
import { type Stages, retrieve } from "../retrieve/pipeline.ts";
import { jaccard } from "../retrieve/rank.ts";
import { QUERIES } from "./queries.ts";

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;

/**
 * nDCG@k: the most common ranking quality metric.
 *
 * It answers two things at once: **was the relevant thing found**, and **is it near the top**.
 * A relevance-3 page scores full marks at rank 1 and about half at rank 5.
 *
 * The `2^rel - 1` in the formula amplifies the importance of high relevance:
 * one rel=3 result is worth 7 points, and three rel=1 results add up to 3.
 * **That matches how users actually feel**: one entirely correct answer beats three tangential ones.
 *
 * The `log2(i+1)` denominator is the positional discount: later positions score little even when relevant.
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

/** How many of the top k are relevant (rel >= 1). Cruder than nDCG and very intuitive. */
function recall(rankedUrls: string[], relevance: Record<string, number>, k = 5): number {
	const total = Object.keys(relevance).length;
	if (total === 0) return 1;
	const found = rankedUrls.slice(0, k).filter((url) => (relevance[url] ?? 0) > 0).length;
	return found / Math.min(total, k);
}

/**
 * novelty@k: how many of the top k are not near-duplicates of something above them.
 *
 * **This metric was added later, because nDCG cannot see something that matters here.**
 *
 * nDCG only asks "is it relevant, is it high enough". Two nearly identical documents that are both
 * relevant both score — and to a user the second is worth almost nothing,
 * while to an agent it is worse: it spends another `fetch_page` before discovering it read the same thing.
 *
 * The academic metric for this is α-nDCG (discounting information already seen).
 * This uses a more legible version: **count how many are new.**
 *
 * The lesson: **when an existing metric cannot see what you care about, add another metric**,
 * rather than editing the evaluation set to make the numbers look good.
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
 * Queries the lesson demonstrates must also go into the embedding cache.
 *
 * Otherwise somebody without a key running `PROVIDER=fake bun run lesson-22` blows up,
 * because dense retrieval needs the query's vector.
 * **"It runs offline" has to cover the demonstration inputs too, not just the evaluation.**
 */
const DEMO_QUERIES = [
	"open source video to humanoid retargeting for unitree g1",
	"unitree g1 retargeting",
	"open source video to humanoid retargeting",
	"humanoid-mimic g1 support",
	"retarget-anything g1 profile deprecated 2026 sdk",
];

// Six configurations, layered one at a time.
// That order is this lesson's narrative order, and the order real development should follow:
// **add one thing at a time, then look at the numbers.**
const CONFIGS: Array<{ label: string; stages: Stages }> = [
	{
		label: "BM25 (L20)",
		stages: { bm25: true, dense: false, dedupe: false, signals: false, diversity: false },
	},
	{
		label: "Dense only",
		stages: { bm25: false, dense: true, dedupe: false, signals: false, diversity: false },
	},
	{
		label: "+ RRF",
		stages: { bm25: true, dense: true, dedupe: false, signals: false, diversity: false },
	},
	{
		label: "+ dedup",
		stages: { bm25: true, dense: true, dedupe: true, signals: false, diversity: false },
	},
	{
		label: "+ quality",
		stages: { bm25: true, dense: true, dedupe: true, signals: true, diversity: false },
	},
	{
		label: "+ diversity",
		stages: { bm25: true, dense: true, dedupe: true, signals: true, diversity: true },
	},
];

// LLM rerank needs a key, so it joins the comparison only with --rerank
if (process.argv.includes("--rerank")) {
	CONFIGS.push({
		label: "+ LLM rerank",
		stages: { bm25: true, dense: true, dedupe: true, signals: true, diversity: true, rerank: true },
	});
}

async function showOne(queryId: string): Promise<void> {
	const query = QUERIES.find((q) => q.id === queryId || q.id.startsWith(queryId));
	if (!query) {
		throw new Error(`${queryId} not found. Available: ${QUERIES.map((q) => q.id).join(", ")}`);
	}

	console.log(bold(`\n${query.query}`));
	console.log(dim(`what it tests: ${query.tests}\n`));

	for (const config of CONFIGS) {
		const result = await retrieve(query.query, config.stages, 5);
		const urls = result.hits.map((h) => h.url);
		const score = ndcg(urls, query.relevant);

		console.log(`${bold(config.label.padEnd(24))} nDCG@5 = ${score.toFixed(3)}`);
		if (result.bm25Empty) console.log(dim("    BM25 returned 0 results (the query tokenises to no English words)"));

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
			console.log(dim(`    dedup: ${group.dropped.join(", ")} ≈ ${group.kept} (${group.similarity.toFixed(2)})`));
		}
		console.log();
	}
}

async function runAll(): Promise<void> {
	const stats = cacheStats();
	console.log(dim(`embedding: ${stats.model || "(cached)"}  ${stats.dims} dims  ${stats.count} entries\n`));

	const header = `${"query".padEnd(18)}${CONFIGS.map((c) => c.label.slice(0, 11).padStart(12)).join("")}`;
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
		`${bold("mean nDCG@5".padEnd(18))}${totals.map((t) => (t.ndcg / n).toFixed(3).padStart(12)).join("")}`,
	);
	console.log(
		`${"mean recall@5".padEnd(18)}${totals.map((t) => (t.recall / n).toFixed(3).padStart(12)).join("")}`,
	);
	console.log(
		`${"mean novelty@5".padEnd(18)}${totals.map((t) => (t.novelty / n).toFixed(3).padStart(12)).join("")}`,
	);
	console.log();
	console.log(dim('To see one query in detail: bun run lesson-22:eval --show q1'));
}

if (import.meta.main) {
	const args = process.argv.slice(2);

	if (args.includes("--warm")) {
			// Compute every vector for the corpus and the evaluation queries and write the cache
		await warmCorpusEmbeddings();
		await embed([...QUERIES.map((q) => q.query), ...DEMO_QUERIES]);
		const stats = cacheStats();
		console.log(`embedding cache updated: ${stats.count} entries, ${stats.dims} dims, model=${stats.model}`);
	} else if (args.includes("--show")) {
		const id = args[args.indexOf("--show") + 1];
		if (!id) throw new Error("--show needs a query id, for example q1");
		await showOne(id);
	} else {
		await runAll();
	}
}
