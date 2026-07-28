/**
 * 這一課的四個 LLM 步驟。
 *
 * 注意每一個都是**單次呼叫、輸入輸出明確、沒有工具**：
 *
 *   clarify         問題 → 3 個澄清問題
 *   generateQueries 問題 + 已知 → N 條查詢
 *   extractLearnings 查詢 + 網頁內容 → 結論 + 後續問題
 *   writeReport     全部結論 → 報告
 *
 * 這是 research loop 跟 agent loop 最大的形狀差異：
 *
 * ```text
 * Agent loop        一個大模型 + 一堆工具 + 一個沒人知道會跑幾輪的迴圈
 * Research loop     一個程式 + 四個小的、可測試的模型呼叫
 * ```
 *
 * 每一個步驟都可以單獨測、單獨換模型、單獨算成本。
 * **這才是為什麼 Deep Research 產品跑得完，而我們 Lesson 22 的 agent 跑不完。**
 */

import type { StreamingProvider } from "../shared/streaming/types.ts";
import { drain } from "../shared/streaming/types.ts";
import type { Learning, ResearchState } from "./state.ts";
import { summarizeLearnings } from "./state.ts";

/**
 * 抄 deep-research/src/prompt.ts 的 system prompt，加上今天的日期。
 *
 * 「今天是哪一天」對研究型任務特別重要：模型的訓練資料有截止日，
 * 但它不知道自己現在在哪一天，所以會把三年前的東西當成最新的。
 */
function systemPrompt(today: string): string {
	return `You are an expert researcher. Today is ${today}.

- The user is an experienced engineer. Be specific and dense; do not pad.
- Always include concrete entities: project names, version numbers, dates, licences, numbers.
- If the sources do not support a claim, say so instead of filling the gap from memory.
- Never invent a URL.`;
}

async function ask(
	provider: StreamingProvider,
	state: ResearchState,
	prompt: string,
	maxTokens = 2000,
): Promise<string> {
	state.budget.llmCalls++;
	const response = await drain(
		provider.stream({
			system: systemPrompt(TODAY),
			messages: [{ role: "user", text: prompt }],
			tools: [],
			maxTokens,
		}),
	);

	// 輸出被 token 上限砍斷的話一定要說。
	//
	// 第一次跑真模型時，報告在一個網址中間斷掉：`(https://github.com/kin`
	// ——沒有錯誤、沒有警告，看起來就像模型寫完了。
	// 12 條證據餵進去，3000 token 寫不完。
	//
	// 這跟 Lesson 21 Step 5 是同一種病：**沉默的截斷比明顯的失敗危險。**
	// Lesson 2 的工具輸出截斷會明講「我截掉了」，這裡也要。
	if (response.stopReason === "max_tokens") {
		state.trace.push(`      ⚠ 輸出撞到 ${maxTokens} token 上限，內容不完整`);
		state.budget.truncatedOutputs++;
	}

	return response.blocks
		.filter((b) => b.type === "text")
		.map((b) => b.text)
		.join("\n");
}

/** 寫死「今天」，理由跟 Lesson 22 的 `TODAY` 一樣：可重現。 */
const TODAY = "2026-07-27";

// ─────────────────────────────────────────────────────────────
// 防禦性 JSON 解析
// ─────────────────────────────────────────────────────────────

/**
 * 模型說要回 JSON，不代表它會回 JSON。
 *
 * Lesson 23 讀到 gpt-researcher 有一整個函式在處理這件事
 * （`actions/query_processing.py:6` 的 `_normalize_sub_queries`），
 * 而且它用的是 `json_repair.loads` 而不是 `json.loads`。當時覺得有點誇張，
 * 自己寫一次就知道不誇張了：
 *
 *   - 前後包著 ```json 圍欄
 *   - 前面加一句「好的，以下是查詢：」
 *   - 回一個物件 `{queries: [...]}` 而不是陣列
 *   - 回一個裸字串
 *
 * 四種都遇過。所以這裡不 assert 格式，而是**盡量把它救回來**，
 * 救不回來就回空陣列讓呼叫端決定怎麼辦——
 * **絕對不要讓一次格式失誤炸掉整個研究。**
 */
function parseJson(text: string): unknown {
	const cleaned = text
		.replace(/^[\s\S]*?```(?:json)?/i, "")
		.replace(/```[\s\S]*$/, "")
		.trim();

	for (const candidate of [cleaned, text.trim()]) {
		try {
			return JSON.parse(candidate);
		} catch {
			// 再試著抓出第一個看起來像 JSON 的區塊
			const match = /[[{][\s\S]*[\]}]/.exec(candidate);
			if (match) {
				try {
					return JSON.parse(match[0]);
				} catch {
					// 繼續試下一個候選
				}
			}
		}
	}
	return undefined;
}

