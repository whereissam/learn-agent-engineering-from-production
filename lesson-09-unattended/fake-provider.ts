/**
 * The fake provider specific to Lesson 9.
 *
 * The same reason as Lesson 8's: the shared script only calls read-only tools
 * and never walks the path "needs approval → nobody present → pause".
 *
 * The script has two beats, because what this lesson looks at is **the gap between them**:
 *
 *   turn 0  send_email(...)   → EXTERNAL, nobody present → into the inbox, the agent pauses
 *   (…eight hours…)
 *   turn 1  receives the tool result and reports to the user
 *
 * Turn 1 is the point. Once approval comes back, **the model has to digest that result and finish**,
 * which the original demo faked with a `console.log`, hiding whether the model
 * correctly understood "that email was sent / was refused".
 */

import type {
	ModelRequest,
	ModelResponse,
	StreamEvent,
	StreamingProvider,
} from "../shared/streaming/types.ts";
import { drain } from "../shared/streaming/types.ts";

const DELAY_MS = Number(process.env.FAKE_DELAY_MS ?? 10);

export function unattendedFakeProvider(): StreamingProvider {
	let step = 0;

	const provider: StreamingProvider = {
		name: "fake",
		model: "scripted-unattended",

		async *stream(request: ModelRequest, signal?: AbortSignal): AsyncIterable<StreamEvent> {
			const turn = step++;

			if (turn === 0) {
				const text = "Right, I will send that daily summary.";
				yield* say(text, signal);
				const call = {
					id: "e1",
					name: "send_email",
					args: {
						to: "team@example.com",
						subject: "Daily summary",
						body: "Today's builds all passed. Nothing needs attention.",
					},
				};
				yield { type: "tool_call", ...call };
				yield {
					type: "done",
					response: {
						blocks: [
							{ type: "text", text },
							{ type: "toolCall", ...call },
						],
						raw: null,
						stopReason: "tool_use",
					},
				};
				return;
			}

				// Beat two: finish based on the tool result.
			//
				// This deliberately reads the last of the messages, because a scripted provider should also
				// **react to the result**, or it is merely acting — and what this lesson demonstrates
				// is exactly "did the model digest that result correctly".
			const last = request.messages[request.messages.length - 1];
			const denied =
				last?.role === "toolResult" && last.results.some((r) => r.isError);

			const text = denied
				? "That message was not sent (approval was declined). I still have the text; say the word if you want it."
				: "Sent, to team@example.com.";

			yield* say(text, signal);
			yield {
				type: "done",
				response: {
					blocks: [{ type: "text", text }],
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

async function* say(text: string, signal?: AbortSignal): AsyncIterable<StreamEvent> {
	yield { type: "text_start" };
	for (const char of text) {
		if (signal?.aborted) {
			yield { type: "text_end" };
			return;
		}
		await new Promise((r) => setTimeout(r, DELAY_MS));
		yield { type: "text_delta", delta: char };
	}
	yield { type: "text_end" };
}
