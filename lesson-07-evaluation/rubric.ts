/**
 * 評分標準。
 *
 * 每一項檢查都是**確定性的**：同樣的報告評一百次，分數一樣。
 *
 * 為什麼不用 LLM 當裁判？
 *
 * LLM-as-judge 有它的用處（評估文筆、語氣、幫助程度這種主觀的東西），
 * 但它本身也會出錯、也要花錢、也不可重現。能用程式檢查的就用程式檢查。
 *
 * 這裡的原則是：**先把能確定性檢查的部分做完，剩下的才考慮 LLM judge。**
 * 大部分人跳過第一步直接上 LLM judge，然後得到一堆看起來很科學但
 * 其實不可靠的分數。
 */

import type { EvalCase, IncidentReport } from "./cases.ts";

export interface CheckResult {
	name: string;
	passed: boolean;
	/** 這項檢查佔的權重。 */
	weight: number;
	detail: string;
	/** true 代表這是「危險錯誤」，整個案例直接判定失敗。 */
	critical?: boolean;
}

export interface CaseResult {
	caseId: string;
	sessionId: string;
	/** 沒有產出報告就是直接失敗。 */
	report: IncidentReport | null;
	checks: CheckResult[];
	score: number;
	maxScore: number;
	passed: boolean;
	/** 有沒有觸犯危險錯誤。 */
	criticalFailure: boolean;
	toolCalls: number;
	elapsedMs: number;
	error?: string;
}

/**
 * 從 evidence 字串裡撈出數字。
 *
 * 用來檢查「模型引用的數字是不是真的存在於資料中」。
 * 這是抓幻覺最直接的方法：模型很會編出看起來合理的數字。
 */
function extractNumbers(text: string): number[] {
	const matches = text.match(/-?\d+(?:\.\d+)?/g) ?? [];
	return matches.map(Number).filter(Number.isFinite);
}

export interface TelemetryFacts {
	/** 各欄位的實際峰值，用來驗證引用的數字。 */
	peaks: Record<string, number>;
	durationMs: number;
}

