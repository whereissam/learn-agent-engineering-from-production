/**
 * The fake provider specific to this lesson.
 *
 * Three lessons' fake trajectories together are the AI Search part's progress so far:
 *
 *   Lesson 20   search → conclude immediately                        → wrong
 *   Lesson 21   search → open and read both repos → conclude          → right, in three steps
 *   Lesson 22   search (well ranked) → open the first → conclude      → right, in two
 *
 * The difference is not the model and not the prompt but **how well the first step's results are ranked**.
 *
 * Usage: PROVIDER=fake bun run lesson-22
 */

import type {
	ModelRequest,
	ModelResponse,
	StreamEvent,
	StreamingProvider,
} from "../shared/streaming/types.ts";
import { drain } from "../shared/streaming/types.ts";

const DELAY_MS = Number(process.env.FAKE_DELAY_MS ?? 8);

const STEPS = [
	{
		text: "Let me search.",
		call: {
			id: "f1",
			name: "web_search",
			args: { query: "open source video to humanoid retargeting for unitree g1", max_results: 5 },
		},
	},
	{
		text: "humanoid-mimic is first, and it is three weeks old. Let me open it and confirm the G1 support details.",
		call: {
			id: "f2",
			name: "fetch_page",
			args: { url: "https://github.com/kinelabs/humanoid-mimic" },
		},
	},
];

const ANSWER = `**kinelabs/humanoid-mimic** — https://github.com/kinelabs/humanoid-mimic

v0.7 (June 2026) added a Unitree G1 profile written against the 2026 SDK's joint
ordering and verified on real hardware. Licence MIT, though the pose backbone weights
are a separate download under a non-commercial clause.
[CONFIRMED: fetch_page, second and fifth paragraphs of the body]

Note how these search results differ from Lesson 20:

- asking in Chinese still finds things (dense retrieval; BM25 returns 0 results there)
- the SEO farm is not in the top five (keyword stuffing is penalised)
- the 2025 round-up is pushed down (freshness decay)
- only one of retarget-anything's GitHub and docs pages appears (near-duplicates merged)

⚠️ But this is a **hardcoded** script, acting out what happens if the agent is willing
to trust the ranking. Measured against a real model on the same question, it did not:
it still searched a dozen times for project names it remembered from training data,
and hit the step cap. See README Step 8.

**Ranking is measurable offline; whether the agent trusts the ranking is a separate question.**`;

export function fakeRetrievalProvider(): StreamingProvider {
	let step = 0;

	const provider: StreamingProvider = {
		name: "fake",
		model: "scripted-retrieval",

		async *stream(request: ModelRequest, signal?: AbortSignal): AsyncIterable<StreamEvent> {
			const turn = step++;
			const scripted = STEPS[turn];

			if (scripted && request.tools.length > 0) {
				yield* say(scripted.text, signal);
				if (signal?.aborted) return yield aborted();
				yield { type: "tool_call", ...scripted.call };
				yield {
					type: "done",
					response: {
						blocks: [
							{ type: "text", text: scripted.text },
							{ type: "toolCall", ...scripted.call },
						],
						raw: null,
						stopReason: "tool_use",
					},
				};
				return;
			}

			const text =
				turn === STEPS.length
					? ANSWER
					: "(This fake provider has one hardcoded script and it just finished.\n" +
						"To keep asking, switch to a real model: bun run lesson-22\n" +
						"To look at the ranking itself: bun run lesson-22:eval)";

			yield* say(text, signal);
			if (signal?.aborted) return yield aborted();
			yield {
				type: "done",
				response: { blocks: [{ type: "text", text }], raw: null, stopReason: "end" },
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
