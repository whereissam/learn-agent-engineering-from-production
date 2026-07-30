/**
 * The Anthropic implementation.
 *
 * This file is the **only** place in the whole exercise that knows the Anthropic SDK.
 * Against Pi: packages/ai/src/providers/anthropic.ts
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
		// The SDK reads ANTHROPIC_API_KEY itself
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
					// With no thinking configured, Opus 5 thinks by default (adaptive).
					// The thinking content is not returned by default (display: "omitted"), so content
					// contains a thinking block while text is empty. That is normal; do not delete it.
			});

			return {
				blocks: fromAnthropicContent(response.content),
					// Store the whole content array verbatim — including the thinking block.
				raw: response.content,
				stopReason: toStopReason(response.stop_reason),
			};
		},
	};
}

// ─────────────────────────────────────────────────────────────
// Neutral → Anthropic
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
				// Use raw rather than blocks — a thinking block must go back unchanged.
			return { role: "assistant", content: message.raw as Anthropic.ContentBlockParam[] };

		case "toolResult":
				// Anthropic's key rule: a batch of tool results all goes in **one** user message.
				// Splitting them stops the model making parallel tool calls afterwards.
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
// Anthropic → neutral
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
					// The Anthropic SDK has already parsed the JSON for you (OpenAI's has not)
				args: block.input as Record<string, unknown>,
			});
		}
			// A thinking block does not enter the neutral representation — it lives only in raw.
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
				// end_turn / stop_sequence / pause_turn all count as having finished.
				// (pause_turn only appears with server-side tools, which this lesson does not use.)
			return "end";
	}
}
