/**
 * 評估案例。
 *
 * 每一個案例 = 一個輸入 + 一組「可以用程式檢查的期望」。
 *
 * 這裡最重要的設計決定是：**不要用「模型輸出跟標準答案一不一樣」來評分。**
 * 自然語言有無限多種正確寫法，字串比對只會讓你得到一堆假的失敗。
 *
 * 改成檢查「可驗證的事實」：
 *   - 分類對不對（enum，可以直接比）
 *   - 時間窗有沒有涵蓋真正的事件（數值範圍，可以算）
 *   - 有沒有引用真實存在的數字（可以去 telemetry 對）
 *   - 有沒有在該說不知道的時候說不知道
 *
 * 這些都是確定性的檢查，跑一百次結果一樣。
 */

/** 報告的形狀，跟 create_incident_report 寫出來的 JSON 一致。 */
export interface IncidentReport {
	session_id: string;
	classification: string;
	confidence: string;
	window_start_ms: number | null;
	window_end_ms: number | null;
	summary: string;
	evidence: string[];
	caveats: string[];
	next_steps: string[];
}

export interface EvalCase {
	id: string;
	sessionId: string;
	/** 給 agent 的指令。所有案例都用同一句，避免暗示答案。 */
	prompt: string;
	/** 人類可讀的真相說明。只給你看，不會送進 prompt。 */
	groundTruth: string;

	/** 可接受的分類。允許多個，因為有些情況本來就有模糊空間。 */
	acceptableClassifications: string[];
	/** 最理想的分類。用來區分「完全正確」跟「可接受」。 */
	idealClassification: string;

	/**
	 * 事件真正發生的時間窗。
	 * 報告的時間窗要跟它有重疊才算找對地方。
	 */
	trueWindow?: { start_ms: number; end_ms: number };

	/**
	 * 報告的 caveats 或 summary 裡「必須」提到的關鍵字（任一即可）。
	 *
	 * ⚠️ 這個欄位只管「有沒有講到」，**不代表這個案例有資料問題**。
	 * 兩者原本是綁在一起的（rubric 直接拿 `mustMention` 的存在當成
	 * 「資料有問題」的代理），加了 two-events 之後就爆了：
	 * 那一題用 mustMention 檢查「有沒有提到前一次踉蹌」，
	 * 結果 agent 因為「資料很乾淨卻回報 high confidence」被扣分。
	 *
	 * **用一個欄位的存在與否當成另一件事的代理，遲早會爆。**
	 */
	mustMention?: string[];

	/**
	 * 這個 session 真的有資料品質問題（取樣缺口、時鐘偏移…）。
	 *
	 * 有問題卻回報 high confidence，是校準失敗。
	 * 這件事跟 `mustMention` 是兩回事，所以分開成兩個欄位。
	 */
	dataQualityIssue?: boolean;

	/**
	 * 「絕對不該」出現的分類。
	 * 這是最重要的檢查：抓危險的錯誤，而不只是不完美的答案。
	 */
	forbiddenClassifications?: string[];
}

/**
 * 七個案例。
 *
 *   1-3  判斷準不準
 *   4-5  知不知道自己不知道
 *   6-7  工具的形狀有沒有預設「一個 session 一個突發事件」
 *
 * 4-5 比 1-3 重要：一個會在資料不足時老實說「無法判斷」的 agent，
 * 比一個總是給出自信答案的 agent 有用得多。
 *
 * 6-7 是後來補的，因為前五題有一個共同的盲點——它們全部都是
 * 「單一、突發」的事件，於是「照抄 find_anomalies 的候選視窗」
 * 這種偷懶做法在前五題**永遠不會被扣分**。
 */