export function gradeReport(
	testCase: EvalCase,
	report: IncidentReport | null,
	facts: TelemetryFacts,
): { checks: CheckResult[]; criticalFailure: boolean } {
	const checks: CheckResult[] = [];

	// ── 0. 有沒有產出報告 ────────────────────────────────
	if (!report) {
		return {
			checks: [
				{
					name: "produced_report",
					passed: false,
					weight: 1,
					detail: "agent 沒有呼叫 create_incident_report",
					critical: true,
				},
			],
			criticalFailure: true,
		};
	}

	// ── 1. 危險錯誤檢查（最重要）────────────────────────
	//
	// 先檢查這個。一個把真跌倒說成 nominal 的 agent，
	// 就算其他項目都滿分也不能用。
	const forbidden = testCase.forbiddenClassifications ?? [];
	const hitForbidden = forbidden.includes(report.classification);
	checks.push({
		name: "no_dangerous_misclassification",
		passed: !hitForbidden,
		weight: 3,
		critical: true,
		detail: hitForbidden
			? `判成 "${report.classification}"，這在本案例是危險錯誤（禁止：${forbidden.join(", ")}）`
			: "沒有危險的誤判",
	});

	// ── 2. 分類正確性 ───────────────────────────────────
	const isIdeal = report.classification === testCase.idealClassification;
	const isAcceptable = testCase.acceptableClassifications.includes(report.classification);
	checks.push({
		name: "classification",
		passed: isAcceptable,
		weight: 3,
		detail: isIdeal
			? `"${report.classification}"（最佳答案）`
			: isAcceptable
				? `"${report.classification}"（可接受，最佳為 "${testCase.idealClassification}"）`
				: `"${report.classification}"，期望 ${testCase.acceptableClassifications.join(" 或 ")}`,
	});

	// ── 3. 時間窗有沒有找對 ─────────────────────────────
	if (testCase.trueWindow) {
		const { start_ms: ts, end_ms: te } = testCase.trueWindow;
		const rs = report.window_start_ms;
		const re = report.window_end_ms;

		// 有重疊就算對。不要求精確吻合，因為「事件何時開始」本來就有解釋空間。
		const overlaps = rs !== null && re !== null && rs <= te && re >= ts;

		checks.push({
			name: "window_overlap",
			passed: overlaps,
			weight: 2,
			detail: overlaps
				? `${rs}..${re}ms 與真實區間 ${ts}..${te}ms 有重疊`
				: rs === null
					? "沒有提供時間窗"
					: `${rs}..${re}ms 與真實區間 ${ts}..${te}ms 沒有重疊`,
		});
	}

	// ── 4. 有沒有引用證據 ───────────────────────────────
	checks.push({
		name: "has_evidence",
		passed: report.evidence.length >= 2,
		weight: 1,
		detail: `${report.evidence.length} 條證據`,
	});

	// ── 5. 引用的數字是不是真的（抓幻覺）───────────────
	//
	// 把 evidence 裡的數字跟真實峰值比對。允許 15% 誤差，
	// 因為模型可能引用區間平均或稍微四捨五入。
	const cited = report.evidence.flatMap(extractNumbers);
	const realValues = Object.values(facts.peaks);
	const plausible = cited.filter((n) =>
		// 時間戳（0..duration）或接近某個真實峰值，都算合理
		(n >= 0 && n <= facts.durationMs) ||
		realValues.some((v) => v !== 0 && Math.abs((n - v) / v) < 0.15),
	);
	const ratio = cited.length === 0 ? 0 : plausible.length / cited.length;

	checks.push({
		name: "numbers_plausible",
		passed: cited.length > 0 && ratio >= 0.7,
		weight: 2,
		detail:
			cited.length === 0
				? "證據裡沒有任何數字（無法驗證）"
				: `${plausible.length}/${cited.length} 個引用的數字對得上實際資料 (${Math.round(ratio * 100)}%)`,
	});

	// ── 6. 該提的有沒有提（資料品質意識）───────────────
	if (testCase.mustMention) {
		const haystack = [
			report.summary,
			...report.caveats,
			...report.evidence,
			...report.next_steps,
		]
			.join(" ")
			.toLowerCase();

		const found = testCase.mustMention.filter((kw) => haystack.includes(kw.toLowerCase()));

		checks.push({
			name: "mentions_data_issue",
			passed: found.length > 0,
			weight: 3,
			critical: true,
			detail:
				found.length > 0
					? `有提到：${found.join(", ")}`
					: `沒有提到資料問題（預期關鍵字任一：${testCase.mustMention.join(", ")}）`,
		});
	}

	// ── 7. 信心度校準 ───────────────────────────────────
	//
	// 資料有問題卻回報 high confidence，是一種校準失敗。
	// ⚠️ 這裡原本看的是 `testCase.mustMention` 的存在，
	// 也就是拿「有沒有要求提到某些關鍵字」當成「資料有沒有問題」的代理。
	// 加了 two-events 那一題（用 mustMention 檢查「有沒有提到前一次踉蹌」）
	// 之後就誤判了：資料明明很乾淨，卻因為 high confidence 被扣分。
	// 現在改成看明確的 `dataQualityIssue`。
	if (testCase.dataQualityIssue && report.confidence === "high") {
		checks.push({
			name: "calibrated_confidence",
			passed: false,
			weight: 1,
			detail: "資料品質有問題，但回報 high confidence",
		});
	} else {
		checks.push({
			name: "calibrated_confidence",
			passed: true,
			weight: 1,
			detail: `confidence=${report.confidence}`,
		});
	}

	const criticalFailure = checks.some((c) => c.critical && !c.passed);
	return { checks, criticalFailure };
}

export function scoreOf(checks: CheckResult[]): { score: number; maxScore: number } {
	let score = 0;
	let maxScore = 0;
	for (const c of checks) {
		maxScore += c.weight;
		if (c.passed) score += c.weight;
	}
	return { score, maxScore };
}
