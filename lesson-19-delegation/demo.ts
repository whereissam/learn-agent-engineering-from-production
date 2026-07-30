/**
 * Lesson 19 - 委派的四個機制（不用金鑰）
 *
 *   isolation  子 agent 到底看得到什麼
 *   blocklist  子 agent 不准做的五件事，以及關掉之後
 *   approval   子 agent 那一側沒有人可以批准
 *   locate     出錯的時候，看不看得出是哪一步壞了
 *
 * 執行：
 *   bun run lesson-19
 *   bun run lesson-19 blocklist
 *   BLOCK=off bun run lesson-19 blocklist     # 遞迴委派
 *   APPROVE=auto bun run lesson-19 approval   # 子 agent 自己按了 y
 *
 * 每個情境的腳本 provider 都寫在情境旁邊（五行），沒有抽成共用檔案：
 * 抽出去之後要讀兩個地方才知道這一段在演什麼，而共用的部分只有樣板。
 */

import { BLOCKED_FOR_CHILDREN, runChild } from "./delegate.ts";
import type { ModelResponse, StreamEvent, StreamingProvider, ToolSpec } from "../shared/streaming/types.ts";

const BLOCK_ON = process.env.BLOCK !== "off";
const APPROVAL = process.env.APPROVE === "auto" ? "auto-approve" : "deny";

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;

const TOOLS: ToolSpec[] = [
	{ name: "read_file", description: "Read a file.", parameters: { type: "object", properties: { path: { type: "string" } } } },
	{ name: "write_file", description: "Write a file.", parameters: { type: "object", properties: { path: { type: "string" } } } },
	{ name: "delegate_task", description: "Delegate.", parameters: { type: "object", properties: { goal: { type: "string" } } } },
	{ name: "memory", description: "Write to shared MEMORY.md.", parameters: { type: "object", properties: { text: { type: "string" } } } },
	{ name: "cronjob", description: "Schedule work.", parameters: { type: "object", properties: { prompt: { type: "string" } } } },
	{ name: "clarify", description: "Ask the user a question.", parameters: { type: "object", properties: { question: { type: "string" } } } },
];

/** 一個只會照著劇本走的 provider。 */
function scripted(beats: { say: string; tool?: { name: string; args: Record<string, unknown> } }[]): StreamingProvider {
	let step = 0;
	const provider: StreamingProvider = {
		name: "fake",
		model: "scripted-delegation",
		async *stream(): AsyncIterable<StreamEvent> {
			const beat = beats[Math.min(step++, beats.length - 1)] as (typeof beats)[number];
			const blocks: ModelResponse["blocks"] = [{ type: "text", text: beat.say }];
			if (beat.tool) {
				blocks.push({ type: "toolCall", id: `c${step}`, name: beat.tool.name, args: beat.tool.args });
			}
			yield {
				type: "done",
				response: { blocks, raw: null, stopReason: beat.tool ? "tool_use" : "end", usage: { input: 100, output: 20, total: 140 } },
			};
		},
		async call() {
			return { blocks: [], raw: null, stopReason: "end" };
		},
	};
	return provider;
}

// ─────────────────────────────────────────────────────────────
// 1. isolation
// ─────────────────────────────────────────────────────────────

async function scenarioIsolation(): Promise<void> {
	console.log(`\n${bold("── isolation · 子 agent 看得到什麼")}`);

	// 父 agent 的對話裡有一件只有它知道的事。
	const parentHistory = [
		"使用者：我們的 staging 環境從上週開始就一直噴 E-118。",
		"使用者：喔對了，**staging 的資料是假的，不要拿去做結論**。",
		"助理：了解，我看一下 logs/。",
	];

	console.log(dim("  父 agent 的對話："));
	for (const line of parentHistory) console.log(dim(`    │ ${line}`));

	const seen: string[] = [];
	const provider = scripted([
		{ say: "我看一下。", tool: { name: "read_file", args: { path: "logs/inventory.log" } } },
		{ say: "inventory 最常見的是 E-118，共 11 次。" },
	]);

	const child = await runChild(
		{ goal: "統計 logs/inventory.log 裡最常出現的錯誤碼", context: "檔案在 workspace 底下。" },
		{
			provider,
			tools: TOOLS,
			execute: async (name, args) => {
				seen.push(`${name}(${JSON.stringify(args)})`);
				return "2026-07-11T03:00:00Z ERROR E-118 …（11 筆）";
			},
		},
	);

	console.log(`\n  ${bold("子 agent 的整個 context：")}`);
	console.log(cyan(`    │ ${child.goal}`));
	console.log(cyan("    │ Context: 檔案在 workspace 底下。"));

	const leaked = parentHistory.some((line) => child.goal.includes(line));
	console.log(
		`\n  「staging 的資料是假的」有沒有跨過去：${leaked ? red("有") : green("沒有")}`,
	);
	console.log(dim(`  子 agent 的摘要：${child.summary}`));

	console.log(
		yellow(
			"\n  ⚠ 這既是功能也是 bug，取決於那句話重不重要。\n" +
				"    父 agent 的 context 不會被子 agent 的十次工具呼叫塞爆（功能），\n" +
				"    但子 agent 也不知道那份資料是假的（bug）。\n" +
				"    **決定哪些東西要放進 context 參數的是父 agent，而它常常會忘。**",
		),
	);
}

