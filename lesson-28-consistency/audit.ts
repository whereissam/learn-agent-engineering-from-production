/**
 * The audit: read back a session that was **already persisted** and ask whether it lies.
 *
 * Why the audit targets the saved file rather than the object in memory: the whole point of interruption is
 * whether what is left behind can be trusted once the process is gone. In-memory state vanishes a second later;
 * the saved file lives until your next `--resume`.
 *
 * Five rules, each matching a way of breaking that **throws nothing** (design principle 7).
 * This lesson's entire verdict is those five rules, with no LLM judge.
 */

import { isInFlight, type AssistantMessage, type Part } from "./parts.ts";

export type ViolationKind =
	/** Storage still holds something pending / running. */
	| "in-flight-in-storage"
	/** It has a start time and no end time. */
	| "unfinished-span"
	/** The message itself has no end time → the session is busy forever. */
	| "message-never-completed"
	/** A terminal state with no result content at all. */
	| "terminal-without-result"
	/** The filesystem says it changed and the session says it did not. */
	| "unrecorded-patch";

export interface Violation {
	kind: ViolationKind;
	where: string;
	detail: string;
}

export interface AuditInput {
	message: AssistantMessage;
	/**
		 * Which files the outside world says changed.
	 *
		 * Deliberately a parameter rather than computed here: this lesson's subject is whether the record is consistent,
		 * and "how do you know a file really changed" is [Lesson 29](../lesson-29-evidence/)'s subject.
		 * That lesson's `snapshot.patch()` is this parameter's real version.
	 */
	changedFiles?: string[];
}

export function audit({ message, changedFiles }: AuditInput): Violation[] {
	const out: Violation[] = [];

	for (const part of message.parts) {
			// ── 1. Storage must hold nothing "in progress" ─────────
		//
			// The most important rule. A pending tool renders on screen as a spinner,
			// and that spinner turns until the end of the universe —
			// because the process responsible for turning it into completed is gone.
		if (part.type === "tool" && (part.state.status === "pending" || part.state.status === "running")) {
			out.push({
				kind: "in-flight-in-storage",
				where: `${part.type}:${part.id}`,
				detail: `工具 ${part.name} 存檔時是 ${part.state.status}，沒有人會再把它推進下一個狀態`,
			});
		}

			// ── 2. Started with no end ────────────────────────────
		if (isInFlight(part) && part.type !== "tool") {
			out.push({
				kind: "unfinished-span",
				where: `${part.type}:${part.id}`,
				detail: `${part.type} 有 created 沒有 completed，下游算不出它花了多久`,
			});
		}
		if (part.type === "tool" && part.time.ran !== undefined && part.time.completed === undefined) {
			out.push({
				kind: "unfinished-span",
				where: `tool:${part.id}`,
				detail: `工具開始執行了（ran）但沒有 completed`,
			});
		}

			// ── 3. A terminal state with no result ────────────────
		//
			// This blocks "changing the status to error counts as handling it".
			// An error with no content is no message at all to downstream (and to the user).
		if (part.type === "tool") {
			if (part.state.status === "completed" && part.state.output.trim() === "") {
				out.push({
					kind: "terminal-without-result",
					where: `tool:${part.id}`,
					detail: `completed 但 output 是空的`,
				});
			}
			if (part.state.status === "error" && part.state.error.trim() === "") {
				out.push({
					kind: "terminal-without-result",
					where: `tool:${part.id}`,
					detail: `error 但沒有錯誤訊息`,
				});
			}
		}
	}

		// ── 4. The message itself never finished ───────────────
	if (message.time.completed === undefined) {
		out.push({
			kind: "message-never-completed",
			where: `message:${message.id}`,
			detail: "訊息沒有 completed 時間：載回來之後這個 session 會被當成還在跑",
		});
	}

		// ── 5. Files changed and it was not recorded ───────────
	if (changedFiles !== undefined && changedFiles.length > 0) {
		const recorded = new Set(message.snapshot?.files ?? []);
		for (const file of changedFiles) {
			if (!recorded.has(file)) {
				out.push({
					kind: "unrecorded-patch",
					where: `file:${file}`,
					detail: `${file} 真的變了，但這一輪的紀錄裡沒有它`,
				});
			}
		}
	}

	return out;
}

/** For printing the table. */
export function summarise(violations: Violation[]): string {
	if (violations.length === 0) return "—";
	const counts = new Map<ViolationKind, number>();
	for (const violation of violations) {
		counts.set(violation.kind, (counts.get(violation.kind) ?? 0) + 1);
	}
	return [...counts.entries()].map(([kind, n]) => (n > 1 ? `${kind}×${n}` : kind)).join(", ");
}
