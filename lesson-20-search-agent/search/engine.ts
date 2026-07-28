/**
 * 一個小到可以整份讀完的搜尋引擎。
 *
 * 它只做一件事：把 query 拿來跟語料比對，回傳排序過的
 * 「標題 + 網址 + 一小段 snippet」。**沒有正文。**
 *
 * 這個限制是刻意的，而且它就是真實世界的樣子：
 * Google、Bing、SearXNG 回給你的都是這三樣東西。要拿到正文，
 * 你得自己再去把網頁抓下來（Lesson 21）。
 *
 * 排序用 BM25。為什麼不是「丟進向量資料庫算 cosine 相似度」？
 * 因為 BM25 是 1994 年的東西，到今天仍然是很多搜尋系統的骨幹，
 * 而且它便宜、可解釋、不用模型。Lesson 22 會加上 dense retrieval，
 * 你會看到兩者各自擅長什麼——但要先有一個 baseline 才比得出來。
 *
 * 直接跑跑看（不需要 API key，不需要模型）：
 *
 *   bun run lesson-20-search-agent/search/engine.ts "unitree g1 retargeting"
 *   bun run lesson-20-search-agent/search/engine.ts "把影片動作轉到人形機器人"
 *
 * 第二個指令會回傳 0 筆。這不是 bug，見 README 的 Step 3。
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { IndexedPage } from "../corpus/generate.ts";

const INDEX_PATH = resolve(import.meta.dirname, "../corpus/index.json");

/** BM25 的兩個旋鈕。這是文獻上的常用預設值，不需要調。 */
const K1 = 1.5;
const B = 0.75;

/**
 * 標題權重。
 *
 * 做法很土：把標題的字重複幾次再丟進索引。
 * 真的搜尋引擎會用 field-weighted BM25（BM25F），但形狀是一樣的：
 * **出現在標題比出現在正文重要。**
 */
const TITLE_BOOST = 3;

/** snippet 取幾個字。真實搜尋引擎大約給你 150-200 個字元。 */
const SNIPPET_WORDS = 32;

export interface SearchHit {
	rank: number;
	url: string;
	title: string;
	site: string;
	published: string;
	/** 正文的一小片。**不是整頁。** */
	snippet: string;
	score: number;
}

interface Doc {
	page: IndexedPage;
	tokens: string[];
	/** term → 這篇出現幾次 */
	freq: Map<string, number>;
	length: number;
}

/**
 * 斷詞。
 *
 * 注意這個正規表示式只認得 a-z 和 0-9。
 * 中文、日文、韓文丟進來會得到空陣列——這是關鍵字檢索的真實限制，
 * 不是這份程式偷懶。Lesson 22 的 dense retrieval 才有辦法處理。
 */
export function tokenize(text: string): string[] {
	return text
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/** 最常見的英文虛詞。留著只會讓每一篇的分數一起變高，沒有鑑別力。 */
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
			`找不到語料索引 ${INDEX_PATH}。\n` +
				"先產生語料：bun run lesson-20-search-agent/corpus/generate.ts",
		);
	}

	const pages = JSON.parse(raw) as IndexedPage[];
	cached = pages.map((page) => {
		// 標題重複 TITLE_BOOST 次 = 標題的字比較重要
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
 * 白話版：一個字在**這篇**出現越多次分數越高（但有邊際遞減），
 * 在**所有篇**出現越多次分數越低（到處都有的字沒有鑑別力），
 * 而且短文章比長文章佔便宜要被扣回來（不然塞很長的頁面就贏了）。
 *
 * 就這樣。三十年來大家還在用它，因為它便宜又難打敗。
 */
export function search(query: string, maxResults = 5): SearchHit[] {
	const docs = loadDocs();
	const terms = tokenize(query);

	// query 斷不出任何字（例如純中文）→ 沒有結果。
	// 這不是「找不到相關內容」，是「這個檢索方式看不懂這個 query」。
	if (terms.length === 0) return [];

	const avgLength = docs.reduce((sum, d) => sum + d.length, 0) / docs.length;

	const scored = docs.map((doc) => {
		let score = 0;
		for (const term of terms) {
			const tf = doc.freq.get(term) ?? 0;
			if (tf === 0) continue;

			// 有幾篇文章含這個字
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
 * 挑一段最像「有回答到 query」的文字當 snippet。
 *
 * 真實搜尋引擎也是這樣做的，而這正是 snippet 會騙人的原因：
 * **它挑的是「最符合 query 的那一段」，不是「最重要的那一段」。**
 *
 * 如果一篇文章開頭寫「支援 G1」、第四段寫「G1 已棄用」，
 * 你的 query 是「G1 支援」，snippet 大概率會挑到開頭那句。
 * 這不是誰在說謊，是摘要這件事本身就會丟資訊。
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
// CLI：不需要模型也能玩排序
// ─────────────────────────────────────────────────────────────

if (import.meta.main) {
	const query = process.argv.slice(2).join(" ");
	if (!query) {
		console.error('用法：bun run lesson-20-search-agent/search/engine.ts "你的 query"');
		process.exit(1);
	}

	const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
	const hits = search(query, 8);

	console.log(dim(`query: ${query}`));
	console.log(dim(`斷詞:  [${tokenize(query).join(", ")}]`));
	console.log(dim(`${hits.length} 筆結果\n`));

	for (const hit of hits) {
		console.log(`${hit.rank}. ${hit.title}`);
		console.log(dim(`   ${hit.url}  ${hit.published}  score=${hit.score}`));
		console.log(`   ${hit.snippet}\n`);
	}

	if (hits.length === 0) {
		console.log("沒有任何結果。如果你的 query 是中文，看 README 的 Step 3。");
	}
}
