/**
 * fetch_page: the tool Lesson 20 was missing.
 *
 * Lesson 20's agent has only snippets, so it has no way to know what it missed.
 * With this tool, "go open that page and look" becomes an action it can take,
 * and "I cannot confirm this" becomes a state the model can escape.
 *
 * This tool does four things, each matching a real-world nuisance:
 *
 *   fetchPage()    robots / 403 / 404 / JS rendering  → the error must state the difference
 *   extractMain()  cut navigation, ads and footers    → 51% noise must not enter context
 *   chunkText()    split long documents               → what you want is often near the end
 *   assemble output title, date, which chunk         → the model must know it is seeing a fragment
 */

import type { Tool } from "../../shared/tools/registry.ts";
import { chunkText } from "../extract/chunk.ts";
import { extractMain } from "../extract/html.ts";
import { fetchPage } from "../fetcher.ts";

/** How many characters to give the model at most. A real product counts tokens; this approximates with characters. */
const MAX_CHARS = 2400;

export const fetchPageTool: Tool = {
	name: "fetch_page",
	mutating: false,
	description:
		"Open one of the URLs from web_search and read its actual content, with navigation, ads " +
		"and footers removed. Long pages are split into chunks: the result tells you which chunk " +
		"you got and how many there are, and you can ask for another one. " +
		"Use this whenever a claim matters: a snippet shows the passage that matched your query, " +
		"which is often not what the page concludes.",
	parameters: {
		type: "object",
		properties: {
			url: {
				type: "string",
				description: "Full URL, exactly as it appeared in the search results.",
			},
			chunk: {
				type: "number",
				description:
					"Which chunk to read, starting at 1. Default 1. Only long pages have more than one.",
			},
		},
		required: ["url"],
	},

	async execute(args) {
		const url = String(args.url ?? "").trim();
		if (!url) throw new Error("url is empty. Pass a URL from the web_search results.");

		const result = fetchPage(url);

			// Could not fetch. The four causes must be stated separately, because each has a different next step:
			// robots means give up on this page, 403 means find another source, 404 means go back and search.
			// Return "fetch failed" for all of them and the model just keeps retrying the same URL.
		if (!result.ok) throw new Error(result.detail);

			// includeStructures: true → extract tables and lists too.
			// This flag was added after a measurement; the account is in README Step 5.
		const { title, published, text, dropped } = extractMain(result.html, {
			includeStructures: true,
		});

			// HTML arrived and no text could be extracted. That is almost certainly a JS-rendered page.
		//
			// This error needs writing especially carefully: a model easily reads "nothing extracted" as
			// "this page has no information", and then writes "the page does not mention X" — a false negative conclusion.
		if (text.trim().length === 0) {
			throw new Error(
				`Fetched ${url} but found no readable text. The page renders its content with ` +
					"JavaScript, so the HTML is an empty shell. " +
					"IMPORTANT: this means the content is unknown, NOT that the page is empty. " +
					"Do not conclude anything about what this page does or does not say. " +
					"Use its search snippet and look for the same information elsewhere.",
			);
		}

		const chunks = chunkText(text, { maxChars: MAX_CHARS });
		const requested = Number(args.chunk ?? 1);
		const wanted = Number.isFinite(requested) ? Math.trunc(requested) : 1;

		if (wanted < 1 || wanted > chunks.length) {
			throw new Error(
				`chunk ${wanted} does not exist: ${url} has ${chunks.length} chunk(s). ` +
					`Ask for a number between 1 and ${chunks.length}.`,
			);
		}

		const chunk = chunks[wanted - 1];
		if (!chunk) throw new Error(`chunk ${wanted} is missing. This is a bug in fetch_page.`);

		const header = [
			`# ${title}`,
			`url: ${url}`,
			published ? `published: ${published}` : "published: unknown",
			`chunk ${chunk.index} of ${chunk.total}  (${text.length} characters extracted in total)`,
		].join("\n");

			// This extractor keeps paragraphs only; tables and lists are dropped. **It must say so.**
		//
			// Without saying it, the model misreads "the extractor missed it" as "the page does not have it",
			// and either invents a number or keeps changing the query. Measured: the latter —
			// it read all 7 chunks, searched 6 more times, and hit the step ceiling (README Step 5).
		const warning =
			dropped.tables > 0 || dropped.lists > 0
				? `\n\nNOTE: this extractor keeps paragraphs only. This page also contains ` +
					`${dropped.tables} table(s) and ${dropped.lists} list(s) whose contents are NOT ` +
					"included above. If the fact you need looks tabular (indices, versions, limits, " +
					"compatibility matrices), report that it could not be extracted from this page. " +
					"Do NOT conclude that the page does not contain it, and do not guess the value."
				: "";

			// Say nothing when there is one chunk; always warn when there are several,
			// or the model answers questions about the whole document from chunk 1.
		const footer =
			chunk.total > 1
				? `\n\n---\nThis is chunk ${chunk.index}/${chunk.total}. You have NOT seen the rest of ` +
					`this page. Call fetch_page again with chunk=${Math.min(chunk.index + 1, chunk.total)} ` +
					"to continue, and do not describe the page as a whole until you have read what you need."
				: "";

		return `${header}${warning}\n\n${chunk.text}${footer}`;
	},
};
