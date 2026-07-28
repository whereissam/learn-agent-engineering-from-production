/**
 * Lesson 7: 評估執行器
 *
 * 對每一個案例跑一次 agent，然後用確定性的規則評分。
 *
 * 執行：
 *   bun run lesson-07-evaluation/eval.ts                跑全部案例
 *   bun run lesson-07-evaluation/eval.ts real-fall      只跑一個
 *   bun run lesson-07-evaluation/eval.ts --save base    存成基準，之後可以比較
 *   bun run lesson-07-evaluation/eval.ts --compare base 跟基準比，看有沒有退步
 */

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runTurn } from "../lesson-06-domain-tools/agent.ts";
import { REPORT_DIR } from "../lesson-06-domain-tools/tools/report.ts";
import { fakeTelemetryProvider } from "../lesson-06-domain-tools/fake-provider.ts";
import { selectStreamingProvider } from "../shared/streaming/index.ts";
import type { StreamingProvider } from "../shared/streaming/types.ts";

/**
 * 跟 Lesson 6 一樣自備 fake provider。
 *
 * ⚠️ 用 `PROVIDER=fake` 跑評估**只能驗證管線本身有沒有壞**
 * （案例讀得到嗎、rubric 算得出來嗎、`--save` / `--compare` 正常嗎），
 * **不能拿來判斷 agent 好不好**——假 provider 每個案例都演同一套動作，
 * 分數沒有意義。真正的評估一定要用真模型。
 */
function selectProvider(): StreamingProvider {
	if (process.env.PROVIDER?.toLowerCase() === "fake") return fakeTelemetryProvider();
	return selectStreamingProvider();
}
import type { Message } from "../shared/streaming/types.ts";
import type { ToolContext } from "../shared/tools/index.ts";
import { CASES, type EvalCase, type IncidentReport } from "./cases.ts";
import { type CaseResult, gradeReport, scoreOf, type TelemetryFacts } from "./rubric.ts";

const RESULTS_DIR = resolve(import.meta.dirname, "results");
const DATA_DIR = resolve(import.meta.dirname, "../lesson-06-domain-tools/data/sessions");

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;

// ─────────────────────────────────────────────────────────────
// 從真實資料算出「事實」，用來驗證模型引用的數字
// ─────────────────────────────────────────────────────────────

async function loadFacts(sessionId: string): Promise<TelemetryFacts> {
	const raw = await readFile(resolve(DATA_DIR, `${sessionId}.jsonl`), "utf8");
	const samples = raw
		.split("\n")
		.filter((l) => l.trim())
		.map((l) => JSON.parse(l) as Record<string, number>);

	const fields = ["imu_pitch_deg", "imu_roll_deg", "imu_accel_z", "joint_torque_max"];
	const peaks: Record<string, number> = {};
	for (const f of fields) {
		peaks[f] = Math.max(...samples.map((s) => Math.abs(s[f] ?? 0)));
	}

	return { peaks, durationMs: Math.max(...samples.map((s) => s.t_ms ?? 0)) };
}

// ─────────────────────────────────────────────────────────────
// 跑一個案例
// ─────────────────────────────────────────────────────────────

