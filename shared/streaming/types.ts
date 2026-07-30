/**
 * The streaming provider interface.
 *
 * It differs from shared/providers/types.ts in exactly one way: it adds stream().
 * Messages, tools and stopReason have identical shapes, so everything from Lessons 1-2 carries over.
 *
 * Why streaming?
 *   1. the user sees something moving immediately rather than staring at a cursor for 30 seconds
 *   2. you can stop it mid-generation (the other half of Lesson 3)
 *
 * Against Pi: StreamFn at packages/agent/src/types.ts:28
 */

export type {
	AssistantBlock,
	AssistantMessage,
	Message,
	ModelRequest,
	ModelResponse,
	StopReason,
	TokenUsage,
	ToolResult,
	ToolResultMessage,
	ToolSpec,
	UserMessage,
} from "../providers/types.ts";

import type { ModelRequest, ModelResponse } from "../providers/types.ts";

/**
 * The events emitted while streaming.
 *
 * Deliberately small. A real harness (Pi, say) has a dozen or more event kinds:
 * thinking start/end, tool arguments streamed character by character, usage updates…
 * Only the few needed to make a UI move are kept here.
 */
export type StreamEvent =
	/** The model started emitting a passage of text. */
	| { type: "text_start" }
	/** The next fragment of text. Printing this gives the typewriter effect. */
	| { type: "text_delta"; delta: string }
	/** That passage ended. */
	| { type: "text_end" }
	/**
	 * The model decided to call a tool.
	 *
	 * Note: this is emitted only once the arguments are **complete**.
	 * Some providers stream tool arguments character by character, but half a JSON document
	 * is useless to a UI, so we wait for it to be complete.
	 */
	| { type: "tool_call"; id: string; name: string; args: Record<string, unknown> }
	/** The stream ended. */
	| { type: "done"; response: ModelResponse }
	/**
	 * Something failed, or it was interrupted.
	 *
	 * The key design: an error is an **event**, not a throw.
	 * Because when a stream fails midway, the text already emitted is still valid,
	 * and you need a chance to preserve what you already have.
	 */
	| { type: "error"; message: string; aborted: boolean };

export interface StreamingProvider {
	readonly name: string;
	readonly model: string;

	/**
		 * Stream one model response.
	 *
		 * When signal is aborted, an implementation must:
		 *   1. stop reading
		 *   2. emit { type: "error", aborted: true }
		 *   3. not throw
	 *
		 * Why not throw? Because the loop needs to know what was produced before the interruption,
		 * so it can repair the conversation history into a legal state. See Lesson 3's README.
	 */
	stream(request: ModelRequest, signal?: AbortSignal): AsyncIterable<StreamEvent>;

	/**
		 * The non-streaming version, for places that do not need live output (Lesson 5's compaction, say).
		 * The default implementation simply drains stream().
	 */
	call(request: ModelRequest, signal?: AbortSignal): Promise<ModelResponse>;
}

/**
 * Drain a stream() into a single result.
 *
 * This demonstrates an important idea: **streaming is the primitive capability and non-streaming is its special case.**
 * The reverse is impossible; you cannot make streaming out of an API that only returns when everything is ready.
 * So a provider need only implement stream(), and call() can be generated from it.
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
