/**
 * Lesson 37 - chat history is not enough: action / observation
 *
 * Four scenarios, each contrasting "the same history in two recordings":
 *
 *   conflict   the model says the tests passed and the environment says exit code 1
 *   failures   three failures (the environment refused / the user refused / our bug)
 *   batches    one response calling three tools, or three responses calling one each
 *   view       can you tell compaction happened afterwards
 *
 * Run:
 *   bun run lesson-37
 *   bun run lesson-37 conflict
 *
 * This lesson needs no model: what is proved is **a property of the data structure**, not model behaviour.
 * The real-model part is `bun run lesson-37:agent` (which asks a completely different question).
 */

import { Trajectory, conflictsFromChat } from "./trajectory.ts";
import type { TrajectoryEvent } from "./events.ts";

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;

let clock = 1_700_000_000_000;
const next = () => (clock += 1000);

/**
 * This trajectory reproduces **behaviour Lesson 8 really measured**:
 * the tool did not succeed and the model told the user it was done.
 * There it was a permission refusal; here it is an exit code, to demonstrate the `exitCode` field.
 */
function conflictFixture(): Trajectory {
	const trajectory = new Trajectory();
	const events: TrajectoryEvent[] = [
		{ kind: "message", id: "e1", timestamp: next(), source: "user", text: "跑一下測試，確認我的修改沒有壞掉。" },
		{
			kind: "action",
			id: "e2",
			timestamp: next(),
			source: "agent",
			thought: "先跑測試看看現在的狀態。",
			toolName: "run_command",
			toolCallId: "call_1",
			args: { command: "npm test" },
			llmResponseId: "resp_1",
		},
		{
			kind: "observation",
			id: "e3",
			timestamp: next(),
			source: "environment",
			toolName: "run_command",
			toolCallId: "call_1",
			actionId: "e2",
			content: "2 failing\n  1) store lookup is case-insensitive\n  2) analytics uses the same key\n",
			exitCode: 1,
		},
		{
			kind: "message",
			id: "e4",
			timestamp: next(),
			source: "agent",
			text: "已經跑完了，測試都過，你的修改沒有問題。",
		},
	];
	for (const event of events) trajectory.add(event);
	return trajectory;
}

function scenarioConflict(): void {
	console.log(`\n${bold("── conflict · 同一個 command，兩種說法")}`);
	const trajectory = conflictFixture();

	console.log(dim("\n  ① 聊天記錄（Lesson 1-28 的形狀）："));
	for (const message of trajectory.toChatHistory()) {
		console.log(`    ${dim(message.role.padEnd(11))}${message.content.split("\n")[0]}`);
	}
	console.log(
		dim("\n    兩種說法擠在同一個欄位形狀裡（一段字串），而且都不帶「誰說的」。"),
	);

	const chat = conflictsFromChat(trajectory.toChatHistory());
	console.log(
		`    字串比對能給的答案：看到失敗字樣 ${chat.failureSeen ? "有" : "無"}、` +
			`看到成功宣稱 ${chat.claimSeen ? "有" : "無"}、${red(`可信 ${chat.confident ? "是" : "否"}`)}`,
	);
	console.log(
		dim("    關鍵字表是我編的：換成「全部綠燈」「no failures」就漏掉了。"),
	);

	console.log(dim("\n  ② Trajectory（action / observation）："));
	for (const event of trajectory.all()) {
		const tag =
			event.source === "environment" ? green("[environment]") : cyan(`[${event.source}]`);
		const body =
			event.kind === "observation"
				? `exitCode=${event.exitCode} ${JSON.stringify(event.content.split("\n")[0])}`
				: event.kind === "action"
					? `${event.toolName}(${JSON.stringify(event.args)})`
					: event.kind === "message"
						? JSON.stringify(event.text.slice(0, 40))
						: "";
		console.log(`    ${tag.padEnd(24)} ${dim(event.kind.padEnd(12))}${body}`);
	}

	const conflicts = trajectory.conflicts();
	console.log(`\n  ${bold("同一個問題，在這個結構上是集合運算：")}`);
	for (const conflict of conflicts) {
		console.log(
			`    ${red("衝突")} ${conflict.action.toolName}(${JSON.stringify(conflict.action.args)}) → exitCode=${conflict.exitCode}`,
		);
		console.log(`         agent 之後說：${JSON.stringify(conflict.claim)}`);
	}

	console.log(
		yellow(
			"\n  ⚠ 差別不在「哪一種比較好讀」，在於**能不能被查詢**。\n" +
				"    聊天記錄上這是一個自然語言理解問題（而且答案不可信），\n" +
				"    trajectory 上這是一次 filter + join。",
		),
	);
}

