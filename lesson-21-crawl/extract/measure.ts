/**
 * Measure extraction quality.
 *
 * "My extractor seems to extract well" is a meaningless sentence. This lesson has a rare
 * luxury: **the right answer is known**. Lesson 20's `corpus/index.json`
 * holds each page's body text (because the HTML was generated from that text).
 *
 * So two things can be measured directly:
 *
 *   recall  what fraction of the body was extracted? Missing words are missing evidence.
 *   noise   how much of what was extracted is not body text at all?
 *           Noise eats context and gets cited by the model as content.
 *
 * This is Lesson 7's approach arriving early: **deterministic scoring with no LLM judge.**
 *
 * Run (no key and no model needed):
 *   bun run lesson-21-crawl/extract/measure.ts
 *   bun run lesson-21-crawl/extract/measure.ts --show github-com-openmotion-retarget-anything
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { IndexedPage } from "../../lesson-20-search-agent/corpus/generate.ts";
import { extractMain, stripTags } from "./html.ts";

const CORPUS = resolve(import.meta.dirname, "../../lesson-20-search-agent/corpus");

export interface Score {
	/** What fraction of the body was extracted (0-1). */
	recall: number;
	/** How much of the extraction is not body text (0-1). */
	noise: number;
	truthWords: number;
	gotWords: number;
}

/**
 * Compare as **multisets of words** rather than string equality.
 *
 * Why not compare strings? Because newlines, whitespace and punctuation certainly change during extraction,
 * and those differences do not affect the information the model reads. **What is measured is information, not formatting.**
 */
export function score(truth: string, got: string): Score {
	const truthWords = words(truth);
	const gotWords = words(got);

	const pool = new Map<string, number>();
	for (const w of truthWords) pool.set(w, (pool.get(w) ?? 0) + 1);

	let matched = 0;
	for (const w of gotWords) {
		const left = pool.get(w) ?? 0;
		if (left > 0) {
			pool.set(w, left - 1);
			matched++;
		}
	}

	return {
		recall: truthWords.length === 0 ? 1 : matched / truthWords.length,
		noise: gotWords.length === 0 ? 0 : (gotWords.length - matched) / gotWords.length,
		truthWords: truthWords.length,
		gotWords: gotWords.length,
	};
}

function words(text: string): string[] {
	return text
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter(Boolean);
}

function loadCorpus(): IndexedPage[] {
	try {
		return JSON.parse(readFileSync(resolve(CORPUS, "index.json"), "utf8")) as IndexedPage[];
	} catch {
		throw new Error(
			"Lesson 20's corpus not found. Generate it first: bun run lesson-20:corpus",
		);
	}
}

export function readHtml(page: IndexedPage): string {
	return readFileSync(resolve(CORPUS, "pages", page.html), "utf8");
}

// ─────────────────────────────────────────────────────────────

if (import.meta.main) {
	const pages = loadCorpus();
	const showId = process.argv.includes("--show")
		? process.argv[process.argv.indexOf("--show") + 1]
		: undefined;

	const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
	const pct = (n: number) => `${(n * 100).toFixed(1)}%`.padStart(6);

	if (showId) {
		const page = pages.find((p) => p.id === showId || p.url.includes(showId));
		if (!page) throw new Error(`${showId} not found. Use an id or part of the URL.`);
		const html = readHtml(page);
		console.log(dim(`── ${page.url}`));
		console.log(dim("\n[stripTags] just remove the tags, surely?\n"));
		console.log(stripTags(html));
		console.log(dim("\n[extractMain] after cutting the boilerplate\n"));
		console.log(extractMain(html).text);
		process.exit(0);
	}

	console.log(dim("recall = how much of the body was extracted   noise = how much of the extract is not body\n"));
	console.log(dim("                                          stripTags        extractMain"));
	console.log(dim("                                        recall  noise    recall  noise"));

	let naiveRecall = 0;
	let naiveNoise = 0;
	let mainRecall = 0;
	let mainNoise = 0;
	let naiveChars = 0;
	let mainChars = 0;
	let truthChars = 0;

	for (const page of pages) {
		const html = readHtml(page);
		const naive = stripTags(html);
		const main = extractMain(html).text;

		const a = score(page.text, naive);
		const b = score(page.text, main);

		naiveRecall += a.recall;
		naiveNoise += a.noise;
		mainRecall += b.recall;
		mainNoise += b.noise;
		naiveChars += naive.length;
		mainChars += main.length;
		truthChars += page.text.length;

		const name = page.id.slice(0, 36).padEnd(38);
		console.log(`${name}${pct(a.recall)}${pct(a.noise)}   ${pct(b.recall)}${pct(b.noise)}`);
	}

	const n = pages.length;
	console.log(dim("─".repeat(70)));
	console.log(
		`${"average".padEnd(38)}${pct(naiveRecall / n)}${pct(naiveNoise / n)}   ` +
			`${pct(mainRecall / n)}${pct(mainNoise / n)}`,
	);
	console.log();
	console.log(`actual body size        ${truthChars} characters`);
	console.log(`stripTags extracted     ${naiveChars} characters  (${(naiveChars / truthChars).toFixed(2)}x)`);
	console.log(`extractMain extracted   ${mainChars} characters  (${(mainChars / truthChars).toFixed(2)}x)`);
	console.log();
	console.log(dim("To see the difference on one page: bun run lesson-21-crawl/extract/measure.ts --show retarget-anything"));
}
