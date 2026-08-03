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

describe("token estimation (Lesson 5)", () => {
	test("an empty conversation is 0", () => {
		assert.equal(estimateTokens([]), 0);
	});

	test("a longer conversation estimates larger", () => {
		const short = [user("hi")];
		const long = [user("hi".repeat(1000))];
		assert.ok(estimateTokens(long) > estimateTokens(short));
	});

	test("tool results count too", () => {
		const withResult = [user("x"), assistantCall("c1"), toolResult("c1", "y".repeat(4000))];
		assert.ok(estimateTokens(withResult) > 500, "a large tool output must not be ignored");
	});
});

describe("the trigger condition (Lesson 5)", () => {
	test("too few messages means no compaction (a summary costs money too)", () => {
		const messages = [user("a"), assistantText("b")];
		assert.equal(shouldCompact(messages, { ...DEFAULT_COMPACTION, triggerTokens: 1 }), false);
	});

	test("compacts only when over the threshold and long enough", () => {
		const messages = Array.from({ length: 20 }, (_, i) => user("x".repeat(200) + i));
		assert.equal(shouldCompact(messages, { ...DEFAULT_COMPACTION, triggerTokens: 100 }), true);
	});
});

describe("the cut must not separate a tool call from its result (Lesson 5 Step 5)", () => {
	test("the first kept message is never a toolResult", async () => {
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
				fakeProvider("a summary"),
				messages,
				{ ...DEFAULT_COMPACTION, keepRecent },
			);
				// compactedCount of 0 means nothing was compacted (not worth it), so there is no cut point to worry about
			if (result.compactedCount === 0) continue;

			const firstKept = result.messages[1]; // [0] is the summary
			assert.notEqual(
				firstKept?.role,
				"toolResult",
				`with keepRecent=${keepRecent} the cut landed on a toolResult, and the next request would 400`,
			);
		}
	});
});

describe("do not compact when compaction does not pay (Lesson 5 Step 4)", () => {
	test("falls back to the original messages when the summary is longer", async () => {
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

		const hugeSummary = "summary ".repeat(5000);
		const result = await compact(fakeProvider(hugeSummary), messages, {
			...DEFAULT_COMPACTION,
			keepRecent: 2,
		});

		assert.equal(result.compactedCount, 0, "it should have judged this not worth it");
		assert.equal(result.messages.length, messages.length, "it should return the original message list");
		assert.equal(result.tokensAfter, result.tokensBefore);
	});

	test("compacts for real when the summary is short enough", async () => {
		const messages: Message[] = Array.from({ length: 20 }, (_, i) =>
			i % 2 === 0 ? user("x".repeat(500)) : assistantText("y".repeat(500)),
		);

		const result = await compact(fakeProvider("short summary"), messages, {
			...DEFAULT_COMPACTION,
			keepRecent: 4,
		});

		assert.ok(result.compactedCount > 0, "something should have been compacted");
		assert.ok(result.tokensAfter < result.tokensBefore, "the result must be smaller than the original");
		assert.ok(result.messages.length < messages.length);
	});

	test("the summary goes back as a user message, not an assistant one", async () => {
		const messages: Message[] = Array.from({ length: 20 }, (_, i) =>
			i % 2 === 0 ? user("x".repeat(500)) : assistantText("y".repeat(500)),
		);

		const result = await compact(fakeProvider("short summary"), messages, {
			...DEFAULT_COMPACTION,
			keepRecent: 4,
		});

		assert.equal(
			result.messages[0]?.role,
			"user",
			"The summary is produced by the harness; filing it as assistant makes the model believe it said all this",
		);
	});
});
