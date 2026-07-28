/**
 * 這一課專用的假 provider。
 *
 * 它演的軌跡跟 Lesson 20 的假 provider 是**同一個問題、不同的做法**：
 *
 *   Lesson 20   搜尋 → 直接下結論              → 錯
 *   Lesson 21   搜尋 → 把兩個 repo 打開來讀 → 對
 *
 * 兩邊對照著看，就是這一課的全部重點。
 *
 * 用法：PROVIDER=fake bun run lesson-21
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
		text: "我先搜尋一下有哪些相關專案。",
		call: {
			id: "f1",
			name: "web_search",
			args: { query: "unitree g1 video retargeting open source", max_results: 5 },
		},
	},
	{
		text: "snippet 說 retarget-anything 支援 G1，但 snippet 不等於整頁。我把它打開來確認。",
		call: {
			id: "f2",
			name: "fetch_page",
			args: { url: "https://github.com/openmotion/retarget-anything" },
		},
	},
	{
		text: "果然不一樣。第四段寫著 G1 profile 在 v2.0 已經棄用。再看另一個專案。",
		call: {
			id: "f3",
			name: "fetch_page",
			args: { url: "https://github.com/kinelabs/humanoid-mimic" },
		},
	},
];

const ANSWER = `讀完兩個 repo 的正文之後，結論跟 snippet 給的印象相反：

**你要的是 humanoid-mimic，不是 retarget-anything。**

1. **kinelabs/humanoid-mimic** — https://github.com/kinelabs/humanoid-mimic
   v0.7（2026 年 6 月）加入了 Unitree G1 profile，是對著 2026 SDK 的關節順序寫的，
   而且在實機上測過，不只是模擬。授權 MIT。
   [CONFIRMED：fetch_page 讀到正文第二段]

   注意：pose backbone 的權重是另外下載的，帶非商業授權。要出商品的話這點要先確認。
   [CONFIRMED：正文第五段]

2. **openmotion/retarget-anything** — https://github.com/openmotion/retarget-anything
   snippet 說它「支援 Unitree G1」，但整頁讀下來，第四段是一則棄用公告：
   G1 profile 在 v2.0（2026 年 3 月）已棄用且不再維護，因為 2026 SDK 改了關節順序，
   舊 profile 產生的軌跡在現行韌體上載入不了，官方也說不打算修。
   [CONFIRMED：fetch_page 讀到正文第四段]

**如果只看 snippet，這兩條結論都會反過來。**`;

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
				"（這個假 provider 只有一段寫死的腳本，演完了。\n" +
				"想繼續問，換成真模型：bun run lesson-21）";
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
