/**
 * The fake streaming provider.
 *
 * It emits characters **slowly**, so you can see the typewriter effect and have time to press Ctrl+C to test interruption.
 * The delay between deltas checks the signal, so interruption is immediate.
 */

import type { ModelRequest, ModelResponse, StreamEvent, StreamingProvider } from "./types.ts";
import { drain } from "./types.ts";

/** How long to pause between characters (milliseconds). Raise it to test interruption by hand. */
const DELAY_MS = Number(process.env.FAKE_DELAY_MS ?? 25);

export function fakeStreamingProvider(): StreamingProvider {
	let step = 0;

	const provider: StreamingProvider = {
		name: "fake",
		model: "scripted-stream",

		async *stream(request: ModelRequest, signal?: AbortSignal): AsyncIterable<StreamEvent> {
				// A compaction request looks different from an ordinary conversation: no tools, and the system prompt
				// talks about "summarizing". Recognise it and return a plausible short summary,
				// or the fake provider's canned long passage becomes the summary and compaction makes things bigger.
			if (request.tools.length === 0 && request.system.includes("summarizing")) {
				const summary =
					"- The user asked the agent to look over a URL shortener project\n" +
					"- Read src/store.ts and src/config.ts\n" +
					"- Found that ALPHABET in config.ts contains uppercase letters, but lookup() in store.ts calls toLowerCase() first\n" +
					"- Not fixed yet; tests still 2 fail / 3 pass";
				yield* say(summary, signal);
				if (signal?.aborted) return yield aborted();
				yield {
					type: "done",
					response: {
						blocks: [{ type: "text", text: summary }],
						raw: null,
						stopReason: "end",
					},
				};
				return;
			}

			const turn = step++;
			const hasTools = request.tools.length > 0;

				// Call tools for the first two turns, then say a long passage (so you can test interruption)
			if (hasTools && turn === 0) {
				yield* say("Let me look at the project structure first.", signal);
				if (signal?.aborted) return yield aborted();
				yield { type: "tool_call", id: "s1", name: "list_files", args: {} };
				yield {
					type: "done",
					response: {
						blocks: [
							{ type: "text", text: "Let me look at the project structure first." },
							{ type: "toolCall", id: "s1", name: "list_files", args: {} },
						],
						raw: null,
						stopReason: "tool_use",
					},
				};
				return;
			}

			if (hasTools && turn === 1) {
				yield* say("Now reading store.ts.", signal);
				if (signal?.aborted) return yield aborted();
				yield {
					type: "tool_call",
					id: "s2",
					name: "read_file",
					args: { path: "src/store.ts" },
				};
				yield {
					type: "done",
					response: {
						blocks: [
							{ type: "text", text: "Now reading store.ts." },
							{ type: "toolCall", id: "s2", name: "read_file", args: { path: "src/store.ts" } },
						],
						raw: null,
						stopReason: "tool_use",
					},
				};
				return;
			}

				// A deliberately long reply, giving you time to press Ctrl+C
			const long =
				"This reply is deliberately long, to give you enough time to press Ctrl+C and try interrupting it.\n\n" +
				"When you do, watch for three things:\n" +
				"First, the text stops immediately, mid-word, instead of finishing the sentence.\n" +
				"Second, the text already printed does not vanish. It is valid data, and it is kept in the conversation history.\n" +
				"Third, the program does not crash. You land back at the prompt and can keep talking.\n\n" +
				"None of those three happen by accident. Lesson 3's README explains how each one is arranged.\n";

			yield* say(long, signal);
			if (signal?.aborted) return yield aborted();

			yield {
				type: "done",
				response: {
					blocks: [{ type: "text", text: long }],
					raw: null,
					stopReason: "end",
				},
			};
		},

		async call(request: ModelRequest, signal?: AbortSignal): Promise<ModelResponse> {
			return await drain(provider.stream(request, signal));
		},
	};

	return provider;
}

/** Emit character by character, leaving gaps for an interruption. */
async function* say(text: string, signal?: AbortSignal): AsyncIterable<StreamEvent> {
	yield { type: "text_start" };
	for (const char of text) {
		if (signal?.aborted) {
			yield { type: "text_end" };
			return;
		}
		await sleep(DELAY_MS);
		yield { type: "text_delta", delta: char };
	}
	yield { type: "text_end" };
}

function aborted(): StreamEvent {
	return { type: "error", message: "Aborted by user", aborted: true };
}

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}
