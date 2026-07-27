/**
 * The provider seam.
 *
 * 這個檔案定義「我的 agent 眼中的模型長什麼樣」。它不認識 Anthropic，
 * 也不認識 OpenAI ， 底下的 anthropic.ts / openai.ts 負責翻譯。
 *
 * 為什麼要這一層？因為每家 provider 的 tool calling 形狀都不一樣：
 *   - Anthropic：一則 assistant 訊息裡有多個 tool_use block，
 *                所有 tool_result 也塞在「同一則」user 訊息裡
 *   - OpenAI：   assistant 訊息有 tool_calls 陣列，
 *                但每個結果要「各自」一則 role:"tool" 訊息
 *   - Gemini：   functionCall / functionResponse，又是第三種形狀
 *
 * 如果 agent loop 直接寫死其中一種，換 provider 就要重寫整個 loop。
 *
 * 對照 Pi：packages/agent/src/types.ts:28 的 StreamFn
 *          ， 一模一樣的想法，只是 Pi 的版本是 streaming 的。
 */

// ─────────────────────────────────────────────────────────────
// 訊息
// ─────────────────────────────────────────────────────────────

export type Message = UserMessage | AssistantMessage | ToolResultMessage;

export interface UserMessage {
	role: "user";
	text: string;
}

export interface AssistantMessage {
	role: "assistant";

	/** 中立表示。你的程式碼讀這個。 */
	blocks: AssistantBlock[];

	/**
	 * Provider 原生的回覆物件，原封不動保存。
	 *
	 * 這個欄位看起來很醜，但它是必要的：Anthropic 的 thinking block
	 * 必須「一字不改」傳回去，否則下一輪請求會被拒絕。中立表示不可能
	 * 涵蓋每家 provider 的所有內部欄位，所以我們兩份都留 ，
	 * blocks 給自己讀，raw 給 provider 傳回去。
	 *
	 * 真實的 agent harness 幾乎都有這一欄。
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
	/** 回給模型看的文字。 */
	content: string;
	isError?: boolean;
}

// ─────────────────────────────────────────────────────────────
// 工具
// ─────────────────────────────────────────────────────────────

export interface ToolSpec {
	name: string;
	/** 這不是註解，是 prompt。模型只靠這段字決定要不要呼叫這個工具。 */
	description: string;
	/** 參數的 JSON Schema（必須是 type: "object"）。 */
	parameters: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────
// 呼叫
// ─────────────────────────────────────────────────────────────

export interface ModelRequest {
	system: string;
	messages: Message[];
	tools: ToolSpec[];
	/** 單次回覆的輸出上限。注意：thinking 也算在裡面。 */
	maxTokens: number;
}

/**
 * 模型為什麼停下來。這是 loop 最重要的分支依據。
 *
 * - "end"        正常說完了
 * - "tool_use"   想呼叫工具，等你執行
 * - "max_tokens" 被截斷了 ， 這一輪的輸出不可信，包括 tool call 的參數
 * - "refusal"    模型拒絕回答，content 可能是空的
 */
export type StopReason = "end" | "tool_use" | "max_tokens" | "refusal";

export interface ModelResponse {
	blocks: AssistantBlock[];
	raw: unknown;
	stopReason: StopReason;
}

export interface Provider {
	readonly name: string;
	readonly model: string;
	call(request: ModelRequest): Promise<ModelResponse>;
}
