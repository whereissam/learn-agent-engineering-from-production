/**
 * Lesson 16 - 路由實驗：description 被切掉之後，模型還找得到嗎？
 *
 * 這一課 Step 2 引了 Hermes 的 authoring standard，斷言非常強：
 *
 *     anything past char 60 is silently cut and never routes
 *     → 模型永遠不會知道這個 skill 能做什麼，於是永遠不會叫用它
 *
 * 這是一個關於**模型行為**的斷言。`demo.ts` 只能證明字串被 `truncate()`
 * 切掉了，證明不了「模型因此找不到它」。
 *
 * 而且這個斷言有理由懷疑：`replay-fall-window` 這個**名字本身**
 * 就帶了很多路由訊息。所以描述被切掉，模型也許照樣找得到。
 *
 * 這支程式量測它：同一個問題、同一組 skill，只有目標 skill 的
 * description 不同，看模型有沒有 load 對的那一個。
 *
 * 執行：
 *   PROVIDER=gemini bun run lesson-16:route              # 描述合格（≤60）
 *   DESC=bloated PROVIDER=gemini bun run lesson-16:route # 描述 129 字，被切
 *   DESC=useless PROVIDER=gemini bun run lesson-16:route # 描述被切成完全沒資訊
 *
 * 判定是確定性的：模型有沒有呼叫 load_skill("replay-fall-window")。
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { SkillStore } from "../shared/skills/store.ts";
import { selectStreamingProvider } from "../shared/streaming/index.ts";
import type { Message, StreamingProvider, ToolSpec } from "../shared/streaming/types.ts";

/**
 * skill 的名字。
 *
 * `NAME=opaque` 會換成一個不帶任何語意的名字。
 *
 * 這是這個實驗的**關鍵控制變因**，而且是跑完第一輪才發現需要的：
 * 用 `replay-fall-window` 這個名字時，description 不管怎麼被切,
 * 模型都照樣找得到，因為名字自己就把路由訊息講完了。
 * 要驗證「description 被切會不會壞掉」，必須先把名字的訊息拿掉。
 */
const OPAQUE_NAME = process.env.NAME?.toLowerCase() === "opaque";
const TARGET = OPAQUE_NAME ? "sk-0472" : "replay-fall-window";

/**
 * 三種描述，同一個 skill。
 *
 * - good：合格，60 字以內，講「能做什麼」
 * - bloated：129 字的行銷詞。切到 60 字之後剩下一句沒講完的廢話,
 *   **但 skill 的名字還在**，這正是要測的變因
 * - useless：切到 60 字之後連主題都看不出來。這是「最壞情況」,
 *   用來確認實驗本身有鑑別度（如果連這個都能路由，那就是名字在起作用）
 */
const DESCRIPTIONS: Record<string, string> = {
	good: "Replay a robot session around a detected fall.",
	bloated:
		"A comprehensive and powerful skill that seamlessly replays robot " +
		"sessions around detected falls with advanced telemetry analysis.",
	useless:
		"This document provides a thorough and carefully considered overview of " +
		"one of the most important capabilities available in this workspace today, " +
		"namely replaying a robot session around a detected fall.",
};

const VARIANT = (process.env.DESC ?? "good").toLowerCase();

/**
 * 干擾用的 skill。它們的描述一律合格，所以描述長度不是變因。
 *
 * 兩組的差別是**難度**，而這件事是跑完第一輪才發現必須區分的：
 *
 * - easy：四個都跟問題明顯無關。這組有一個嚴重的混淆變因,
 *   模型可以用**排除法**選出唯一不明顯錯誤的那個,
 *   根本不需要讀目標的描述。第一版就是這樣，所以測不出東西
 * - hard：四個都是機器人遙測、而且都跟「跌倒前後的感測器數值」沾邊。
 *   排除法在這裡沒有用，模型必須真的讀懂描述才選得對
 */
const DISTRACTOR_SETS: Record<string, Array<[string, string, string]>> = {
	easy: [
		["compare-sessions", "Compare two robot sessions field by field.", "逐欄位比對。"],
		["export-report", "Export an incident report as PDF.", "輸出 PDF。"],
		["tune-gait", "Adjust walking gait parameters for a robot.", "調整步態參數。"],
		["check-battery", "Check battery health across a robot fleet.", "檢查電池健康度。"],
	],
	hard: [
		["session-timeline", "Show a timeline of events in a robot session.", "列出事件時間軸。"],
		["sensor-dump", "Export raw sensor readings for a time range.", "匯出區間內的原始讀數。"],
		["fall-detector", "Detect fall events from accelerometer data.", "從加速度計偵測跌倒。"],
		["incident-summary", "Summarise what happened during an incident.", "摘要事故經過。"],
	],
};

