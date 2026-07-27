/**
 * Anthropic 的 streaming 實作。
 *
 * SDK 已經幫你把 SSE 解析成事件了，這裡的工作是把它翻譯成我們的 StreamEvent。
 */

import Anthropic from "@anthropic-ai/sdk";
import type {
	AssistantBlock,
	Message,
	ModelRequest,
	ModelResponse,
	StopReason,
	StreamEvent,
	StreamingProvider,
	ToolSpec,
} from "./types.ts";
import { drain } from "./types.ts";

export function anthropicStreamingProvider(model: string): StreamingProvider {
	const client = new Anthropic();

	const provider: StreamingProvider = {
		name: "anthropic",
		model,

		async *stream(request: ModelRequest, signal?: AbortSignal): AsyncIterable<StreamEvent> {
			try {
				const stream = client.messages.stream(
					{
						model,
						max_tokens: request.maxTokens,
						system: request.system,
						tools: request.tools.map(toAnthropicTool),
						messages: request.messages.map(toAnthropicMessage),
					},
					{ signal },
				);

				let textOpen = false;

				for await (const event of stream) {
					// 每一個事件之間都檢查一次中斷。
					// SDK 也會處理 signal，但我們自己檢查可以更快停下來。
					if (signal?.aborted) {
						if (textOpen) yield { type: "text_end" };
						yield { type: "error", message: "Aborted by user", aborted: true };
						return;
					}

					if (event.type === "content_block_start" && event.content_block.type === "text") {
						textOpen = true;
						yield { type: "text_start" };
					} else if (
						event.type === "content_block_delta" &&
						event.delta.type === "text_delta"
					) {
						yield { type: "text_delta", delta: event.delta.text };
					} else if (event.type === "content_block_stop" && textOpen) {
						textOpen = false;
						yield { type: "text_end" };
					}
					// thinking / tool_use 的串流事件在這裡忽略，
					// 工具呼叫等下面拿到完整訊息後統一發出。
				}

				const message = await stream.finalMessage();

				for (const block of message.content) {
					if (block.type === "tool_use") {
						yield {
							type: "tool_call",
							id: block.id,
							name: block.name,
							args: block.input as Record<string, unknown>,
						};
					}
				}

				yield {
					type: "done",
					response: {
						blocks: fromAnthropicContent(message.content),
						raw: message.content,
						stopReason: toStopReason(message.stop_reason),
					},
				};
			} catch (error) {
				// 中斷會以 APIUserAbortError 的形式丟出來。
				// 把它變成一個「事件」而不是繼續往上丟，loop 需要優雅地處理它。
				const aborted =
					signal?.aborted === true ||
					(error instanceof Error && error.name === "APIUserAbortError");

				yield {
					type: "error",
					message: aborted ? "Aborted by user" : error instanceof Error ? error.message : String(error),
					aborted,
				};
			}
		},

		async call(request: ModelRequest, signal?: AbortSignal): Promise<ModelResponse> {
			return await drain(provider.stream(request, signal));
		},
	};

	return provider;
}

// ─────────────────────────────────────────────────────────────
// 轉換（跟非串流版一樣）
// ─────────────────────────────────────────────────────────────

function toAnthropicTool(tool: ToolSpec): Anthropic.Tool {
	return {
		name: tool.name,
		description: tool.description,
		input_schema: tool.parameters as Anthropic.Tool["input_schema"],
	};
}

function toAnthropicMessage(message: Message): Anthropic.MessageParam {
	switch (message.role) {
		case "user":
			return { role: "user", content: message.text };
		case "assistant":
			return { role: "assistant", content: message.raw as Anthropic.ContentBlockParam[] };
		case "toolResult":
			return {
				role: "user",
				content: message.results.map(
					(result): Anthropic.ToolResultBlockParam => ({
						type: "tool_result",
						tool_use_id: result.toolCallId,
						content: result.content,
						is_error: result.isError,
					}),
				),
			};
	}
}

function fromAnthropicContent(content: Anthropic.ContentBlock[]): AssistantBlock[] {
	const blocks: AssistantBlock[] = [];
	for (const block of content) {
		if (block.type === "text") {
			blocks.push({ type: "text", text: block.text });
		} else if (block.type === "tool_use") {
			blocks.push({
				type: "toolCall",
				id: block.id,
				name: block.name,
				args: block.input as Record<string, unknown>,
			});
		}
	}
	return blocks;
}

function toStopReason(reason: Anthropic.Message["stop_reason"]): StopReason {
	switch (reason) {
		case "tool_use":
			return "tool_use";
		case "max_tokens":
			return "max_tokens";
		case "refusal":
			return "refusal";
		default:
			return "end";
	}
}