// ─────────────────────────────────────────────────────────────
// 2. blocklist
// ─────────────────────────────────────────────────────────────

async function scenarioBlocklist(): Promise<void> {
	console.log(`\n${bold("── blocklist · 子 agent 不准做的五件事")}`);
	console.log(dim(`  BLOCK=${BLOCK_ON ? "on" : "off"}`));

	console.log(dim("\n  五個被擋的工具，五個不同的理由："));
	for (const [tool, reason] of [
		["delegate_task", "資源：會指數展開"],
		["clarify", "通道：子 agent 那一側沒有使用者"],
		["memory", "共用狀態：誰都能寫的話，隔離是假的"],
		["send_message", "外部副作用：收不回來，而且父 agent 不知情"],
		["cronjob", "身分：用父 agent 的名義排未來的工作"],
	]) {
		console.log(`    ${dim(String(tool).padEnd(15))}${dim(String(reason))}`);
	}

	// 子 agent 拿到的工具清單裡就沒有它們。
	const available = BLOCK_ON ? TOOLS.filter((t) => !BLOCKED_FOR_CHILDREN.has(t.name)) : TOOLS;
	console.log(
		`\n  子 agent 拿到的工具：${available.map((t) => t.name).join(", ")}`,
	);

	// ── 遞迴 ────────────────────────────────────────────────
	let spawned = 0;
	const DEPTH_CAP = 4;

	async function spawn(depth: number): Promise<void> {
		if (depth > DEPTH_CAP) return;
		spawned++;
		const provider = scripted([
			{ say: "這件事太大了，我再拆成兩個子任務。", tool: { name: "delegate_task", args: { goal: `子任務 d${depth}` } } },
			{ say: "做完了。" },
		]);
		const child = await runChild(
			{ goal: `深度 ${depth} 的任務` },
			{
				provider,
				tools: TOOLS,
				blocklist: BLOCK_ON,
				execute: async (name) => {
					if (name === "delegate_task") {
						// 沒有 blocklist 的話，子 agent 真的可以再叫子 agent。
						await spawn(depth + 1);
						await spawn(depth + 1);
						return "done";
					}
					return "ok";
				},
			},
		);
		if (child.blockedAttempts.length > 0 && depth === 1) {
			console.log(dim(`  子 agent 想叫 ${child.blockedAttempts.join(", ")}，被擋下來了`));
		}
	}

	await spawn(1);

	console.log(
		`\n  總共產生了 ${BLOCK_ON ? green(String(spawned)) : red(String(spawned))} 個子 agent` +
			dim(`（深度上限 ${DEPTH_CAP}、每層 2 個）`),
	);
	if (!BLOCK_ON) {
		console.log(
			red("  ⚠ 每一個都在燒 token，而且父 agent 只看得到最上面那一層的摘要。"),
		);
		console.log(
			dim("    真實情況沒有深度上限，是 API quota 或錢包當上限。"),
		);
	}
}

// ─────────────────────────────────────────────────────────────
// 3. approval
// ─────────────────────────────────────────────────────────────

