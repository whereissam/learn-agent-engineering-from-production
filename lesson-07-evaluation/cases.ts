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
	 * 用來檢查它有沒有察覺資料品質問題。
	 */
	mustMention?: string[];

	/**
	 * 「絕對不該」出現的分類。
	 * 這是最重要的檢查：抓危險的錯誤，而不只是不完美的答案。
	 */
	forbiddenClassifications?: string[];
}

/**
 * 五個案例。前三個測「判斷準不準」，後兩個測「知不知道自己不知道」。
 *
 * 後兩個其實更重要。一個會在資料不足時老實說「無法判斷」的 agent，
 * 比一個總是給出自信答案的 agent 有用得多。
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
	},
];
