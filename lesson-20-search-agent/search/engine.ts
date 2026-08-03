/**
 * A search engine small enough to read whole.
 *
 * It does one thing: match a query against the corpus and return ranked
 * "title plus URL plus a short snippet". **No body text.**
 *
 * That limit is deliberate, and it is what the real world looks like:
 * Google, Bing and SearXNG all return those three things. To get the body,
 * you have to go and fetch the page yourself (Lesson 21).
 *
 * Ranking uses BM25. Why not "throw it in a vector database and compute cosine similarity"?
 * Because BM25 is from 1994 and remains the backbone of many search systems today,
 * and it is cheap, explainable and model-free. Lesson 22 adds dense retrieval and
 * you will see what each is good at — but a baseline has to exist before anything can be compared.
 *
 * Run it directly (no API key and no model needed):
 *
 *   bun run lesson-20-search-agent/search/engine.ts "unitree g1 retargeting"
 *   bun run lesson-20-search-agent/search/engine.ts "retarget video motion onto a humanoid"
 *
 * The second command returns 0 results. That is not a bug; see README Step 3.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { IndexedPage } from "../corpus/generate.ts";

const INDEX_PATH = resolve(import.meta.dirname, "../corpus/index.json");

/** BM25's two knobs. These are the literature's usual defaults and need no tuning. */
const K1 = 1.5;
const B = 0.75;

/**
 * Title weighting.
 *
 * The implementation is crude: repeat the title's words a few times before indexing.
 * A real search engine uses field-weighted BM25 (BM25F), and the shape is the same:
 * **appearing in the title matters more than appearing in the body.**
 */
const TITLE_BOOST = 3;

/** How many characters a snippet takes. Real search engines give you about 150-200. */
const SNIPPET_WORDS = 32;

export interface SearchHit {
	rank: number;
	url: string;
	title: string;
	site: string;
	published: string;
	/** A small slice of the body. **Not the whole page.** */
	snippet: string;
	score: number;
}

interface Doc {
	page: IndexedPage;
	tokens: string[];
	/** term → how many times it occurs in this document */
	freq: Map<string, number>;
	length: number;
}

/**
 * Tokenisation.
 *
 * Note this regular expression only recognises a-z and 0-9.
 * Chinese, Japanese and Korean produce an empty array — a real limit of keyword retrieval,
 * not laziness in this code. Only Lesson 22's dense retrieval can handle it.
 */
