/**
 * Lesson 7: the evaluation runner
 *
 * Run the agent once per case, then score with deterministic rules.
 *
 * Run:
 *   bun run lesson-07-evaluation/eval.ts                every case
 *   bun run lesson-07-evaluation/eval.ts real-fall      one case only
 *   bun run lesson-07-evaluation/eval.ts --save base    save a baseline for later comparison
 *   bun run lesson-07-evaluation/eval.ts --compare base compare against the baseline and see regressions
 */

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runTurn } from "../lesson-06-domain-tools/agent.ts";
import { REPORT_DIR } from "../lesson-06-domain-tools/tools/report.ts";
import { fakeTelemetryProvider } from "../lesson-06-domain-tools/fake-provider.ts";
import { selectStreamingProvider } from "../shared/streaming/index.ts";
import type { StreamingProvider } from "../shared/streaming/types.ts";

/**
 * Like Lesson 6, this brings its own fake provider.
 *
 * ⚠️ Running the evaluation with `PROVIDER=fake` **only verifies the pipeline itself**
 * (do the cases load, does the rubric compute, do `--save` / `--compare` work),
 * **and cannot judge whether the agent is good** — the fake provider acts out the same actions
 * for every case, so the scores are meaningless. A real evaluation needs a real model.
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
// Compute "the facts" from the real data, to validate the numbers the model cites
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
// Run one case
// ─────────────────────────────────────────────────────────────

async function runCase(testCase: EvalCase): Promise<CaseResult> {
	const provider = selectProvider();
	const started = Date.now();

	// Every case starts from a clean report directory,
	// or it reads the previous run's results and the test becomes meaningless.
	const reportPath = resolve(REPORT_DIR, `${testCase.sessionId}.json`);
	await rm(reportPath, { force: true });

	let toolCalls = 0;

	const ctx: ToolContext = {
		root: DATA_DIR,
		// Everything is auto-approved during evaluation. A real approval flow is tested separately.
		approve: async () => {
			toolCalls++;
			return true;
		},
		log: () => {},
	};

	const messages: Message[] = [
		{ role: "user", text: `Session ${testCase.sessionId}。${testCase.prompt}` },
	];

	// Retries.
	//
	// A real API fails intermittently (Gemini was measured returning 400 no body sporadically,
	// while the same case run by hand worked fine). Without retries your evaluation scores mix in
	// network noise, and you conclude the prompt change broke something.
	//
	// The point: retry **infrastructure errors** only, never "the model answered wrongly".
	// A wrong answer is a wrong answer, and retrying until it is right is self-deception.
	const MAX_ATTEMPTS = 3;
	let error: string | undefined;

	for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
		const controller = new AbortController();
		// A hard cap per attempt, so one broken case cannot stall the whole evaluation
		const timer = setTimeout(() => controller.abort(), 180_000);

		// Every retry starts from a clean conversation
		messages.length = 0;
		messages.push({ role: "user", text: `Session ${testCase.sessionId}。${testCase.prompt}` });

		try {
			await runTurn(provider, messages, ctx, controller.signal, /* quiet */ true);
			error = undefined;
			break;
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
			if (attempt < MAX_ATTEMPTS) {
				// Exponential backoff
				await new Promise((r) => setTimeout(r, 1000 * 2 ** (attempt - 1)));
			}
		} finally {
			clearTimeout(timer);
		}
	}

	// Count how many tool calls there were in total (including read-only ones)
	toolCalls = messages
		.filter((m) => m.role === "assistant")
		.reduce((n, m) => n + (m.role === "assistant" ? m.blocks.filter((b) => b.type === "toolCall").length : 0), 0);

	let report: IncidentReport | null = null;
	try {
		report = JSON.parse(await readFile(reportPath, "utf8")) as IncidentReport;
	} catch {
		// No report written, so report stays null and the rubric judges it a failure
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
		// The passing condition: no dangerous error, and a score of at least 70%
		passed: !criticalFailure && score / maxScore >= 0.7,
		criticalFailure,
		toolCalls,
		elapsedMs: Date.now() - started,
		error,
	};
}

