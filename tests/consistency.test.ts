/**
 * 中斷之後的一致性（Lesson 28）。
 *
 * 兩組：
 *
 *   audit      五條規則各自都會在該響的時候響（**鑑別度**）
 *   processor  收尾真的把 part 推進到終局狀態
 *
 * 第一組不能省。`bun run lesson-28` 的 CLEANUP=on 那一欄全部是「乾淨」，
 * 而一個永遠說乾淨的稽核器跟一個有效的稽核器在畫面上長得一樣
 * （Lesson 16 第一輪、Lesson 30 第一層都栽在這件事上）。
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

		// 記了就不該報。
		const recorded = message([goodTool], { snapshot: { files: ["a.ts"] } });
		assert.deepEqual(audit({ message: recorded, changedFiles: ["a.ts"] }), []);
	});

	test("被中斷的工具是合法的終局狀態，不該被報", () => {
		// interrupted 是 error 的一種，它有內容、有結束時間，紀錄是誠實的。
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
		// 半截 JSON parse 不了 —— 這正是它是字串的理由。
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
		// 半截的參數是被 JSON.stringify 過才放進訊息的，所以比對的是轉義後的形式。
		// 這件事本身就是重點：**它是一段資料，不是一段可以直接 parse 的 JSON。**
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
		// 這一條是真模型跑出來的 bug：模型沒有先輸出文字就直接呼叫工具，
		// 串流正常結束、工具還在跑 → 250ms 到了 → 一個成功的工具被標成
		// interrupted，而 finish 是 "end"。一份自相矛盾的紀錄。
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
