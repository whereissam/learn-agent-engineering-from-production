/**
 * web_search v2：接上完整檢索管線的搜尋工具。
 *
 * 對模型來說，介面跟 Lesson 20 的那個幾乎一樣（給 query，回排序過的結果）。
 * 換掉的是背後那條管線：BM25 → +dense → +RRF → +去重 → +訊號 → +多樣性。
 *
 * 有兩個地方是**為了 agent 而不是為了人**設計的：
 *
 * 1. **回傳發佈日期，而且講清楚今天是哪天。**
 *    模型不知道今天幾號，它會把 2025 年的文章當成最新的。
 *
 * 2. **把去重的事實講出來。**
 *    「我幫你合併了 2 筆幾乎一樣的內容」比默默砍掉好，
 *    因為模型可能正想比較不同來源說了什麼。
 */

import type { Tool } from "../../shared/tools/registry.ts";
import { ALL_STAGES, retrieve } from "../retrieve/pipeline.ts";
import { TODAY } from "../retrieve/rank.ts";

const MAX_RESULTS_CAP = 8;

export const webSearchTool: Tool = {
	name: "web_search",
	mutating: false,
	description:
		"Search the web. Results are ranked by a hybrid pipeline (keyword + semantic), " +
		"deduplicated, and adjusted for freshness and source quality. " +
		"Semantic matching means you can search in any language and still hit English pages, " +
		"but a snippet is still only a snippet: use fetch_page before relying on any claim.",
	parameters: {
		type: "object",
		properties: {
			query: {
				type: "string",
				description:
					"What you are looking for. Natural language works; you do not need to guess exact keywords.",
			},
			max_results: {
				type: "number",
				description: `1 to ${MAX_RESULTS_CAP}. Default 5.`,
			},
		},
		required: ["query"],
	},

	async execute(args) {
		const query = String(args.query ?? "").trim();
		if (!query) throw new Error("query is empty. Pass what you are looking for.");

		const requested = Number(args.max_results ?? 5);
		const maxResults = Number.isFinite(requested)
			? Math.min(Math.max(Math.trunc(requested), 1), MAX_RESULTS_CAP)
			: 5;

		const { hits, duplicates } = await retrieve(query, ALL_STAGES, maxResults);

		if (hits.length === 0) {
			return (
				`No results for "${query}".\n` +
				"The index is small and domain-specific. Try describing the topic differently, " +
				"or search for a narrower technical term that would appear on the page."
			);
		}

		const today = new Date(TODAY).toISOString().slice(0, 10);
		const lines = hits.map((hit) => {
			const age = Math.round((TODAY - new Date(hit.published).getTime()) / 86_400_000);
			return (
				`[${hit.rank}] ${hit.title}\n` +
				`    ${hit.url}\n` +
				`    published=${hit.published} (${age} days ago)`
			);
		});

		const dupeNote =
			duplicates.length > 0
				? `\n\n${duplicates.length} near-duplicate page(s) were collapsed into the results above ` +
					"(mirrors of the same content). Ask again with a more specific query if you need to " +
					"compare what different sources say."
				: "";

		return `${hits.length} results for "${query}"  (today is ${today})\n\n${lines.join("\n\n")}${dupeNote}`;
	},
};
