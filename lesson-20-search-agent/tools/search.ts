/**
 * This lesson's only tool: web_search.
 *
 * One tool, and it returns only snippets. That incompleteness is deliberate:
 * you have to see for yourself where a search-only agent gets stuck
 * before Lesson 21's fetch_page can show you what that tool solves.
 *
 * Two things in the tool's description are worth noting, both echoing Lesson 6's principles:
 *
 *   1. **State the data's limits unprompted** (Lesson 6 Step 4: tools report data quality)
 *      A snippet is not the page, and it is "the passage best matching the query",
 *      not "the page's conclusion". Unstated, the model treats a snippet as the page.
 *
 *   2. **An error message must state the next step** (Lesson 6 Step 5)
 *      When nothing is found, do not just return "no results";
 *      tell the model how to change the query.
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
				// An empty result is not an exception but a normal result the model must be able to act on.
				// The two most common causes are both written out, along with "what to do next".
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
