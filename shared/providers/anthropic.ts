/**
 * Anthropic 實作。
 *
 * 這個檔案是整個練習裡「唯一」認識 Anthropic SDK 的地方。
 * 對照 Pi：packages/ai/src/providers/anthropic.ts
 */

import Anthropic from "@anthropic-ai/sdk";
import type {
	AssistantBlock,
	Message,
	ModelRequest,
	ModelResponse,
	Provider,
	StopReason,
	ToolSpec,
} from "./types.ts";

export function anthropicProvider(model: string): Provider {
	// SDK 會自己讀 ANTHROPIC_API_KEY
	const client = new Anthropic();

	return {
		name: "anthropic",
		model,

		async call(request: ModelRequest): Promise<ModelResponse> {
			const response = await client.messages.create({
				model,
				max_tokens: request.maxTokens,
				system: request.system,
				tools: request.tools.map(toAnthropicTool),
				messages: request.messages.map(toAnthropicMessage),
				// 沒有設 thinking → Opus 5 預設就會思考（adaptive）。
				// 思考內容預設不回傳（display: "omitted"），所以 content 裡
				// 會有 thinking block 但 text 是空的。這正常，別去刪它。
			});

			return {
				blocks: fromAnthropicContent(response.content),
				// 整個 content 陣列原封不動存起來 ， 包含 thinking block。
				raw: response.content,
				stopReason: toStopReason(response.stop_reason),
			};
		},
	};
}

// ─────────────────────────────────────────────────────────────
// 中立 → Anthropic
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
			// 用 raw，不是用 blocks ， thinking block 必須原樣傳回去。
			return { role: "assistant", content: message.raw as Anthropic.ContentBlockParam[] };

		case "toolResult":
			// Anthropic 的關鍵規則：一批工具結果全部放在「同一則」user 訊息裡。
			// 拆成多則會讓模型之後不再做平行工具呼叫。
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

// ─────────────────────────────────────────────────────────────
// Anthropic → 中立
// ─────────────────────────────────────────────────────────────

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
				// Anthropic SDK 已經幫你把 JSON 解析好了（OpenAI 沒有）
				args: block.input as Record<string, unknown>,
			});
		}
		// thinking block 不進中立表示 ， 它只活在 raw 裡。
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
			// end_turn / stop_sequence / pause_turn 都當成講完了。
			// （pause_turn 只有在用 server-side 工具時才會出現，這一課用不到。）
			return "end";
	}
}
