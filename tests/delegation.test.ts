/**
 * Delegation (Lesson 19).
 *
 * Two groups:
 *
 *   delegate  the subagent's boundaries (tools, context, approval)
 *   fixture   **is the ground truth itself right**
 *
 * The second is easy to skip and it guards the whole experiment's foundation: if `GROUND_TRUTH`
 * does not match the corpus, the "accuracy" `bun run lesson-19:agent` measures
 * only measures whether the fixture was written correctly. Lesson 25 hit this trap
 * (the evaluation's sources must be the same ones the system saw).
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { BLOCKED_FOR_CHILDREN, runChild } from "../lesson-19-delegation/delegate.ts";
import {
	CAVEAT_MARKERS,
	FIXTURE,
	GROUND_TRUTH,
	mentionsCaveat,
	scoreCodes,
} from "../lesson-19-delegation/workspace.ts";
import type { ModelResponse, StreamEvent, StreamingProvider, ToolSpec } from "../shared/streaming/types.ts";

const TOOLS: ToolSpec[] = [
	{ name: "read_file", description: "", parameters: { type: "object", properties: {} } },
	{ name: "write_file", description: "", parameters: { type: "object", properties: {} } },
	{ name: "delegate_task", description: "", parameters: { type: "object", properties: {} } },
	{ name: "memory", description: "", parameters: { type: "object", properties: {} } },
	{ name: "cronjob", description: "", parameters: { type: "object", properties: {} } },
];

/** Record the tool list every stream received, so "what the subagent saw" can be verified. */
function spy(beats: { say: string; tool?: { name: string } }[]) {
	const seenTools: string[][] = [];
	const seenMessages: string[] = [];
	let step = 0;
	const provider: StreamingProvider = {
		name: "fake",
		model: "spy",
		async *stream(request): AsyncIterable<StreamEvent> {
			seenTools.push((request.tools ?? []).map((t) => t.name));
			for (const message of request.messages) {
				if (message.role === "user") seenMessages.push(message.text);
			}
			const beat = beats[Math.min(step++, beats.length - 1)] as (typeof beats)[number];
			const blocks: ModelResponse["blocks"] = [{ type: "text", text: beat.say }];
			if (beat.tool) blocks.push({ type: "toolCall", id: `c${step}`, name: beat.tool.name, args: {} });
			yield {
				type: "done",
				response: { blocks, raw: null, stopReason: beat.tool ? "tool_use" : "end" },
			};
		},
		async call() {
			return { blocks: [], raw: null, stopReason: "end" };
		},
	};
	return { provider, seenTools, seenMessages };
}

describe("subagent boundaries (Lesson 19)", () => {
	test("five tools are removed from a subagent's list", async () => {
		const { provider, seenTools } = spy([{ say: "done" }]);
		await runChild({ goal: "g" }, { provider, tools: TOOLS, execute: async () => "ok" });

		assert.deepEqual(seenTools[0], ["read_file", "write_file"]);
		for (const blocked of BLOCKED_FOR_CHILDREN) {
			assert.ok(!seenTools[0]?.includes(blocked), `${blocked} must not appear in a subagent's tools`);
		}
	});

	test("calling a blocked tool from memory → isError, and it is recorded", async () => {
			// Absent from the tool list does not mean the model will not call it (in Lesson 20 it searched for a project that did not exist).
		const { provider } = spy([{ say: "split it again", tool: { name: "delegate_task" } }, { say: "done" }]);
		let executed = 0;
		const child = await runChild(
			{ goal: "g" },
			{ provider, tools: TOOLS, execute: async () => { executed++; return "ok"; } },
		);

		assert.deepEqual(child.blockedAttempts, ["delegate_task"]);
		assert.equal(executed, 0, "a blocked tool must not actually run");
	});

	test("BLOCK=off: the same call really runs", async () => {
		const { provider, seenTools } = spy([{ say: "split it again", tool: { name: "delegate_task" } }, { say: "done" }]);
		let executed = 0;
		const child = await runChild(
			{ goal: "g" },
			{ provider, tools: TOOLS, blocklist: false, execute: async () => { executed++; return "ok"; } },
		);

		assert.ok(seenTools[0]?.includes("delegate_task"));
		assert.deepEqual(child.blockedAttempts, []);
		assert.equal(executed, 1);
	});

	test("a subagent's context holds only goal and context, never the parent's history", async () => {
		const { provider, seenMessages } = spy([{ say: "done" }]);
		await runChild(
			{ goal: "count the error codes", context: "the files are under logs/" },
			{ provider, tools: TOOLS, execute: async () => "ok" },
		);

		assert.equal(seenMessages.length, 1);
		assert.match(seenMessages[0] as string, /count the error codes/);
		assert.match(seenMessages[0] as string, /the files are under logs\//);
	});

	test("side-effecting tools are denied by default (nobody on the subagent's side can approve)", async () => {
		const { provider } = spy([{ say: "write the file", tool: { name: "write_file" } }, { say: "done" }]);
		let executed = 0;
		await runChild(
			{ goal: "g" },
			{ provider, tools: TOOLS, execute: async () => { executed++; return "ok"; } },
		);
		assert.equal(executed, 0);
	});

	test("auto-approve: the same call really writes", async () => {
		const { provider } = spy([{ say: "write the file", tool: { name: "write_file" } }, { say: "done" }]);
		let executed = 0;
		await runChild(
			{ goal: "g" },
			{
				provider,
				tools: TOOLS,
				approval: "auto-approve",
				execute: async () => { executed++; return "ok"; },
			},
		);
		assert.equal(executed, 1);
	});

	test("only the final passage goes back to the parent", async () => {
		const { provider } = spy([
			{ say: "let me read the file first (the parent never sees this)", tool: { name: "read_file" } },
			{ say: "The most common one is E-118." },
		]);
		const child = await runChild({ goal: "g" }, { provider, tools: TOOLS, execute: async () => "ok" });
		assert.equal(child.summary, "The most common one is E-118.");
	});
});

describe("the ground truth itself (Lesson 19)", () => {
		/** Count the corpus directly, ignoring GROUND_TRUTH, and compare. */
	function mostFrequentCode(text: string): string {
		const counts = new Map<string, number>();
		for (const match of text.matchAll(/\bERROR (E-\d+)/g)) {
			const code = match[1] as string;
			counts.set(code, (counts.get(code) ?? 0) + 1);
		}
		return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
	}

	for (const [service, expected] of Object.entries(GROUND_TRUTH)) {
		test(`the ground truth for ${service} matches the corpus`, () => {
			const log = FIXTURE[`logs/${service}.log`] as string;
			assert.equal(mostFrequentCode(log), expected);
		});
	}

	test("the caveat really is in inventory's file header", () => {
		const log = FIXTURE["logs/inventory.log"] as string;
		assert.ok(CAVEAT_MARKERS.some((marker) => log.toLowerCase().includes(marker.toLowerCase())));
	});

	test("the scorer: only all three mentioned counts as 3/3", () => {
		const good = "checkout is E-402, inventory is E-118, notify is E-511.";
		assert.deepEqual(scoreCodes(good).missed, []);
		assert.equal(scoreCodes("only E-402").hit.length, 1);
	});

	test("the scorer: the caveat matcher is deliberately broad (wording must not change the verdict)", () => {
		assert.ok(mentionsCaveat("note that anything before 2026-07-14 uses the old numbering"));
		assert.ok(mentionsCaveat("codes were renumbered after the migration"));
		assert.equal(mentionsCaveat("checkout is E-402."), false);
	});
});
