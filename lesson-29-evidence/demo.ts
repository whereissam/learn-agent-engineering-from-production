/**
 * Lesson 29 - 模型自述不是完成的證據
 *
 * 五個情境，每個跑完都印同一張表：
 *
 *     模型說     assistant 最後那段文字
 *     工具說     每次呼叫回報了什麼
 *     檔案系統說 snapshot 之間實際變了哪些檔案
 *
 * 執行：
 *   bun run lesson-29                         # 五個情境（不用 key）
 *   bun run lesson-29 revert                  # 只跑一個
 *   CAPTURE=first-tool bun run lesson-29      # 把基準點抓晚一步，看情境 5 壞掉
 *
 * 判定是確定性的：`evidence.ts` 的 `compare()` 做三個集合運算。
 * 沒有 LLM 裁判 —— 一課主張「不要拿模型的話當證據」，
 * 卻用模型來判斷結果，那是自打嘴巴。
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
	// 每個情境都從乾淨的 workspace 開始。上一個情境留下的變更
	// 會直接混進這一個的 patch，那樣量到的東西就沒有意義了。
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

	// 跑完把 workspace 復原，這樣 `git status` 是乾淨的。
	await resetWorkspace();
	console.log(dim("\n（workspace 已復原）"));
}

await main();
