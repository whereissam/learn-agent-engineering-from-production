/**
 * The fake provider specific to this lesson.
 *
 * The trajectory it acts out is **the same question with a different approach** from Lesson 20's fake provider:
 *
 *   Lesson 20   search → conclude immediately            → wrong
 *   Lesson 21   search → open and read both repos        → right
 *
 * Reading the two side by side is this lesson's whole point.
 *
 * Usage: PROVIDER=fake bun run lesson-21
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
		text: "Let me search for the relevant projects first.",
		call: {
			id: "f1",
			name: "web_search",
			args: { query: "unitree g1 video retargeting open source", max_results: 5 },
		},
	},
	{
		text: "The snippet says retarget-anything supports the G1, but a snippet is not the page. Let me open it and check.",
		call: {
			id: "f2",
			name: "fetch_page",
			args: { url: "https://github.com/openmotion/retarget-anything" },
		},
	},
	{
		text: "As suspected, it differs. The fourth paragraph says the G1 profile was deprecated in v2.0. Now the other project.",
		call: {
			id: "f3",
			name: "fetch_page",
			args: { url: "https://github.com/kinelabs/humanoid-mimic" },
		},
	},
];

const ANSWER = `After reading the body text of both repos, the conclusion is the opposite of what the snippets suggested:

**What you want is humanoid-mimic, not retarget-anything.**

1. **kinelabs/humanoid-mimic** — https://github.com/kinelabs/humanoid-mimic
   v0.7 (June 2026) added a Unitree G1 profile written against the 2026 SDK's joint
   ordering, and tested on real hardware rather than only in simulation. Licence MIT.
   [CONFIRMED: fetch_page, second paragraph of the body]

   Note: the pose backbone weights are a separate download under a non-commercial
   licence. Check that first if you intend to ship a product.
   [CONFIRMED: fifth paragraph of the body]

2. **openmotion/retarget-anything** — https://github.com/openmotion/retarget-anything
   The snippet says it "supports the Unitree G1", but read the whole page and the
   fourth paragraph is a deprecation notice: the G1 profile was deprecated and
   unmaintained as of v2.0 (March 2026), because the 2026 SDK changed the joint
   ordering. Trajectories from the old profile will not load on current firmware,
   and upstream says it will not be fixed.
   [CONFIRMED: fetch_page, fourth paragraph of the body]

**Read only the snippets and both conclusions flip.**`;

export function fakeCrawlProvider(): StreamingProvider {
	let step = 0;

	const provider: StreamingProvider = {
		name: "fake",
		model: "scripted-crawl",

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

			if (turn === STEPS.length) {
				yield* say(ANSWER, signal);
				if (signal?.aborted) return yield aborted();
				yield {
					type: "done",
					response: { blocks: [{ type: "text", text: ANSWER }], raw: null, stopReason: "end" },
				};
				return;
			}

			const outro =
				"(This fake provider has one hardcoded script and it just finished.\n" +
				"To keep asking, switch to a real model: bun run lesson-21)";
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
