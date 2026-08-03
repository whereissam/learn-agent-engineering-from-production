/**
 * The fake provider specific to this lesson.
 *
 * Why not `shared/streaming/fake.ts`? Because that one was written for the Lesson 1-5
 * coding agent and calls list_files / read_file,
 * which here earns two "Unknown tool" results followed by a canned paragraph unrelated to search.
 *
 * The trajectory it acts out is **deliberately wrong**:
 *
 *   1. search once
 *   2. conclude straight from the snippet
 *
 * It confidently says "retarget-anything supports the Unitree G1",
 * which is false in this corpus — that page's fourth paragraph says the G1 profile is deprecated,
 * and the snippet only reached the first.
 *
 * This is not a smear on models. A real model is more careful than this (the README has real trajectories),
 * and **the direction of the error is the same**: with only a snippet,
 * you have no way to know you missed the fourth paragraph.
 *
 * Usage: PROVIDER=fake bun run lesson-20
 */

import type {
	ModelRequest,
	ModelResponse,
	StreamEvent,
	StreamingProvider,
} from "../shared/streaming/types.ts";
import { drain } from "../shared/streaming/types.ts";

const DELAY_MS = Number(process.env.FAKE_DELAY_MS ?? 8);

const OPENING = "Let me search for the relevant projects first.";

const ANSWER = `Based on the search results, two open source projects can retarget video motion onto a humanoid robot:

**1. retarget-anything** — https://github.com/openmotion/retarget-anything
the snippet says "ships retargeting profiles for the Unitree G1, the Unitree H1, and the
Booster T1", so it **supports the Unitree G1** and is the mainstream choice. Licence Apache-2.0.

**2. humanoid-mimic** — https://github.com/kinelabs/humanoid-mimic
Real-time motion imitation for the Unitree H1. The snippet does not mention the G1, so it **does not support the G1**.

The 2025 robotblog round-up also lists retarget-anything as the first choice and says
humanoid-mimic is H1-only, which agrees with the above.

Conclusion: if you want the G1, use retarget-anything.`;

export function fakeSearchProvider(): StreamingProvider {
	let step = 0;

	const provider: StreamingProvider = {
		name: "fake",
		model: "scripted-search",

		async *stream(request: ModelRequest, signal?: AbortSignal): AsyncIterable<StreamEvent> {
			const turn = step++;

				// Round one: search
			if (turn === 0 && request.tools.length > 0) {
				yield* say(OPENING, signal);
				if (signal?.aborted) return yield aborted();

				const args = { query: "unitree g1 video retargeting open source", max_results: 5 };
				yield { type: "tool_call", id: "f1", name: "web_search", args };
				yield {
					type: "done",
					response: {
						blocks: [
							{ type: "text", text: OPENING },
							{ type: "toolCall", id: "f1", name: "web_search", args },
						],
						raw: null,
						stopReason: "tool_use",
					},
				};
				return;
			}

				// Round two: conclude from the snippet alone. Exactly the failure this lesson wants you to see.
			if (turn === 1) {
				yield* say(ANSWER, signal);
				if (signal?.aborted) return yield aborted();
				yield {
					type: "done",
					response: {
						blocks: [{ type: "text", text: ANSWER }],
						raw: null,
						stopReason: "end",
					},
				};
				return;
			}

				// Afterwards: the script is finished
			const outro =
				"(This fake provider has one hardcoded script and it just finished.\n" +
				"To keep asking, switch to a real model: bun run lesson-20\n" +
				"Or play with the ranking directly: bun run lesson-20-search-agent/search/engine.ts \"your query\")";
			yield* say(outro, signal);
			if (signal?.aborted) return yield aborted();
			yield {
				type: "done",
				response: { blocks: [{ type: "text", text: outro }], raw: null, stopReason: "end" },
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