const DISTRACTOR_MODE = (process.env.DISTRACTORS ?? "hard").toLowerCase();
const DISTRACTORS =
	DISTRACTOR_SETS[DISTRACTOR_MODE] ?? (DISTRACTOR_SETS.hard as Array<[string, string, string]>);

/** 問題刻意**不含** skill 名字裡的字，避免直接字面比對就中。 */
const QUESTION =
	"機器人 R-204 昨天在倉庫跌倒了，我想看看牠倒下去前後那段時間的感測器數值。該怎麼做？";

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;

function skillFile(name: string, description: string, body: string): string {
	return [
		"---",
		`name: ${name}`,
		`description: ${description}`,
		"version: 1.0.0",
		"author: Hermes",
		"---",
		"",
		body,
	].join("\n");
}

async function main(): Promise<void> {
	const description = DESCRIPTIONS[VARIANT];
	if (!description) {
		throw new Error(`DESC 只能是 ${Object.keys(DESCRIPTIONS).join(" / ")}`);
	}

	const dir = mkdtempSync(resolve(tmpdir(), "lesson16-"));
	writeFileSync(
		resolve(dir, `${TARGET}.md`),
		skillFile(
			TARGET,
			description,
			"1. 找出 fall 事件的時間戳\n2. 取前後各 5 秒的所有感測器欄位\n3. 對齊時間軸後輸出",
		),
	);
	for (const [name, desc, body] of DISTRACTORS) {
		writeFileSync(resolve(dir, `${name}.md`), skillFile(name, desc, body));
	}

	const store = new SkillStore({ dir });
	await store.load();
	const index = store.buildIndex();

	console.log(bold(`\nSkill 路由實驗   DESC=${VARIANT}  NAME=${OPAQUE_NAME ? "opaque" : "descriptive"}  干擾項=${DISTRACTOR_MODE}`));
	console.log(dim("─".repeat(66)));
	console.log(dim(`原始描述 ${description.length} 字元`));
	console.log(dim("模型實際看到的索引："));
	console.log(dim(index.split("\n").map((l) => `  │ ${l}`).join("\n")));
	console.log(dim("─".repeat(66)));

	const loadSkillTool: ToolSpec = {
		name: "load_skill",
		description:
			"Load the full instructions for one of the available skills before doing that task.",
		parameters: {
			type: "object",
			properties: { name: { type: "string", description: "The skill name" } },
			required: ["name"],
		},
	};

	const model: StreamingProvider = process.env.PROVIDER
		? selectStreamingProvider()
		: scriptedProvider();

	const messages: Message[] = [{ role: "user", text: QUESTION }];

	console.log(`\n${bold("問：")}${QUESTION}`);

	const loaded: string[] = [];
	let stopReason = "?";

	for await (const event of model.stream({
		system: `You are an agent that helps operators analyse robot telemetry.\n\n${index}`,
		messages,
		tools: [loadSkillTool],
		maxTokens: 2000,
	})) {
		if (event.type === "text_delta") process.stdout.write(dim(event.delta));
		if (event.type === "tool_call" && event.name === "load_skill") {
			loaded.push(String(event.args.name ?? ""));
		}
		if (event.type === "done") stopReason = event.response.stopReason;
	}

	// ── 確定性判定 ──────────────────────────────────────────
	const hit = loaded.includes(TARGET);

	console.log(bold(`\n\n判定`));
	console.log(`  模型載入了：${loaded.length ? loaded.join(", ") : dim("（沒有載入任何 skill）")}`);
	console.log(
		hit
			? `  ${green("✓ 路由成功")}：找到了 ${TARGET}`
			: `  ${red("✗ 路由失敗")}：沒有載入 ${TARGET}`,
	);
	console.log(dim(`  provider: ${model.name} / ${model.model}  stopReason=${stopReason}`));

	// Lesson 15 的教訓：沒有正常結束的話，「沒發生」不能當結論。
	if (!hit && stopReason !== "tool_use" && stopReason !== "end") {
		console.log(yellow(`  ⚠ 回覆不是正常結束（${stopReason}），這個結果不可信，請重跑`));
	}

	rmSync(dir, { recursive: true, force: true });
}

/** 沒有 key 時的腳本 provider：只示範畫面長相，不能當證據。 */
function scriptedProvider(): StreamingProvider {
	const call = { id: "s1", name: "load_skill", args: { name: TARGET } };
	const response = {
		blocks: [{ type: "toolCall" as const, ...call }],
		raw: null,
		stopReason: "tool_use" as const,
	};
	return {
		name: "fake",
		model: "scripted-routing（不能當證據）",
		async *stream() {
			yield { type: "tool_call", ...call };
			yield { type: "done", response };
		},
		async call() {
			return response;
		},
	};
}

await main();
