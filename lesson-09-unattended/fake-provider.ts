/**
 * Lesson 9 專用的 fake provider。
 *
 * 跟 Lesson 8 那份同樣的理由：共用的腳本只會呼叫唯讀工具，
 * 永遠不會走到「需要批准 → 沒人在場 → 停住」這條路。
 *
 * 劇本只有兩拍，因為這一課要看的是**兩拍中間那段空白**：
 *
 *   turn 0  send_email(...)   → EXTERNAL，沒人在場 → 進 inbox，agent 停住
 *   （…八小時…）
 *   turn 1  拿到工具結果，跟使用者報告
 *
 * turn 1 是重點。批准回來之後，**模型要消化那個結果並收尾**，
 * 這件事在原本的 demo 裡是 `console.log` 假裝的，看不到模型
 * 到底有沒有正確理解「剛剛那封信寄成功了 / 被拒絕了」。
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
				const text = "好，我來寄這封每日摘要。";
				yield* say(text, signal);
				const call = {
					id: "e1",
					name: "send_email",
					args: {
						to: "team@example.com",
						subject: "每日摘要",
						body: "今天的建置全部通過，沒有需要注意的事項。",
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

			// 第二拍：根據工具結果收尾。
			//
			// 這裡刻意讀了 messages 的最後一則，因為腳本 provider 也應該
			// **對結果有反應**，不然它就變成在演戲，而這一課要示範的
			// 正好就是「模型有沒有正確消化那個結果」。
			const last = request.messages[request.messages.length - 1];
			const denied =
				last?.role === "toolResult" && last.results.some((r) => r.isError);

			const text = denied
				? "那封信沒有寄出去（批准被拒絕了）。內容我留著，你要的話再說一聲。"
				: "已經寄出去了，收件人 team@example.com。";

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