async function runCase(testCase: EvalCase): Promise<CaseResult> {
	const provider = selectProvider();
	const started = Date.now();

	// 每個案例都從乾淨的報告目錄開始，
	// 不然會讀到上一次跑的結果，測試就失去意義。
	const reportPath = resolve(REPORT_DIR, `${testCase.sessionId}.json`);
	await rm(reportPath, { force: true });

	let toolCalls = 0;

	const ctx: ToolContext = {
		root: DATA_DIR,
		// 評估時全部自動批准。真實的批准流程要另外測。
		approve: async () => {
			toolCalls++;
			return true;
		},
		log: () => {},
	};

	const messages: Message[] = [
		{ role: "user", text: `Session ${testCase.sessionId}。${testCase.prompt}` },
	];

	// 重試。
	//
	// 真實的 API 會偶發失敗（我實測到 Gemini 會間歇性回 400 no body，
	// 同一個案例手動跑又完全正常）。沒有重試的話，你的評估分數會混進
	// 網路噪音，然後你會以為是 prompt 改壞了。
	//
	// 重點：只重試「基礎設施錯誤」，不要重試「模型答錯」。
	// 模型答錯就是答錯，重試到它答對只是在自欺欺人。
	const MAX_ATTEMPTS = 3;
	let error: string | undefined;

	for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
		const controller = new AbortController();
		// 單一嘗試的硬性上限，避免一個壞掉的案例卡住整輪評估
		const timer = setTimeout(() => controller.abort(), 180_000);

		// 每次重試都從乾淨的對話開始
		messages.length = 0;
		messages.push({ role: "user", text: `Session ${testCase.sessionId}。${testCase.prompt}` });

		try {
			await runTurn(provider, messages, ctx, controller.signal, /* quiet */ true);
			error = undefined;
			break;
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
			if (attempt < MAX_ATTEMPTS) {
				// 指數退避
				await new Promise((r) => setTimeout(r, 1000 * 2 ** (attempt - 1)));
			}
		} finally {
			clearTimeout(timer);
		}
	}

	// 數一下總共呼叫了幾次工具（含唯讀的）
	toolCalls = messages
		.filter((m) => m.role === "assistant")
		.reduce((n, m) => n + (m.role === "assistant" ? m.blocks.filter((b) => b.type === "toolCall").length : 0), 0);

	let report: IncidentReport | null = null;
	try {
		report = JSON.parse(await readFile(reportPath, "utf8")) as IncidentReport;
	} catch {
		// 沒寫報告，report 保持 null，rubric 會判定失敗
	}

	const facts = await loadFacts(testCase.sessionId);
	const { checks, criticalFailure } = gradeReport(testCase, report, facts);
	const { score, maxScore } = scoreOf(checks);

	return {
		caseId: testCase.id,
		sessionId: testCase.sessionId,
		report,
		checks,
		score,
		maxScore,
		// 通過的條件：沒有危險錯誤，而且分數達 70%
		passed: !criticalFailure && score / maxScore >= 0.7,
		criticalFailure,
		toolCalls,
		elapsedMs: Date.now() - started,
		error,
	};
}

// ─────────────────────────────────────────────────────────────
// 輸出
// ─────────────────────────────────────────────────────────────

function printCase(result: CaseResult): void {
	const pct = Math.round((result.score / result.maxScore) * 100);
	const badge = result.criticalFailure
		? red("CRITICAL")
		: result.passed
			? green("PASS")
			: yellow("FAIL");

	console.log(
		`${badge}  ${bold(result.caseId.padEnd(20))} ${String(pct).padStart(3)}%  ` +
			`${result.score}/${result.maxScore}  ${result.toolCalls} calls  ${(result.elapsedMs / 1000).toFixed(1)}s`,
	);

	for (const check of result.checks) {
		const mark = check.passed ? green("  ✓") : check.critical ? red("  ✗") : yellow("  ✗");
		console.log(`${mark} ${check.name.padEnd(30)} ${dim(check.detail)}`);
	}

	if (result.error) console.log(red(`    error: ${result.error}`));
	console.log();
}

function printSummary(results: CaseResult[]): void {
	const passed = results.filter((r) => r.passed).length;
	const critical = results.filter((r) => r.criticalFailure).length;
	const totalScore = results.reduce((n, r) => n + r.score, 0);
	const totalMax = results.reduce((n, r) => n + r.maxScore, 0);
	const totalCalls = results.reduce((n, r) => n + r.toolCalls, 0);
	const totalMs = results.reduce((n, r) => n + r.elapsedMs, 0);

	console.log(bold("─".repeat(64)));
	console.log(
		bold(`通過 ${passed}/${results.length}   `) +
			`總分 ${totalScore}/${totalMax} (${Math.round((totalScore / totalMax) * 100)}%)   ` +
			`${totalCalls} 次工具呼叫   ${(totalMs / 1000).toFixed(1)}s`,
	);
	if (critical > 0) {
		console.log(red(bold(`⚠  ${critical} 個案例有危險錯誤，這比分數低嚴重得多`)));
	}
}

// ─────────────────────────────────────────────────────────────
// 基準比較（回歸測試）
// ─────────────────────────────────────────────────────────────

interface Baseline {
	label: string;
	savedAt: string;
	provider: string;
	model: string;
	cases: Array<{ caseId: string; score: number; maxScore: number; passed: boolean }>;
}