// ─────────────────────────────────────────────────────────────

function failureFixture(): Trajectory {
	const trajectory = new Trajectory();
	const events: TrajectoryEvent[] = [
		{ kind: "message", id: "f1", timestamp: next(), source: "user", text: "把舊的快取清掉，然後重跑測試。" },
		{
			kind: "action", id: "f2", timestamp: next(), source: "agent",
			thought: "先刪快取。", toolName: "run_command", toolCallId: "c1",
			args: { command: "rm -rf .cache" }, llmResponseId: "r1",
		},
			// ① The user refused — with a reason, and as its own event type
		{
			kind: "user-reject", id: "f3", timestamp: next(), source: "environment",
			toolName: "run_command", toolCallId: "c1", actionId: "f2",
			rejectionReason: "使用者拒絕：rm -rf 不在允許清單上，而且 .cache 裡有還沒上傳的量測結果",
		},
		{
			kind: "action", id: "f4", timestamp: next(), source: "agent",
			thought: "那我直接跑測試。", toolName: "run_command", toolCallId: "c2",
			args: { command: "npm test" }, llmResponseId: "r2",
		},
			// ② The environment says it failed
		{
			kind: "observation", id: "f5", timestamp: next(), source: "environment",
			toolName: "run_command", toolCallId: "c2", actionId: "f4",
			content: "2 failing", exitCode: 1,
		},
		{
			kind: "action", id: "f6", timestamp: next(), source: "agent",
			thought: "看一下失敗的那個檔案。", toolName: "read_file", toolCallId: "c3",
			args: { path: "src/store.ts", offset: -5 }, llmResponseId: "r3",
		},
			// ③ Our own harness broke (source is "agent", not environment)
		{
			kind: "agent-error", id: "f7", timestamp: next(), source: "agent",
			toolName: "read_file", toolCallId: "c3",
			error: "TypeError: Cannot read properties of undefined (reading 'slice') — offset 沒有做負數檢查",
		},
	];
	for (const event of events) trajectory.add(event);
	return trajectory;
}

function scenarioFailures(): void {
	console.log(`\n${bold("── failures · 三種失敗，一個欄位裝不下")}`);
	const trajectory = failureFixture();

	console.log(dim("\n  ① 聊天記錄裡的三次失敗："));
	for (const message of trajectory.toChatHistory()) {
		if (message.role !== "toolResult") continue;
		console.log(`    ${dim("toolResult")} ${message.content.slice(0, 62)}`);
	}
	console.log(red("    三個都是 toolResult + 一段以 Error 開頭的字串。分不出來。"));

	console.log(dim("\n  ② Trajectory："));
	const kinds = trajectory.failureKinds();
	console.log(`    環境說失敗（exitCode≠0）　${kinds.environment}`);
	console.log(`    使用者拒絕（帶理由）　　　${kinds.rejected}`);
	console.log(`    ${yellow("我們自己的 bug")}　　　　　　${kinds.scaffold}`);

	console.log(
		yellow(
			"\n  ⚠ 第三種最重要：`source: \"agent\"` 說的是**鷹架壞了**，不是世界拒絕。\n" +
				"    混在一起的代價很具體：你會拿著自己的 bug 去調 prompt。",
		),
	);
	console.log(
		dim(
			"\n  而且三種的後續完全不同：\n" +
				"    環境失敗 → 可以重試或換做法\n" +
				"    使用者拒絕 → **不該重試**（Lesson 8 量到模型會連試五次）\n" +
				"    鷹架壞了 → 該修的是我們的程式，模型再聰明也沒用",
		),
	);
}

// ─────────────────────────────────────────────────────────────

