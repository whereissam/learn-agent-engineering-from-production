/**
 * 假的 streaming provider。
 *
 * 它會「慢慢地」吐字，這樣你才看得到打字機效果，也才有時間按 Ctrl+C 測中斷。
 * 每個 delta 之間的延遲會檢查 signal，所以中斷是即時的。
 */

import type { ModelRequest, ModelResponse, StreamEvent, StreamingProvider } from "./types.ts";
import { drain } from "./types.ts";

/** 每個字之間停多久（毫秒）。調大一點比較容易手動測中斷。 */
const DELAY_MS = Number(process.env.FAKE_DELAY_MS ?? 25);

export function fakeStreamingProvider(): StreamingProvider {
	let step = 0;

	const provider: StreamingProvider = {
		name: "fake",
		model: "scripted-stream",

		async *stream(request: ModelRequest, signal?: AbortSignal): AsyncIterable<StreamEvent> {
			// 壓縮請求長得跟一般對話不一樣：沒有工具，而且 system prompt
			// 在講「summarizing」。認出它，回一段像樣的短摘要，
			// 不然假 provider 會把它的罐頭長文當成摘要，壓縮後反而變大。
			if (request.tools.length === 0 && request.system.includes("summarizing")) {
				const summary =
					"- 使用者請 agent 檢查一個 URL 短網址服務的專案\n" +
					"- 已讀取 src/store.ts 與 src/config.ts\n" +
					"- 發現 config.ts 的 ALPHABET 含大寫字母，但 store.ts 的 lookup() 會先 toLowerCase()\n" +
					"- 尚未修正，測試仍為 2 fail / 3 pass";
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

			// 前兩輪呼叫工具，之後講一段長話（方便你測中斷）
			if (hasTools && turn === 0) {
				yield* say("我先看一下專案結構。", signal);
				if (signal?.aborted) return yield aborted();
				yield { type: "tool_call", id: "s1", name: "list_files", args: {} };
				yield {
					type: "done",
					response: {
						blocks: [
							{ type: "text", text: "我先看一下專案結構。" },
							{ type: "toolCall", id: "s1", name: "list_files", args: {} },
						],
						raw: null,
						stopReason: "tool_use",
					},
				};
				return;
			}

			if (hasTools && turn === 1) {
				yield* say("接著讀 store.ts。", signal);
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
							{ type: "text", text: "接著讀 store.ts。" },
							{ type: "toolCall", id: "s2", name: "read_file", args: { path: "src/store.ts" } },
						],
						raw: null,
						stopReason: "tool_use",
					},
				};
				return;
			}

			// 一段刻意寫長的回覆，讓你有足夠時間按 Ctrl+C
			const long =
				"這是一段刻意寫得很長的回覆，目的是讓你有足夠的時間按下 Ctrl+C 試試看中斷。\n\n" +
				"當你按下去的時候，注意三件事：\n" +
				"第一，文字會立刻停在某個字的中間，不會等整段講完。\n" +
				"第二，已經印出來的文字不會消失，它是有效的資料，會被保存進對話歷史。\n" +
				"第三，程式不會崩潰，你會回到提示符號，而且可以繼續對話。\n\n" +
				"這三件事都需要刻意設計才會發生。詳細原理請看 Lesson 3 的 README。\n";

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

/** 一個字一個字吐出去，中間留空檔給中斷。 */
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
