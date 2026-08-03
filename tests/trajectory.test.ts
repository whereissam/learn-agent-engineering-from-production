/**
 * Action / observation trajectory（Lesson 37）。
 *
 * This group guards "with a different data structure these questions are answerable" —
 * that is, the lesson's whole thesis. Each case matches one of `demo.ts`'s scenarios.
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

describe("trajectory queries (Lesson 37)", () => {
	test("the agent claims success and the environment says failure → the conflict is queryable", () => {
		const trajectory = new Trajectory();
		const act = action({ id: "a1" });
		trajectory.add(act);
		trajectory.add({
			kind: "observation", id: "o1", timestamp: 2, source: "environment",
			toolName: "run_command", toolCallId: "c1", actionId: "a1",
			content: "2 failing", exitCode: 1,
		});
		trajectory.add({
			kind: "message", id: "m1", timestamp: 3, source: "agent", text: "All tests passed.",
		});

		const conflicts = trajectory.conflicts();
		assert.equal(conflicts.length, 1);
		assert.equal(conflicts[0]?.exitCode, 1);
		assert.match(conflicts[0]?.claim ?? "", /passed/);
	});

	test("no conflict is reported when the environment succeeded", () => {
		const trajectory = new Trajectory();
		trajectory.add(action({ id: "a2" }));
		trajectory.add({
			kind: "observation", id: "o2", timestamp: 2, source: "environment",
			toolName: "run_command", toolCallId: "c1", actionId: "a2",
			content: "12 passing", exitCode: 0,
		});
		trajectory.add({ kind: "message", id: "m2", timestamp: 3, source: "agent", text: "They all passed." });
		assert.deepEqual(trajectory.conflicts(), []);
	});

	test("the same question is unanswerable on a chat log", () => {
			// This is not testing how well `conflictsFromChat` is written but testing
			// **that data structure's ceiling**: it can only match keywords, and it is never confident.
		const trajectory = new Trajectory();
		trajectory.add(action({ id: "a3" }));
		trajectory.add({
			kind: "observation", id: "o3", timestamp: 2, source: "environment",
			toolName: "run_command", toolCallId: "c1", actionId: "a3",
			content: "2 failing", exitCode: 1,
		});
		trajectory.add({ kind: "message", id: "m3", timestamp: 3, source: "agent", text: "Everything is green." });

			// The trajectory still finds it (it looks at exitCode, not at wording)
		assert.equal(trajectory.conflicts().length, 1);

			// The chat log: rephrase it and the detection misses
		const chat = conflictsFromChat(trajectory.toChatHistory());
		assert.equal(chat.claimSeen, false, '"everything is green" is not in the keyword list');
		assert.equal(chat.confident, false);
	});

	test("the three kinds of failure are distinguishable", () => {
		const trajectory = new Trajectory();
		trajectory.add({
			kind: "observation", id: "x1", timestamp: 1, source: "environment",
			toolName: "run_command", toolCallId: "c1", actionId: "a1", content: "boom", exitCode: 1,
		});
		trajectory.add({
			kind: "user-reject", id: "x2", timestamp: 2, source: "environment",
			toolName: "run_command", toolCallId: "c2", actionId: "a2", rejectionReason: "do not run rm",
		});
		trajectory.add({
			kind: "agent-error", id: "x3", timestamp: 3, source: "agent",
			toolName: "read_file", toolCallId: "c3", error: "TypeError in our own code",
		});

		assert.deepEqual(trajectory.failureKinds(), { environment: 1, rejected: 1, scaffold: 1 });

			// Flattened into a chat log they become indistinguishable: all three are toolResult.
		const results = trajectory.toChatHistory().filter((m) => m.role === "toolResult");
		assert.equal(results.length, 3);
	});

	test("an agent-error has source agent, not environment", () => {
		const scaffold: TrajectoryEvent = {
			kind: "agent-error", id: "x4", timestamp: 1, source: "agent",
			toolName: "read_file", toolCallId: "c1", error: "our bug",
		};
		const fromWorld: TrajectoryEvent = {
			kind: "observation", id: "x5", timestamp: 2, source: "environment",
			toolName: "read_file", toolCallId: "c2", actionId: "a1", content: "ENOENT", exitCode: 1,
		};
		assert.equal(isFromEnvironment(scaffold), false, "our own bug is not the world speaking");
		assert.equal(isFromEnvironment(fromWorld), true);
	});

	test("llmResponseId separates parallel from sequential", () => {
		const parallel = new Trajectory();
		for (let i = 0; i < 3; i++) parallel.add(action({ llmResponseId: "same" }));
		assert.equal(parallel.batches().size, 1);

		const sequential = new Trajectory();
		for (let i = 0; i < 3; i++) sequential.add(action({ llmResponseId: `r${i}` }));
		assert.equal(sequential.batches().size, 3);
	});

	test("an action with no observation is caught (Lesson 3's hard rule)", () => {
		const trajectory = new Trajectory();
		trajectory.add(action({ id: "a9" }));
		assert.equal(trajectory.danglingActions().length, 1);

		trajectory.add({
			kind: "user-reject", id: "o9", timestamp: 2, source: "environment",
			toolName: "run_command", toolCallId: "c1", actionId: "a9", rejectionReason: "no",
		});
		assert.deepEqual(trajectory.danglingActions(), [], "a rejection counts as a response");
	});

	test("the view applies compaction while the trajectory keeps everything", () => {
		const trajectory = new Trajectory();
		trajectory.add({ kind: "message", id: "v1", timestamp: 1, source: "user", text: "one" });
		trajectory.add({ kind: "message", id: "v2", timestamp: 2, source: "agent", text: "two" });
		trajectory.add({
			kind: "condensation", id: "vc", timestamp: 3, source: "environment",
			forgottenIds: ["v1"], summary: "a summary",
		});

		assert.equal(trajectory.all().length, 3);
		assert.equal(trajectory.view().length, 2, "v1 is removed from the LLM view");
		assert.ok(
			trajectory.all().some((event) => event.id === "v1"),
			"but it is still in the trajectory — append-only",
		);
	});

	test("saving to JSONL and reloading preserves the shape", () => {
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