async function scenarioApproval(): Promise<void> {
	console.log(`\n${bold("── approval · 子 agent 那一側沒有人")}`);
	console.log(dim(`  APPROVE=${APPROVAL}`));

	const written: string[] = [];
	const provider = scripted([
		{ say: "我把結論寫進報告。", tool: { name: "write_file", args: { path: "report.md" } } },
		{ say: "完成。" },
	]);

	const child = await runChild(
		{ goal: "統計錯誤碼，把結果寫成 report.md" },
		{
			provider,
			tools: TOOLS,
			approval: APPROVAL,
			execute: async (name, args) => {
				if (name === "write_file") written.push(String(args.path));
				return "ok";
			},
		},
	);

	console.log(`  實際寫出去的檔案：${written.length === 0 ? green("（沒有）") : red(written.join(", "))}`);
	console.log(dim(`  子 agent 說：${child.summary}`));

	if (APPROVAL === "deny") {
		console.log(
			green("\n  ✓ 預設拒絕。") +
				dim("Hermes 的理由有兩層（delegate_tool.py:60-76）：\n" +
					"    安全　子 agent 的動作沒有人看得到，不該有副作用\n" +
					"    活性　worker thread 拿不到互動式 callback，掉回 input() 會跟父進程的 TUI 搶 stdin **死鎖**"),
		);
	} else {
		console.log(
			red("\n  ⚠ 自動批准：檔案真的被寫出去了，而且從頭到尾沒有人看到那個要求。"),
		);
		console.log(dim("    Hermes 有這個開關（`delegation.subagent_auto_approve`），預設 false，註解寫 opt-in YOLO。"));
	}
}

// ─────────────────────────────────────────────────────────────
// 4. locate
// ─────────────────────────────────────────────────────────────

async function scenarioLocate(): Promise<void> {
	console.log(`\n${bold("── locate · 出錯的時候看得出是哪一步嗎")}`);

	const goals = ["統計 checkout 的錯誤碼", "統計 inventory 的錯誤碼", "統計 notify 的錯誤碼"];
	const results: { goal: string; toolFailed: boolean; summary: string }[] = [];

	for (const [index, goal] of goals.entries()) {
		// 第二個子 agent 的檔案讀不到，**但它的劇本照樣給出一個數字** ——
		// 這正是模型真的會做的事（Lesson 8 那個「謊報完成」的家族）。
		const broken = index === 1;
		const provider = scripted([
			{ say: "讀檔。", tool: { name: "read_file", args: { path: `logs/${index}.log` } } },
			{ say: broken ? "最常見的是 E-118。" : `最常見的是 E-${400 + index}。` },
		]);

		// 真相由 demo 自己記，不是問子 agent —— 問它就等於相信它。
		let toolFailed = false;
		const child = await runChild(
			{ goal },
			{
				provider,
				tools: TOOLS,
				execute: async () => {
					if (broken) {
						toolFailed = true;
						throw new Error("ENOENT: logs/inventory.log");
					}
					return "…";
				},
			},
		);
		results.push({ goal, toolFailed, summary: child.summary });
	}

	console.log(dim("\n  真相（demo 自己記的）　　　　父 agent 收到的 tool result："));
	for (const row of results) {
		console.log(
			`    ${row.goal.padEnd(24)} ${row.toolFailed ? red("工具失敗") : green("工具成功")}　${dim(row.summary)}`,
		);
	}

	console.log(
		yellow(
			"\n  ⚠ 這裡有一個委派特有的失敗：**子 agent 把失敗吞掉了。**\n" +
				"    檔案讀不到 → 工具回一個 isError 的字串 → 但那是**子 agent 的** context，\n" +
				"    它可以選擇在摘要裡不提，然後父 agent 收到一段看起來正常的摘要。",
		),
	);
	console.log(
		dim(
			"\n  委派讓「哪一步壞了」變得好定位（每個子任務有名字），\n" +
				"  同時讓「有沒有壞」變得難偵測（中間隔了一層自然語言摘要）。\n" +
				"  → 這正是 Lesson 29 的結論在委派上的版本：**摘要不是證據。**",
		),
	);
}

// ─────────────────────────────────────────────────────────────

const SCENARIOS: Record<string, () => Promise<void>> = {
	isolation: scenarioIsolation,
	blocklist: scenarioBlocklist,
	approval: scenarioApproval,
	locate: scenarioLocate,
};

async function main(): Promise<void> {
	const only = process.argv[2];
	const names = only ? [only] : Object.keys(SCENARIOS);
	for (const name of names) {
		const scenario = SCENARIOS[name];
		if (!scenario) {
			console.error(`不認得的情境：${name}。可用：${Object.keys(SCENARIOS).join(", ")}`);
			process.exitCode = 1;
			return;
		}
		await scenario();
	}
	console.log(
		dim("\n（真模型的成本比較在 `MODE=delegate PROVIDER=gemini bun run lesson-19:agent`）"),
	);
}

await main();
