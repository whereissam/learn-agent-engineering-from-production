/**
 * Context compaction.
 *
 * The problem: every turn resends the full conversation history to the model. The longer the
 * history, the slower and more expensive each turn, until it hits the context window and the request fails.
 *
 * The fix: replace long-ago messages with a summary and keep the recent originals.
 *
 *   before: [msg1][msg2][msg3]...[msg40][msg41][msg42]
 *   after:  [summary: msg1-msg30 ][msg31]...[msg42]
 *            └─ one passage        └─ the original tail is kept
 *
 * Against Pi: packages/agent/src/harness/compaction/compaction.ts (880 lines)
 */

import type { Message } from "./providers/types.ts";
import type { StreamingProvider } from "./streaming/types.ts";

export interface CompactionConfig {
	/** Compact once the estimated token count exceeds this. */
	triggerTokens: number;
	/** How many original messages to keep after compaction. */
	keepRecent: number;
	/** How many tokens the summary itself may use. */
	summaryMaxTokens: number;
}

export const DEFAULT_COMPACTION: CompactionConfig = {
	// A real application sets this from the model's context window.
	// It is deliberately small here so compaction is visible in a short conversation.
	triggerTokens: Number(process.env.COMPACT_AT ?? 8000),
	keepRecent: 6,
	summaryMaxTokens: 2000,
};

/**
 * A rough token estimate.
 *
 * Real accuracy needs a provider's count_tokens API (different for every vendor, and one more
 * network round trip). Compaction's trigger point does not need that accuracy; 10% out changes
 * nothing, so a character count divided by a constant is enough.
 *
 * 4 is the empirical value for English. CJK is roughly 1.5-2 characters per token, so this
 * function **underestimates** Chinese conversations — and underestimating (compacting later) is
 * preferable to overestimating (compacting too early).
 */
export function estimateTokens(messages: Message[]): number {
	let chars = 0;

	for (const message of messages) {
		switch (message.role) {
			case "user":
				chars += message.text.length;
				break;
			case "assistant":
				for (const block of message.blocks) {
					chars += block.type === "text" ? block.text.length : JSON.stringify(block.args).length;
				}
				break;
			case "toolResult":
				for (const result of message.results) {
					chars += result.content.length;
				}
				break;
		}
	}

	return Math.ceil(chars / 4);
}

export interface CompactionResult {
	/** The message list to use after compaction. */
	messages: Message[];
	/** The summary text, which can be stored in the session for later reference. */
	summary: string;
	tokensBefore: number;
	tokensAfter: number;
	/** How many messages were summarised away. */
	compactedCount: number;
}

/** Should we compact? */
export function shouldCompact(messages: Message[], config: CompactionConfig): boolean {
	// Too short is not worth it: the summary costs money too, so compacting can cost more
	if (messages.length <= config.keepRecent + 2) return false;
	return estimateTokens(messages) > config.triggerTokens;
}

/**
 * Perform the compaction.
 *
 * This is "using an LLM to handle an LLM's context": one extra model call asking it to write
 * the old messages up as a summary.
 */
