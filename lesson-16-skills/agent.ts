/**
 * Lesson 16 - the routing experiment: once a description is truncated, can the model still find it?
 *
 * This lesson's Step 2 quotes Hermes's authoring standard, whose assertion is very strong:
 *
 *     anything past char 60 is silently cut and never routes
 *     → the model will never know what this skill does, so it will never invoke it
 *
 * That is an assertion about **model behaviour**. `demo.ts` can only prove `truncate()`
 * cut the string; it cannot prove "and therefore the model cannot find it".
 *
 * And there is reason to doubt the assertion: the **name** `replay-fall-window`
 * itself carries plenty of routing information. So a truncated description may not matter.
 *
 * This program measures it: the same question and the same skill set, with only the target
 * skill's description differing, checking whether the model loads the right one.
 *
 * Run:
 *   PROVIDER=gemini bun run lesson-16:route              # a compliant description (≤60)
 *   DESC=bloated PROVIDER=gemini bun run lesson-16:route # a 129-character description, truncated
 *   DESC=useless PROVIDER=gemini bun run lesson-16:route # truncated to carry no information at all
 *
 * The verdict is deterministic: did the model call load_skill("replay-fall-window").
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { SkillStore } from "../shared/skills/store.ts";
import { selectStreamingProvider } from "../shared/streaming/index.ts";
import type { Message, StreamingProvider, ToolSpec } from "../shared/streaming/types.ts";

/**
 * The skill's name.
 *
 * `NAME=opaque` swaps in a name with no meaning at all.
 *
 * This is the experiment's **key control variable**, and the need for it only became clear after the first round:
 * with the name `replay-fall-window`, however the description is truncated,
 * the model still finds it, because the name states the routing information by itself.
 * Verifying "does a truncated description break it" requires removing the name's information first.
 */
const OPAQUE_NAME = process.env.NAME?.toLowerCase() === "opaque";
const TARGET = OPAQUE_NAME ? "sk-0472" : "replay-fall-window";

/**
 * Three descriptions for one skill.
 *
 * - good: compliant, within 60 characters, stating what it can do
 * - bloated: 129 characters of marketing. Truncated to 60 it leaves an unfinished platitude,
 *   **and the skill's name is still there**, which is exactly the variable under test
 * - useless: truncated to 60 it does not even reveal the topic. This is the worst case,
 *   used to confirm the experiment can discriminate (if even this routes, the name is doing the work)
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
 * Distractor skills. Their descriptions are all compliant, so description length is not a variable.
 *
 * The two groups differ in **difficulty**, and the need to distinguish them only became clear after the first round:
 *
 * - easy: all four are obviously unrelated to the question. This group has a serious confound:
 *   the model can pick the only not-obviously-wrong one by **elimination**,
 *   without reading the target's description at all. The first version did this and measured nothing
 * - hard: all four are robot telemetry and all touch "sensor values around a fall".
 *   Elimination does not help here, and the model has to actually read the descriptions to choose
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

/** The question deliberately **excludes** the words in the skill's name, so literal matching alone cannot succeed. */
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

	// ── the deterministic verdict ───────────────────────────────
	const hit = loaded.includes(TARGET);

	console.log(bold(`\n\n判定`));
	console.log(`  模型載入了：${loaded.length ? loaded.join(", ") : dim("（沒有載入任何 skill）")}`);
	console.log(
		hit
			? `  ${green("✓ 路由成功")}：找到了 ${TARGET}`
			: `  ${red("✗ 路由失敗")}：沒有載入 ${TARGET}`,
	);
	console.log(dim(`  provider: ${model.name} / ${model.model}  stopReason=${stopReason}`));

	// Lesson 15's lesson: without a normal finish, "it did not happen" is not a conclusion.
	if (!hit && stopReason !== "tool_use" && stopReason !== "end") {
		console.log(yellow(`  ⚠ 回覆不是正常結束（${stopReason}），這個結果不可信，請重跑`));
	}

	rmSync(dir, { recursive: true, force: true });
}

/** The scripted provider used without a key: it shows what the output looks like and is not evidence. */
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
