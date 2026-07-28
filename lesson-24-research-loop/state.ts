/**
 * Research state：這一課真正的主角。
 *
 * Lesson 22 Step 8 的失敗長這樣：模型搜了 14 次、撞上步數上限、沒有答案。
 * 當時的結論是「排序解決不了這個，因為問題在 agent 那一側」。
 *
 * 這一課要說的是：問題其實**不在 agent 那一側，而是在 agent 這個形狀本身**。
 *
 * ```text
 * Agent loop（Lesson 1-23）   模型決定下一步 → 直到它自己說停
 * Research loop（這一課）      程式決定下一步 → 預算用完就停，模型只做小任務
 * ```
 *
 * 差別不是「哪個比較聰明」，是**誰握著控制流**。
 * 一個沒有停止條件的 while 迴圈，配上一個永遠覺得「再搜一次說不定會更好」
 * 的模型，結果就是燒光步數上限。
 *
 * 這個檔案裡沒有任何 LLM 呼叫。它只是一個**狀態機的狀態**——
 * 但整課的價值幾乎都在這裡。
 */

/**
 * 一條「學到的事」。
 *
 * ⚠️ 這裡跟 deep-research 不一樣，而且是刻意的。
 *
 * `deep-research/src/deep-research.ts:107` 的 learnings 是 `string[]`，
 * 純文字，**沒有來源**。所以到了寫報告那一步（`:129`），
 * 它只能把所有 learning 倒進 prompt，然後在報告最後貼一份
 * 「所有造訪過的網址」清單。
 *
 * 那份清單沒辦法告訴你**哪一句話來自哪一個網址**。
 * Lesson 21 Step 6 我們親眼看過「引用嫁接」：一句沒有來源支持的話
 * 掛上了一個真實的 URL。要抓那種錯，證據和來源必須綁在一起。
 *
 * 所以我們多存 `sources`。這是 Lesson 25 能做引用驗證的前提。
 */
export interface Learning {
	/** 一句話的結論。要具體、要帶數字或日期。 */
	text: string;
	/** 這句話是從哪些網址讀來的。**不能是空的。** */
	sources: string[];
	/** 這條是在第幾層學到的。用來理解研究的形狀，也方便 debug。 */
	depth: number;
}

/** 用掉的資源。這是「深度」旋鈕的另一面：深度就是錢。 */
export interface Budget {
	llmCalls: number;
	searches: number;
	fetches: number;
	/** 因為 URL 已經讀過而跳過的次數。這個數字越大，去重越值得。 */
	skippedDuplicates: number;
	/** 因為這條 query 已經下過而跳過的次數。 */
	skippedQueries: number;
	/** 有幾次模型輸出撞到 token 上限被截斷。**不是零就要處理。** */
	truncatedOutputs: number;
}

export interface ResearchState {
	question: string;
	learnings: Learning[];
	/**
	 * 讀過的網址。
	 *
	 * 對照 `gpt-researcher/gpt_researcher/skills/researcher.py:801` 的 `_get_new_urls`，
	 * 以及 `:108` 那句註解：
	 *
	 *   > visited_urls is deliberately NOT cleared here. It may be shared with a
	 *   > parent researcher ... so that already scraped URLs are not fetched again.
	 *
	 * 注意這個 Set 是**整棵研究樹共用**的，不是每一層各有一份。
	 * deep-research 有收集 visitedUrls，但**只用來在報告末尾列 Sources**
	 * （`deep-research.ts:229`、`:292`），從來沒拿來避免重複抓取。
	 * 這是兩個專案很明顯的差別，我們照 gpt-researcher 的做。
	 */
	visited: Set<string>;
	/** 已經下過的 query，避免同一層問出幾乎一樣的東西。 */
	queriesRun: string[];
	budget: Budget;
	/** 每一步發生了什麼，給 demo 印出來看的。 */
	trace: string[];
}

export function createState(question: string): ResearchState {
	return {
		question,
		learnings: [],
		visited: new Set(),
		queriesRun: [],
		budget: { llmCalls: 0, searches: 0, fetches: 0, skippedDuplicates: 0, skippedQueries: 0, truncatedOutputs: 0 },
		trace: [],
	};
}

/**
 * 研究的形狀：廣度與深度。
 *
 * 直接抄 `deep-research/src/deep-research.ts:230-231`：
 *
 * ```ts
 * const newBreadth = Math.ceil(breadth / 2);
 * const newDepth = depth - 1;
 * ```
 *
 * 為什麼廣度要砍半？因為第一層是「這個題目有哪些面向」，
 * 越往下越具體，需要的查詢也越少。如果每層都保持一樣的廣度，
 * 成本會是 breadth^depth——breadth=4、depth=3 就是 64 次搜尋。
 *
 * 砍半之後：4 → 2 → 1，總共 4 + 8 + 8 = 幾十次，而且**上界算得出來**。
 *
 * **算得出上界**這件事本身就是重點。Lesson 22 那個 agent 的上界是
 * 「步數上限」，那不是預算，那是熔斷器。
 */
export function nextBreadth(breadth: number): number {
	return Math.ceil(breadth / 2);
}

/**
 * 把 query 正規化成可以比對的形式。
 *
 * prompt 裡已經寫了「不要重複已經下過的 query」，但**那只是拜託**。
 * 假 provider 第一次跑就照樣重複了兩條——真模型也會，只是頻率低一點。
 *
 * 這一課的主題就是「能用程式保證的事不要用 prompt 拜託」，
 * 所以重複這件事要在程式裡擋掉，不能只寫在 prompt 裡。
 */
export function normalizeQuery(query: string): string {
	return query
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter(Boolean)
		.sort()
		.join(" ");
}

/** 這一層是不是最後一層。 */
export function isLastLayer(depth: number): boolean {
	return depth - 1 <= 0;
}

/**
 * 把研究狀態壓成一段文字，給下一輪的 query 生成當 context。
 *
 * **loop 裡流動的是 learnings，不是網頁。**
 * 對照 `deep-research.ts:102`：五頁內容被壓成最多 3 條 learning，
 * 原始文字完全不進下一輪。
 *
 * 這就是 Lesson 5 的 context 壓縮長在 research loop 裡的樣子。
 * 沒有這一步，研究到第三層 context 就爆了。
 */
export function summarizeLearnings(state: ResearchState, max = 12): string {
	if (state.learnings.length === 0) return "(nothing learned yet)";
	// 取最近的幾條。最近的通常最具體，因為研究是由粗到細。
	return state.learnings
		.slice(-max)
		.map((l) => `- ${l.text}`)
		.join("\n");
}
