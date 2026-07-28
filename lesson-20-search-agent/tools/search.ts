/**
 * 這一課唯一的工具：web_search。
 *
 * 只有一個工具，而且它只回傳 snippet。這個「殘缺」是刻意設計的：
 * 你要先親眼看到只有搜尋的 agent 會卡在哪裡，
 * Lesson 21 加上 fetch_page 之後才會知道那個工具在解決什麼問題。
 *
 * 工具的 description 有兩個地方值得注意，兩個都回應 Lesson 6 的原則：
 *
 *   1. **主動說出資料的限制**（Lesson 6 Step 4：工具要報告資料品質）
 *      snippet 不等於整頁，而且它是「最符合 query 的那一段」，
 *      不是「這一頁的結論」。不講，模型就會把 snippet 當成整頁。
 *
 *   2. **錯誤訊息要說下一步**（Lesson 6 Step 5）
 *      查不到東西的時候不要只回「no results」，
 *      要告訴模型可以怎麼改 query。
 */

import type { Tool } from "../../shared/tools/registry.ts";
import { search, tokenize } from "../search/engine.ts";

const MAX_RESULTS_CAP = 8;

export const webSearchTool: Tool = {
	name: "web_search",
	mutating: false,
	description:
		"Search the web and get back ranked results: title, URL, publication date, and a short " +
		"snippet. IMPORTANT: a snippet is not the page. It is the passage that best matches your " +
		"query, so it can omit or even contradict what the page actually concludes. " +
		"You have no tool for opening a page in full, so anything that only the full page could " +
		"confirm must be reported as unverified.",
	parameters: {
		type: "object",
		properties: {
			query: {
				type: "string",
				description:
					"Keyword query. The index is keyword-based and English-only, so write the query " +
					"in English even when the user asked in another language.",
			},
			max_results: {
				type: "number",
				description: `How many results to return, 1 to ${MAX_RESULTS_CAP}. Default 5.`,
			},
		},
		required: ["query"],
	},

	async execute(args) {
		const query = String(args.query ?? "").trim();
		if (!query) {
			throw new Error("query is empty. Pass the keywords you want to search for.");
		}

		const requested = Number(args.max_results ?? 5);
		const maxResults = Number.isFinite(requested)
			? Math.min(Math.max(Math.trunc(requested), 1), MAX_RESULTS_CAP)
			: 5;

		const hits = search(query, maxResults);

		if (hits.length === 0) {
			// 空結果不是例外，是一個要讓模型能據此行動的正常結果。
			// 最常見的原因有兩個，兩個都寫出來，並且說「下一步做什麼」。
			const terms = tokenize(query);
			const reason =
				terms.length === 0
					? "The query produced no searchable keywords. This index only understands " +
						"English words and numbers, so a query written in Chinese, Japanese or Korean " +
						"matches nothing at all."
					: `The query tokenised to [${terms.join(", ")}] but none of those words appear in ` +
						"the index.";
			return (
				`No results for "${query}".\n${reason}\n` +
				"Next step: rewrite the query in English using the technical terms that would " +
				"actually appear on the page (project names, model names, file formats), and search again."
			);
		}

		const lines = hits.map(
			(hit) =>
				`[${hit.rank}] ${hit.title}\n` +
				`    ${hit.url}\n` +
				`    site=${hit.site}  published=${hit.published}\n` +
				`    ${hit.snippet}`,
		);

		return (
			`${hits.length} results for "${query}"\n\n${lines.join("\n\n")}\n\n` +
			"Reminder: the text above is search snippets, not page contents."
		);
	},
};
