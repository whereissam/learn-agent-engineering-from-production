/**
 * A general-purpose BM25.
 *
 * Lesson 20's version is hardcoded to its corpus (reading `corpus/index.json` directly),
 * because there was only one dataset then. There are two now (local documents and web pages),
 * so it is extracted into "give me some documents and I will rank them".
 *
 * **This is what to do the second time something repeats.** Hardcoding the first time is fine,
 * and abstracting on the second, or you over-design for an imagined second user.
 *
 * The algorithm itself is identical to Lesson 20's, and its comments are not repeated; see
 * `lesson-20-search-agent/search/engine.ts`。
 */

const K1 = 1.5;
const B = 0.75;
const TITLE_BOOST = 3;

const STOPWORDS = new Set([
	"the", "and", "for", "are", "but", "not", "you", "all", "can", "was", "one", "our",
	"out", "has", "had", "how", "its", "who", "did", "that", "this", "with", "from",
	"they", "them", "have", "been", "were", "will", "what", "when", "your", "there",
	"their", "which", "would", "about", "into", "than", "then", "some", "more",
]);

export function tokenize(text: string): string[] {
	return text
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

export interface Document {
	id: string;
	title: string;
	text: string;
}

export interface Ranked {
	id: string;
	score: number;
}

interface Prepared {
	id: string;
	freq: Map<string, number>;
	length: number;
}

export class Bm25Index {
	private readonly docs: Prepared[];
	private readonly avgLength: number;
	/** term → how many documents contain it. Precomputed, or every query would scan everything. */
	private readonly docFreq = new Map<string, number>();

	constructor(documents: Document[]) {
		this.docs = documents.map((doc) => {
			const tokens = [
				...Array.from({ length: TITLE_BOOST }, () => tokenize(doc.title)).flat(),
				...tokenize(doc.text),
			];
			const freq = new Map<string, number>();
			for (const token of tokens) freq.set(token, (freq.get(token) ?? 0) + 1);
			for (const term of freq.keys()) {
				this.docFreq.set(term, (this.docFreq.get(term) ?? 0) + 1);
			}
			return { id: doc.id, freq, length: tokens.length };
		});

		const total = this.docs.reduce((sum, d) => sum + d.length, 0);
		this.avgLength = this.docs.length > 0 ? total / this.docs.length : 1;
	}

	search(query: string, limit = 10): Ranked[] {
		const terms = tokenize(query);
		if (terms.length === 0) return [];

		return this.docs
			.map((doc) => {
				let score = 0;
				for (const term of terms) {
					const tf = doc.freq.get(term) ?? 0;
					if (tf === 0) continue;
					const df = this.docFreq.get(term) ?? 0;
					const idf = Math.log(1 + (this.docs.length - df + 0.5) / (df + 0.5));
					const denom = tf + K1 * (1 - B + (B * doc.length) / this.avgLength);
					score += idf * ((tf * (K1 + 1)) / denom);
				}
				return { id: doc.id, score };
			})
			.filter((hit) => hit.score > 0)
			.sort((a, b) => b.score - a.score)
			.slice(0, limit);
	}
}
