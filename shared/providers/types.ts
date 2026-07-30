/**
 * The provider seam.
 *
 * This file defines what a model looks like to my agent. It knows nothing about Anthropic
 * or OpenAI; the anthropic.ts / openai.ts beneath it do the translating.
 *
 * Why this layer? Because every provider's tool calling has a different shape:
 *   - Anthropic: one assistant message holds several tool_use blocks,
 *                and every tool_result goes into the **same** user message
 *   - OpenAI:    the assistant message has a tool_calls array,
 *                and each result needs **its own** role:"tool" message
 *   - Gemini:    functionCall / functionResponse, a third shape again
 *
 * Hardcode one of them into the agent loop and switching provider means rewriting the loop.
 *
 * Against Pi: StreamFn at packages/agent/src/types.ts:28
 *             — exactly the same idea, except Pi's version is streaming.
 */

// ─────────────────────────────────────────────────────────────
// Messages
// ─────────────────────────────────────────────────────────────

export type Message = UserMessage | AssistantMessage | ToolResultMessage;

export interface UserMessage {
	role: "user";
	text: string;
}

export interface AssistantMessage {
	role: "assistant";

	/** The neutral representation. Your code reads this. */
	blocks: AssistantBlock[];

	/**
	 * The provider's native response object, preserved verbatim.
	 *
	 * This field looks ugly and it is necessary: Anthropic's thinking blocks
	 * must be passed back **unchanged**, or the next request is rejected. A neutral representation
	 * cannot cover every provider's internal fields, so both are kept:
	 * blocks for us to read, raw to hand back to the provider.
	 *
	 * Nearly every real agent harness has this field.
	 */
	raw: unknown;
}

export interface ToolResultMessage {
	role: "toolResult";
	results: ToolResult[];
}

export type AssistantBlock =
	| { type: "text"; text: string }
	| { type: "toolCall"; id: string; name: string; args: Record<string, unknown> };

export interface ToolResult {
	toolCallId: string;
	toolName: string;
	/** The text the model sees. */
	content: string;
	isError?: boolean;
}

// ─────────────────────────────────────────────────────────────
// Tools
// ─────────────────────────────────────────────────────────────

export interface ToolSpec {
	name: string;
	/** This is not a comment but a prompt. This text alone decides whether the model calls this tool. */
	description: string;
	/** The arguments' JSON Schema (must be type: "object"). */
	parameters: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────
// Calls
// ─────────────────────────────────────────────────────────────

export interface ModelRequest {
	system: string;
	messages: Message[];
	tools: ToolSpec[];
	/** The output limit for one response. Note: thinking counts towards it. */
	maxTokens: number;
}

/**
 * Why the model stopped. This is the loop's most important branch condition.
 *
 * - "end"        it finished normally
 * - "tool_use"   it wants to call a tool and is waiting for you
 * - "max_tokens" it was truncated — this turn's output cannot be trusted, including tool call arguments
 * - "refusal"    the model refused, and content may be empty
 */
export type StopReason = "end" | "tool_use" | "max_tokens" | "refusal";

export interface ModelResponse {
	blocks: AssistantBlock[];
	raw: unknown;
	stopReason: StopReason;
	/**
		 * How many tokens this call used. undefined when the provider does not report it.
	 *
		 * ⚠️ **`total` does not equal `input + output`**, and the gap is large.
		 * Measured on Gemini 3.6 Flash: input=20, output=710, and total=2016 —
		 * the 1286 in between are thinking tokens, which are outside output, which you pay for,
		 * and which **share the `maxTokens` allowance with output**.
	 *
		 * So price from `total` rather than adding it up yourself. The full experiment is in Lesson 26.
	 */
	usage?: TokenUsage;
}

export interface TokenUsage {
	input: number;
	output: number;
		/** The total the provider reported. May exceed input + output (thinking tokens). */
	total: number;
}

export interface Provider {
	readonly name: string;
	readonly model: string;
	call(request: ModelRequest): Promise<ModelResponse>;
}
