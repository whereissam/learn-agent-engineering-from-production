/**
 * The scoring rubric.
 *
 * Every check is **deterministic**: score the same report a hundred times and the score is the same.
 *
 * Why no LLM judge?
 *
 * LLM-as-judge has its uses (evaluating style, tone, helpfulness — subjective things),
 * and it also errs, costs money and is irreproducible. Whatever a program can check, a program should check.
 *
 * The principle here: **finish everything that can be checked deterministically first, and only then consider an LLM judge.**
 * Most people skip the first step and go straight to an LLM judge, then get a pile of scores that look
 * scientific and are unreliable.
 */

import type { EvalCase, IncidentReport } from "./cases.ts";

export interface CheckResult {
	name: string;
	passed: boolean;
	/** This check's weight. */
	weight: number;
	detail: string;
	/** true means a **dangerous error**: the whole case fails outright. */
	critical?: boolean;
}

export interface CaseResult {
	caseId: string;
	sessionId: string;
	/** Producing no report at all is an outright failure. */
	report: IncidentReport | null;
	checks: CheckResult[];
	score: number;
	maxScore: number;
	passed: boolean;
	/** Whether any dangerous error was committed. */
	criticalFailure: boolean;
	toolCalls: number;
	elapsedMs: number;
	error?: string;
}

/**
 * Pull the numbers out of an evidence string.
 *
 * Used to check whether the numbers the model cited really exist in the data.
 * The most direct way to catch hallucination: models are very good at inventing plausible numbers.
 */
function extractNumbers(text: string): number[] {
	const matches = text.match(/-?\d+(?:\.\d+)?/g) ?? [];
	return matches.map(Number).filter(Number.isFinite);
}

export interface TelemetryFacts {
	/** Each field's actual peak, for validating cited numbers. */
	peaks: Record<string, number>;
	durationMs: number;
}

export function gradeReport(
	testCase: EvalCase,
	report: IncidentReport | null,
	facts: TelemetryFacts,
): { checks: CheckResult[]; criticalFailure: boolean } {
	const checks: CheckResult[] = [];

	// ── 0. Was a report produced ─────────────────────────
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

	// ── 1. Dangerous error check (the most important) ────
	//
	// Check this first. An agent that calls a real fall nominal
	// is unusable even with full marks everywhere else.
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

	// ── 2. Classification correctness ───────────────────
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

	// ── 3. Was the time window found ────────────────────
	if (testCase.trueWindow) {
		const { start_ms: ts, end_ms: te } = testCase.trueWindow;
		const rs = report.window_start_ms;
		const re = report.window_end_ms;

		// Overlap counts as correct. Exact agreement is not required, because "when the event began" is genuinely open to interpretation.
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

	// ── 4. Was evidence cited ───────────────────────────
	checks.push({
		name: "has_evidence",
		passed: report.evidence.length >= 2,
		weight: 1,
		detail: `${report.evidence.length} 條證據`,
	});

	// ── 5. Are the cited numbers real (catching hallucination) ──
	//
	// Compare the numbers in evidence against the real peaks. A 15% tolerance is allowed,
	// because the model may cite an interval average or round slightly.
	const cited = report.evidence.flatMap(extractNumbers);
	const realValues = Object.values(facts.peaks);
	const plausible = cited.filter((n) =>
		// A timestamp (0..duration) or something close to a real peak both count as reasonable
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

	// ── 6. Was what should be mentioned mentioned (data quality awareness) ──
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

	// ── 7. Confidence calibration ───────────────────────
	//
	// Reporting high confidence when the data has a problem is a calibration failure.
	// ⚠️ This used to look at the presence of `testCase.mustMention`,
	// that is, using "were certain keywords required" as a proxy for "does the data have a problem".
	// Adding the two-events case (which uses mustMention to check "was the earlier stumble mentioned")
	// made it misjudge: the data was perfectly clean and high confidence still lost points.
	// It now looks at an explicit `dataQualityIssue`.
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
