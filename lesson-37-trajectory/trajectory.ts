/**
 * Trajectory: an append-only event stream, plus **computable** queries.
 *
 * This file is where this lesson's thesis lives. It is two hundred lines, and every function demonstrates
 * the same thing: **with a different data structure, questions that needed reading prose become set operations.**
 *
 *   conflicts()     the agent claimed success and the environment said failure → they line up
 *   failureKinds()  three kinds of failure                                     → distinguishable
 *   batches()       which actions came from one response                       → countable
 *   view()          the version the LLM sees                                   → computed rather than rewritten
 *
 * The last one incidentally fixes a flaw in Lesson 5: after compaction you cannot tell it happened.
 *
 * > **The trajectory is the complete record of fact, and the view is the projection the model sees.**
 * > Once separated, compaction stops being a destructive rewrite.
 */

import type { ActionEvent, TrajectoryEvent } from "./events.ts";

export class Trajectory {
	private readonly events: TrajectoryEvent[] = [];

		/** Append-only. **No update and no delete, deliberately.** */
	add(event: TrajectoryEvent): void {
		this.events.push(event);
	}

	all(): readonly TrajectoryEvent[] {
		return this.events;
	}

	/**
		 * The version the LLM sees: the projection after applying every condensation.
	 *
		 * Against the comment at `condensation-event.ts:12-14`
	 * （`removed from the View given to the LLM`）。
	 */
	view(): TrajectoryEvent[] {
		const forgotten = new Set<string>();
		for (const event of this.events) {
			if (event.kind === "condensation") {
				for (const id of event.forgottenIds) forgotten.add(id);
			}
		}
		return this.events.filter((event) => !forgotten.has(event.id));
	}

	/**
		 * **Flatten the trajectory into a chat log** — that is, Lessons 1-28's shape.
	 *
		 * This function exists solely to **demonstrate what that loses**:
		 * all three failures become one string, source disappears, llmResponseId disappears.
		 * `demo.ts` uses it as the contrast against the trajectory.
	 */
	toChatHistory(): { role: "user" | "assistant" | "toolResult"; content: string }[] {
		const out: { role: "user" | "assistant" | "toolResult"; content: string }[] = [];
		for (const event of this.view()) {
			switch (event.kind) {
				case "message":
					out.push({ role: event.source === "user" ? "user" : "assistant", content: event.text });
					break;
				case "action":
					out.push({
						role: "assistant",
						content: `${event.thought}\n[tool ${event.toolName} ${JSON.stringify(event.args)}]`,
					});
					break;
				case "observation":
					out.push({ role: "toolResult", content: event.content });
					break;
					// ⚠️ These two lines are where the information is lost: three failures of different natures
					// are flattened into one thing (a string), with no way to see who said it.
				case "user-reject":
					out.push({ role: "toolResult", content: `Error: ${event.rejectionReason}` });
					break;
				case "agent-error":
					out.push({ role: "toolResult", content: `Error: ${event.error}` });
					break;
				case "condensation":
					out.push({ role: "assistant", content: event.summary });
					break;
			}
		}
		return out;
	}

	// ───────────────────────────────────────────────────────────
		// Queries
	// ───────────────────────────────────────────────────────────

	/**
		 * The agent claimed success and the environment said failure.
	 *
		 * **This is the lesson's core query**, and it is only writable because
		 * an observation's `exitCode` is a field and its `source` is pinned.
		 * On a chat log the same question is a natural-language-understanding problem (see `demo.ts`).
	 */
	conflicts(): { action: ActionEvent; exitCode: number; claim: string }[] {
		const out: { action: ActionEvent; exitCode: number; claim: string }[] = [];

		for (const event of this.events) {
			if (event.kind !== "observation") continue;
			if (event.exitCode === undefined || event.exitCode === 0) continue;

			const action = this.events.find(
				(candidate): candidate is ActionEvent =>
					candidate.kind === "action" && candidate.id === event.actionId,
			);
			if (!action) continue;

				// Did the agent say anything after this action.
			const index = this.events.indexOf(event);
			const claim = this.events
				.slice(index + 1)
				.find((later) => later.kind === "message" && later.source === "agent");

			if (claim && claim.kind === "message") {
				out.push({ action, exitCode: event.exitCode, claim: claim.text });
			}
		}
		return out;
	}

		/** How many of each of the three failures. */
	failureKinds(): { environment: number; rejected: number; scaffold: number } {
		let environment = 0;
		let rejected = 0;
		let scaffold = 0;
		for (const event of this.events) {
			if (event.kind === "observation" && event.exitCode !== undefined && event.exitCode !== 0) {
				environment++;
			}
			if (event.kind === "user-reject") rejected++;
			if (event.kind === "agent-error") scaffold++;
		}
		return { environment, rejected, scaffold };
	}

		/** Actions grouped by llmResponseId. One group = one LLM response. */
	batches(): Map<string, ActionEvent[]> {
		const out = new Map<string, ActionEvent[]>();
		for (const event of this.events) {
			if (event.kind !== "action") continue;
			const group = out.get(event.llmResponseId) ?? [];
			group.push(event);
			out.set(event.llmResponseId, group);
		}
		return out;
	}

		/** Is there an action with no matching observation (Lesson 3's hard rule). */
	danglingActions(): ActionEvent[] {
		const answered = new Set<string>();
		for (const event of this.events) {
			if (event.kind === "observation" || event.kind === "user-reject") {
				answered.add(event.actionId);
			}
			if (event.kind === "agent-error") answered.add(event.toolCallId);
		}
		return this.events.filter(
			(event): event is ActionEvent => event.kind === "action" && !answered.has(event.id),
		);
	}

		/** JSONL: the same shape as Lesson 4's session file, with different contents. */
	toJSONL(): string {
		return this.events.map((event) => JSON.stringify(event)).join("\n");
	}

	static fromJSONL(text: string): Trajectory {
		const trajectory = new Trajectory();
		for (const line of text.split("\n")) {
			if (line.trim() === "") continue;
			trajectory.add(JSON.parse(line) as TrajectoryEvent);
		}
		return trajectory;
	}
}

// ─────────────────────────────────────────────────────────────
// Answering the same question on a chat log (demonstrating why it does not work)
// ─────────────────────────────────────────────────────────────

/**
 * Find "claimed success but actually failed" in a chat log.
 *
 * Only string comparison is possible, because that data structure **has no concept of an exit code** —
 * it was formatted away into prose for a human.
 *
 * This is not a poorly written implementation; **it is the ceiling of what that data structure supports.**
 */
export function conflictsFromChat(
	history: { role: string; content: string }[],
	failureMarkers = ["exit code 1", "FAIL", "error:"],
	successMarkers = ["都過", "通過", "all pass", "passing", "成功"],
): { failureSeen: boolean; claimSeen: boolean; confident: boolean } {
	const failureSeen = history.some(
		(message) =>
			message.role === "toolResult" &&
			failureMarkers.some((marker) => message.content.toLowerCase().includes(marker.toLowerCase())),
	);
	const claimSeen = history.some(
		(message) =>
			message.role === "assistant" &&
			successMarkers.some((marker) => message.content.toLowerCase().includes(marker.toLowerCase())),
	);
	return {
		failureSeen,
		claimSeen,
			// Never confident: both sides guess from keywords, and the keyword list is hand-written.
		confident: false,
	};
}
