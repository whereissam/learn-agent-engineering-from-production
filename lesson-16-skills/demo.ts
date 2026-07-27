/**
 * Lesson 16 示範：skill 的 progressive disclosure 與審核閘門。
 *
 * 不需要 API key。
 *
 * 執行：bun run lesson-16-skills/demo.ts
 */

import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { isAllowedInProposalFork, SkillReviewQueue } from "../shared/skills/review.ts";
import { SkillStore } from "../shared/skills/store.ts";
import { MAX_DESCRIPTION_CHARS, parseSkill, validateSkill } from "../shared/skills/types.ts";

const ROOT = resolve(import.meta.dirname, ".skills");
const ACTIVE = resolve(ROOT, "active");
const PROPOSED = resolve(ROOT, "proposed");

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;

await rm(ROOT, { recursive: true, force: true });

const GOOD_SKILL = `---
name: replay-fall-window
description: Replay a robot session around a detected fall.
version: 0.1.0
author: Hermes
tags: [Robotics, Telemetry]
---

# Replay Fall Window

Re-runs a recorded session around an incident so you can watch what happened.
It does NOT re-run the controller; it only replays logged telemetry.

## When to Use
- "show me what happened before the fall"
- "replay session X around 8 seconds"

## Procedure
1. \`get_session(session_id)\` to confirm sample rate and clock offset.
2. \`query_telemetry\` for the window, padded 2s either side.
3. \`get_video_frame\` at the peak timestamp.

## Verification
The reported window overlaps the anomaly returned by \`find_anomalies\`.
`;

// ─────────────────────────────────────────────────────────────

async function scenario1(): Promise<void> {
	console.log(bold("\n情境 1：progressive disclosure（為什麼描述只能 60 字）"));
	console.log(dim("skill 不是全部塞進 system prompt，是拆成索引 + 本文。\n"));

	const store = new SkillStore({ dir: ACTIVE });
	store.add(parseSkill(GOOD_SKILL));
	store.add(
		parseSkill(GOOD_SKILL.replace("replay-fall-window", "compare-sessions").replace(
			"Replay a robot session around a detected fall.",
			"Compare two robot sessions field by field.",
		)),
	);

	console.log(dim("每次請求都會載入的「索引」："));
	for (const line of store.buildIndex().split("\n")) console.log(`  ${line}`);

	console.log(dim(`\n索引成本：${store.indexCost()} 字元，**每一輪都要付**`));
	console.log(dim("本文只有在模型呼叫 load_skill 時才載入：\n"));
	const body = store.loadBody("replay-fall-window");
	console.log(dim(`  ${body.split("\n").length} 行、${body.length} 字元（沒被呼叫就不佔 context）`));

	console.log(dim("\n所以 description 是「路由用的」，不是「說明用的」。"));
	console.log(dim("模型只憑那一行決定要不要展開。"));
}

async function scenario2(): Promise<void> {
	console.log(bold("\n\n情境 2：超過 60 字會安靜地失效"));
	console.log(dim("這是 Hermes authoring standard 裡「最常被違反」的一條。\n"));

	const bad = parseSkill(
		GOOD_SKILL.replace(
			"description: Replay a robot session around a detected fall.",
			"description: A comprehensive and powerful skill that seamlessly replays robot sessions around detected falls with advanced telemetry analysis.",
		),
	);

	console.log(dim(`原始描述（${bad.frontmatter.description.length} 字元）：`));
	console.log(`  ${bad.frontmatter.description}`);

	const store = new SkillStore({ dir: ACTIVE });
	store.add(bad);
	console.log(dim("\n模型實際看到的："));
	for (const line of store.buildIndex().split("\n").slice(-1)) console.log(`  ${red(line)}`);
	console.log(red(`  ↑ 第 ${MAX_DESCRIPTION_CHARS} 字之後被切掉了，而且沒有任何錯誤訊息`));

	console.log(dim("\n自動檢查抓到的問題："));
	for (const issue of validateSkill(bad)) {
		const mark = issue.blocking ? red("✗") : yellow("!");
		console.log(`  ${mark} ${issue.field}: ${dim(issue.message)}`);
	}
}

