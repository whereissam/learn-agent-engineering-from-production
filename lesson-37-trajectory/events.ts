/**
 * The event model: **who said it, written into the type.**
 *
 * From Lesson 1 to 28, history has been an array of these three roles:
 *
 *   user / assistant / toolResult
 *
 * **That is a chat log.** It can express "somebody said something" and cannot express that
 * "what the agent wants to do" and "what the world answered" are facts of different natures.
 *
 * OpenHands records something else (`openhands/src/types/agent-server/core/events/`):
 *
 *   ActionEvent       what the agent wants to do (thought + tool_call + who emitted it)
 *   ObservationEvent  what the environment returned; source is always "environment"
 *
 * ⚠️ **`source: "environment"` at `observation-event.ts:10` is the whole point of the lesson.**
 * It is a hard rule in the type system, not a convention. In plain words:
 *
 * > **An observation is not what the agent said, it is what the world said.**
 *
 * Against `base/common.ts:56`: `SourceType = "agent" | "user" | "environment" | "hook"`.
 * Four sources, and **every event pins its own source down**,
 * so "what the model claimed" and "what was measured" cannot enter the same field.
 */

export type Source = "agent" | "user" | "environment";

export interface BaseEvent {
	id: string;
	timestamp: number;
	source: Source;
}

/** What the user said. */
export interface MessageEvent extends BaseEvent {
	kind: "message";
	source: "user" | "agent";
	text: string;
}

/**
 * The agent wants to do something.
 *
 * Note that `thought` and `action` are separate fields: **a thought is not an action**.
 * Our `blocks: [{text}, {toolCall}]` separates them too,
 * but the two fields below are ones we do not have.
 */
export interface ActionEvent extends BaseEvent {
	kind: "action";
	source: "agent";
	thought: string;
	toolName: string;
	toolCallId: string;
	args: Record<string, unknown>;
	/**
	 * Actions emitted by the same LLM response share an id (`action-event.ts:56`).
	 *
	 * ⚠️ **This is the data-model answer to Lesson 23's bug that lay latent for three lessons.**
	 * There, Gemini's OpenAI-compatible layer did not send `index`, and parallel tool calls'
	 * arguments were concatenated into one broken string. We fixed it with `index ?? id`;
	 * OpenHands **has the concept of "the same response" in its data model**.
	 *
	 * And it does more than fix a bug: with it you can distinguish
	 * "one response called three tools" from "three responses each called one" —
	 * two completely different situations for doom-loop detection (the opencode rule mentioned in Lesson 28).
	 */
	llmResponseId: string;
	/**
	 * ⚠️ **This field is a counter-example, and the source says so itself.**
	 *
	 * `security_risk` at `action-event.ts:61` is a risk level **predicted by the LLM**.
	 * And the comment at `:44-47` explains how they handle it:
	 *
	 * > `tool_call` may contain `security_risk` field predicted by LLM when
	 * > LLM risk analyzer is enabled, while `action` does not.
	 *
	 * **They store "the model's self-assessed risk" separately from "the action itself".** That design is right,
	 * and the field conflicts head-on with Lesson 8's position: risk classification should be deterministic and decided by the harness.
	 *
	 * So it is kept here, and `agent.ts` measures whether it is worth believing.
	 */
	selfAssessedRisk?: "UNKNOWN" | "LOW" | "MEDIUM" | "HIGH";
}

/** What the environment returned. **source is pinned to "environment".** */
export interface ObservationEvent extends BaseEvent {
	kind: "observation";
	source: "environment";
	toolName: string;
	toolCallId: string;
	/** Which action this responds to. */
	actionId: string;
	content: string;
	/** Only tools with an exit code have one. It is a measurement, not a narration. */
	exitCode?: number;
}

/**
 * The user rejected this action (`observation-event.ts:39`).
 *
 * ⚠️ **This is its own event type, carrying `rejection_reason`.**
 *
 * In Lessons 8/9 we stuffed rejections into `ToolResult.isError`'s string,
 * so "the user said no" and "the tool broke" look identical.
 * And their consequences differ completely: a broken tool is worth retrying and a user rejection is not
 * (Lesson 28 says the same about `interrupted` — the third appearance).
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
 * **Our own harness broke** (`observation-event.ts:52`, `source: "agent"`).
 *
 * A third kind of failure, different from both above:
 *
 *   observation + exitCode≠0   the world says this failed
 *   user-reject                a person says do not do it
 *   agent-error                **our program has a bug**
 *
 * The cost of mixing them is concrete: you end up tuning prompts to work around your own bug.
 */
export interface AgentErrorEvent extends BaseEvent {
	kind: "agent-error";
	source: "agent";
	toolName: string;
	toolCallId: string;
	error: string;
}

/**
 * Compaction is itself an event in the trajectory (`condensation-event.ts`).
 *
 * Lesson 5 rewrites the message array directly, so **afterwards you cannot tell compaction happened**.
 * As an event, "which events were forgotten" is data rather than a side effect:
 *
 *   forgottenIds  the events removed from the LLM's view
 *   summary       the summary replacing them
 *
 * And the source's comment names the key term: `removed from the View given to the LLM`.
 * **The trajectory is append-only and the view is computed**; see `trajectory.ts`.
 */
export interface CondensationEvent extends BaseEvent {
	kind: "condensation";
	source: "environment";
	forgottenIds: string[];
	summary: string;
	/** Where in the view the summary is inserted. */
	summaryOffset?: number;
}

export type TrajectoryEvent =
	| MessageEvent
	| ActionEvent
	| ObservationEvent
	| UserRejectEvent
	| AgentErrorEvent
	| CondensationEvent;

/** Whether this event is "what the world said". */
export function isFromEnvironment(event: TrajectoryEvent): boolean {
	return event.source === "environment";
}
