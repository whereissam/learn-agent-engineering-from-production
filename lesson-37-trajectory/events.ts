/**
 * 事件模型：**誰說的，寫在型別裡。**
 *
 * Lesson 1 到 28，history 都是這三種角色的陣列：
 *
 *   user / assistant / toolResult
 *
 * **那是聊天記錄。** 它能表達「有人說了什麼」，表達不了
 * 「agent 想做什麼」跟「世界回了什麼」是兩種不同性質的事實。
 *
 * OpenHands 記的是另一種東西（`openhands/src/types/agent-server/core/events/`）：
 *
 *   ActionEvent       agent 想做什麼（thought + tool_call + 誰發的）
 *   ObservationEvent  環境回了什麼    source 永遠是 "environment"
 *
 * ⚠️ **`observation-event.ts:10` 那個 `source: "environment"` 是整課的重點。**
 * 它是型別上的硬性規定，不是慣例。翻譯成人話：
 *
 * > **observation 不是 agent 說的，是世界說的。**
 *
 * 對照 `base/common.ts:56`：`SourceType = "agent" | "user" | "environment" | "hook"`。
 * 四個來源，而**每一種事件都把自己的 source 釘死**，
 * 所以「模型宣稱的事」跟「量測到的事」在型別上就進不了同一個欄位。
 */

export type Source = "agent" | "user" | "environment";

export interface BaseEvent {
	id: string;
	timestamp: number;
	source: Source;
}

/** 使用者說的話。 */
export interface MessageEvent extends BaseEvent {
	kind: "message";
	source: "user" | "agent";
	text: string;
}

/**
 * agent 想做一件事。
 *
 * 注意 `thought` 跟 `action` 是分開的欄位：**想法不是動作**。
 * 我們的 `blocks: [{text}, {toolCall}]` 也算分開了，
 * 但下面兩個欄位是我們沒有的。
 */
export interface ActionEvent extends BaseEvent {
	kind: "action";
	source: "agent";
	thought: string;
	toolName: string;
	toolCallId: string;
	args: Record<string, unknown>;
	/**
	 * 同一次 LLM 回應發出的動作共用一個 id（`action-event.ts:56`）。
	 *
	 * ⚠️ **這正是 Lesson 23 那個潛伏三課的 bug 的資料模型解。**
	 * 那次 Gemini 的 OpenAI 相容層不送 `index`，平行工具呼叫的 arguments
	 * 被串成一個壞字串。我們是靠 `index ?? id` 修的；
	 * OpenHands **在資料模型裡就有「同一次回應」這個概念**。
	 *
	 * 而且它不只修 bug：有了它才分得出
	 * 「一次回應叫了三個工具」和「三次回應各叫一個工具」——
	 * 那對 doom-loop 偵測（Lesson 28 提到的 opencode 規則）是兩種完全不同的情況。
	 */
	llmResponseId: string;
	/**
	 * ⚠️ **這個欄位是反面教材，而且原始碼自己講明了。**
	 *
	 * `action-event.ts:61` 的 `security_risk` 是 **LLM 預測的**風險等級。
	 * 而 `:44-47` 的註解說明了他們怎麼處理它：
	 *
	 * > `tool_call` may contain `security_risk` field predicted by LLM when
	 * > LLM risk analyzer is enabled, while `action` does not.
	 *
	 * **他們把「模型自評的風險」跟「動作本身」分開存。** 這個設計是對的，
	 * 但它跟 Lesson 8 的立場正面衝突：風險分級應該是確定性的、由 harness 決定。
	 *
	 * 所以這裡保留它，然後用 `agent.ts` 去量它值不值得信。
	 */
	selfAssessedRisk?: "UNKNOWN" | "LOW" | "MEDIUM" | "HIGH";
}

/** 環境回了什麼。**source 釘死成 "environment"。** */
export interface ObservationEvent extends BaseEvent {
	kind: "observation";
	source: "environment";
	toolName: string;
	toolCallId: string;
	/** 這是在回應哪一個 action。 */
	actionId: string;
	content: string;
	/** 有 exit code 的工具才有。它是量測，不是敘述。 */
	exitCode?: number;
}

/**
 * 使用者拒絕了這個動作（`observation-event.ts:39`）。
 *
 * ⚠️ **這是一個獨立的事件型別，帶 `rejection_reason`。**
 *
 * 我們在 Lesson 8/9 把拒絕塞進 `ToolResult.isError` 的字串裡，
 * 於是「使用者說不」和「工具自己壞了」長得一模一樣。
 * 而它們的後續完全不同：工具壞了值得重試，使用者拒絕不值得
 * （Lesson 28 對 `interrupted` 也講了同一句話 —— 第三次出現了）。
 */
export interface UserRejectEvent extends BaseEvent {
	kind: "user-reject";
	source: "environment";
	toolName: string;
	toolCallId: string;
	actionId: string;
	rejectionReason: string;
}

/**
 * **我們自己的鷹架壞了**（`observation-event.ts:52`，`source: "agent"`）。
 *
 * 第三種失敗，跟上面兩種都不同：
 *
 *   observation + exitCode≠0   環境說這件事失敗了
 *   user-reject                人說不要做
 *   agent-error                **我們的程式有 bug**
 *
 * 混在一起的代價很具體：你會拿著自己的 bug 去調 prompt。
 */
export interface AgentErrorEvent extends BaseEvent {
	kind: "agent-error";
	source: "agent";
	toolName: string;
	toolCallId: string;
	error: string;
}

/**
 * 壓縮本身是 trajectory 裡的一個事件（`condensation-event.ts`）。
 *
 * Lesson 5 是直接改寫訊息陣列，所以**壓縮完之後看不出壓縮過**。
 * 當成事件之後，「哪些事件被忘掉了」是資料，不是副作用：
 *
 *   forgottenIds  被移出 LLM view 的事件
 *   summary       取代它們的摘要
 *
 * 而原始碼的註解點出了關鍵字：`removed from the View given to the LLM`。
 * **trajectory 是 append-only 的，view 是算出來的**，見 `trajectory.ts`。
 */
export interface CondensationEvent extends BaseEvent {
	kind: "condensation";
	source: "environment";
	forgottenIds: string[];
	summary: string;
	/** 摘要要插在 view 的哪個位置。 */
	summaryOffset?: number;
}

export type TrajectoryEvent =
	| MessageEvent
	| ActionEvent
	| ObservationEvent
	| UserRejectEvent
	| AgentErrorEvent
	| CondensationEvent;

/** 這個事件是不是「世界說的」。 */
export function isFromEnvironment(event: TrajectoryEvent): boolean {
	return event.source === "environment";
}
