/**
 * 量抽取品質。
 *
 * 「我的抽取器看起來抽得不錯」是一句沒有意義的話。這一課有一個很少見的
 * 好條件：**我們知道正確答案**。Lesson 20 的 `corpus/index.json` 裡
 * 存的就是每一頁的正文（因為 HTML 是我們自己從那份文字產生的）。
 *
 * 所以可以直接量兩件事：
 *
 *   recall（涵蓋率）  正文有多少比例被抽到了？漏字就是漏證據。
 *   noise （雜訊率）  抽出來的東西裡，有多少根本不是正文？
 *                     雜訊會吃掉 context，還會被模型當成內容引用。
 *
 * 這其實就是 Lesson 7 的做法提前出現：**確定性的評分，不用 LLM 當裁判。**
 *
 * 執行（不需要金鑰、不需要模型）：
 *   bun run lesson-21-crawl/extract/measure.ts
 *   bun run lesson-21-crawl/extract/measure.ts --show github-com-openmotion-retarget-anything
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { IndexedPage } from "../../lesson-20-search-agent/corpus/generate.ts";
import { extractMain, stripTags } from "./html.ts";

const CORPUS = resolve(import.meta.dirname, "../../lesson-20-search-agent/corpus");

export interface Score {
	/** 正文有多少比例被抽到（0-1）。 */
	recall: number;
	/** 抽出來的內容裡有多少不是正文（0-1）。 */
	noise: number;
	truthWords: number;
	gotWords: number;
}

/**
 * 用「詞的多重集合」比對，不是比字串相等。
 *
 * 為什麼不比字串？因為換行、空白、標點在抽取過程一定會變，
 * 但那些差異不影響模型讀到的資訊。**要量的是資訊，不是格式。**
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
			"找不到 Lesson 20 的語料。先產生：bun run lesson-20:corpus",
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
		if (!page) throw new Error(`找不到 ${showId}。用 id 或網址的一部分。`);
		const html = readHtml(page);
		console.log(dim(`── ${page.url}`));
		console.log(dim("\n【stripTags】把標籤拿掉就好了吧？\n"));
		console.log(stripTags(html));
		console.log(dim("\n【extractMain】砍掉 boilerplate 之後\n"));
		console.log(extractMain(html).text);
		process.exit(0);
	}

	console.log(dim("recall = 正文抽到多少   noise = 抽出來的東西有多少不是正文\n"));
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
		`${"平均".padEnd(38)}${pct(naiveRecall / n)}${pct(naiveNoise / n)}   ` +
			`${pct(mainRecall / n)}${pct(mainNoise / n)}`,
	);
	console.log();
	console.log(`正文實際大小        ${truthChars} 字元`);
	console.log(`stripTags 抽出來    ${naiveChars} 字元  (${(naiveChars / truthChars).toFixed(2)}x)`);
	console.log(`extractMain 抽出來  ${mainChars} 字元  (${(mainChars / truthChars).toFixed(2)}x)`);
	console.log();
	console.log(dim("看某一頁的實際差別：bun run lesson-21-crawl/extract/measure.ts --show retarget-anything"));
}
