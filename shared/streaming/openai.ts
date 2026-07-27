/**
 * OpenAI / Gemini 的 streaming 實作。
 *
 * 這裡比 Anthropic 版麻煩很多，原因是 **OpenAI 的工具參數是逐字串流的**：
 *
 *   delta.tool_calls[0].function.arguments = '{"pa'
 *   delta.tool_calls[0].function.arguments = 'th":"RE'
 *   delta.tool_calls[0].function.arguments = 'ADME.md"}'
 *
 * 你必須自己把這些碎片依 index 拼回去，全部收完才能 JSON.parse。
 * 這是 streaming 最常見的踩雷點。
 */

import OpenAI from "openai";
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

export interface OpenAiStreamingOptions {
	model: string;
	apiKey?: string;
	baseURL?: string;
	tokenParam?: "max_completion_tokens" | "max_tokens";
	label?: string;
}

export function openaiStreamingProvider(options: OpenAiStreamingOptions): StreamingProvider {
	const client = new OpenAI({ apiKey: options.apiKey, baseURL: options.baseURL });
	const tokenParam = options.tokenParam ?? "max_completion_tokens";

	const provider: StreamingProvider = {
		name: options.label ?? "openai",
		model: options.model,

		async *stream(request: ModelRequest, signal?: AbortSignal): AsyncIterable<StreamEvent> {
			try {
				const tokenLimit =
					tokenParam === "max_tokens"
						? { max_tokens: request.maxTokens }
						: { max_completion_tokens: request.maxTokens };

				const stream = await client.chat.completions.create(
					{
						model: options.model,
						...tokenLimit,
						messages: [
							{ role: "system", content: request.system },
							...request.messages.flatMap(toOpenAiMessages),
						],
						tools: request.tools.map(toOpenAiTool),
						stream: true,
					},
					{ signal },
				);

				// 拼裝中的狀態
				let text = "";
				let textOpen = false;
				let finishReason: string | null = null;
				// index -> 累積中的 tool call
				//
				// `extra` 存的是 provider 自己塞在 tool call 上的額外欄位。
				// Gemini 會放 extra_content.google.thought_signature，而且
				// **下一輪必須原封不動送回去**，少了它整個請求會被 400 拒絕
				// （而且回應沒有 body，看不出原因，超難 debug）。
				//
				// 這跟 Anthropic 的 thinking block 是同一個問題：
				// 中立表示涵蓋不了每家 provider 的內部欄位，所以原始的也要留一份。
				const pending = new Map<
					number,
					{ id: string; name: string; args: string; extra?: Record<string, unknown> }
				>();

				for await (const chunk of stream) {
					if (signal?.aborted) {
						if (textOpen) yield { type: "text_end" };
						yield { type: "error", message: "Aborted by user", aborted: true };
						return;
					}

					const choice = chunk.choices[0];
					if (!choice) continue;

					if (choice.finish_reason) finishReason = choice.finish_reason;

					const delta = choice.delta;

					if (delta?.content) {
						if (!textOpen) {
							textOpen = true;
							yield { type: "text_start" };
						}
						text += delta.content;
						yield { type: "text_delta", delta: delta.content };
					}

					// 工具參數碎片，依 index 累積
					for (const call of delta?.tool_calls ?? []) {
						const index = call.index;
						const existing = pending.get(index) ?? { id: "", name: "", args: "" };

						if (call.id) existing.id = call.id;
						if (call.function?.name) existing.name = call.function.name;
						// 注意這裡是 += 而不是 =，碎片要接起來
						if (call.function?.arguments) existing.args += call.function.arguments;

						// 把 provider 自訂的欄位原樣收下來（Gemini 的 thought_signature 在這裡）
						for (const [key, value] of Object.entries(call)) {
							if (key === "index" || key === "id" || key === "type" || key === "function") continue;
							existing.extra = { ...existing.extra, [key]: value };
						}

						pending.set(index, existing);
					}
				}

				if (textOpen) yield { type: "text_end" };

				const stopReason = toStopReason(finishReason);

				// 被 max_tokens 截斷時，累積的參數 JSON 可能是半截的。
				// 那種參數就算 parse 得出來也不能用，整批放棄。
				// 對照 Pi：agent-loop.ts:211 failToolCallsFromTruncatedMessage
				if (stopReason === "max_tokens") {
					yield {
						type: "done",
						response: {
							blocks: text ? [{ type: "text", text }] : [],
							raw: { role: "assistant", content: text },
							stopReason,
						},
					};
					return;
				}

				const blocks: AssistantBlock[] = [];
				if (text) blocks.push({ type: "text", text });

				// 依 index 排序，讓輸出順序穩定
				const ordered = [...pending.entries()].sort((a, b) => a[0] - b[0]).map(([, call]) => call);

				for (const call of ordered) {
					let args: Record<string, unknown>;
					try {
						args = JSON.parse(call.args || "{}");
					} catch {
						args = {};
					}
					blocks.push({ type: "toolCall", id: call.id, name: call.name, args });
					yield { type: "tool_call", id: call.id, name: call.name, args };
				}

				// 重建原生格式的 assistant 訊息，供下一輪送回去
				const raw: OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam = {
					role: "assistant",
					content: text || null,
				};
				if (ordered.length > 0) {
					raw.tool_calls = ordered.map((call) => ({
						// ...call.extra 一定要展開在最前面，
						// 這樣 provider 的額外欄位（thought_signature）會跟著回去，
						// 但又不會蓋掉我們自己組的 id / type / function。
						...call.extra,
						id: call.id,
						type: "function" as const,
						function: {
							name: call.name,
							// 送回原始的參數字串，不要 re-stringify 我們 parse 過的物件。
							// 有些 provider 會拿這段字串去驗簽。
							arguments: call.args || "{}",
						},
					}));
				}

				yield { type: "done", response: { blocks, raw, stopReason } };
			} catch (error) {
				const aborted =
					signal?.aborted === true ||
					(error instanceof Error &&
						(error.name === "APIUserAbortError" || error.name === "AbortError"));

				yield {
					type: "error",
					message: aborted
						? "Aborted by user"
						: error instanceof Error
							? error.message
							: String(error),
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

function toOpenAiTool(tool: ToolSpec): OpenAI.Chat.Completions.ChatCompletionTool {
	return {
		type: "function",
		function: { name: tool.name, description: tool.description, parameters: tool.parameters },
	};
}

function toOpenAiMessages(message: Message): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
	switch (message.role) {
		case "user":
			return [{ role: "user", content: message.text }];
		case "assistant":
			return [message.raw as OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam];
		case "toolResult":
			return message.results.map((result) => ({
				role: "tool" as const,
				tool_call_id: result.toolCallId,
				content: result.isError ? `Error: ${result.content}` : result.content,
			}));
	}
}

function toStopReason(reason: string | null): StopReason {
	switch (reason) {
		case "tool_calls":
		case "function_call":
			return "tool_use";
		case "length":
			return "max_tokens";
		case "content_filter":
			return "refusal";
		default:
			return "end";
	}
}
