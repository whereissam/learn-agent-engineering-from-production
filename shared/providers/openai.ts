/**
 * The OpenAI implementation — which is also the Gemini implementation.
 *
 * Gemini offers an OpenAI-compatible endpoint, so the same code works with a different baseURL:
 *   https://generativelanguage.googleapis.com/v1beta/openai/
 *
 * Put this file beside anthropic.ts and you can see what the provider abstraction solves.
 * Three places differ entirely in shape:
 *   1. tool definitions carry an extra { type: "function", function: {...} } wrapper
 *   2. tool arguments are a **JSON string** you have to parse (Anthropic's are parsed objects)
 *   3. tool results need **one message per result** (Anthropic puts them all in one)
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
	/** Set this to hit a compatible endpoint (Gemini, say). */
	baseURL?: string;
	/**
		 * Newer OpenAI models use max_completion_tokens; older ones and some compatible endpoints use max_tokens.
		 * On an error like "Unrecognized request argument", swap this.
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
				// The old and new APIs name the field differently; pick one and spread it in.
			const tokenLimit =
				tokenParam === "max_tokens"
					? { max_tokens: request.maxTokens }
					: { max_completion_tokens: request.maxTokens };

			const completion = await client.chat.completions.create({
				model: options.model,
				...tokenLimit,
					// OpenAI has no separate system field — the system prompt is messages[0]
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

				// The non-streaming usage is in the response body directly, with no need for stream_options.
			//
				// ⚠️ This section was added later: Lesson 26 added `usage` to the shared
				// `ModelResponse` and **filled it only in the streaming implementation**. The type promised
				// something half the implementations did not deliver — Lessons 1-2's readers always got
				// undefined, with no message saying why.
			//
				// **A shared type is a promise. When adding a field, check every implementation,
				// not just the one you are looking at.**
			const usage = completion.usage
				? {
						input: completion.usage.prompt_tokens ?? 0,
						output: completion.usage.completion_tokens ?? 0,
						total: completion.usage.total_tokens ?? 0,
					}
				: undefined;

				// On truncation, tool_calls' arguments may be half a JSON document.
				// Such arguments must not be used even if they parse — abandon this turn rather than executing.
				// Against Pi: agent-loop.ts:211 failToolCallsFromTruncatedMessage
				// A truncated call is billed too, so this path must carry usage as well.
				// (The streaming implementation missed this for three lessons; see Lesson 26 Step 3.)
			if (stopReason === "max_tokens") {
				return { blocks: [], raw: choice.message, stopReason, usage };
			}

			return {
				blocks: fromOpenAiMessage(choice.message),
				raw: choice.message,
				stopReason,
				usage,
			};
		},
	};
}

// ─────────────────────────────────────────────────────────────
// Neutral → OpenAI
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
 * Note the return type is an **array**, not a single message.
 *
 * That is why the seam exists: Anthropic is 1 neutral message → 1 native message,
 * while OpenAI's tool results are 1 neutral message → N native messages.
 * The loop above never needs to know.
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
					// OpenAI has no is_error field, so an error can only go into the text.
					// A classic lossy conversion — when the neutral representation is more expressive than
					// some provider, information is lost right here.
				content: result.isError ? `Error: ${result.content}` : result.content,
			}));
	}
}

// ─────────────────────────────────────────────────────────────
// OpenAI → neutral
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
				// arguments is a **string**, not an object. The most common trap.
			args = JSON.parse(call.function.arguments || "{}");
		} catch {
				// Models occasionally emit broken JSON. Passing empty arguments to the tool
				// lets the tool throw, and the error message reaches the model so it can retry.
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