export function tokenize(text: string): string[] {
	return text
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/** The most common English function words. Keeping them only raises every document's score equally, with no discrimination. */
const STOPWORDS = new Set([
	"the", "and", "for", "are", "but", "not", "you", "all", "can", "her", "was", "one", "our",
	"out", "his", "has", "had", "how", "its", "who", "did", "yes", "she", "him", "that", "this",
	"with", "from", "they", "them", "have", "been", "were", "will", "what", "when", "your",
	"there", "their", "which", "would", "about", "into", "than", "then", "some", "more",
]);

let cached: Doc[] | undefined;

function loadDocs(): Doc[] {
	if (cached) return cached;

	let raw: string;
	try {
		raw = readFileSync(INDEX_PATH, "utf8");
	} catch {
		throw new Error(
			`Corpus index not found at ${INDEX_PATH}.\n` +
				"Generate it first: bun run lesson-20-search-agent/corpus/generate.ts",
		);
	}

	const pages = JSON.parse(raw) as IndexedPage[];
	cached = pages.map((page) => {
			// Repeating the title TITLE_BOOST times = title words matter more
		const tokens = [
			...Array.from({ length: TITLE_BOOST }, () => tokenize(page.title)).flat(),
			...tokenize(page.text),
		];
		const freq = new Map<string, number>();
		for (const t of tokens) freq.set(t, (freq.get(t) ?? 0) + 1);
		return { page, tokens, freq, length: tokens.length };
	});
	return cached;
}

/**
 * BM25。
 *
 * In plain words: a word occurring more often in **this** document scores higher (with diminishing returns),
 * a word occurring in **more** documents scores lower (a word that is everywhere has no discrimination),
 * and short documents' advantage over long ones is compensated back (or a very long page would win).
 *
 * That is all. People have used it for thirty years because it is cheap and hard to beat.
 */
export function search(query: string, maxResults = 5): SearchHit[] {
	const docs = loadDocs();
	const terms = tokenize(query);

	// The query tokenises to nothing (pure Chinese, say) → no results.
	// That is not "no relevant content found" but "this retrieval method cannot read this query".
	if (terms.length === 0) return [];

	const avgLength = docs.reduce((sum, d) => sum + d.length, 0) / docs.length;

	const scored = docs.map((doc) => {
		let score = 0;
		for (const term of terms) {
			const tf = doc.freq.get(term) ?? 0;
			if (tf === 0) continue;

			// How many documents contain this word
			const df = docs.filter((d) => d.freq.has(term)).length;
			const idf = Math.log(1 + (docs.length - df + 0.5) / (df + 0.5));

			const norm = tf * (K1 + 1);
			const denom = tf + K1 * (1 - B + (B * doc.length) / avgLength);
			score += idf * (norm / denom);
		}
		return { doc, score };
	});

	return scored
		.filter((s) => s.score > 0)
		.sort((a, b) => b.score - a.score)
		.slice(0, maxResults)
		.map((s, i) => ({
			rank: i + 1,
			url: s.doc.page.url,
			title: s.doc.page.title,
			site: s.doc.page.site,
			published: s.doc.page.published,
			snippet: makeSnippet(s.doc.page.text, terms),
			score: Math.round(s.score * 1000) / 1000,
		}));
}

/**
 * Pick the passage that best "answers the query" as the snippet.
 *
 * Real search engines do the same, and that is exactly why a snippet deceives:
 * **it picks the passage that best matches the query, not the most important passage.**
 *
 * If an article says "supports the G1" at the top and "the G1 is deprecated" in its fourth paragraph,
 * and your query is "G1 support", the snippet will very likely pick the opening.
 * Nobody is lying; summarisation itself loses information.
 */
function makeSnippet(text: string, terms: Set<string> | string[]): string {
	const wanted = new Set(terms);
	const words = text.split(/\s+/);
	if (words.length <= SNIPPET_WORDS) return text;

	let bestStart = 0;
	let bestHits = -1;

	for (let start = 0; start + SNIPPET_WORDS <= words.length; start += 4) {
		let hits = 0;
		for (let i = start; i < start + SNIPPET_WORDS; i++) {
			const word = (words[i] ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
			if (wanted.has(word)) hits++;
		}
		if (hits > bestHits) {
			bestHits = hits;
			bestStart = start;
		}
	}

	const head = bestStart > 0 ? "… " : "";
	const tail = bestStart + SNIPPET_WORDS < words.length ? " …" : "";
	return head + words.slice(bestStart, bestStart + SNIPPET_WORDS).join(" ") + tail;
}

// ─────────────────────────────────────────────────────────────
// CLI: play with ranking without a model
// ─────────────────────────────────────────────────────────────

if (import.meta.main) {
	const query = process.argv.slice(2).join(" ");
	if (!query) {
		console.error('Usage: bun run lesson-20-search-agent/search/engine.ts "your query"');
		process.exit(1);
	}

	const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
	const hits = search(query, 8);

	console.log(dim(`query: ${query}`));
	console.log(dim(`tokens: [${tokenize(query).join(", ")}]`));
	console.log(dim(`${hits.length} results\n`));

	for (const hit of hits) {
		console.log(`${hit.rank}. ${hit.title}`);
		console.log(dim(`   ${hit.url}  ${hit.published}  score=${hit.score}`));
		console.log(`   ${hit.snippet}\n`);
	}

	if (hits.length === 0) {
		console.log("No results at all. If your query is in Chinese, see Step 3 in the README.");
	}
}