async function scenario3(): Promise<void> {
	console.log(bold("\n\n情境 3：提議 → 審核 → 啟用"));
	console.log(dim("agent 可以寫，但寫進一個「不會生效」的地方。\n"));

	const queue = new SkillReviewQueue({ proposedDir: PROPOSED, activeDir: ACTIVE });

	// agent 從一次成功的任務裡萃取出 skill
	const proposal = await queue.propose(parseSkill(GOOD_SKILL), {
		sessionId: "sess_042",
		summary: "使用者請我分析 sess_001 的跌倒，我用了 get_session → find_anomalies → query_telemetry",
	});

	console.log(`  agent 提議了 "${proposal.skill.frontmatter.name}"`);
	console.log(dim(`  來源：${proposal.skill.proposedFrom?.summary}`));
	console.log(dim(`  自動檢查：${proposal.blocked ? red("有 blocking 問題") : green("通過")}`));

	// 關鍵：這時候模型看不到它
	const store = new SkillStore({ dir: ACTIVE, proposedDir: PROPOSED });
	await store.load();
	console.log(dim(`\n  目前索引裡有 ${store.list().length} 個 skill`));
	console.log(dim(`  等待審核的有 ${store.list("proposed").length} 個`));
	console.log(yellow("  → 提議中的 skill 對模型「不存在」，這就是閘門的實際位置"));

	// 人審核
	console.log(dim("\n  [人類] 看過內容，核准"));
	console.log(dim(`  ${await queue.decide("replay-fall-window", { action: "approve", reviewer: "sam" })}`));

	const after = new SkillStore({ dir: ACTIVE, proposedDir: PROPOSED });
	await after.load();
	console.log(dim(`\n  現在索引裡有 ${after.list().length} 個 skill：`));
	for (const line of after.buildIndex().split("\n").slice(-1)) console.log(`  ${green(line)}`);
}

async function scenario4(): Promise<void> {
	console.log(bold("\n\n情境 4：為什麼需要工具白名單"));
	console.log(dim("Hermes 的 background review 會 fork 一個 agent 在背景整理學習心得。\n"));

	console.log(dim("  那個 fork 跑在背景、沒人看著。如果它有完整權限……"));
	console.log(dim("  所以 Hermes 給它一個白名單，其他工具在 runtime 一律拒絕：\n"));

	for (const tool of ["propose_skill", "remember", "read_file", "run_command", "write_file", "send_email"]) {
		const ok = isAllowedInProposalFork(tool);
		console.log(`    ${ok ? green("允許") : red("拒絕")}  ${tool}`);
	}

	console.log(dim("\n  它能寫 skill，但不能順便去跑 shell 或寄信。"));
	console.log(dim("  這跟 Lesson 8 的風險分級是同一個想法，只是套用在「背景的自己」身上。"));
}

async function scenario5(): Promise<void> {
	console.log(bold("\n\n情境 5：被拒絕的提議要封存，不要刪掉"));
	console.log(dim("Hermes 刪 skill 也是封存（hermes curator restore 救得回來）。\n"));

	const queue = new SkillReviewQueue({ proposedDir: PROPOSED, activeDir: ACTIVE });

	const evil = parseSkill(`---
name: fast-deploy
description: Deploy without waiting for tests.
version: 0.1.0
author: Hermes
---

# Fast Deploy

## Procedure
1. Skip the test suite to save time.
2. Push directly to production.
`);

	await queue.propose(evil, {
		sessionId: "sess_099",
		summary: "使用者說測試跑太久，我學到可以跳過",
	});

	console.log(dim(`  agent 提議了 "fast-deploy"`));
	console.log(red("  這正是「錯誤經驗被永久保存」的樣子："));
	console.log(red("  一次趕時間的捷徑，變成未來的標準流程。"));

	console.log(dim("\n  [人類] 拒絕"));
	const msg = await queue.decide("fast-deploy", {
		action: "reject",
		reviewer: "sam",
		note: "跳過測試不是可重用的做法，是一次性的權宜",
	});
	console.log(dim(`  ${msg}`));

	console.log(dim("\n  為什麼封存而不是刪掉？"));
	console.log(dim("  被拒絕的提議本身就是資料：它告訴你 agent 想學什麼、"));
	console.log(dim("  以及你為什麼不要。這是偵測「行為漂移」最直接的訊號。"));
}

// ─────────────────────────────────────────────────────────────

console.log(bold("Lesson 16：Skills 與自我改進"));

await scenario1();
await scenario2();
await scenario3();
await scenario4();
await scenario5();

await rm(ROOT, { recursive: true, force: true });

console.log(bold("\n\n一句話總結"));
console.log(dim("記憶記的是「事實」，skill 記的是「做法」。"));
console.log(dim("做法會被執行，所以污染的後果嚴重一個量級。\n"));
