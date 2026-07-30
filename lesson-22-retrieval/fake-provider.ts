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
		text: "我搜尋一下。",
		call: {
			id: "f1",
			name: "web_search",
			args: { query: "把影片動作 retarget 到 Unitree G1 的開源專案", max_results: 5 },
		},
	},
	{
		text: "第一名就是 humanoid-mimic，而且是三週前的。我打開來確認 G1 支援的細節。",
		call: {
			id: "f2",
			name: "fetch_page",
			args: { url: "https://github.com/kinelabs/humanoid-mimic" },
		},
	},
];

const ANSWER = `**kinelabs/humanoid-mimic** — https://github.com/kinelabs/humanoid-mimic

v0.7（2026 年 6 月）加入 Unitree G1 profile，對著 2026 SDK 的關節順序寫的，
而且在實機上驗證過。授權 MIT，但 pose backbone 的權重另外下載、帶非商業條款。
[CONFIRMED：fetch_page 讀到正文第二段和第五段]

注意這次的搜尋結果跟 Lesson 20 不一樣：

- 用中文問也查得到（dense retrieval，BM25 在這題會回 0 筆）
- SEO 農場沒有出現在前五名（關鍵字堆砌被扣分）
- 2025 年的懶人包被壓下去了（新鮮度衰減）
- retarget-anything 的 GitHub 和 docs 站只出現一個（近似重複被合併）

⚠️ 但這只是一段**寫死的**腳本，演的是「如果 agent 願意相信排序」會怎麼樣。
實測真模型問同一個問題時，它並沒有這樣做——它照樣搜了十幾次去找
訓練資料裡記得的專案名，然後撞上步數上限。見 README Step 8。

**排序是離線量得出來的；agent 要不要相信排序，是另一個問題。**`;

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
					: "（這個假 provider 只有一段寫死的腳本，演完了。\n" +
						"想繼續問，換成真模型：bun run lesson-22\n" +
						"想看排序本身：bun run lesson-22:eval）";

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
