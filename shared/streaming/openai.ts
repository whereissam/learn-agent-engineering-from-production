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
	TokenUsage,
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
						// 沒有這一行，串流回應**不會**帶 usage。
						// 這是 OpenAI 相容 API 的預設，很多人因此以為串流量不到 token。
						stream_options: { include_usage: true },
					},
					{ signal },
				);

				// 拼裝中的狀態
				let text = "";
				let textOpen = false;
				let finishReason: string | null = null;
				let usage: TokenUsage | undefined;
				// key -> 累積中的 tool call
				//
				// `extra` 存的是 provider 自己塞在 tool call 上的額外欄位。
				// Gemini 會放 extra_content.google.thought_signature，而且
				// **下一輪必須原封不動送回去**，少了它整個請求會被 400 拒絕
				// （而且回應沒有 body，看不出原因，超難 debug）。
				//
				// 這跟 Anthropic 的 thinking block 是同一個問題：
				// 中立表示涵蓋不了每家 provider 的內部欄位，所以原始的也要留一份。
				const pending = new Map<
					string,
					{ id: string; name: string; args: string; extra?: Record<string, unknown> }
				>();
				/** 沒有 index 也沒有 id 的碎片，接到上一個 key 上。 */
				let lastKey: string | undefined;

				for await (const chunk of stream) {
					if (signal?.aborted) {
						if (textOpen) yield { type: "text_end" };
						yield { type: "error", message: "Aborted by user", aborted: true };
						return;
					}

					// usage 通常在**最後一個 chunk**，而且那個 chunk 沒有 choices。
					// 所以這一行必須在 `if (!choice) continue` 之前，不然永遠讀不到。
					if (chunk.usage) {
						usage = {
							input: chunk.usage.prompt_tokens ?? 0,
							output: chunk.usage.completion_tokens ?? 0,
							total: chunk.usage.total_tokens ?? 0,
						};
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

					// 工具參數碎片，累積到同一個 tool call 上。
					//
					// ⚠️ 這裡**不能只看 index**。OpenAI 每個碎片都帶 index、只有第一個帶 id；
					// 但 Gemini 的 OpenAI 相容層**完全不送 index**（每個 delta 是一個
					// 完整的 tool call，各自帶不同的 id）。
					//
					// 只用 index 當 key 的話，Gemini 一次回多個工具呼叫時，
					// 它們會全部塞進 `pending.get(undefined)`，於是：
					//   args = '{"query":"a"}{"query":"b"}{"query":"c"}'   ← 三段 JSON 黏在一起
					// JSON.parse 失敗 → 參數變成 {} → 工具收到空 query，
					// 而且這個壞掉的字串會被送回下一輪，換來 400 status code (no body)。
					//
					// 這個 bug 在 Lesson 20-22 都沒發作，因為模型剛好每輪只叫一個工具。
					// Lesson 23 把 deep-research 的「一次規劃 3-4 條 query」抄進 prompt 之後，
					// 第一次跑就炸了。完整的除錯過程在 Lesson 23 Step 6。
					for (const call of delta?.tool_calls ?? []) {
						const key =
							typeof call.index === "number"
								? `index:${call.index}`
								: call.id
									? `id:${call.id}`
									: (lastKey ?? "index:0");
						lastKey = key;
						const existing = pending.get(key) ?? { id: "", name: "", args: "" };

						if (call.id) existing.id = call.id;
						if (call.function?.name) existing.name = call.function.name;
						// 注意這裡是 += 而不是 =，碎片要接起來
						if (call.function?.arguments) existing.args += call.function.arguments;

						// 把 provider 自訂的欄位原樣收下來（Gemini 的 thought_signature 在這裡）
						for (const [field, value] of Object.entries(call)) {
							if (field === "index" || field === "id" || field === "type" || field === "function") {
								continue;
							}
							existing.extra = { ...existing.extra, [field]: value };
						}

						pending.set(key, existing);
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
							// ⚠️ usage 一定要帶上。**被截斷的呼叫一樣要付錢**，
							// 而且它通常是最貴的那幾筆（模型想了很久才被砍斷）。
							// 這一行漏了三課才被 Lesson 26 的計量發現。
							usage,
						},
					};
					return;
				}

				const blocks: AssistantBlock[] = [];
				if (text) blocks.push({ type: "text", text });

				// Map 保留插入順序，而插入順序就是 provider 送出的順序，
				// 所以直接取值就好。（之前這裡是照 index 數字排序，
				// 但 key 現在可能是 id，沒有數字可以排。）
				const ordered = [...pending.values()];

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

				yield { type: "done", response: { blocks, raw, stopReason, usage } };
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
