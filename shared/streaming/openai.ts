/**
 * The streaming implementation for OpenAI / Gemini.
 *
 * This is much fussier than the Anthropic version, because **OpenAI streams tool arguments character by character**:
 *
 *   delta.tool_calls[0].function.arguments = '{"pa'
 *   delta.tool_calls[0].function.arguments = 'th":"RE'
 *   delta.tool_calls[0].function.arguments = 'ADME.md"}'
 *
 * You have to reassemble those fragments by index yourself, and only JSON.parse once they are all in.
 * This is streaming's most common trap.
 */

import OpenAI from "openai";
import { describeProviderError } from "../providers/errors.ts";
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

/**
 * A `fetch` that does not let a failure's explanation get thrown away.
 *
 * Two things go wrong without it, and both were found the hard way (see
 * `shared/providers/errors.ts`):
 *
 *   1. on a streaming request the SDK does not always read the error body at
 *      all, so a perfectly good explanation becomes `400 status code (no body)`
 *   2. Google's OpenAI-compatible endpoint answers with a JSON **array**,
 *      `[{"error": {...}}]`, where the SDK looks for `{"error": {...}}`
 *
 * So on any non-2xx we read the body ourselves, unwrap a single-element array,
 * and hand the SDK a response it can parse. The status and the body's meaning
 * are unchanged — this only stops them being lost.
 *
 * `content-encoding` and `content-length` are dropped because the body has been
 * decoded by the time it is handed back; leaving them would describe bytes that
 * no longer exist.
 */
export async function fetchPreservingErrorBody(
	input: Parameters<typeof fetch>[0],
	init?: Parameters<typeof fetch>[1],
): Promise<Response> {
	const response = await fetch(input, init);
	if (response.ok) return response;

	let text: string;
	try {
		text = await response.clone().text();
	} catch {
		return response;
	}
	if (text.trim().length === 0) return response;

	let body = text;
	try {
		const parsed = JSON.parse(text);
		if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === "object") {
			body = JSON.stringify(parsed[0]);
		}
	} catch {
		// Not JSON. Handing the text back unchanged still beats "(no body)".
	}

	const headers = new Headers(response.headers);
	headers.delete("content-encoding");
	headers.delete("content-length");
	headers.set("content-type", "application/json");

	return new Response(body, { status: response.status, statusText: response.statusText, headers });
}

export function openaiStreamingProvider(options: OpenAiStreamingOptions): StreamingProvider {
	const client = new OpenAI({
		apiKey: options.apiKey,
		baseURL: options.baseURL,
		fetch: fetchPreservingErrorBody,
	});
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
							// Without this line the streaming response carries **no** usage.
							// That is the OpenAI-compatible API's default, which makes many people believe tokens cannot be measured while streaming.
						stream_options: { include_usage: true },
					},
					{ signal },
				);

				// Assembly state
				let text = "";
				let textOpen = false;
				let finishReason: string | null = null;
				let usage: TokenUsage | undefined;
				// key -> the tool call being accumulated
				//
				// `extra` holds additional fields a provider attaches to a tool call.
				// Gemini puts extra_content.google.thought_signature there, and
				// **it must be sent back verbatim next round**; without it the whole request is rejected with a 400
				// (and the response has no body, so the cause is invisible and it is extremely hard to debug).
				//
				// The same problem as Anthropic's thinking block:
				// a neutral representation cannot cover every provider's internal fields, so the raw form is kept too.
				const pending = new Map<
					string,
					{ id: string; name: string; args: string; extra?: Record<string, unknown> }
				>();
				/** Fragments with neither index nor id attach to the previous key. */
				let lastKey: string | undefined;

				for await (const chunk of stream) {
					if (signal?.aborted) {
						if (textOpen) yield { type: "text_end" };
						yield { type: "error", message: "Aborted by user", aborted: true };
						return;
					}

						// usage usually arrives in the **last chunk**, and that chunk has no choices.
						// So this line must come before `if (!choice) continue`, or it is never read.
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

						// Tool argument fragments, accumulated onto the same tool call.
					//
						// ⚠️ **index alone is not enough here.** OpenAI puts an index on every fragment and an id on the first;
						// Gemini's OpenAI-compatible layer **never sends index** (each delta is a complete
						// tool call carrying its own distinct id).
					//
						// Keying on index alone means that when Gemini returns several tool calls at once
						// they all land in `pending.get(undefined)`, so:
						//   args = '{"query":"a"}{"query":"b"}{"query":"c"}'   ← three JSON documents glued together
						// JSON.parse fails → the arguments become {} → the tool receives an empty query,
						// and that broken string is sent back next round, earning a 400 status code (no body).
					//
						// This bug never fired in Lessons 20-22, because the model happened to call one tool per round.
						// Once Lesson 23 copied deep-research's "plan 3-4 queries at once" into the prompt,
						// the very first run blew up. The full debugging account is in Lesson 23 Step 6.
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
							// Note this is += rather than =; fragments have to be joined
						if (call.function?.arguments) existing.args += call.function.arguments;

							// Take the provider's custom fields verbatim (Gemini's thought_signature lives here)
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

					// When truncated by max_tokens, the accumulated argument JSON may be half a document.
					// Such arguments must not be used even if they parse, so the whole batch is abandoned.
					// Against Pi: agent-loop.ts:211 failToolCallsFromTruncatedMessage
				if (stopReason === "max_tokens") {
					yield {
						type: "done",
						response: {
							blocks: text ? [{ type: "text", text }] : [],
							raw: { role: "assistant", content: text },
							stopReason,
								// ⚠️ usage must be carried. **A truncated call is billed too**,
								// and it is usually among the most expensive (the model thought for a long time before being cut off).
								// This line was missing for three lessons before Lesson 26's metering found it.
							usage,
						},
					};
					return;
				}

				const blocks: AssistantBlock[] = [];
				if (text) blocks.push({ type: "text", text });

					// A Map preserves insertion order, and insertion order is the order the provider sent,
					// so taking the values directly is enough. (This used to sort by numeric index,
					// and a key may now be an id, with no number to sort by.)
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

					// Rebuild the assistant message in native format, to be sent back next round
				const raw: OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam = {
					role: "assistant",
					content: text || null,
				};
				if (ordered.length > 0) {
					raw.tool_calls = ordered.map((call) => ({
							// ...call.extra must be spread first,
							// so the provider's extra fields (thought_signature) go back with it
							// without overwriting the id / type / function we assembled.
						...call.extra,
						id: call.id,
						type: "function" as const,
						function: {
							name: call.name,
								// Send back the original argument string; do not re-stringify the object we parsed.
								// Some providers verify a signature over that exact string.
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
					// Not `error.message`: see shared/providers/errors.ts for the hour
					// that decision cost, and why an error string is a product surface.
					message: aborted ? "Aborted by user" : describeProviderError(error),
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