function scenarioBatches(): void {
	console.log(`\n${bold("── batches · 一次回應三個工具，還是三次回應各一個")}`);

	const parallel = new Trajectory();
	for (let i = 1; i <= 3; i++) {
		parallel.add({
			kind: "action", id: `p${i}`, timestamp: next(), source: "agent",
			thought: "三個檔案一起看。", toolName: "read_file", toolCallId: `pc${i}`,
			args: { path: `src/${i}.ts` }, llmResponseId: "resp_same",
		});
	}

	const sequential = new Trajectory();
	for (let i = 1; i <= 3; i++) {
		sequential.add({
			kind: "action", id: `s${i}`, timestamp: next(), source: "agent",
			thought: "再看一個。", toolName: "read_file", toolCallId: `sc${i}`,
			args: { path: "src/store.ts" }, llmResponseId: `resp_${i}`,
		});
	}

	console.log(
		`\n  平行：${parallel.batches().size} 個 batch / ${parallel.all().length} 個動作` +
			dim("　← 一次回應叫了三個工具"),
	);
	console.log(
		`  循序：${sequential.batches().size} 個 batch / ${sequential.all().length} 個動作` +
			dim("　← 三次回應各叫一個，而且參數一樣"),
	);

	console.log(
		dim(
			"\n  聊天記錄裡兩者長得幾乎一樣（都是三則 assistant 訊息），\n" +
				"  但它們是完全不同的兩件事：",
		),
	);
	console.log(
		dim(
			"    平行 → 正常的批次操作\n" +
				"    循序 + 參數相同 → **doom loop**（Lesson 28 提到的 opencode 規則）",
		),
	);
	console.log(
		yellow(
			"\n  ⚠ 這個欄位還修掉了一個我們真的踩過的 bug：Lesson 23 那次 Gemini 不送 `index`，\n" +
				"    平行工具呼叫的 arguments 被串成一個壞字串、潛伏三課。\n" +
				"    我們是靠 `index ?? id` 補的；OpenHands 在**資料模型裡**就有「同一次回應」。",
		),
	);
}

// ─────────────────────────────────────────────────────────────

function scenarioView(): void {
	console.log(`\n${bold("── view · 壓縮完之後看不看得出壓縮過")}`);

	const trajectory = new Trajectory();
	for (let i = 1; i <= 4; i++) {
		trajectory.add({
			kind: "message", id: `v${i}`, timestamp: next(), source: i % 2 ? "user" : "agent",
			text: `第 ${i} 輪的對話內容……`,
		});
	}
	trajectory.add({
		kind: "condensation", id: "vc", timestamp: next(), source: "environment",
		forgottenIds: ["v1", "v2"],
		summary: "（摘要）使用者要修短碼大小寫不一致的 bug，已定位到 store.ts。",
	});
	trajectory.add({
		kind: "message", id: "v5", timestamp: next(), source: "user", text: "那就照你說的改。",
	});

	console.log(`\n  完整 trajectory：${trajectory.all().length} 個事件`);
	console.log(`  LLM 看到的 view：${trajectory.view().length} 個事件`);
	console.log(dim(`    被忘掉的：v1, v2　摘要：${(trajectory.all()[4] as { summary: string }).summary.slice(0, 30)}…`));

	console.log(
		yellow(
			"\n  ⚠ Lesson 5 是直接改寫訊息陣列，所以**壓縮完之後看不出壓縮過**：\n" +
				"    舊訊息不見了，而「為什麼不見」沒有留下任何紀錄。",
		),
	);
	console.log(
		dim(
			"\n  當成事件之後：\n" +
				"    trajectory  append-only，完整的事實紀錄（v1、v2 還在）\n" +
				"    view        算出來的投影，模型看到的那一份\n\n" +
				"  **壓縮從一次破壞性的改寫，變成一個可以查詢、可以還原的事件。**",
		),
	);
}

// ─────────────────────────────────────────────────────────────

const SCENARIOS: Record<string, () => void> = {
	conflict: scenarioConflict,
	failures: scenarioFailures,
	batches: scenarioBatches,
	view: scenarioView,
};

function main(): void {
	const only = process.argv[2];
	const names = only ? [only] : Object.keys(SCENARIOS);
	for (const name of names) {
		const scenario = SCENARIOS[name];
		if (!scenario) {
			console.error(`不認得的情境：${name}。可用：${Object.keys(SCENARIOS).join(", ")}`);
			process.exitCode = 1;
			return;
		}
		scenario();
	}
	console.log(
		dim("\n（真模型的部分問的是另一個問題：`PROVIDER=gemini bun run lesson-37:agent`）"),
	);
}

main();