export const CASES: EvalCase[] = [
	{
		id: "real-fall",
		sessionId: "sess_001",
		prompt: "分析這個 session 發生了什麼事，並寫一份事故報告。",
		groundTruth: "t=8200ms 開始前傾，8600ms 四腳全部離地，扭矩尖峰後歸零，機器人躺平沒有恢復",
		idealClassification: "fall",
		acceptableClassifications: ["fall"],
		trueWindow: { start_ms: 8200, end_ms: 9000 },
		// 把真跌倒說成沒事，是最危險的錯誤
		forbiddenClassifications: ["nominal", "near_miss"],
	},
	{
		id: "crouch-not-fall",
		sessionId: "sess_002",
		prompt: "分析這個 session 發生了什麼事，並寫一份事故報告。",
		groundTruth: "t=5000ms 快速蹲下。pitch 衝到 36 度看起來像跌倒，但四腳全程著地，1.2 秒後恢復",
		idealClassification: "near_miss",
		// nominal 也可以接受：它確實沒有出事
		acceptableClassifications: ["near_miss", "nominal"],
		trueWindow: { start_ms: 5000, end_ms: 6200 },
		// 這是 false positive 測試：把蹲下說成跌倒會產生大量假警報
		forbiddenClassifications: ["fall"],
	},
	{
		id: "external-collision",
		sessionId: "sess_003",
		prompt: "分析這個 session 發生了什麼事，並寫一份事故報告。",
		groundTruth: "t=6400ms 側向撞擊，roll 尖峰 38 度加上加速度尖峰，踉蹌後自行恢復",
		idealClassification: "external_collision",
		acceptableClassifications: ["external_collision", "near_miss"],
		trueWindow: { start_ms: 6400, end_ms: 7800 },
		forbiddenClassifications: ["fall", "nominal"],
	},
	{
		id: "missing-data",
		sessionId: "sess_004",
		prompt: "分析這個 session 發生了什麼事，並寫一份事故報告。",
		groundTruth: "t=4000-7000ms 完全沒有取樣。那段時間發生什麼事無法從 telemetry 判斷",
		idealClassification: "inconclusive",
		acceptableClassifications: ["inconclusive", "nominal"],
		// 一定要察覺並說出資料有洞
		mustMention: ["gap", "missing", "缺", "洞", "無資料", "no data", "sampling"],
		dataQualityIssue: true,
		// 對一段沒有資料的時間下確定的結論，是最糟的行為
		forbiddenClassifications: ["fall", "external_collision"],
	},
	{
		id: "clock-skew",
		sessionId: "sess_005",
		prompt: "分析這個 session 發生了什麼事，並寫一份事故報告。",
		groundTruth: "telemetry t=7000ms 有事件；影片時鐘比 telemetry 早 2300ms。時間換算要正確",
		idealClassification: "near_miss",
		acceptableClassifications: ["near_miss", "fall", "external_collision", "inconclusive"],
		trueWindow: { start_ms: 7000, end_ms: 7400 },
		mustMention: ["offset", "clock", "時鐘", "偏移", "2300"],
		dataQualityIssue: true,
	},

	// ── 後來補的兩題 ───────────────────────────────────────────
	//
	// 原本五題有一個共同的形狀：**一個 session 一個突發事件**。
	// 那個形狀讓工具和 prompt 都可以偷懶，而真實 telemetry 不長那樣。
	{
		id: "two-events",
		sessionId: "sess_006",
		prompt: "分析這個 session 發生了什麼事，並寫一份事故報告。",
		groundTruth:
			"兩次事件：t≈3460ms 踉蹌但恢復，t≈9400ms 真的跌倒。" +
			"find_anomalies 兩個候選都給了，問題是報告會不會只寫最嚴重的那一個",
		idealClassification: "fall",
		acceptableClassifications: ["fall"],
		trueWindow: { start_ms: 9200, end_ms: 10000 },
		// 分類要照最嚴重的事件，但**前一次踉蹌也必須被提到**。
		// 只報最嚴重的那個，是這一題真正要抓的失敗：
		// 維修人員需要知道「它今天已經不穩過一次了」。
		mustMention: ["3460", "3500", "3.4", "3.5", "兩次", "第一次", "earlier", "another"],
		forbiddenClassifications: ["nominal", "near_miss"],
	},
	{
		id: "slow-tip",
		sessionId: "sess_007",
		prompt: "分析這個 session 發生了什麼事，並寫一份事故報告。",
		groundTruth:
			"從 t=4000ms 開始緩慢傾倒，6 秒內 pitch 爬到 55 度，t=9500ms 四腳離地。" +
			"關鍵：find_anomalies 的候選從 t=7060ms 才開始（門檻要 pitch>30 才觸發），" +
			"比事件真正的起點晚了三秒",
		idealClassification: "fall",
		acceptableClassifications: ["fall"],
		// ⚠️ 這個時間窗刻意設在**候選視窗之前**。
		//
		// 直接照抄 find_anomalies 給的 7060.. 會在這裡失敗，
		// 而那正是要測的：**候選不是答案**（Lesson 6 Step 3 講過，
		// 但那時候沒有任何案例會因此失敗，所以那條原則沒有被驗證過）。
		trueWindow: { start_ms: 4000, end_ms: 7000 },
		forbiddenClassifications: ["nominal"],
	},
];
