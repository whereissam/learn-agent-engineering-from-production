/**
 * Embedding：把文字變成向量。
 *
 * 這是 dense retrieval 的前置。Lesson 20 的 BM25 只認得「字面上一樣的字」，
 * 所以中文 query 查英文文件會回 0 筆，同義詞也查不到。
 * Embedding 把文字放到一個空間裡，意思相近的東西距離就近，
 * 跟用什麼語言、用哪個同義詞無關。
 *
 * ## 兩個設計決定
 *
 * **1. 用真的 embedding API，不自己造一個假的。**
 * 我本來想寫一個離線的玩具版（例如 hash + 隨機投影），但那會教錯東西：
 * 玩具版沒有語義，跨語言檢索根本不會成功，讀者會學到一個假的成功案例。
 *
 * **2. 但結果要能離線重現。** 所以向量算完之後寫進 `cache.json` 一起進版控。
 * 沒有金鑰的人照樣跑得動整課，而且拿到的數字跟 README 裡的一模一樣。
 * 只有你**加了新的 query 或新的文件**才需要金鑰。
 *
 * 這其實是很多產品的真實做法：embedding 是可以離線批次算好的，
 * 線上只需要算 query 那一次。
 *
 * ## 為什麼是 768 維
 *
 * `gemini-embedding-001` 預設 3072 維，但 API 可以指定較小的維度
 * （Matryoshka 表示法：前面的維度就已經包含大部分資訊）。實測：
 *
 *   dims=256   cos(英文, 中文)=0.861   cos(英文, 無關的烹飪文)=0.569
 *   dims=768   cos(英文, 中文)=0.817   cos(英文, 無關的烹飪文)=0.449
 *   dims=3072  cos(英文, 中文)=0.820
 *
 * 注意看的不是「跟中文有多像」，是**兩者的差距**：
 * 256 維的時候連完全無關的烹飪文章都有 0.569，鑑別力太差。
 * 768 維把無關的壓到 0.449，差距拉開到 0.37。
 *
 * 維度越低越省空間，但**語義會被壓扁**。這是一個真實的取捨，
 * 不是「越大越好」也不是「越小越省」。
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

if (typeof process.loadEnvFile === "function") {
	try {
		process.loadEnvFile(resolve(import.meta.dirname, "../../.env"));
	} catch {
		// 沒有 .env 很正常
	}
}

const CACHE_PATH = resolve(import.meta.dirname, "cache.json");

export const DIMS = 768;

interface Cache {
	model: string;
	dims: number;
	/** 原文 → 向量。用原文當 key 是為了可讀：出問題的時候你打得開這個檔案。 */
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
	// Anthropic 沒有 embedding API，所以這裡沒有第三個分支。
	// 這件事本身值得知道：embedding 和生成常常不是同一家。
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
 * 正規化成單位長度。
 *
 * 這樣 cosine 相似度就等於內積，省掉每次比對都要算兩個長度。
 * 另外 Gemini 的文件也說了：**維度不是預設值的時候要自己重新正規化**，
 * 因為截斷之後長度就不是 1 了。
 */
function normalize(vector: number[]): number[] {
	const length = Math.sqrt(vector.reduce((sum, x) => sum + x * x, 0)) || 1;
	// 存進版控的檔案不需要 17 位小數，5 位對 768 維綽綽有餘
	return vector.map((x) => Math.round((x / length) * 1e5) / 1e5);
}

// ─────────────────────────────────────────────────────────────

/**
 * 拿一段文字的向量。優先用快取，快取沒有才打 API。
 *
 * 沒有金鑰而且快取也沒有的時候，錯誤訊息要說清楚**兩條路**：
 * 補金鑰重算，或者換一個快取裡有的 query。
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

		// 一次送一批。真實系統這裡還要處理 rate limit 和分批大小，
		// 語料只有 14 篇所以不需要。
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

/** 已經正規化過了，所以 cosine 就是內積。 */
export function cosine(a: number[], b: number[]): number {
	let sum = 0;
	for (let i = 0; i < a.length; i++) sum += (a[i] ?? 0) * (b[i] ?? 0);
	return sum;
}

export function cacheStats(): { model: string; dims: number; count: number } {
	const store = loadCache();
	return { model: store.model, dims: store.dims, count: Object.keys(store.vectors).length };
}
