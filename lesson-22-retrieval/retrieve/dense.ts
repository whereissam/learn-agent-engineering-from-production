/**
 * Dense retrieval：用意思找，不是用字找。
 *
 * BM25 問「這些字出現了嗎」，dense 問「這段文字的意思跟 query 像不像」。
 * 兩者的失敗方式剛好互補：
 *
 *   BM25  查得到罕見的專有名詞（`waist_yaw`、`v0.7`、`Apache-2.0`），
 *         但同義詞、換句話說、跨語言全部掛掉。
 *   Dense 抓得到「意思接近」，
 *         但精確的字串反而容易被稀釋（型號、版本、錯誤碼常常查不準）。
 *
 * **所以正解不是二選一，是兩個都跑再融合**（`rank.ts` 的 RRF）。
 * 「AI Search = 把文件丟進 vector database」這個印象，
 * 漏掉的就是左邊那一半。
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { IndexedPage } from "../../lesson-20-search-agent/corpus/generate.ts";
import { cosine, embed } from "../embed/provider.ts";

const CORPUS = resolve(import.meta.dirname, "../../lesson-20-search-agent/corpus");

export interface Scored {
	id: string;
	url: string;
	score: number;
}

let corpus: IndexedPage[] | undefined;

export function loadCorpus(): IndexedPage[] {
	if (corpus) return corpus;
	try {
		corpus = JSON.parse(readFileSync(resolve(CORPUS, "index.json"), "utf8")) as IndexedPage[];
	} catch {
		throw new Error("找不到 Lesson 20 的語料。先產生：bun run lesson-20:corpus");
	}
	return corpus;
}

/**
 * 一篇文件拿去 embed 的文字。
 *
 * 標題要放進去，因為標題常常是整頁最濃縮的一句話。
 *
 * 這裡把**整篇**丟進一個向量，是因為語料每篇都很短。真實系統會
 * 先 chunk（Lesson 21 做過）再一塊一塊 embed，然後用「最相似的那一塊」
 * 代表整篇——不然一篇長文的向量會被平均成一團什麼都不像的東西。
 * 這叫 dilution，是 dense retrieval 最常見的坑。
 */
export function docText(page: IndexedPage): string {
	return `${page.title}\n\n${page.text}`;
}

export async function warmCorpusEmbeddings(): Promise<void> {
	await embed(loadCorpus().map(docText));
}

/** 用向量相似度排序整份語料。 */
export async function denseRank(query: string): Promise<Scored[]> {
	const pages = loadCorpus();
	const [queryVector] = await embed([query]);
	if (!queryVector) throw new Error("query embedding 失敗");

	const docVectors = await embed(pages.map(docText));

	return pages
		.map((page, i) => ({
			id: page.id,
			url: page.url,
			score: cosine(queryVector, docVectors[i] ?? []),
		}))
		.sort((a, b) => b.score - a.score);
}
