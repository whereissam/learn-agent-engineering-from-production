/**
 * Streaming 版的 provider 介面。
 *
 * 跟 shared/providers/types.ts 的差別只有一個：多了 stream()。
 * 訊息、工具、stopReason 的形狀完全一樣，所以 Lesson 1-2 的東西都能直接沿用。
 *
 * 為什麼要 streaming？
 *   1. 使用者能立刻看到東西在動，而不是盯著游標等 30 秒
 *   2. 你可以在生成到一半的時候喊停（Lesson 3 的另一半）
 *
 * 對照 Pi：packages/agent/src/types.ts:28 的 StreamFn
 */

export type {
	AssistantBlock,
	AssistantMessage,
	Message,
	ModelRequest,
	ModelResponse,
	StopReason,
	ToolResult,
	ToolResultMessage,
	ToolSpec,
	UserMessage,
} from "../providers/types.ts";

import type { ModelRequest, ModelResponse } from "../providers/types.ts";

/**
 * 串流過程中吐出來的事件。
 *
 * 刻意做得很小。真實的 harness（例如 Pi）會有十幾種事件，
 * thinking 開始/結束、工具參數逐字串流、usage 更新……
 * 這裡只留下讓 UI 動起來最必要的幾種。
 */
export type StreamEvent =
	/** 模型開始輸出一段文字。 */
	| { type: "text_start" }
	/** 文字的下一小塊。把這個印出來就會有打字機效果。 */
	| { type: "text_delta"; delta: string }
	/** 這段文字結束了。 */
	| { type: "text_end" }
	/**
	 * 模型決定要呼叫某個工具。
	 *
	 * 注意：這是在參數「完整收到之後」才發出。
	 * 有些 provider 會逐字串流工具參數，但半截的 JSON 對 UI 沒用，
	 * 所以我們等它完整了再發。
	 */
	| { type: "tool_call"; id: string; name: string; args: Record<string, unknown> }
	/** 串流結束。 */
	| { type: "done"; response: ModelResponse }
	/**
	 * 出錯了，或被中斷了。
	 *
	 * 關鍵設計：錯誤是「事件」，不是 throw。
	 * 因為串流到一半失敗時，前面已經吐出去的文字仍然有效，
	 * 你需要一個機會把「已經拿到的部分」保存下來。
	 */
	| { type: "error"; message: string; aborted: boolean };

export interface StreamingProvider {
	readonly name: string;
	readonly model: string;

	/**
	 * 串流一次模型回應。
	 *
	 * signal 被 abort 時，實作必須：
	 *   1. 停止讀取
	 *   2. 發出 { type: "error", aborted: true }
	 *   3. 不要 throw
	 *
	 * 為什麼不 throw？因為 loop 需要知道「中斷前已經產生了什麼」，
	 * 才能把對話歷史修回一個合法狀態。詳見 Lesson 3 README。
	 */
	stream(request: ModelRequest, signal?: AbortSignal): AsyncIterable<StreamEvent>;

	/**
	 * 不串流的版本，給不需要即時輸出的場合用（例如 Lesson 5 的壓縮）。
	 * 預設實作就是把 stream() 收乾。
	 */
	call(request: ModelRequest, signal?: AbortSignal): Promise<ModelResponse>;
}

/**
 * 把一個 stream() 收乾成單一結果。
 *
 * 這裡示範了一個重要觀念：**streaming 才是原始能力，非串流是它的特例。**
 * 反過來做不到，你沒辦法從一個「等全部好了才回傳」的 API 生出 streaming。
 * 所以 provider 只要實作 stream()，call() 可以自動生出來。
 */
export async function drain(
	events: AsyncIterable<StreamEvent>,
): Promise<ModelResponse> {
	for await (const event of events) {
		if (event.type === "done") return event.response;
		if (event.type === "error") {
			throw new Error(event.message);
		}
	}
	throw new Error("Stream ended without a done event");
}
