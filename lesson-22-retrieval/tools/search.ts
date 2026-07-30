/**
 * web_search v2: the search tool wired to the full retrieval pipeline.
 *
 * To the model the interface is nearly the same as Lesson 20's (give a query, get ranked results).
 * What changed is the pipeline behind it: BM25 → +dense → +RRF → +dedup → +signals → +diversity.
 *
 * Two things here are designed **for the agent rather than for a person**:
 *
 * 1. **Return the publication date, and state what today is.**
 *    The model does not know today's date and will treat a 2025 article as the newest.
 *
 * 2. **State the fact that deduplication happened.**
 *    "I merged 2 nearly identical results for you" beats cutting them silently,
 *    because the model may be about to compare what different sources say.
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
