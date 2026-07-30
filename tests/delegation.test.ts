/**
 * 委派（Lesson 19）。
 *
 * 兩組：
 *
 *   delegate  子 agent 的邊界（工具、context、批准）
 *   fixture   **標準答案本身是對的嗎**
 *
 * 第二組容易被跳過，但它守的是整個實驗的地基：如果 `GROUND_TRUTH`
 * 跟語料對不上，那 `bun run lesson-19:agent` 量到的「正確率」
 * 只是在量我有沒有寫錯 fixture。Lesson 25 踩過這個坑
 * （評估的來源必須跟系統看到的是同一份）。
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

/** 記下每次 stream 拿到的工具清單，才驗得了「子 agent 看到什麼」。 */
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

describe("子 agent 的邊界（Lesson 19）", () => {
	test("五個工具從子 agent 的清單裡被拿掉", async () => {
		const { provider, seenTools } = spy([{ say: "done" }]);
		await runChild({ goal: "g" }, { provider, tools: TOOLS, execute: async () => "ok" });

		assert.deepEqual(seenTools[0], ["read_file", "write_file"]);
		for (const blocked of BLOCKED_FOR_CHILDREN) {
			assert.ok(!seenTools[0]?.includes(blocked), `${blocked} 不該出現在子 agent 的工具裡`);
		}
	});

	test("憑記憶叫出被擋的工具 → isError，而且記下來", async () => {
		// 工具清單裡沒有不代表模型不會叫（Lesson 20 那次它搜了不存在的專案名）。
		const { provider } = spy([{ say: "再拆一次", tool: { name: "delegate_task" } }, { say: "done" }]);
		let executed = 0;
		const child = await runChild(
			{ goal: "g" },
			{ provider, tools: TOOLS, execute: async () => { executed++; return "ok"; } },
		);

		assert.deepEqual(child.blockedAttempts, ["delegate_task"]);
		assert.equal(executed, 0, "被擋的工具不能真的執行");
	});

	test("BLOCK=off：同一個呼叫會真的執行", async () => {
		const { provider, seenTools } = spy([{ say: "再拆一次", tool: { name: "delegate_task" } }, { say: "done" }]);
		let executed = 0;
		const child = await runChild(
			{ goal: "g" },
			{ provider, tools: TOOLS, blocklist: false, execute: async () => { executed++; return "ok"; } },
		);

		assert.ok(seenTools[0]?.includes("delegate_task"));
		assert.deepEqual(child.blockedAttempts, []);
		assert.equal(executed, 1);
	});

	test("子 agent 的 context 只有 goal 和 context，沒有父 agent 的歷史", async () => {
		const { provider, seenMessages } = spy([{ say: "done" }]);
		await runChild(
			{ goal: "統計錯誤碼", context: "檔案在 logs/ 底下" },
			{ provider, tools: TOOLS, execute: async () => "ok" },
		);

		assert.equal(seenMessages.length, 1);
		assert.match(seenMessages[0] as string, /統計錯誤碼/);
		assert.match(seenMessages[0] as string, /檔案在 logs\/ 底下/);
	});

	test("預設拒絕有副作用的工具（子 agent 那一側沒有人可以批准）", async () => {
		const { provider } = spy([{ say: "寫檔", tool: { name: "write_file" } }, { say: "done" }]);
		let executed = 0;
		await runChild(
			{ goal: "g" },
			{ provider, tools: TOOLS, execute: async () => { executed++; return "ok"; } },
		);
		assert.equal(executed, 0);
	});

	test("auto-approve：同一個呼叫會真的寫出去", async () => {
		const { provider } = spy([{ say: "寫檔", tool: { name: "write_file" } }, { say: "done" }]);
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

	test("只有最後那段文字會回給父 agent", async () => {
		const { provider } = spy([
			{ say: "我先讀檔（這句父 agent 看不到）", tool: { name: "read_file" } },
			{ say: "最常見的是 E-118。" },
		]);
		const child = await runChild({ goal: "g" }, { provider, tools: TOOLS, execute: async () => "ok" });
		assert.equal(child.summary, "最常見的是 E-118。");
	});
});

describe("標準答案本身（Lesson 19）", () => {
	/** 直接數語料，不看 GROUND_TRUTH，然後比對。 */
	function mostFrequentCode(text: string): string {
		const counts = new Map<string, number>();
		for (const match of text.matchAll(/\bERROR (E-\d+)/g)) {
			const code = match[1] as string;
			counts.set(code, (counts.get(code) ?? 0) + 1);
		}
		return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
	}

	for (const [service, expected] of Object.entries(GROUND_TRUTH)) {
		test(`${service} 的標準答案跟語料對得上`, () => {
			const log = FIXTURE[`logs/${service}.log`] as string;
			assert.equal(mostFrequentCode(log), expected);
		});
	}

	test("那個但書真的在 inventory 的檔頭裡", () => {
		const log = FIXTURE["logs/inventory.log"] as string;
		assert.ok(CAVEAT_MARKERS.some((marker) => log.toLowerCase().includes(marker.toLowerCase())));
	});

	test("判定函式：三個都提到才算 3/3", () => {
		const good = "checkout 是 E-402、inventory 是 E-118、notify 是 E-511。";
		assert.deepEqual(scoreCodes(good).missed, []);
		assert.equal(scoreCodes("只有 E-402").hit.length, 1);
	});

	test("判定函式：但書認得寬一點（措辭不該影響判定）", () => {
		assert.ok(mentionsCaveat("注意 2026-07-14 之前是舊的編號"));
		assert.ok(mentionsCaveat("codes were renumbered after the migration"));
		assert.equal(mentionsCaveat("checkout 是 E-402。"), false);
	});
});
