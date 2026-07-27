/**
 * 記憶 provider 介面。
 *
 * Hermes 的 memory_provider.py 開頭那段 lifecycle 註解，
 * 幾乎是照抄下來就能用的設計：
 *
 *   initialize()          連線、建資源、暖機
 *   system_prompt_block()  放進 system prompt 的靜態文字
 *   prefetch(query)        每一輪之前的回想
 *   sync_turn(user, asst)  每一輪之後的寫入
 *   get_tool_schemas()     要不要給模型記憶相關的工具
 *   shutdown()             收尾
 *
 * 重點是這三個掛勾點**剛好對應我們 loop 的三個位置**：
 *
 *   systemPromptBlock()  → loop 開始之前，只做一次
 *   prefetch(query)      → 每次呼叫 LLM 之前（就是 Lesson 5 的 transformContext 位置）
 *   syncTurn(u, a)       → 每一輪結束之後
 *
 * 換句話說，「長期記憶」不是一個新的迴圈，是掛在舊迴圈上的三個 hook。
 *
 * 對照：hermes-agent/agent/memory_provider.py
 */

import type { ToolSpec } from "../providers/types.ts";

export interface MemoryProvider {
	/** 短識別名，例如 "file"、"honcho"。 */
	readonly name: string;

	/**
	 * 這個 provider 現在可以用嗎？
	 *
	 * Hermes 的註解特別說：**不要在這裡打網路**，只檢查設定跟相依。
	 * 因為它是在 agent 啟動時同步呼叫的，網路請求會拖慢啟動。
	 */
	isAvailable(): boolean;

	initialize?(): Promise<void>;

	/**
	 * 放進 system prompt 的靜態文字。
	 *
	 * 「靜態」是關鍵：這段內容在整個 session 裡不會變，
	 * 所以它可以被 prompt cache 快取。會變的東西要走 prefetch。
	 */
	systemPromptBlock(): string;

	/**
	 * 依照這一輪的輸入回想相關記憶。
	 *
	 * 回傳原始文字就好，**不要自己加圍欄**。
	 * 圍欄由 manager 統一加，理由見 manager.ts。
	 */
	prefetch(query: string): Promise<string>;

	/** 一輪結束後寫入。 */
	syncTurn(userMessage: string, assistantMessage: string): Promise<void>;

	/** 要給模型的記憶工具（例如「記住這件事」）。 */
	toolSpecs?(): ToolSpec[];

	/** 執行記憶工具。 */
	handleToolCall?(name: string, args: Record<string, unknown>): Promise<string>;

	shutdown?(): Promise<void>;
}
