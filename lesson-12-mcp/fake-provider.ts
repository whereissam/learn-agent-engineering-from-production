/**
 * Lesson 12 專用的 fake provider。
 *
 * 一樣的理由（這是第四課自備了）：共用的腳本只會呼叫檔案工具，
 * 不會碰到任何 MCP 工具，那就什麼都示範不到。
 *
 * 劇本兩拍，對應這一課的兩個重點：
 *
 *   turn 0  mcp__fleet__list_robots        唯讀，但**還是要批准**
 *   turn 1  mcp__fleet__schedule_maintenance  外部副作用，一定要批准
 *
 * turn 0 是重點：`list_robots` 聽起來完全無害，
 * 但它是別人寫的程式，**你只有它的名字跟一句它自己寫的描述**。
 */

import type {
	ModelRequest,
	ModelResponse,
	StreamEvent,
	StreamingProvider,
} from "../shared/streaming/types.ts";
import { drain } from "../shared/streaming/types.ts";

const DELAY_MS = Number(process.env.FAKE_DELAY_MS ?? 8);

export function mcpFakeProvider(): StreamingProvider {
	let step = 0;

	const provider: StreamingProvider = {
		async *stream(request: ModelRequest, signal?: AbortSignal): AsyncIterable<StreamEvent> {
			const turn = step++;

			/** 找一個名字符合的工具，找不到就退回第一個，這樣 COLLIDE 模式也跑得動。 */
			const pick = (suffix: string): string =>
				request.tools.find((tool) => tool.name.endsWith(suffix))?.name ??
				request.tools[0]?.name ??
				"unknown";

			if (turn === 0) {
				const text = "我先看一下哪些機器人在維修中。";
				yield* say(text, signal);
				const call = {
					id: "m1",
					name: pick("list_robots"),
					args: { status: "maintenance" },
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

			if (turn === 1) {
				const text = "R-204 在維修中。我幫它排一個維修時段。";
				yield* say(text, signal);
				const call = {
					id: "m2",
					name: pick("schedule_maintenance"),
					args: {
						robot_id: "R-204",
						window: { start: "2026-08-01T02:00:00Z", hours: 3 },
						notes: null,
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

			const last = request.messages[request.messages.length - 1];
			const denied = last?.role === "toolResult" && last.results.some((r) => r.isError);
			const text = denied
				? "維修時段沒有排成（批准被拒絕了）。目前在維修中的是 R-204。"
				: "排好了。目前在維修中的是 R-204，維修時段已通知現場人員。";

			yield* say(text, signal);
			yield {
				type: "done",
				response: { blocks: [{ type: "text", text }], raw: null, stopReason: "end" },
			};
		},

		name: "fake",
		model: "scripted-mcp",

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
