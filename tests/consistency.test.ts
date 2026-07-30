/**
 * Consistency after an interruption (Lesson 28).
 *
 * Two groups:
 *
 *   audit      each of the five rules fires when it should (**discrimination**)
 *   processor  cleanup really pushes parts into terminal states
 *
 * The first group cannot be skipped. `bun run lesson-28`'s CLEANUP=on column is all "clean",
 * and an auditor that always says clean looks identical on screen to one that works
 * (Lesson 16's first round and Lesson 30's first tier both fell for exactly this).
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import { audit } from "../lesson-28-consistency/audit.ts";
import type { AssistantMessage, Part } from "../lesson-28-consistency/parts.ts";
import { SessionProcessor } from "../lesson-28-consistency/processor.ts";

const TMP = mkdtempSync(join(tmpdir(), "lesson-28-"));
after(() => rmSync(TMP, { recursive: true, force: true }));

function message(parts: Part[], overrides: Partial<AssistantMessage> = {}): AssistantMessage {
	return {
		id: "m1",
		parts,
		time: { created: 1, completed: 9 },
		finish: "end",
		...overrides,
	};
}

const goodTool: Part = {
	type: "tool",
	id: "t1",
	name: "write_file",
	state: { status: "completed", input: { path: "a.ts" }, output: "Wrote a.ts" },
	time: { created: 1, ran: 2, completed: 3 },
};

const goodText: Part = { type: "text", id: "x1", text: "done", time: { created: 4, completed: 5 } };

describe("稽核規則的鑑別度（Lesson 28）", () => {
	test("形狀正確的訊息沒有違規", () => {
		assert.deepEqual(audit({ message: message([goodTool, goodText]) }), []);
	});

	test("存檔裡有 running 的工具 → in-flight-in-storage", () => {
		const part: Part = {
			type: "tool",
			id: "t1",
			name: "write_file",
			state: { status: "running", input: { path: "a.ts" } },
			time: { created: 1, ran: 2 },
		};
		const kinds = audit({ message: message([part]) }).map((v) => v.kind);
		assert.ok(kinds.includes("in-flight-in-storage"));
		assert.ok(kinds.includes("unfinished-span"), "ran 了卻沒有 completed 也要報");
	});

	test("存檔裡有 pending 的工具 → in-flight-in-storage", () => {
		const part: Part = {
			type: "tool",
			id: "t1",
			name: "write_file",
			state: { status: "pending", input: '{"path":"a' },
			time: { created: 1 },
		};
		assert.ok(
			audit({ message: message([part]) })
				.map((v) => v.kind)
				.includes("in-flight-in-storage"),
		);
	});

	test("text 沒有結束時間 → unfinished-span", () => {
		const part: Part = { type: "text", id: "x1", text: "半截", time: { created: 4 } };
		assert.deepEqual(
			audit({ message: message([part]) }).map((v) => v.kind),
			["unfinished-span"],
		);
	});

	test("訊息沒有結束時間 → message-never-completed", () => {
		assert.deepEqual(
			audit({ message: message([goodTool, goodText], { time: { created: 1 } }) }).map((v) => v.kind),
			["message-never-completed"],
		);
	});

	test("終局狀態但沒有內容 → terminal-without-result", () => {
		const empty: Part = {
			type: "tool",
			id: "t1",
			name: "write_file",
			state: { status: "error", input: {}, error: "  " },
			time: { created: 1, completed: 2 },
		};
		assert.deepEqual(
			audit({ message: message([empty]) }).map((v) => v.kind),
			["terminal-without-result"],
		);
	});

	test("檔案變了但沒記 → unrecorded-patch", () => {
		const kinds = audit({ message: message([goodTool]), changedFiles: ["a.ts"] }).map((v) => v.kind);
		assert.deepEqual(kinds, ["unrecorded-patch"]);

			// Recorded means it must not be reported.
		const recorded = message([goodTool], { snapshot: { files: ["a.ts"] } });
		assert.deepEqual(audit({ message: recorded, changedFiles: ["a.ts"] }), []);
	});

	test("被中斷的工具是合法的終局狀態，不該被報", () => {
			// interrupted is a kind of error with content and an end time; the record is honest.
		const part: Part = {
			type: "tool",
			id: "t1",
			name: "write_file",
			state: { status: "error", input: { path: "a.ts" }, error: "interrupted", interrupted: true },
			time: { created: 1, ran: 2, completed: 3 },
		};
		assert.deepEqual(audit({ message: message([part], { finish: "interrupted" }) }), []);
	});
});

// ─────────────────────────────────────────────────────────────

function clock() {
	let t = 100;
	return () => (t += 1);
}

describe("收尾（Lesson 28）", () => {
	test("工具參數逐塊累積，pending 的 input 是字串", async () => {
		const processor = new SessionProcessor("m1", { clock: clock(), execute: async () => "ok" });
		await processor.handle({ type: "tool_input_delta", id: "t1", name: "write_file", chunk: '{"path"' });
		await processor.handle({ type: "tool_input_delta", id: "t1", name: "write_file", chunk: ':"a.ts"' });

		const part = processor.message.parts[0];
		assert.equal(part?.type, "tool");
		if (part?.type !== "tool") return;
		assert.equal(part.state.status, "pending");
		if (part.state.status !== "pending") return;
		assert.equal(part.state.input, '{"path":"a.ts"');
			// Half a JSON document does not parse — which is precisely why it is a string.
		assert.throws(() => JSON.parse(part.state.status === "pending" ? part.state.input : "{}"));
	});

	test("中斷 pending 的工具 → error + interrupted，半截參數留在訊息裡", async () => {
		const processor = new SessionProcessor("m1", { clock: clock(), execute: async () => "ok" });
		await processor.handle({ type: "tool_input_delta", id: "t1", name: "write_file", chunk: '{"path' });
		await processor.cleanup("interrupted");

		const part = processor.message.parts[0];
		if (part?.type !== "tool" || part.state.status !== "error") {
			assert.fail("應該變成 error");
			return;
		}
		assert.equal(part.state.interrupted, true);
			// Half-formed arguments were JSON.stringify'd before going into the message, so the comparison uses the escaped form.
			// That fact is itself the point: **it is data, not JSON you can parse directly.**
		assert.ok(part.state.error.includes(JSON.stringify('{"path')));
		assert.ok(part.time.completed !== undefined);
	});

	test("中斷正在跑的工具 → error + interrupted", async () => {
		let release: () => void = () => {};
		const processor = new SessionProcessor("m1", {
			clock: clock(),
			graceMs: 10,
			execute: () => new Promise<string>((resolve) => { release = () => resolve("ok"); }),
		});
		await processor.handle({ type: "tool_call", id: "t1", name: "write_file", args: { path: "a.ts" } });
		await processor.cleanup("interrupted");

		const part = processor.message.parts[0];
		if (part?.type !== "tool" || part.state.status !== "error") {
			assert.fail("應該變成 error");
			return;
		}
		assert.equal(part.state.interrupted, true);
		release();
	});

	test("寬限窗口內跑完的工具 → completed，不是 interrupted", async () => {
		const processor = new SessionProcessor("m1", {
			clock: clock(),
			graceMs: 200,
			execute: async () => {
				await new Promise((r) => setTimeout(r, 5));
				return "Wrote a.ts";
			},
		});
		await processor.handle({ type: "tool_call", id: "t1", name: "write_file", args: { path: "a.ts" } });
		await processor.cleanup("interrupted");

		const part = processor.message.parts[0];
		assert.equal(part?.type === "tool" && part.state.status, "completed");
	});

	test("⚠ 正常結束時要等工具真的跑完，不能套用寬限窗口", async () => {
			// This one is a bug a real model produced: the model called a tool without emitting text first,
			// the stream finished normally with the tool still running → the 250ms elapsed → a successful tool was marked
			// interrupted while finish was "end". A self-contradictory record.
		const processor = new SessionProcessor("m1", {
			clock: clock(),
			graceMs: 10,
			execute: async () => {
				await new Promise((r) => setTimeout(r, 60));
				return "Wrote a.ts";
			},
		});
		await processor.handle({ type: "tool_call", id: "t1", name: "write_file", args: { path: "a.ts" } });
		await processor.cleanup("end");

		const part = processor.message.parts[0];
		assert.equal(part?.type === "tool" && part.state.status, "completed");
		assert.deepEqual(audit({ message: processor.message }), []);
	});

	test("半截的文字保留下來，並補上結束時間", async () => {
		const processor = new SessionProcessor("m1", { clock: clock(), execute: async () => "ok" });
		await processor.handle({ type: "text_start", id: "x1" });
		await processor.handle({ type: "text_delta", id: "x1", delta: "我已經把" });
		await processor.cleanup("interrupted");

		const part = processor.message.parts[0];
		assert.equal(part?.type === "text" && part.text, "我已經把");
		assert.ok(part?.time.completed !== undefined, "使用者已經看過的字不能沒有結束時間");
	});

	test("被中斷的那一輪也要記 patch", async () => {
		const processor = new SessionProcessor("m1", {
			clock: clock(),
			execute: async () => "ok",
			diff: () => ["a.ts"],
		});
		await processor.handle({ type: "tool_call", id: "t1", name: "write_file", args: { path: "a.ts" } });
		await processor.cleanup("interrupted");

		assert.deepEqual(processor.message.snapshot?.files, ["a.ts"]);
		assert.deepEqual(audit({ message: processor.message, changedFiles: ["a.ts"] }), []);
	});

	test("CLEANUP=off：什麼都不做，稽核就會抓到", async () => {
		const processor = new SessionProcessor("m1", {
			clock: clock(),
			cleanup: false,
			execute: async () => new Promise<string>(() => {}),
			diff: () => ["a.ts"],
		});
		await processor.handle({ type: "text_start", id: "x1" });
		await processor.handle({ type: "text_delta", id: "x1", delta: "半截" });
		await processor.handle({ type: "tool_call", id: "t1", name: "write_file", args: { path: "a.ts" } });
		await processor.cleanup("interrupted");

		const kinds = audit({ message: processor.message, changedFiles: ["a.ts"] }).map((v) => v.kind);
		assert.ok(kinds.includes("in-flight-in-storage"));
		assert.ok(kinds.includes("unfinished-span"));
		assert.ok(kinds.includes("message-never-completed"));
		assert.ok(kinds.includes("unrecorded-patch"));
	});

	test("存檔再載回來，四種 state 的形狀不變", async () => {
		const processor = new SessionProcessor("m1", { clock: clock(), execute: async () => "ok" });
		await processor.handle({ type: "tool_input_delta", id: "t1", name: "write_file", chunk: '{"a' });
		await processor.cleanup("interrupted");

		const path = join(TMP, "session.json");
		await processor.persist(path);
		const loaded = await SessionProcessor.load(path);
		assert.deepEqual(loaded, processor.message);
	});
});
