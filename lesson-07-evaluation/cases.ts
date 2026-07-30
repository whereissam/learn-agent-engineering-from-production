/**
 * Evaluation cases.
 *
 * Each case = one input plus a set of expectations a program can check.
 *
 * The most important design decision here: **do not score by "is the model's output identical to a reference answer".**
 * Natural language has infinitely many correct phrasings, and string comparison only produces false failures.
 *
 * Check verifiable facts instead:
 *   - is the classification right (an enum, directly comparable)
 *   - does the time window cover the real event (a numeric range, computable)
 *   - does it cite numbers that really exist (checkable against the telemetry)
 *   - does it say "I do not know" when it should
 *
 * All deterministic checks, giving the same result a hundred runs in a row.
 */

/** The report's shape, matching the JSON create_incident_report writes. */
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
	/** The instruction given to the agent. Every case uses the same one, so nothing hints at the answer. */
	prompt: string;
	/** A human-readable statement of the truth. For you only; it never enters the prompt. */
	groundTruth: string;

	/** Acceptable classifications. Several are allowed, because some situations are genuinely ambiguous. */
	acceptableClassifications: string[];
	/** The ideal classification. Distinguishes "entirely right" from "acceptable". */
	idealClassification: string;

	/**
	 * The window in which the event really happened.
	 * The report's window must overlap it to count as having found the right place.
	 */
	trueWindow?: { start_ms: number; end_ms: number };

	/**
	 * Keywords the report's caveats or summary **must** mention (any one will do).
	 *
	 * ⚠️ This field only covers "was it mentioned"; it **does not mean this case has a data problem**.
	 * The two used to be tied together (the rubric took the presence of `mustMention` as a proxy
	 * for "the data has a problem"), and adding two-events blew that up:
	 * that case uses mustMention to check "did it mention the earlier stumble",
	 * and the agent lost points for "reporting high confidence when the data is clean".
	 *
	 * **Using one field's presence as a proxy for another thing blows up eventually.**
	 */
	mustMention?: string[];

	/**
	 * This session really has a data quality problem (a sampling gap, a clock offset…).
	 *
	 * Reporting high confidence when there is a problem is a calibration failure.
	 * That is a different matter from `mustMention`, so they are separate fields.
	 */
	dataQualityIssue?: boolean;

	/**
	 * Classifications that must **never** appear.
	 * The most important check: catching dangerous errors rather than merely imperfect answers.
	 */
	forbiddenClassifications?: string[];
}

/**
 * Seven cases.
 *
 *   1-3  is the judgement accurate
 *   4-5  does it know what it does not know
 *   6-7  does the tools' shape assume "one sudden event per session"
 *
 * 4-5 matter more than 1-3: an agent that honestly says "cannot determine" when data is thin
 * is far more useful than one that always produces a confident answer.
 *
 * 6-7 were added later, because the first five shared a blind spot — all of them were
 * "single, sudden" events, so the lazy approach of "copy find_anomalies's candidate window"
 * **never lost points** on the first five.
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
		// Calling a real fall nothing is the most dangerous error
		forbiddenClassifications: ["nominal", "near_miss"],
	},
	{
		id: "crouch-not-fall",
		sessionId: "sess_002",
		prompt: "分析這個 session 發生了什麼事，並寫一份事故報告。",
		groundTruth: "t=5000ms 快速蹲下。pitch 衝到 36 度看起來像跌倒，但四腳全程著地，1.2 秒後恢復",
		idealClassification: "near_miss",
		// nominal is acceptable too: nothing did in fact go wrong
		acceptableClassifications: ["near_miss", "nominal"],
		trueWindow: { start_ms: 5000, end_ms: 6200 },
		// A false positive test: calling a crouch a fall would generate a flood of false alarms
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
		// It must notice and state that the data has a hole
		mustMention: ["gap", "missing", "缺", "洞", "無資料", "no data", "sampling"],
		dataQualityIssue: true,
		// Drawing a confident conclusion over a period with no data is the worst behaviour
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

	// ── the two cases added later ──────────────────────────────
	//
	// The original five shared a shape: **one sudden event per session**.
	// That shape lets both the tools and the prompt be lazy, and real telemetry does not look like it.
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
		// The classification follows the most severe event, and **the earlier stumble must be mentioned too**.
		// Reporting only the most severe one is the failure this case exists to catch:
		// maintenance needs to know "it has already been unstable once today".
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
		// ⚠️ This window is deliberately set **before** the candidate window.
		//
		// Copying find_anomalies's 7060.. straight through fails here,
		// which is exactly what is being tested: **candidates are not the answer** (Lesson 6 Step 3
		// says so, and at the time no case would fail for it, so that principle was never verified).
		trueWindow: { start_ms: 4000, end_ms: 7000 },
		forbiddenClassifications: ["nominal"],
	},
];
