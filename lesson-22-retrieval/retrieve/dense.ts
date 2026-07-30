/**
 * Dense retrieval: finding by meaning rather than by word.
 *
 * BM25 asks "do these words appear"; dense asks "is this text's meaning close to the query's".
 * Their failure modes are exactly complementary:
 *
 *   BM25  finds rare proper nouns (`waist_yaw`, `v0.7`, `Apache-2.0`),
 *         and fails entirely on synonyms, paraphrases and other languages.
 *   Dense catches "close in meaning",
 *         and dilutes precise strings (model numbers, versions and error codes are often imprecise).
 *
 * **So the answer is not choosing one but running both and fusing** (RRF in `rank.ts`).
 * The impression "AI search = put the documents in a vector database"
 * is missing the left-hand half.
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
 * The text a document is embedded from.
 *
 * The title goes in, because a title is often the page's most condensed sentence.
 *
 * The **whole** document goes into one vector here, because every document in this corpus is short. A real system
 * chunks first (Lesson 21 did) and embeds chunk by chunk, then represents the document by its most similar chunk —
 * otherwise a long document's vector is averaged into something resembling nothing.
 * That is called dilution, and it is dense retrieval's most common trap.
 */
export function docText(page: IndexedPage): string {
	return `${page.title}\n\n${page.text}`;
}

export async function warmCorpusEmbeddings(): Promise<void> {
	await embed(loadCorpus().map(docText));
}

/** Rank the whole corpus by vector similarity. */
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
