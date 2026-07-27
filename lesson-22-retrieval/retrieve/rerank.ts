/**
 * Rerank：讓模型重新排前面幾筆。
 *
 * 前面所有階段（BM25、dense、訊號）都只看**文件本身的統計**，
 * 沒有一個真的「讀懂」query 跟文件的關係。rerank 是最後一段，
 * 把貴的東西留到候選已經很少的時候才用。
 *
 * ```text
 * 14 篇文件 → 便宜的檢索取前 10 → 貴的模型只看這 10 篇 → 前 5 名
 * ```
 *
 * **這跟 Lesson 6 的 `find_anomalies` 是同一個模式**：
 * 先用便宜的確定性方法縮小範圍，再讓模型做判斷。
 *
 * ## 為什麼這裡用 LLM，不用 cross-encoder
 *
 * 教科書的答案是 cross-encoder（例如 `ms-marco-MiniLM-L-6-v2`）：
 * 把 query 和文件一起餵進一個小模型，直接輸出相關性分數。它比 LLM
 * 便宜幾個數量級，延遲也低得多。
 *
 * 這裡不用，只是因為那要下載一個模型權重，這個 repo 刻意不裝額外依賴。
 * **形狀是一樣的**：一個看得到 query 和文件全文的模型，重新給分。
 *
 * ⚠️ 這一階段預設關閉。原因見 README Step 6：
 * 在這份 14 篇的語料上，它**沒有讓 nDCG 變好**。
 */

import { selectStreamingProvider } from "../../shared/streaming/index.ts";
import { drain } from "../../shared/streaming/types.ts";

export interface RerankCandidate {
	id: string;
	title: string;
	url: string;
	/** 給模型看的內容。真實系統會給抽取後的正文或最相關的 chunk。 */
	text: string;
}

const SYSTEM = `You score how well a document answers a search query.

For each document output one line: <id> <score>
score is an integer 0-3:
  3 = directly answers the query
  2 = useful supporting evidence, not the main answer
  1 = tangentially related
  0 = not relevant

Rules:
- Judge the document's actual content, not how many query words it repeats.
- A page that repeats the query terms but says nothing is 0.
- An outdated page that would mislead the user is at most 1.
- Output nothing except the id/score lines.`;

/**
 * 回傳 id → 分數。模型漏掉的 id 一律當 0 分處理由呼叫端決定。
 *
 * 這裡刻意**不要求模型輸出排序**，只要求逐篇打分。理由：
 * 讓模型直接輸出一個排好的清單，它很容易漏掉或重複某些 id，
 * 而逐篇打分是可以逐行驗證的。**輸出格式越簡單，錯誤越好處理。**
 */
export async function llmRerank(
	query: string,
	candidates: RerankCandidate[],
	maxChars = 700,
): Promise<Map<string, number>> {
	if (candidates.length === 0) return new Map();

	const provider = selectStreamingProvider();
	const listing = candidates
		.map((c) => `[${c.id}]\ntitle: ${c.title}\n${c.text.slice(0, maxChars)}`)
		.join("\n\n---\n\n");

	const response = await drain(
		provider.stream({
			system: SYSTEM,
			messages: [{ role: "user", text: `query: ${query}\n\n${listing}` }],
			tools: [],
			maxTokens: 1000,
		}),
	);

	const text = response.blocks
		.filter((b) => b.type === "text")
		.map((b) => b.text)
		.join("\n");

	const scores = new Map<string, number>();
	for (const line of text.split("\n")) {
		// 容忍 "[id] 3"、"id 3"、"id: 3" 這幾種寫法。
		// 模型的輸出格式永遠會有一點飄，parser 要寬鬆一點。
		const match = /^\s*\[?([a-z0-9-]+)\]?\s*[: ]\s*([0-3])\s*$/i.exec(line);
		if (!match) continue;
		const [, id, score] = match;
		if (id && score) scores.set(id, Number(score));
	}

	return scores;
}
