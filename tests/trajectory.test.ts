/**
 * Action / observation trajectory（Lesson 37）。
 *
 * 這一組守的是「換了資料結構之後，這些問題答得出來」——
 * 也就是這一課的整個主張。每一條都對應 `demo.ts` 的一個情境。
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { TrajectoryEvent } from "../lesson-37-trajectory/events.ts";
import { isFromEnvironment } from "../lesson-37-trajectory/events.ts";
import { conflictsFromChat, Trajectory } from "../lesson-37-trajectory/trajectory.ts";

let seq = 0;
const id = () => `e${++seq}`;

function action(overrides: Partial<Extract<TrajectoryEvent, { kind: "action" }>> = {}) {
	return {
		kind: "action" as const,
		id: id(),
		timestamp: 1,
		source: "agent" as const,
		thought: "…",
		toolName: "run_command",
		toolCallId: "c1",
		args: { command: "npm test" },
		llmResponseId: "r1",
		...overrides,
	};
}

describe("trajectory 查詢（Lesson 37）", () => {
	test("agent 宣稱成功、環境說失敗 → 查得出衝突", () => {
		const trajectory = new Trajectory();
		const act = action({ id: "a1" });
		trajectory.add(act);
		trajectory.add({
			kind: "observation", id: "o1", timestamp: 2, source: "environment",
			toolName: "run_command", toolCallId: "c1", actionId: "a1",
			content: "2 failing", exitCode: 1,
		});
		trajectory.add({
			kind: "message", id: "m1", timestamp: 3, source: "agent", text: "測試都過了。",
		});

		const conflicts = trajectory.conflicts();
		assert.equal(conflicts.length, 1);
		assert.equal(conflicts[0]?.exitCode, 1);
		assert.match(conflicts[0]?.claim ?? "", /都過/);
	});

	test("環境成功的時候不報衝突", () => {
		const trajectory = new Trajectory();
		trajectory.add(action({ id: "a2" }));
		trajectory.add({
			kind: "observation", id: "o2", timestamp: 2, source: "environment",
			toolName: "run_command", toolCallId: "c1", actionId: "a2",
			content: "12 passing", exitCode: 0,
		});
		trajectory.add({ kind: "message", id: "m2", timestamp: 3, source: "agent", text: "都過了。" });
		assert.deepEqual(trajectory.conflicts(), []);
	});

	test("同一個問題在聊天記錄上答不出來", () => {
		// 這一條不是在測 `conflictsFromChat` 寫得好不好，是在測
		// **那個資料結構的上限**：它只能做關鍵字比對，而且永遠不 confident。
		const trajectory = new Trajectory();
		trajectory.add(action({ id: "a3" }));
		trajectory.add({
			kind: "observation", id: "o3", timestamp: 2, source: "environment",
			toolName: "run_command", toolCallId: "c1", actionId: "a3",
			content: "2 failing", exitCode: 1,
		});
		trajectory.add({ kind: "message", id: "m3", timestamp: 3, source: "agent", text: "全部綠燈。" });

		// trajectory 照樣查得到（它看的是 exitCode，不是措辭）
		assert.equal(trajectory.conflicts().length, 1);

		// 聊天記錄：換一種說法就漏了
		const chat = conflictsFromChat(trajectory.toChatHistory());
		assert.equal(chat.claimSeen, false, "「全部綠燈」不在關鍵字表裡");
		assert.equal(chat.confident, false);
	});

	test("三種失敗分得開", () => {
		const trajectory = new Trajectory();
		trajectory.add({
			kind: "observation", id: "x1", timestamp: 1, source: "environment",
			toolName: "run_command", toolCallId: "c1", actionId: "a1", content: "boom", exitCode: 1,
		});
		trajectory.add({
			kind: "user-reject", id: "x2", timestamp: 2, source: "environment",
			toolName: "run_command", toolCallId: "c2", actionId: "a2", rejectionReason: "不要跑 rm",
		});
		trajectory.add({
			kind: "agent-error", id: "x3", timestamp: 3, source: "agent",
			toolName: "read_file", toolCallId: "c3", error: "TypeError in our own code",
		});

		assert.deepEqual(trajectory.failureKinds(), { environment: 1, rejected: 1, scaffold: 1 });

		// 攤平成聊天記錄之後就分不出來了：三個都是 toolResult。
		const results = trajectory.toChatHistory().filter((m) => m.role === "toolResult");
		assert.equal(results.length, 3);
	});

	test("agent-error 的 source 是 agent，不是 environment", () => {
		const scaffold: TrajectoryEvent = {
			kind: "agent-error", id: "x4", timestamp: 1, source: "agent",
			toolName: "read_file", toolCallId: "c1", error: "our bug",
		};
		const fromWorld: TrajectoryEvent = {
			kind: "observation", id: "x5", timestamp: 2, source: "environment",
			toolName: "read_file", toolCallId: "c2", actionId: "a1", content: "ENOENT", exitCode: 1,
		};
		assert.equal(isFromEnvironment(scaffold), false, "我們的 bug 不是世界說的");
		assert.equal(isFromEnvironment(fromWorld), true);
	});

	test("llmResponseId 分得出平行與循序", () => {
		const parallel = new Trajectory();
		for (let i = 0; i < 3; i++) parallel.add(action({ llmResponseId: "same" }));
		assert.equal(parallel.batches().size, 1);

		const sequential = new Trajectory();
		for (let i = 0; i < 3; i++) sequential.add(action({ llmResponseId: `r${i}` }));
		assert.equal(sequential.batches().size, 3);
	});

	test("沒有 observation 的 action 抓得出來（Lesson 3 的硬規則）", () => {
		const trajectory = new Trajectory();
		trajectory.add(action({ id: "a9" }));
		assert.equal(trajectory.danglingActions().length, 1);

		trajectory.add({
			kind: "user-reject", id: "o9", timestamp: 2, source: "environment",
			toolName: "run_command", toolCallId: "c1", actionId: "a9", rejectionReason: "no",
		});
		assert.deepEqual(trajectory.danglingActions(), [], "拒絕也算一種回應");
	});

	test("view 套用壓縮，trajectory 保留全部", () => {
		const trajectory = new Trajectory();
		trajectory.add({ kind: "message", id: "v1", timestamp: 1, source: "user", text: "一" });
		trajectory.add({ kind: "message", id: "v2", timestamp: 2, source: "agent", text: "二" });
		trajectory.add({
			kind: "condensation", id: "vc", timestamp: 3, source: "environment",
			forgottenIds: ["v1"], summary: "摘要",
		});

		assert.equal(trajectory.all().length, 3);
		assert.equal(trajectory.view().length, 2, "v1 被移出 LLM view");
		assert.ok(
			trajectory.all().some((event) => event.id === "v1"),
			"但它還在 trajectory 裡 —— append-only",
		);
	});

	test("JSONL 存檔再載回來，形狀不變", () => {
		const trajectory = new Trajectory();
		trajectory.add(action({ id: "j1" }));
		trajectory.add({
			kind: "user-reject", id: "j2", timestamp: 2, source: "environment",
			toolName: "run_command", toolCallId: "c1", actionId: "j1", rejectionReason: "no",
		});

		const restored = Trajectory.fromJSONL(trajectory.toJSONL());
		assert.deepEqual(restored.all(), trajectory.all());
		assert.deepEqual(restored.failureKinds(), { environment: 0, rejected: 1, scaffold: 0 });
	});
});
