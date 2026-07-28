/**
 * 這一課專用的假 provider。
 *
 * 為什麼不用 `shared/streaming/fake.ts`？因為那一支是寫給 Lesson 1-5 的
 * coding agent 的，它會去呼叫 list_files / read_file，
 * 在這一課只會換來兩次「Unknown tool」，然後吐一段跟搜尋無關的罐頭文字。
 *
 * 這裡演的軌跡是**刻意錯的**：
 *
 *   1. 搜尋一次
 *   2. 直接根據 snippet 下結論
 *
 * 它會很有自信地說「retarget-anything 支援 Unitree G1」，
 * 而這在語料裡是錯的——那一頁的第四段寫著 G1 profile 已經棄用，
 * 但 snippet 只截到第一段。
 *
 * 這不是在黑模型。真模型跑起來會比這個小心一點（README 有實際軌跡），
 * 但**錯的方向是一樣的**：只有 snippet 的時候，
 * 你沒有任何辦法知道自己漏掉了第四段。
 *
 * 用法：PROVIDER=fake bun run lesson-20
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

			// 第一輪：搜尋
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

			// 第二輪：只看 snippet 就下結論。這正是這一課要你看到的失敗。
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

			// 之後：腳本演完了
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
