/**
 * OpenAI 實作 ， 同時也是 Gemini 實作。
 *
 * Gemini 提供 OpenAI 相容端點，所以同一份 code 換個 baseURL 就能用：
 *   https://generativelanguage.googleapis.com/v1beta/openai/
 *
 * 把這個檔案跟 anthropic.ts 並排看，就能看到 provider 抽象在解決什麼問題。
 * 三個地方形狀完全不同：
 *   1. tool 定義多包了一層 { type: "function", function: {...} }
 *   2. 工具參數是「JSON 字串」，要自己 parse（Anthropic 是解析好的物件）
 *   3. 工具結果要「一個結果一則訊息」（Anthropic 是全部塞同一則）
 */

import OpenAI from "openai";
import type {
	AssistantBlock,
	Message,
	ModelRequest,
	ModelResponse,
	Provider,
	StopReason,
	ToolSpec,
} from "./types.ts";

export interface OpenAiProviderOptions {
	model: string;
	apiKey?: string;
	/** 設了就打相容端點（例如 Gemini）。 */
	baseURL?: string;
	/**
	 * 新版 OpenAI 模型用 max_completion_tokens，舊版跟部分相容端點用 max_tokens。
	 * 如果收到 "Unrecognized request argument" 之類的錯誤，就把這個換掉。
	 */
	tokenParam?: "max_completion_tokens" | "max_tokens";
	label?: string;
}

export function openaiProvider(options: OpenAiProviderOptions): Provider {
	const client = new OpenAI({ apiKey: options.apiKey, baseURL: options.baseURL });
	const tokenParam = options.tokenParam ?? "max_completion_tokens";

	return {
		name: options.label ?? "openai",
		model: options.model,

		async call(request: ModelRequest): Promise<ModelResponse> {
			// 新舊 API 的欄位名不同，這裡挑一個展開進去。
			const tokenLimit =
				tokenParam === "max_tokens"
					? { max_tokens: request.maxTokens }
					: { max_completion_tokens: request.maxTokens };

			const completion = await client.chat.completions.create({
				model: options.model,
				...tokenLimit,
				// OpenAI 沒有獨立的 system 欄位 ， system prompt 是 messages[0]
				messages: [
					{ role: "system", content: request.system },
					...request.messages.flatMap(toOpenAiMessages),
				],
				tools: request.tools.map(toOpenAiTool),
			});

			const choice = completion.choices[0];
			if (!choice) {
				throw new Error("Model returned no choices");
			}

			const stopReason = toStopReason(choice.finish_reason);

			// 被截斷時，tool_calls 的 arguments 可能是半截的 JSON。
			// 這種參數解析得出來也不能用 ， 直接放棄這一輪，別執行。
			// 對照 Pi：agent-loop.ts:211 failToolCallsFromTruncatedMessage
			if (stopReason === "max_tokens") {
				return { blocks: [], raw: choice.message, stopReason };
			}

			return {
				blocks: fromOpenAiMessage(choice.message),
				raw: choice.message,
				stopReason,
			};
		},
	};
}

// ─────────────────────────────────────────────────────────────
// 中立 → OpenAI
// ─────────────────────────────────────────────────────────────

function toOpenAiTool(tool: ToolSpec): OpenAI.Chat.Completions.ChatCompletionTool {
	return {
		type: "function",
		function: {
			name: tool.name,
			description: tool.description,
			parameters: tool.parameters,
		},
	};
}

/**
 * 注意回傳型別是「陣列」，不是單一訊息。
 *
 * 這就是 seam 存在的理由：Anthropic 是 1 則中立訊息 → 1 則原生訊息，
 * OpenAI 的工具結果卻是 1 則中立訊息 → N 則原生訊息。
 * 上層 loop 完全不需要知道這件事。
 */
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
				// OpenAI 沒有 is_error 這個欄位，只能把錯誤寫進文字裡。
				// 這是「有損轉換」的典型例子 ， 中立表示比某些 provider 表達力強時，
				// 資訊就會在這裡掉一點。
				content: result.isError ? `Error: ${result.content}` : result.content,
			}));
	}
}

// ─────────────────────────────────────────────────────────────
// OpenAI → 中立
// ─────────────────────────────────────────────────────────────

function fromOpenAiMessage(
	message: OpenAI.Chat.Completions.ChatCompletionMessage,
): AssistantBlock[] {
	const blocks: AssistantBlock[] = [];

	if (message.content) {
		blocks.push({ type: "text", text: message.content });
	}

	for (const call of message.tool_calls ?? []) {
		if (call.type !== "function") continue;

		let args: Record<string, unknown>;
		try {
			// arguments 是「字串」，不是物件。這是最常見的踩雷點。
			args = JSON.parse(call.function.arguments || "{}");
		} catch {
			// 模型偶爾會吐出壞掉的 JSON。當成空參數丟給工具，
			// 讓工具自己 throw，錯誤訊息就會回到模型手上讓它重試。
			args = {};
		}

		blocks.push({ type: "toolCall", id: call.id, name: call.function.name, args });
	}

	return blocks;
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