/** 把「可能是陣列、可能包在物件裡、可能是單一字串」統一成陣列。 */
function toArray(parsed: unknown, keys: string[]): unknown[] {
	if (Array.isArray(parsed)) return parsed;
	if (parsed && typeof parsed === "object") {
		for (const key of keys) {
			const value = (parsed as Record<string, unknown>)[key];
			if (Array.isArray(value)) return value;
		}
	}
	if (typeof parsed === "string" && parsed.trim()) return [parsed];
	return [];
}

// ─────────────────────────────────────────────────────────────
// Step 0：研究之前先問清楚（deep-research/src/feedback.ts）
// ─────────────────────────────────────────────────────────────

/**
 * 產生澄清問題。
 *
 * deep-research 在開始研究**之前**會先問使用者 3 個問題
 * （`src/feedback.ts`，整個檔案 28 行）。這是很便宜的一步，
 * 但省下來的可能是整輪錯方向的研究。
 *
 * 這裡預設不會真的等使用者回答（demo 用 `--ask` 才會），
 * 因為它的教學價值在於**讓你看到模型覺得哪裡不清楚**。
 */
export async function clarify(
	provider: StreamingProvider,
	state: ResearchState,
	count = 3,
): Promise<string[]> {
	const text = await ask(
		provider,
		state,
		`Given this research request, ask up to ${count} follow-up questions that would ` +
			`most change how you research it. Return ONLY a JSON array of strings.\n\n` +
			`<request>${state.question}</request>`,
		800,
	);
	return toArray(parseJson(text), ["questions"])
		.map((q) => String(q).trim())
		.filter(Boolean)
		.slice(0, count);
}

// ─────────────────────────────────────────────────────────────
// Step 1：生查詢
// ─────────────────────────────────────────────────────────────

export interface PlannedQuery {
	query: string;
	/** 為什麼要搜這一條。抄 deep-research 的 researchGoal（`deep-research.ts:66`）。 */
	goal: string;
}

/**
 * 產生這一層要跑的查詢。
 *
 * 四條規則是 Lesson 23 從真實專案抄回來的，這次寫進程式而不是靠 agent 自律：
 *
 *   不要用搜尋運算子           gpt-researcher/prompts.py:250
 *   一次生 N 條、彼此不相似     deep-research.ts:54
 *   每條附研究目標             deep-research.ts:66
 *   已經搜過的不要再搜         我們自己加的，Lesson 22 Step 8 的教訓
 */
export async function generateQueries(
	provider: StreamingProvider,
	state: ResearchState,
	seed: string,
	count: number,
): Promise<PlannedQuery[]> {
	const already =
		state.queriesRun.length > 0
			? `\nQueries already run (do NOT repeat or paraphrase these):\n${state.queriesRun.map((q) => `- ${q}`).join("\n")}`
			: "";

	const text = await ask(
		provider,
		state,
		`Generate up to ${count} web search queries for this research direction.\n\n` +
			`<direction>${seed}</direction>\n\n` +
			`What we already know:\n${summarizeLearnings(state)}\n${already}\n\n` +
			"Rules:\n" +
			"- Each query must be a plain natural language phrase. Do NOT use search operators " +
			"(site:, filetype:, OR, AND, quotes as operators).\n" +
			"- Each query must be unique and not similar to the others or to the ones already run.\n" +
			"- Do not search for project names you remember from training; search by capability.\n" +
			'- For each query state what you expect to learn from it.\n\n' +
			'Return ONLY JSON: [{"query": "...", "goal": "..."}]',
		1200,
	);

	return toArray(parseJson(text), ["queries"])
		.map((item) => {
			if (typeof item === "string") return { query: item, goal: "" };
			const record = (item ?? {}) as Record<string, unknown>;
			return {
				query: String(record.query ?? "").trim(),
				goal: String(record.goal ?? record.researchGoal ?? "").trim(),
			};
		})
		.filter((q) => q.query.length > 0)
		.slice(0, count);
}

// ─────────────────────────────────────────────────────────────
// Step 2：把網頁壓成 learnings
// ─────────────────────────────────────────────────────────────

export interface PageContent {
	url: string;
	title: string;
	text: string;
}

export interface Extraction {
	learnings: Learning[];
	followUps: string[];
	/**
	 * 這一次萃取為什麼沒有產出（有產出時是 undefined）。
	 *
	 * 這個欄位是實測之後加的。第一次跑真模型時，有一條 query 抓了四頁、
	 * 然後回報「0 條結論」——**而且沒有任何訊息說為什麼**。
	 *
	 * 那是 Lesson 21 Step 5 那個「靜默失敗」的同一張臉：
	 * 管線沒有壞、沒有例外、只是什麼都沒發生。
	 * 所以這裡強制自己講出原因。
	 */
	failure?: "parse-failed" | "no-learnings" | "sources-filtered";
	/** 因為引用了沒抓過的網址而被丟掉的條數。 */
	droppedForSources: number;
}

