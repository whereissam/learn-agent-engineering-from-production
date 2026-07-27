/**
 * Context 壓縮。
 *
 * 問題：每一輪都要把「完整對話歷史」重送給模型。歷史越長，
 * 每一輪就越慢、越貴，最後撞到 context window 上限，請求直接失敗。
 *
 * 解法：把「很久以前的訊息」換成一段摘要，保留最近的原文。
 *
 *   壓縮前： [msg1][msg2][msg3]...[msg40][msg41][msg42]
 *   壓縮後： [摘要:msg1-msg30    ][msg31]...[msg42]
 *            └─ 一段文字         └─ 保留原文的「尾巴」
 *
 * 對照 Pi：packages/agent/src/harness/compaction/compaction.ts（880 行）
 */

import type { Message } from "./providers/types.ts";
import type { StreamingProvider } from "./streaming/types.ts";

export interface CompactionConfig {
	/** 估算 token 數超過這個值就壓縮。 */
	triggerTokens: number;
	/** 壓縮後保留最後幾則原始訊息。 */
	keepRecent: number;
	/** 摘要本身最多用多少 token。 */
	summaryMaxTokens: number;
}

export const DEFAULT_COMPACTION: CompactionConfig = {
	// 真實應用要看 model 的 context window 來設。
	// 這裡刻意設得很小，方便你在短對話裡就看到壓縮發生。
	triggerTokens: Number(process.env.COMPACT_AT ?? 8000),
	keepRecent: 6,
	summaryMaxTokens: 2000,
};

/**
 * 粗估 token 數。
 *
 * 真的要準就要用 provider 的 count_tokens API（每家都不一樣，而且要多打
 * 一次網路請求）。壓縮的觸發時機不需要那麼準，差 10% 不會怎樣，
 * 所以用字元數除以一個常數就夠了。
 *
 * 4 是英文的經驗值。CJK 大約 1.5-2 個字元一個 token，所以中文對話
 * 這個函式會「低估」，寧可低估晚一點壓縮，也不要高估而過早壓縮。
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
	/** 壓縮後要用的訊息串。 */
	messages: Message[];
	/** 摘要文字，可以存進 session 供之後查閱。 */
	summary: string;
	tokensBefore: number;
	tokensAfter: number;
	/** 被摘要掉的訊息數量。 */
	compactedCount: number;
}

/** 要不要壓縮？ */
export function shouldCompact(messages: Message[], config: CompactionConfig): boolean {
	// 太短就沒必要，摘要本身也要花錢，壓縮反而更貴
	if (messages.length <= config.keepRecent + 2) return false;
	return estimateTokens(messages) > config.triggerTokens;
}

/**
 * 執行壓縮。
 *
 * 這是一個「用 LLM 處理 LLM 的 context」的操作，我們額外呼叫一次模型，
 * 請它把舊訊息寫成摘要。
 */
export async function compact(
	provider: StreamingProvider,
	messages: Message[],
	config: CompactionConfig,
	signal?: AbortSignal,
): Promise<CompactionResult> {
	const tokensBefore = estimateTokens(messages);

	// 切成「要摘要的」跟「要保留原文的」
	const cutoff = findCutoff(messages, config.keepRecent);
	const toSummarize = messages.slice(0, cutoff);
	const recent = messages.slice(cutoff);

	const transcript = renderTranscript(toSummarize);

	// 用 call() 而不是 stream()，這個過程不需要給使用者看
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

	// 摘要以「使用者訊息」的形式放回去。
	//
	// 為什麼是 user 而不是 assistant？因為 assistant 訊息代表「模型說過的話」，
	// 但這段摘要是我們（harness）產生的。放成 assistant 會讓模型以為
	// 自己講過這些，可能導致奇怪的自我指涉。
	const summaryMessage: Message = {
		role: "user",
		text:
			"[以下是這次對話較早部分的摘要。原始訊息已從 context 中移除以節省空間。]\n\n" +
			summary +
			"\n\n[摘要結束。以下是最近的對話原文。]",
	};

	const compactedMessages = [summaryMessage, ...recent];
	const tokensAfter = estimateTokens(compactedMessages);

	// 壓縮「可能讓事情變糟」。
	//
	// 摘要有一個固定的成本下限（那段包裝文字 + 模型至少會寫幾行）。
	// 如果被壓縮的訊息本來就很短，摘要反而比原文長，我實測第一次
	// 壓縮就是 424 → 455 tokens，倒賠 7%。
	//
	// 所以算完要檢查。沒賺到就退回原本的訊息串。
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
 * 找切點。
 *
 * 這裡有一個硬性限制：**切點不能落在 assistant(有 toolCall) 跟它的
 * toolResult 中間**。切在那裡的話，保留下來的訊息會以一則沒有對應
 * tool_use 的 tool_result 開頭，API 會直接回 400。
 *
 * 所以我們從理想切點往後找，直到找到一個安全的位置。
 */
function findCutoff(messages: Message[], keepRecent: number): number {
	let cutoff = Math.max(0, messages.length - keepRecent);

	// 往後推，直到切點「不是」一則 toolResult
	while (cutoff < messages.length && messages[cutoff]?.role === "toolResult") {
		cutoff++;
	}

	return cutoff;
}

/** 把訊息串轉成純文字，餵給摘要用的模型。 */
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
					// 工具輸出在摘要裡再截一次，完整內容通常不重要，
					// 重要的是「做了什麼、結果成功還失敗」
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
 * 摘要用的 system prompt。
 *
 * 這段 prompt 決定壓縮的品質，值得反覆調整。重點是明確列出
 * 「什麼一定要留」，不然模型會寫出一段文情並茂但沒有可執行資訊的摘要。
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
