/**
 * Anthropic's streaming implementation.
 *
 * The SDK already parses SSE into events; the work here is translating them into our StreamEvent.
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
						// Check for an interruption between every event.
						// The SDK handles the signal too, and checking ourselves stops sooner.
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
						// thinking / tool_use stream events are ignored here;
						// tool calls are emitted together once the complete message arrives below.
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
					// An interruption arrives as an APIUserAbortError.
					// Turn it into an **event** rather than rethrowing; the loop needs to handle it gracefully.
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
// Conversion (identical to the non-streaming version)
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