/**
 * 這是整個 loop 的壓縮閥。
 *
 * 進去的是好幾頁正文（幾千到幾萬字），出來的是最多 N 條一句話結論。
 * **下一輪只帶結論走，不帶網頁走。** 沒有這一步，研究到第三層 context 就爆了。
 *
 * 對照 `deep-research.ts:102`。我們多做一件事：**每條結論要標出處**。
 * deep-research 的 learning 是純字串，所以寫報告時無法把句子對回來源
 * （見 `state.ts` 的 Learning 註解）。
 */
export async function extractLearnings(
	provider: StreamingProvider,
	state: ResearchState,
	query: string,
	pages: PageContent[],
	depth: number,
	maxLearnings = 3,
): Promise<Extraction> {
	if (pages.length === 0) return { learnings: [], followUps: [], droppedForSources: 0 };

	// 每頁裁一段就好。deep-research 是裁到 25k token（`:93`），
	// 我們的語料短很多，用字元數近似即可。
	const documents = pages
		.map((p) => `<source url="${p.url}" title="${p.title}">\n${p.text.slice(0, 4000)}\n</source>`)
		.join("\n\n");

	const text = await ask(
		provider,
		state,
		`These pages were retrieved for the query "${query}".\n\n${documents}\n\n` +
			`Extract up to ${maxLearnings} learnings. Each learning must:\n` +
			"- be one dense sentence with concrete entities, versions, dates or numbers\n" +
			"- be supported by the source text, not by what you already believe\n" +
			'- list the url(s) it came from in "sources"\n\n' +
			`Also list up to ${maxLearnings} follow-up questions that the pages did NOT answer.\n\n` +
			'Return ONLY JSON: {"learnings": [{"text": "...", "sources": ["url"]}], "followUps": ["..."]}',
		2000,
	);

	const parsed = parseJson(text);
	const known = new Set(pages.map((p) => p.url));

	if (parsed === undefined) {
		return { learnings: [], followUps: [], failure: "parse-failed", droppedForSources: 0 };
	}

	const learnings = toArray(
		parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>).learnings : parsed,
		["learnings"],
	)
		.map((item) => {
			const record = (item ?? {}) as Record<string, unknown>;
			const rawSources = Array.isArray(record.sources) ? record.sources : [];
			return {
				text: String(record.text ?? record.learning ?? "").trim(),
				// 只留真的抓過的網址。模型很愛「順手」補一個看起來合理的 URL，
				// 而那正是 Lesson 21 Step 6 看到的引用嫁接。
				// 這裡用程式擋掉，不用 prompt 拜託。
				sources: rawSources.map((s) => String(s).trim()).filter((s) => known.has(s)),
				depth,
			};
		})
		.filter((l) => l.text.length > 0);

	// 分開算：有內容但來源被過濾掉的，跟根本沒產出，是兩件不同的事。
	const withSources = learnings.filter((l) => l.sources.length > 0);
	const droppedForSources = learnings.length - withSources.length;

	const followUps = toArray(
		parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>).followUps : [],
		["followUps", "follow_up_questions", "questions"],
	)
		.map((q) => String(q).trim())
		.filter(Boolean)
		.slice(0, maxLearnings);

	const failure =
		withSources.length > 0
			? undefined
			: droppedForSources > 0
				? "sources-filtered"
				: "no-learnings";

	return { learnings: withSources, followUps, failure, droppedForSources };
}

// ─────────────────────────────────────────────────────────────
// Step 3：寫報告
// ─────────────────────────────────────────────────────────────

/**
 * 把所有 learnings 寫成報告。
 *
 * 關鍵在於：**模型在這一步看不到任何網頁**，只看得到 learnings。
 * 所以它寫得出來的東西，上限就是前面萃取到的證據。
 *
 * 這是刻意的。如果這一步又把網頁塞進去，你就回到「一大坨 context
 * 進去、一大坨字出來」，也就沒辦法追溯每句話的來源了。
 */
export async function writeReport(
	provider: StreamingProvider,
	state: ResearchState,
): Promise<string> {
	if (state.learnings.length === 0) {
		return "研究沒有得到任何有來源支持的結論。這通常代表 query 的方向不對，或是語料裡真的沒有相關內容。";
	}

	const evidence = state.learnings
		.map((l, i) => `[${i + 1}] ${l.text}\n    sources: ${l.sources.join(", ")}`)
		.join("\n");

	return await ask(
		provider,
		state,
		`Write a report answering this question, using ONLY the findings below.\n\n` +
			`<question>${state.question}</question>\n\n<findings>\n${evidence}\n</findings>\n\n` +
			"Rules:\n" +
			"- Every factual sentence must cite the url(s) it came from, inline.\n" +
			"- Do not add facts that are not in the findings. If something important is missing, " +
			"say explicitly what could not be established.\n" +
			"- Lead with the answer, then the evidence, then the caveats.\n" +
			"- Answer in the same language as the question.",
		// 報告長度會隨證據條數成長。12 條證據配 3000 token 會寫不完，
		// 而且會斷在句子中間。這個數字要跟 breadth/depth 一起調。
		6000,
	);
}
