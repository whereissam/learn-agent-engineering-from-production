/**
 * 這一課的假 provider。
 *
 * 前面幾課的假 provider 是「照腳本演一段軌跡」，這一課不一樣：
 * research loop 會呼叫**四種不同的步驟**，所以它必須看懂自己被問了什麼，
 * 然後回對應形狀的 JSON。
 *
 * 這件事本身就說明了 research loop 跟 agent loop 的差別：
 * agent loop 只有一種呼叫（「這是對話歷史，下一步做什麼」），
 * research loop 有四種各自獨立、各自可測的呼叫。
 *
 * **它回的 sources 是從 prompt 裡真的抓出來的網址**，不是編的——
 * 否則 `extractLearnings` 的來源過濾會把它全部丟掉（那個過濾是刻意的，
 * 見 steps.ts）。假 provider 也要遵守真規則。
 */

import type {
	ModelRequest,
	ModelResponse,
	StreamEvent,
	StreamingProvider,
} from "../shared/streaming/types.ts";
import { drain } from "../shared/streaming/types.ts";

const DELAY_MS = Number(process.env.FAKE_DELAY_MS ?? 0);

const QUERIES_LAYER_1 = [
	{ query: "open source video to humanoid motion retargeting unitree g1", goal: "找出候選專案" },
	{ query: "unitree g1 sdk joint ordering change 2026", goal: "確認相容性的根因" },
	{ query: "humanoid motion imitation project license maintained", goal: "確認授權與維護狀態" },
];

const QUERIES_LAYER_2 = [
	{ query: "retarget-anything g1 profile deprecated replacement", goal: "確認棄用後的替代方案" },
	{ query: "humanoid-mimic foot sliding contact solver workaround", goal: "確認已知限制" },
];

export function fakeResearchProvider(): StreamingProvider {
	let queryRounds = 0;

	const provider: StreamingProvider = {
		name: "fake",
		model: "scripted-research",

		async *stream(request: ModelRequest): AsyncIterable<StreamEvent> {
			const prompt = request.messages.map((m) => (m.role === "user" ? m.text : "")).join("\n");
			let text: string;

			if (prompt.includes("follow-up questions that would")) {
				// clarify
				text = JSON.stringify([
					"你要的是可以直接跑在實體 G1 上的方案，還是模擬也可以？",
					"商用嗎？（會影響能不能接受非商業授權的模型權重）",
					"需要即時串流，還是離線批次處理就夠？",
				]);
			} else if (prompt.includes("web search queries")) {
				// generateQueries
				text = JSON.stringify(queryRounds++ === 0 ? QUERIES_LAYER_1 : QUERIES_LAYER_2);
			} else if (prompt.includes("Extract up to")) {
				// extractLearnings：sources 一定要用 prompt 裡真的出現過的網址
				const urls = [...prompt.matchAll(/<source url="([^"]+)"/g)].map((m) => m[1] ?? "");
				const first = urls[0] ?? "";
				const second = urls[1] ?? first;
				text = JSON.stringify({
					learnings: first
						? [
								{
									text: `根據 ${first} 的正文，這一頁對應的專案狀態與 snippet 給的印象不同（這是假 provider 的罐頭結論）。`,
									sources: [first],
								},
								{
									text: `${second} 提供了版本與授權資訊，可以用來判斷是否適合商用。`,
									sources: [second],
								},
							]
						: [],
					followUps: ["這個專案最後一次更新是什麼時候？", "有沒有實機驗證的紀錄？"],
				});
			} else if (prompt.includes("Write a report")) {
				text =
					"（這是假 provider 產生的報告）\n\n" +
					"上面的證據清單是真的跑完整條管線得到的：每一條都經過搜尋 → 排序 → 抓取 → 抽取 → 萃取，\n" +
					"而且來源網址通過了「只能引用真的抓過的頁面」這個檢查。\n\n" +
					"結論的文字是罐頭的，因為沒有真模型。想看真的報告：`bun run lesson-24`。\n\n" +
					"這一課真正要看的不是報告內容，是上面那段「實際用掉」的數字——\n" +
					"研究**跑完了**，而且花費在開跑前就算得出來。";
			} else {
				text = "(fake provider 不認得這個 prompt)";
			}

			yield { type: "text_start" };
			if (DELAY_MS > 0) await new Promise((r) => setTimeout(r, DELAY_MS));
			yield { type: "text_delta", delta: text };
			yield { type: "text_end" };
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
