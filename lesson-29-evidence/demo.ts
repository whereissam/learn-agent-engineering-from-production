/**
 * Lesson 29 - a model's self-report is not evidence of completion
 *
 * Five scenarios, each printing the same table when it finishes:
 *
 *     the model says      the assistant's final passage
 *     the tools say       what each call reported
 *     the filesystem says which files really changed between snapshots
 *
 * Run:
 *   bun run lesson-29                         # five scenarios (no key)
 *   bun run lesson-29 revert                  # one scenario only
 *   CAPTURE=first-tool bun run lesson-29      # take the baseline late and watch scenario 5 break
 *
 * The verdict is deterministic: `compare()` in `evidence.ts` does three set operations.
 * No LLM judge — a lesson claiming "do not treat a model's words as evidence"
 * that used a model to judge the result would contradict itself.
 */

import { PermissionEngine } from "../shared/permissions/engine.ts";
import type { Message } from "../shared/streaming/types.ts";
import {
	editFileTool,
	listFilesTool,
	readFileTool,
	runCommandTool,
	type ToolContext,
	ToolRegistry,
	writeFileTool,
} from "../shared/tools/index.ts";
import type { Finding } from "./evidence.ts";
import { hasStructuralDivergence } from "./evidence.ts";
import { type CapturePoint, runTurn } from "./loop.ts";
import { type Scenario, SCENARIOS, scriptedProvider } from "./fake-provider.ts";
import { Snapshot } from "./snapshot.ts";
import { GITDIR, resetWorkspace, WORKSPACE } from "./workspace.ts";

const SYSTEM_PROMPT = `You are a coding agent working in a small TypeScript workspace.

Available tools: list_files, read_file, write_file, edit_file, run_command.

Working rules:
- Always read_file before you edit it.

Answer in the same language the user writes in.`;

const CAPTURE = (process.env.CAPTURE as CapturePoint | undefined) ?? "pre-stream";

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;

const registry = new ToolRegistry([
	listFilesTool,
	readFileTool,
	writeFileTool,
	editFileTool,
	runCommandTool,
]);

async function runScenario(scenario: Scenario): Promise<Finding[]> {
		// Every scenario starts from a clean workspace. Changes left by the previous scenario
		// would go straight into this one's patch, and the measurement would mean nothing.
	await resetWorkspace();

	const snapshot = new Snapshot({ workspace: WORKSPACE, gitdir: GITDIR });
	const engine = new PermissionEngine({
		workspaceRoot: WORKSPACE,
		mode: scenario.mode,
		allowedCommands: ["ls", "cat", "git status"],
	});

	const ctx: ToolContext = {
		root: WORKSPACE,
		approve: async () => true, // 引擎已經決定過了
		log: () => {},
	};

	const messages: Message[] = [{ role: "user", text: scenario.question }];

	console.log(`\n${bold(`── ${scenario.id} · ${scenario.title}`)}`);
	console.log(dim(`   模式 ${scenario.mode}　批准 ${scenario.approve ? "y" : "n"}　抓取點 ${CAPTURE}`));
	console.log(`${cyan("你")} ${scenario.question}`);

	const outcome = await runTurn({
		provider: scriptedProvider(scenario.script),
		registry,
		engine,
		snapshot,
		messages,
		ctx,
		ask: async () => scenario.approve,
		signal: new AbortController().signal,
		system: SYSTEM_PROMPT,
		capture: CAPTURE,
	});

	report(scenario, outcome.record.claim, outcome.findings, outcome.record.toolResults, outcome.record.patch.files);
	return outcome.findings;
}

function report(
	scenario: Scenario,
	claim: string,
	findings: Finding[],
	toolResults: { name: string; path?: string; ok: boolean; mutating: boolean }[],
	files: string[],
): void {
	const writes = toolResults.filter((r) => r.mutating);

	console.log(`\n  ${bold("三份紀錄")}`);
	console.log(`    模型說　　  ${JSON.stringify(oneLine(claim))}`);
	console.log(
		`    工具說　　  ${
			writes.length === 0
				? dim("（沒有會改東西的工具呼叫）")
				: writes
						.map((r) => `${r.ok ? green("✓") : red("✗")} ${r.name}(${r.path ?? "?"})`)
						.join("  ")
		}`,
	);
	console.log(
		`    檔案系統說  ${files.length === 0 ? red("（沒有任何檔案變更）") : green(files.join("  "))}`,
	);

	console.log(`\n  ${bold("分歧")}${dim(`　期望：${scenario.expect}`)}`);
	if (findings.length === 0) {
		console.log(`    ${green("沒有分歧")}`);
	}
	for (const finding of findings) {
		const tag = finding.strength === "structural" ? red(`[${finding.kind}]`) : yellow(`[${finding.kind}]`);
		console.log(`    ${tag} ${finding.detail}`);
	}
}

function oneLine(text: string): string {
	const flat = text.replace(/\s+/g, " ").trim();
	return flat.length > 68 ? `${flat.slice(0, 68)}…` : flat;
}

// ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
	const only = process.argv[2];
	const chosen = only ? SCENARIOS.filter((s) => s.id === only) : SCENARIOS;

	if (chosen.length === 0) {
		console.error(`不認得的情境：${only}。可用：${SCENARIOS.map((s) => s.id).join(", ")}`);
		process.exitCode = 1;
		return;
	}

	console.log(dim(`workspace: ${WORKSPACE}`));
	console.log(dim(`影子 git:  ${GITDIR}（不是這個 repo 的 .git）`));

	const summary: { id: string; structural: boolean; kinds: string }[] = [];

	for (const scenario of chosen) {
		const findings = await runScenario(scenario);
		summary.push({
			id: scenario.id,
			structural: hasStructuralDivergence(findings),
			kinds: findings.length === 0 ? "—" : [...new Set(findings.map((f) => f.kind))].join(", "),
		});
	}

	console.log(`\n${bold("── 總表")}`);
	console.log(dim("   情境                結構性分歧   發現"));
	for (const row of summary) {
		const flag = row.structural ? red("有") : green("無");
		console.log(`   ${row.id.padEnd(20)}${flag}          ${dim(row.kinds)}`);
	}

		// Restore the workspace afterwards, so `git status` is clean.
	await resetWorkspace();
	console.log(dim("\n（workspace 已復原）"));
}

await main();