export async function compact(
	provider: StreamingProvider,
	messages: Message[],
	config: CompactionConfig,
	signal?: AbortSignal,
): Promise<CompactionResult> {
	const tokensBefore = estimateTokens(messages);

	// Split into "to be summarised" and "kept verbatim"
	const cutoff = findCutoff(messages, config.keepRecent);
	const toSummarize = messages.slice(0, cutoff);
	const recent = messages.slice(cutoff);

	const transcript = renderTranscript(toSummarize);

	// call() rather than stream(); the user does not need to watch this
	const response = await provider.call(
		{
			system: SUMMARY_SYSTEM_PROMPT,
			messages: [{ role: "user", text: transcript }],
			tools: [], // 摘要不需要工具
			maxTokens: config.summaryMaxTokens,
		},
		signal,
	);

	const summary =
		response.blocks
			.filter((b) => b.type === "text")
			.map((b) => b.text)
			.join("\n")
			.trim() || "(摘要產生失敗)";

	// The summary goes back as a **user message**.
	//
	// Why user rather than assistant? Because an assistant message means "what the model said",
	// and this summary was produced by us (the harness). As an assistant message it would make
	// the model believe it said all this, which can cause odd self-reference.
	const summaryMessage: Message = {
		role: "user",
		text:
			"[以下是這次對話較早部分的摘要。原始訊息已從 context 中移除以節省空間。]\n\n" +
			summary +
			"\n\n[摘要結束。以下是最近的對話原文。]",
	};

	const compactedMessages = [summaryMessage, ...recent];
	const tokensAfter = estimateTokens(compactedMessages);

	// Compaction **can make things worse**.
	//
	// A summary has a fixed cost floor (the wrapping text plus at least a few lines from the model).
	// If the compacted messages were short to begin with, the summary is longer than the original;
	// the first measured compaction went 424 → 455 tokens, a 7% loss.
	//
	// So check afterwards. With no gain, fall back to the original message list.
	if (tokensAfter >= tokensBefore) {
		return {
			messages,
			summary,
			tokensBefore,
			tokensAfter: tokensBefore,
			compactedCount: 0, // 0 代表「算了，沒壓」
		};
	}

	return {
		messages: compactedMessages,
		summary,
		tokensBefore,
		tokensAfter,
		compactedCount: toSummarize.length,
	};
}

/**
 * Find the cut point.
 *
 * There is a hard constraint here: **the cut may not fall between an assistant message with a
 * toolCall and its toolResult**. Cutting there leaves the kept messages starting with a
 * tool_result that has no matching tool_use, and the API returns 400.
 *
 * So search forwards from the ideal cut point until a safe position is found.
 */
function findCutoff(messages: Message[], keepRecent: number): number {
	let cutoff = Math.max(0, messages.length - keepRecent);

	// Move forwards until the cut point is **not** a toolResult
	while (cutoff < messages.length && messages[cutoff]?.role === "toolResult") {
		cutoff++;
	}

	return cutoff;
}

/** Turn the message list into plain text for the summarising model. */
function renderTranscript(messages: Message[]): string {
	const lines: string[] = [];

	for (const message of messages) {
		switch (message.role) {
			case "user":
				lines.push(`### User\n${message.text}`);
				break;

			case "assistant": {
				const parts: string[] = [];
				for (const block of message.blocks) {
					if (block.type === "text") {
						parts.push(block.text);
					} else {
						parts.push(`(called ${block.name} with ${JSON.stringify(block.args)})`);
					}
				}
				lines.push(`### Assistant\n${parts.join("\n")}`);
				break;
			}

			case "toolResult":
				for (const result of message.results) {
						// Tool output is truncated again inside the summary; the full content rarely matters,
						// what matters is "what was done, and did it succeed or fail"
					const preview =
						result.content.length > 500 ? `${result.content.slice(0, 500)}…` : result.content;
					lines.push(
						`### Tool result (${result.toolName})${result.isError ? " [ERROR]" : ""}\n${preview}`,
					);
				}
				break;
		}
	}

	return lines.join("\n\n");
}

/**
 * The system prompt for summarising.
 *
 * This prompt determines compaction quality and is worth iterating on. The key is listing
 * explicitly what must be kept, or the model writes an eloquent summary with no actionable information.
 */
const SUMMARY_SYSTEM_PROMPT = `You are summarizing an earlier portion of a coding agent's conversation so it can be dropped from the context window.

The summary you write REPLACES those messages. Anything you leave out is gone forever - the agent will not be able to recover it.

Preserve, in this order of priority:
1. What the user asked for, including constraints and preferences they stated.
2. Files that were read or modified, with their paths. Note what was changed.
3. Decisions made and the reasoning behind them.
4. Facts discovered about the codebase (structure, conventions, gotchas).
5. Anything that failed, and why - so the agent does not repeat it.
6. Work that is still outstanding.

Drop: full file contents, verbose command output, exploratory dead ends that led nowhere.

Write in the same language the user was using. Be specific and concrete ，
use real file paths and function names, not vague descriptions. Prefer a
compact bulleted structure over prose.`;