async function saveBaseline(label: string, results: CaseResult[]): Promise<void> {
	const provider = selectProvider();
	const baseline: Baseline = {
		label,
		savedAt: new Date().toISOString(),
		provider: provider.name,
		model: provider.model,
		cases: results.map((r) => ({
			caseId: r.caseId,
			score: r.score,
			maxScore: r.maxScore,
			passed: r.passed,
		})),
	};
	await mkdir(RESULTS_DIR, { recursive: true });
	await writeFile(
		resolve(RESULTS_DIR, `${label}.json`),
		`${JSON.stringify(baseline, null, 2)}\n`,
		"utf8",
	);
	console.log(dim(`\n已存成基準 "${label}"`));
}

async function compareBaseline(label: string, results: CaseResult[]): Promise<void> {
	let baseline: Baseline;
	try {
		baseline = JSON.parse(await readFile(resolve(RESULTS_DIR, `${label}.json`), "utf8")) as Baseline;
	} catch {
		console.log(red(`\n找不到基準 "${label}"。先跑一次 --save ${label}`));
		return;
	}

	console.log(bold(`\n跟基準 "${label}" 比較`));
	console.log(dim(`基準：${baseline.provider}/${baseline.model}  ${baseline.savedAt}`));
	console.log();

	let regressions = 0;
	for (const current of results) {
		const before = baseline.cases.find((c) => c.caseId === current.caseId);
		if (!before) {
			console.log(dim(`  ${current.caseId.padEnd(20)} 新案例`));
			continue;
		}

		const delta = current.score - before.score;
		const arrow = delta > 0 ? green(`+${delta}`) : delta < 0 ? red(String(delta)) : dim("±0");
		const flag =
			before.passed && !current.passed
				? red("  ← 退步！本來會過，現在不過")
				: !before.passed && current.passed
					? green("  ← 修好了")
					: "";

		if (before.passed && !current.passed) regressions++;

		console.log(
			`  ${current.caseId.padEnd(20)} ${before.score} → ${current.score}  ${arrow}${flag}`,
		);
	}

	console.log();
	if (regressions > 0) {
		console.log(red(bold(`⚠  ${regressions} 個案例退步了`)));
		process.exitCode = 1; // 讓 CI 可以擋
	} else {
		console.log(green("沒有退步"));
	}
}

// ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	const saveIdx = args.indexOf("--save");
	const compareIdx = args.indexOf("--compare");
	const saveLabel = saveIdx >= 0 ? args[saveIdx + 1] : undefined;
	const compareLabel = compareIdx >= 0 ? args[compareIdx + 1] : undefined;

	// 只有旗標真的存在時，才把它後面那個值排除掉。
	// （寫成 `i !== saveIdx + 1` 會有 off-by-one：旗標不存在時 saveIdx 是 -1，
	//  -1 + 1 = 0，於是第一個位置參數就被吃掉了。這是我實測才發現的。）
	const consumed = new Set<number>();
	if (saveIdx >= 0) consumed.add(saveIdx + 1);
	if (compareIdx >= 0) consumed.add(compareIdx + 1);

	const filters = args.filter((a, i) => !a.startsWith("--") && !consumed.has(i));

	const selected = filters.length > 0 ? CASES.filter((c) => filters.includes(c.id)) : CASES;

	if (selected.length === 0) {
		console.log(red(`沒有符合的案例。可用：${CASES.map((c) => c.id).join(", ")}`));
		process.exit(1);
	}

	const provider = selectProvider();
	console.log(dim(`provider: ${provider.name}  model: ${provider.model}`));
	console.log(dim(`跑 ${selected.length} 個案例\n`));

	const results: CaseResult[] = [];
	for (const testCase of selected) {
		process.stdout.write(dim(`跑 ${testCase.id}… `));
		const result = await runCase(testCase);
		process.stdout.write("\r\x1b[K"); // 清掉那一行
		printCase(result);
		results.push(result);
	}

	printSummary(results);

	if (saveLabel) await saveBaseline(saveLabel, results);
	if (compareLabel) await compareBaseline(compareLabel, results);
}

try {
	await main();
} catch (error) {
	console.error(`\n${error instanceof Error ? error.message : String(error)}`);
	process.exit(1);
}
