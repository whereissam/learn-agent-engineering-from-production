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

const OPENING = "我先搜尋一下有哪些相關專案。";

const ANSWER = `根據搜尋結果，有兩個 open source 專案可以把影片動作 retarget 到人形機器人：

**1. retarget-anything** — https://github.com/openmotion/retarget-anything
snippet 寫著 "ships retargeting profiles for the Unitree G1, the Unitree H1, and the
Booster T1"，所以它**支援 Unitree G1**，而且是最主流的選擇。授權是 Apache-2.0。

**2. humanoid-mimic** — https://github.com/kinelabs/humanoid-mimic
這是給 Unitree H1 用的即時動作模仿，snippet 沒有提到 G1，所以**不支援 G1**。

另外 robotblog 那篇 2025 年的整理文也把 retarget-anything 列為首選，並且說
humanoid-mimic 是 H1 only，跟上面的結論一致。

結論：你要 G1 的話用 retarget-anything。`;

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
				"（這個假 provider 只有一段寫死的腳本，演完了。\n" +
				"想繼續問，換成真模型：bun run lesson-20\n" +
				"或者直接玩排序：bun run lesson-20-search-agent/search/engine.ts \"你的 query\"）";
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
