/**
 * The internal structure of one assistant message: **parts, not a string.**
 *
 * Lessons 1-27's history looks like this:
 *
 *   { role: "assistant", blocks: [...] }   ← written only after the turn ends
 *
 * That is entirely adequate on a normal finish, because "the turn ended" and "it was written to history" are one event.
 * **On an interruption they are not**, so you need a shape that can express "not finished yet".
 *
 * Against opencode: `packages/schema/src/session-message.ts`
 *
 * ⚠️ The most worth copying decision in that file is in `ToolState`:
 *
 *   pending    input is a **string**     ← the arguments are still streaming and may not be legal JSON
 *   running    input is a Record         ← the arguments arrived and were parsed
 *   completed  input + output
 *   error      input + error
 *
 * `pending.input` being a string rather than an object states a fact at the type level:
 * **tool arguments arrive character by character, and interrupting midway leaves half a JSON document.**
 * Represent all four states with one `input?: Record` and that fact disappears,
 * and on the day it disappears you get a `JSON.parse` exception, or worse — an empty object.
 *
 * Against `session-message.ts:81-119` (four states each with their own fields).
 */

export interface TimeSpan {
	created: number;
	/** No completed = **not finished**. That undefined is information, not missing data. */
	completed?: number;
}

export type ToolState =
		/** The arguments are still streaming. `input` is the raw string and may be half a JSON document. */
	| { status: "pending"; input: string }
		/** The arguments arrived and the tool is running. */
	| { status: "running"; input: Record<string, unknown> }
	| { status: "completed"; input: Record<string, unknown>; output: string }
	| {
			status: "error";
			input: Record<string, unknown>;
			error: string;
			/**
				 * ⚠️ **"Interrupted" and "the tool broke" are not the same thing.**
			 *
				 * opencode marks an interrupted tool `{ ...metadata, interrupted: true }`
				 * (`session/processor.ts:589`) rather than leaving it in running forever.
				 * Both are an error status, and downstream needs to tell them apart:
				 * a broken tool is worth retrying, a user interruption is not.
			 */
			interrupted?: boolean;
	  };

export type Part =
	| { type: "reasoning"; id: string; text: string; time: TimeSpan }
	| { type: "text"; id: string; text: string; time: TimeSpan }
	| {
			type: "tool";
			id: string;
			name: string;
			state: ToolState;
			/**
				 * Three timestamps, not two (`session-message.ts:132-137`):
				 *   created   the tool call was seen
				 *   ran       execution started
				 *   completed execution finished
			 *
				 * The middle one is easy to omit, and without it you cannot distinguish
				 * "the arguments have not finished arriving" from "it is taking a long time" — two completely different kinds of stuck.
			 */
			time: TimeSpan & { ran?: number };
	  };

export interface AssistantMessage {
	id: string;
	parts: Part[];
	/**
		 * What this turn did to the workspace (Lesson 29's patch).
	 *
		 * Only filenames are stored, deliberately, and **undefined and an empty array mean different things**:
		 *   undefined  not computed yet
		 *   []         computed, and nothing changed
	 */
	snapshot?: { files: string[] };
	/** Why it ended: normally, interrupted, or with an error. */
	finish?: "end" | "interrupted" | "error";
	time: TimeSpan;
}

// ─────────────────────────────────────────────────────────────
// Constructors. "What time is it" is centralised in one place so tests can control time.
// ─────────────────────────────────────────────────────────────

export type Clock = () => number;

export function newMessage(id: string, now: number): AssistantMessage {
	return { id, parts: [], time: { created: now } };
}

export function isInFlight(part: Part): boolean {
	if (part.type === "tool") {
		return part.state.status === "pending" || part.state.status === "running";
	}
	return part.time.completed === undefined;
}

/** A one-line summary for humans. */
export function describePart(part: Part): string {
	if (part.type === "tool") {
			// On error, show the error message rather than the input: an interrupted pending tool's
			// input is `{}` (half a JSON document does not parse), and the real information is in the message.
		if (part.state.status === "error") {
			const flag = part.state.interrupted ? " (interrupted)" : "";
			return `tool ${part.name} [error${flag}] ${part.state.error.slice(0, 72)}`;
		}
		const input = JSON.stringify(part.state.input).slice(0, 44);
		return `tool ${part.name} [${part.state.status}] ${input}`;
	}
	const done = part.time.completed === undefined ? "…" : "";
	return `${part.type} ${JSON.stringify(part.text.slice(0, 36))}${done}`;
}
