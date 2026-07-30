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
	{ query: "chunk 大小要怎麼選", note: "預期：只有本地（網頁語料是機器人主題）" },
	{ query: "unitree g1 retargeting deprecated", note: "預期：兩邊都有（我們的課程也在講這個語料）" },
	{ query: "BM25 RRF 融合 排序", note: "預期：只有本地" },
];

async function show(query: string, note?: string): Promise<void> {
	console.log(bold(`\n${query}`));
	if (note) console.log(dim(`  ${note}`));

	const result = await hybridSearch(query, 6);

	if (!result.denseAvailable) {
		console.log(yellow("  ⚠ dense 不可用（沒金鑰且不在快取裡），已退化成純關鍵字"));
	}

	console.log(
		dim(
			`  本地 ${result.counts.local} 筆、網頁 ${result.counts.web} 筆` +
				`（門檻擋掉 本地 ${result.filtered.local}、網頁 ${result.filtered.web}）\n`,
		),
	);

	for (const hit of result.hits) {
		const tag = hit.kind === "local" ? cyan("[本地]") : dim("[網頁]");
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
			"\n來源分佈本身就是訊號：只回本地代表網頁索引沒涵蓋這個主題，\n" +
				"只回網頁代表你的文件還沒寫到。**兩者都是有用的資訊。**",
		),
	);
}