// ─────────────────────────────────────────────────────────────
// Output
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
		bold(`passed ${passed}/${results.length}   `) +
			`total ${totalScore}/${totalMax} (${Math.round((totalScore / totalMax) * 100)}%)   ` +
			`${totalCalls} tool calls   ${(totalMs / 1000).toFixed(1)}s`,
	);
	if (critical > 0) {
		console.log(red(bold(`⚠  ${critical} cases had a dangerous error, which is far worse than a low score`)));
	}
}

// ─────────────────────────────────────────────────────────────
// Baseline comparison (regression testing)
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
	console.log(dim(`\nsaved as baseline "${label}"`));
}

async function compareBaseline(label: string, results: CaseResult[]): Promise<void> {
	let baseline: Baseline;
	try {
		baseline = JSON.parse(await readFile(resolve(RESULTS_DIR, `${label}.json`), "utf8")) as Baseline;
	} catch {
		console.log(red(`\nno baseline "${label}". Run --save ${label} first`));
		return;
	}

	console.log(bold(`\ncompared against baseline "${label}"`));
	console.log(dim(`baseline: ${baseline.provider}/${baseline.model}  ${baseline.savedAt}`));
	console.log();

	let regressions = 0;
	for (const current of results) {
		const before = baseline.cases.find((c) => c.caseId === current.caseId);
		if (!before) {
			console.log(dim(`  ${current.caseId.padEnd(20)} new case`));
			continue;
		}

		const delta = current.score - before.score;
		const arrow = delta > 0 ? green(`+${delta}`) : delta < 0 ? red(String(delta)) : dim("±0");
		const flag =
			before.passed && !current.passed
				? red("  ← regression! it used to pass and now does not")
				: !before.passed && current.passed
					? green("  ← fixed")
					: "";

		if (before.passed && !current.passed) regressions++;

		console.log(
			`  ${current.caseId.padEnd(20)} ${before.score} → ${current.score}  ${arrow}${flag}`,
		);
	}

	console.log();
	if (regressions > 0) {
		console.log(red(bold(`⚠  ${regressions} cases regressed`)));
		process.exitCode = 1; // so CI can block on it
	} else {
		console.log(green("no regressions"));
	}
}

// ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	const saveIdx = args.indexOf("--save");
	const compareIdx = args.indexOf("--compare");
	const saveLabel = saveIdx >= 0 ? args[saveIdx + 1] : undefined;
	const compareLabel = compareIdx >= 0 ? args[compareIdx + 1] : undefined;

		// Only exclude the following value when the flag really exists.
		// (Writing `i !== saveIdx + 1` has an off-by-one: without the flag saveIdx is -1,
		//  and -1 + 1 = 0, so the first positional argument gets eaten. Found by measurement.)
	const consumed = new Set<number>();
	if (saveIdx >= 0) consumed.add(saveIdx + 1);
	if (compareIdx >= 0) consumed.add(compareIdx + 1);

	const filters = args.filter((a, i) => !a.startsWith("--") && !consumed.has(i));

	const selected = filters.length > 0 ? CASES.filter((c) => filters.includes(c.id)) : CASES;

	if (selected.length === 0) {
		console.log(red(`No matching case. Available: ${CASES.map((c) => c.id).join(", ")}`));
		process.exit(1);
	}

	const provider = selectProvider();
	console.log(dim(`provider: ${provider.name}  model: ${provider.model}`));
	console.log(dim(`running ${selected.length} cases\n`));

	const results: CaseResult[] = [];
	for (const testCase of selected) {
		process.stdout.write(dim(`running ${testCase.id}… `));
		const result = await runCase(testCase);
		process.stdout.write("\r\x1b[K"); // wipe that line
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
