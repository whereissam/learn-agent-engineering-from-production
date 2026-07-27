/**
 * Approver：把「決策」接到「人」的那一段。
 *
 * Lesson 8 把權限引擎做成純粹的決策器：它只回傳一個 Decision,
 * 不知道要怎麼問人。這個檔案補上另一半。
 *
 * **關鍵是這兩個 approver 有完全相同的簽名。**
 *
 *   inlineApprover(reader)        → 問終端機
 *   inboxApprover(store, session) → 丟進 inbox,然後暫停
 *
 * agent loop 完全看不出差別。它只是 await 一個 Promise,
 * 那個 Promise 可能 0.5 秒後被回答（你按 y）,
 * 也可能 8 小時後才被回答（你早上起床看手機）。
 *
 * 這就是 Lesson 8 堅持「引擎只決定不詢問」的回報。
 *
 * 對照：openworker/coworker/inbox.py 的 inbox_approver
 */

import type { LineReader } from "../repl.ts";
import { argsPreview, type InboxStore } from "./store.ts";

/**
 * 使用者的回答。比 boolean 多了「以後都允許」。
 *
 * 對照 OpenWorker 的 ApprovalOutcome（engine.py:29）。
 */
export type ApprovalOutcome =
	/** 這次允許。 */
	| "once"
	/** 這個工具以後都允許（受 Lesson 8 的 connector 限制）。 */
	| "always"
	/** 拒絕。 */
	| "deny";

export interface ApprovalRequest {
	sessionId: string;
	toolName: string;
	args: Record<string, unknown>;
	/** 來自 Decision.reason,告訴使用者「為什麼會問你」。 */
	reason: string;
	toolCallId?: string;
}

/** 所有 approver 的共同形狀。 */
export type Approver = (request: ApprovalRequest) => Promise<ApprovalOutcome>;

// ─────────────────────────────────────────────────────────────
// 1. 有人在場：問終端機
// ─────────────────────────────────────────────────────────────

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;

export function inlineApprover(reader: LineReader): Approver {
	return async (request) => {
		console.log(`\n${yellow("┌ 需要批准")}`);
		console.log(`${yellow("│")} ${request.toolName}`);
		console.log(`${yellow("│")} ${dim(argsPreview(request.args))}`);
		console.log(`${yellow("│")} ${dim(request.reason)}`);
		console.log(yellow("└"));

		const line = await reader.next(
			`  ${yellow("[y]")} 允許  ${yellow("[a]")} 都允許  ${yellow("[n]")} 拒絕 › `,
		);
		if (line === null) return "deny"; // 沒人能回答就當拒絕

		const answer = line.trim().toLowerCase();
		if (answer === "a") return "always";
		return answer === "y" || answer === "yes" ? "once" : "deny";
	};
}

// ─────────────────────────────────────────────────────────────
// 2. 沒人在場：丟進 inbox,然後暫停
// ─────────────────────────────────────────────────────────────

/**
 * 注意這個函式有多短。
 *
 * 「無人值守」聽起來像一個大功能，但因為前面的架構拆對了,
 * 它只是「換一個 approver」。整個 agent loop、權限引擎、工具,
 * 一行都不用改。
 */
export function inboxApprover(store: InboxStore, sessionId: string): Approver {
	return async (request) => {
		const item = await store.add({
			sessionId,
			kind: "approval",
			visibility: "inbox",
			title: `執行 ${request.toolName}？`,
			body: `${argsPreview(request.args)}\n\n${request.reason}`,
			toolCallId: request.toolCallId,
		});

		// ← agent 就停在這裡。可能 8 小時。
		//
		// 沒有 timeout 是刻意的：逾時之後要放行（危險）還是拒絕（任務失敗）？
		// 都不好，所以就等。真正該設 timeout 的是整個任務，不是單一個批准。
		const resolution = await store.wait(item.id);

		if (resolution === "always") return "always";
		if (resolution === "allow") return "once";
		return "deny";
	};
}

// ─────────────────────────────────────────────────────────────
// 3. 自動：測試與評估用
// ─────────────────────────────────────────────────────────────

export function autoApprover(outcome: ApprovalOutcome = "once"): Approver {
	return async () => outcome;
}

/**
 * 依照 session 是不是無人值守，選一個 approver。
 *
 * 這就是 OpenWorker 的 UnattendedRegistry 在做的事。它的 docstring
 * 有一句話值得抄下來：
 *
 *   > It does **not** change the autonomy ceiling (the permission mode does).
 *   > When a session is unattended, anything that would prompt inline is
 *   > routed to the Inbox and the agent suspends until answered.
 *
 * 也就是：**無人值守只改「去哪裡問」，不改「能做多少」。**
 *
 * 這個區分非常重要。如果無人值守順便放寬了權限，那它就變成
 * 「趁沒人看的時候多做一點」，那才是真正危險的設計。
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
		throw new Error("有人值守的模式需要一個 LineReader");
	}
	return inlineApprover(options.reader);
}
