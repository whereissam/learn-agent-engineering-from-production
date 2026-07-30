/**
 * Context compaction (Lesson 5).
 *
 * Two key invariants:
 *   1. the cut must not separate a tool call from its result (separating them 400s the next request)
 *   2. if compaction does not make the context smaller, do not compact
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { compact, DEFAULT_COMPACTION, estimateTokens, shouldCompact } from "../shared/compaction.ts";
import type { Message } from "../shared/providers/types.ts";
import type { ModelRequest, ModelResponse, StreamEvent, StreamingProvider } from "../shared/streaming/types.ts";

const user = (text: string): Message => ({ role: "user", text });
const assistantText = (text: string): Message => ({
	role: "assistant",
	blocks: [{ type: "text", text }],
	raw: null,
});
const assistantCall = (id: string): Message => ({
	role: "assistant",
	blocks: [{ type: "toolCall", id, name: "read_file", args: { path: "a.md" } }],
	raw: null,
});
const toolResult = (id: string, content = "file contents"): Message => ({
	role: "toolResult",
	results: [{ toolCallId: id, toolName: "read_file", content }],
});

/** A fake provider returning a fixed summary. */
function fakeProvider(summary: string): StreamingProvider {
	const provider: StreamingProvider = {
		name: "fake",
		model: "test",
		async *stream(): AsyncIterable<StreamEvent> {
			yield {
				type: "done",
				response: { blocks: [{ type: "text", text: summary }], raw: null, stopReason: "end" },
			};
		},
		async call(): Promise<ModelResponse> {
			return { blocks: [{ type: "text", text: summary }], raw: null, stopReason: "end" };
		},
	};
	return provider;
}

describe("token 估算（Lesson 5）", () => {
	test("空對話是 0", () => {
		assert.equal(estimateTokens([]), 0);
	});

	test("越長的對話估出來越大", () => {
		const short = [user("hi")];
		const long = [user("hi".repeat(1000))];
		assert.ok(estimateTokens(long) > estimateTokens(short));
	});

	test("工具結果也要算進去", () => {
		const withResult = [user("x"), assistantCall("c1"), toolResult("c1", "y".repeat(4000))];
		assert.ok(estimateTokens(withResult) > 500, "大的工具輸出不能被忽略");
	});
});

describe("觸發條件（Lesson 5）", () => {
	test("訊息太少就不壓（摘要本身也要花錢）", () => {
		const messages = [user("a"), assistantText("b")];
		assert.equal(shouldCompact(messages, { ...DEFAULT_COMPACTION, triggerTokens: 1 }), false);
	});

	test("超過門檻且夠長才壓", () => {
		const messages = Array.from({ length: 20 }, (_, i) => user("x".repeat(200) + i));
		assert.equal(shouldCompact(messages, { ...DEFAULT_COMPACTION, triggerTokens: 100 }), true);
	});
});

describe("切點不能拆散 tool call/result（Lesson 5 Step 5）", () => {
	test("保留的第一則不會是 toolResult", async () => {
			// Deliberately place the ideal cut point exactly on a toolResult
		const messages: Message[] = [
			user("start"),
			assistantText("thinking"),
			assistantCall("c1"),
			toolResult("c1"),
			assistantCall("c2"),
			toolResult("c2"),
			assistantCall("c3"),
			toolResult("c3"),
			user("end"),
		];

		for (let keepRecent = 1; keepRecent <= 8; keepRecent++) {
			const result = await compact(
				fakeProvider("摘要"),
				messages,
				{ ...DEFAULT_COMPACTION, keepRecent },
			);
				// compactedCount of 0 means nothing was compacted (not worth it), so there is no cut point to worry about
			if (result.compactedCount === 0) continue;

			const firstKept = result.messages[1]; // [0] 是摘要
			assert.notEqual(
				firstKept?.role,
				"toolResult",
				`keepRecent=${keepRecent} 時切在了 toolResult 上，下一次請求會 400`,
			);
		}
	});
});

describe("壓縮沒賺到就不要壓（Lesson 5 Step 4）", () => {
	test("摘要比原文長時退回原本的訊息", async () => {
		const messages: Message[] = [
			user("a"),
			assistantText("b"),
			user("c"),
			assistantText("d"),
			user("e"),
			assistantText("f"),
			user("g"),
			assistantText("h"),
		];

		const hugeSummary = "摘".repeat(5000);
		const result = await compact(fakeProvider(hugeSummary), messages, {
			...DEFAULT_COMPACTION,
			keepRecent: 2,
		});

		assert.equal(result.compactedCount, 0, "應該判斷不划算");
		assert.equal(result.messages.length, messages.length, "應該退回原本的訊息串");
		assert.equal(result.tokensAfter, result.tokensBefore);
	});

	test("摘要夠短時真的會壓縮", async () => {
		const messages: Message[] = Array.from({ length: 20 }, (_, i) =>
			i % 2 === 0 ? user("x".repeat(500)) : assistantText("y".repeat(500)),
		);

		const result = await compact(fakeProvider("短摘要"), messages, {
			...DEFAULT_COMPACTION,
			keepRecent: 4,
		});

		assert.ok(result.compactedCount > 0, "應該有壓到東西");
		assert.ok(result.tokensAfter < result.tokensBefore, "壓完要比原本小");
		assert.ok(result.messages.length < messages.length);
	});

	test("摘要以 user 角色放回去，不是 assistant", async () => {
		const messages: Message[] = Array.from({ length: 20 }, (_, i) =>
			i % 2 === 0 ? user("x".repeat(500)) : assistantText("y".repeat(500)),
		);

		const result = await compact(fakeProvider("短摘要"), messages, {
			...DEFAULT_COMPACTION,
			keepRecent: 4,
		});

		assert.equal(
			result.messages[0]?.role,
			"user",
			"摘要是 harness 產生的，放成 assistant 會讓模型以為自己講過",
		);
	});
});
