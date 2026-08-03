/**
 * Approver: the piece connecting a decision to a human.
 *
 * Lesson 8 made the permission engine a pure decision-maker: it returns a Decision
 * and knows nothing about how to ask a human. This file supplies the other half.
 *
 * **The key is that these two approvers have exactly the same signature.**
 *
 *   inlineApprover(reader)        → ask the terminal
 *   inboxApprover(store, session) → put it in the inbox, then pause
 *
 * The agent loop cannot tell the difference. It merely awaits a Promise,
 * which may be answered half a second later (you pressed y)
 * or eight hours later (you looked at your phone in the morning).
 *
 * That is the payoff for Lesson 8 insisting the engine decides without asking.
 *
 * Source: inbox_approver in openworker/coworker/inbox.py
 */

import type { LineReader } from "../repl.ts";
import { argsPreview, type InboxStore } from "./store.ts";

/**
 * The user's answer. Richer than a boolean: it adds "always allow from now on".
 *
 * Against OpenWorker's ApprovalOutcome (engine.py:29).
 */
export type ApprovalOutcome =
	/** Allow this time. */
	| "once"
	/** Always allow this tool from now on (subject to Lesson 8's connector limits). */
	| "always"
	/** Deny. */
	| "deny";

export interface ApprovalRequest {
	sessionId: string;
	toolName: string;
	args: Record<string, unknown>;
	/** From Decision.reason; tells the user **why they are being asked**. */
	reason: string;
	toolCallId?: string;
}

/** The shape every approver shares. */
export type Approver = (request: ApprovalRequest) => Promise<ApprovalOutcome>;

// ─────────────────────────────────────────────────────────────
// 1. Somebody is present: ask the terminal
// ─────────────────────────────────────────────────────────────

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;

export function inlineApprover(reader: LineReader): Approver {
	return async (request) => {
		console.log(`\n${yellow("┌ approval needed")}`);
		console.log(`${yellow("│")} ${request.toolName}`);
		console.log(`${yellow("│")} ${dim(argsPreview(request.args))}`);
		console.log(`${yellow("│")} ${dim(request.reason)}`);
		console.log(yellow("└"));

		const line = await reader.next(
			`  ${yellow("[y]")} allow  ${yellow("[a]")} always  ${yellow("[n]")} deny › `,
		);
		if (line === null) return "deny"; // nobody there to answer counts as a denial

		const answer = line.trim().toLowerCase();
		if (answer === "a") return "always";
		return answer === "y" || answer === "yes" ? "once" : "deny";
	};
}

// ─────────────────────────────────────────────────────────────
// 2. Nobody is present: put it in the inbox, then pause
// ─────────────────────────────────────────────────────────────

/**
 * Note how short this function is.
 *
 * "Unattended" sounds like a big feature, and because the earlier architecture was split correctly
 * it is merely "a different approver". The whole agent loop, the permission engine and the tools
 * need not change by one line.
 */
export function inboxApprover(store: InboxStore, sessionId: string): Approver {
	return async (request) => {
		const item = await store.add({
			sessionId,
			kind: "approval",
			visibility: "inbox",
			title: `Run ${request.toolName}?`,
			body: `${argsPreview(request.args)}\n\n${request.reason}`,
			toolCallId: request.toolCallId,
		});

		// ← the agent stops right here. Possibly for eight hours.
		//
		// The absence of a timeout is deliberate: after one, allow (dangerous) or deny (the task fails)?
		// Neither is good, so it waits. What should have a timeout is the whole task, not a single approval.
		const resolution = await store.wait(item.id);

		if (resolution === "always") return "always";
		if (resolution === "allow") return "once";
		return "deny";
	};
}

// ─────────────────────────────────────────────────────────────
// 3. Automatic: for tests and evaluation
// ─────────────────────────────────────────────────────────────

export function autoApprover(outcome: ApprovalOutcome = "once"): Approver {
	return async () => outcome;
}

/**
 * Choose an approver based on whether the session is unattended.
 *
 * This is what OpenWorker's UnattendedRegistry does. A sentence from its docstring
 * is worth copying:
 *
 *   > It does **not** change the autonomy ceiling (the permission mode does).
 *   > When a session is unattended, anything that would prompt inline is
 *   > routed to the Inbox and the agent suspends until answered.
 *
 * That is: **unattended changes only where the question goes, not how much may be done.**
 *
 * That distinction matters enormously. If unattended also relaxed permissions, it would become
 * "do a bit more while nobody is watching", which is the genuinely dangerous design.
 */
export function routeApprover(options: {
	unattended: boolean;
	store: InboxStore;
	sessionId: string;
	reader?: LineReader;
}): Approver {
	if (options.unattended) {
		return inboxApprover(options.store, options.sessionId);
	}
	if (!options.reader) {
		throw new Error("Attended mode needs a LineReader");
	}
	return inlineApprover(options.reader);
}
