/**
 * Embeddings: turning text into vectors.
 *
 * The prerequisite for dense retrieval. Lesson 20's BM25 only recognises literally identical words,
 * so a Chinese query against English documents returns 0 results, and synonyms are unfindable.
 * An embedding places text in a space where things close in meaning are close in distance,
 * regardless of language or which synonym was used.
 *
 * ## Two design decisions
 *
 * **1. Use a real embedding API rather than building a fake one.**
 * An offline toy version (hash plus random projection, say) was considered and would teach the wrong thing:
 * a toy has no semantics, cross-language retrieval would never succeed, and the reader would learn a fake success.
 *
 * **2. But the results must be reproducible offline.** So computed vectors are written into `cache.json` and committed.
 * Somebody without a key still runs the whole lesson and gets exactly the numbers in the README.
 * A key is needed only when you **add a new query or a new document**.
 *
 * This is in fact how many products work: embeddings can be batch-computed offline,
 * and only the query's embedding is computed online.
 *
 * ## Why 768 dimensions
 *
 * `gemini-embedding-001` defaults to 3072 dimensions, and the API accepts smaller ones
 * (a Matryoshka representation: the leading dimensions already carry most of the information). Measured:
 *
 *   dims=256   cos(English, Chinese)=0.861   cos(English, an unrelated cooking article)=0.569
 *   dims=768   cos(English, Chinese)=0.817   cos(English, an unrelated cooking article)=0.449
 *   dims=3072  cos(English, Chinese)=0.820
 *
 * What matters is not "how similar to the Chinese" but **the gap between the two**:
 * at 256 dimensions even a wholly unrelated cooking article scores 0.569, which discriminates poorly.
 * 768 dimensions push the unrelated one down to 0.449, widening the gap to 0.37.
 *
 * Fewer dimensions save space and **flatten the semantics**. A real trade-off,
 * neither "bigger is better" nor "smaller is cheaper".
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

if (typeof process.loadEnvFile === "function") {
	try {
		process.loadEnvFile(resolve(import.meta.dirname, "../../.env"));
	} catch {
			// Having no .env is entirely normal
	}
}

const CACHE_PATH = resolve(import.meta.dirname, "cache.json");

export const DIMS = 768;

interface Cache {
	model: string;
	dims: number;
		/** Text → vector. The text is the key for readability: when something goes wrong you can open this file. */
	vectors: Record<string, number[]>;
}

let cache: Cache | undefined;

function loadCache(): Cache {
	if (cache) return cache;
	try {
		cache = JSON.parse(readFileSync(CACHE_PATH, "utf8")) as Cache;
	} catch {
		cache = { model: "", dims: DIMS, vectors: {} };
	}
	return cache;
}

function saveCache(): void {
	if (!cache) return;
	writeFileSync(CACHE_PATH, `${JSON.stringify(cache, null, 0)}\n`, "utf8");
}

// ─────────────────────────────────────────────────────────────

interface ApiConfig {
	label: string;
	model: string;
	apiKey: string;
	baseURL: string;
}

function detectApi(): ApiConfig | undefined {
	if (process.env.GEMINI_API_KEY) {
		return {
			label: "gemini",
			model: process.env.EMBED_MODEL ?? "gemini-embedding-001",
			apiKey: process.env.GEMINI_API_KEY,
			baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
		};
	}
	if (process.env.OPENAI_API_KEY) {
		return {
			label: "openai",
			model: process.env.EMBED_MODEL ?? "text-embedding-3-small",
			apiKey: process.env.OPENAI_API_KEY,
			baseURL: "https://api.openai.com/v1/",
		};
	}
		// Anthropic has no embedding API, so there is no third branch here.
		// That is worth knowing in itself: embeddings and generation often come from different vendors.
	return undefined;
}

async function callApi(texts: string[], api: ApiConfig): Promise<number[][]> {
	const response = await fetch(`${api.baseURL}embeddings`, {
		method: "POST",
		headers: { "content-type": "application/json", authorization: `Bearer ${api.apiKey}` },
		body: JSON.stringify({ model: api.model, input: texts, dimensions: DIMS }),
	});

	if (!response.ok) {
		throw new Error(`Embedding API ${response.status}: ${(await response.text()).slice(0, 200)}`);
	}

	const json = (await response.json()) as { data?: Array<{ embedding: number[] }> };
	if (!json.data) throw new Error("Embedding API returned no data");
	return json.data.map((d) => normalize(d.embedding));
}

/**
 * Normalise to unit length.
 *
 * Then cosine similarity is a dot product, saving two length computations per comparison.
 * Gemini's documentation also says so: **re-normalise yourself when the dimensionality is not the default**,
 * because after truncation the length is no longer 1.
 */
function normalize(vector: number[]): number[] {
	const length = Math.sqrt(vector.reduce((sum, x) => sum + x * x, 0)) || 1;
	// A committed file does not need 17 decimal places; 5 is ample for 768 dimensions
	return vector.map((x) => Math.round((x / length) * 1e5) / 1e5);
}

// ─────────────────────────────────────────────────────────────

/**
 * Get a piece of text's vector. The cache first, and the API only when it misses.
 *
 * Without a key and without a cache entry, the error message must state **both roads**:
 * add a key and recompute, or use a query the cache has.
 */
export async function embed(texts: string[]): Promise<number[][]> {
	const store = loadCache();
	const missing = texts.filter((t) => !store.vectors[t]);

	if (missing.length > 0) {
		const api = detectApi();
		if (!api) {
			throw new Error(
				`這段文字不在 embedding 快取裡，而且沒有可用的金鑰：\n` +
					`  "${missing[0]?.slice(0, 60)}…"\n\n` +
					"兩條路：\n" +
					"  1. 設定 GEMINI_API_KEY 或 OPENAI_API_KEY，然後 bun run lesson-22:embed\n" +
					"  2. 換一個已經在快取裡的 query（eval/queries.ts 那八個都在）",
			);
		}

			// Send in batches. A real system would also handle rate limits and batch sizes here;
			// the corpus has only 14 documents, so it does not need to.
		const vectors = await callApi(missing, api);
		store.model = api.model;
		store.dims = DIMS;
		missing.forEach((text, i) => {
			const vector = vectors[i];
			if (vector) store.vectors[text] = vector;
		});
		saveCache();
	}

	return texts.map((t) => {
		const vector = store.vectors[t];
		if (!vector) throw new Error(`embedding 遺失：${t.slice(0, 40)}`);
		return vector;
	});
}

/** Already normalised, so cosine is a dot product. */
export function cosine(a: number[], b: number[]): number {
	let sum = 0;
	for (let i = 0; i < a.length; i++) sum += (a[i] ?? 0) * (b[i] ?? 0);
	return sum;
}

export function cacheStats(): { model: string; dims: number; count: number } {
	const store = loadCache();
	return { model: store.model, dims: store.dims, count: Object.keys(store.vectors).length };
}
