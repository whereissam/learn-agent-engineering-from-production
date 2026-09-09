/**
 * The three steps, and the side effect that makes the experiment measurable.
 *
 * The scenario is deliberately one where doing it twice is not a rounding error:
 *
 *     charge_card  →  await_approval  →  send_receipt
 *        money           a human            an email
 *
 * Lesson 09 already argued that approval has to survive the operator going to
 * bed. This adds the other half: it has to survive the **process** going away.
 *
 * ## Why a ledger file rather than a counter
 *
 * The whole point is that the process dies. A counter in memory dies with it, so
 * the evidence has to outlive the thing being measured — which is Lesson 29's
 * rule (the record must come from outside the thing making the claim) applied to
 * this lesson's own instrumentation.
 */

import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Step } from "./workflow.ts";

export const RUN_DIR = resolve(import.meta.dirname, ".runs");

export interface LedgerEntry {
	at: number;
	pid: number;
	effect: string;
	detail: string;
}

/** Append-only, one JSON object per line, `fsync`-free on purpose — see the README's Step 5. */
export function record(runId: string, effect: string, detail: string): void {
	const path = resolve(RUN_DIR, `${runId}.ledger`);
	mkdirSync(dirname(path), { recursive: true });
	const entry: LedgerEntry = { at: Date.now(), pid: process.pid, effect, detail };
	appendFileSync(path, `${JSON.stringify(entry)}\n`);
}

export function readLedger(runId: string): LedgerEntry[] {
	try {
		return readFileSync(resolve(RUN_DIR, `${runId}.ledger`), "utf8")
			.split("\n")
			.filter((line) => line.trim().length > 0)
			.map((line) => JSON.parse(line) as LedgerEntry);
	} catch {
		return [];
	}
}

export function countEffect(runId: string, effect: string): number {
	return readLedger(runId).filter((entry) => entry.effect === effect).length;
}

export interface RefundInput {
	chargeId: string;
	amountCents: number;
	customerEmail: string;
}

export const PIPELINE: Step[] = [
	{
		id: "charge_card",
		run(ctx) {
			const input = ctx.input as RefundInput;
			// The irreversible thing. In a real system this is a POST to Stripe.
			record(ctx.runId, "charge", `${input.chargeId} ${input.amountCents}c`);
			return { chargeId: input.chargeId, capturedCents: input.amountCents };
		},
	},
	{
		id: "await_approval",
		run(ctx) {
			const charge = ctx.outputOf<{ capturedCents: number }>("charge_card");

			// `suspend` returns `never`, so `??` reads as "resume data, or stop here".
			// Nothing after it runs on the first pass; the engine records where the
			// run stopped and the next process picks it up from the store.
			const approval =
				ctx.resumeData<{ approved: boolean; by: string }>() ??
				ctx.suspend({
					question: `Refund ${charge?.capturedCents ?? "?"} cents to the customer?`,
					chargeId: (ctx.input as RefundInput).chargeId,
				});

			if (!approval.approved) throw new Error(`refund rejected by ${approval.by}`);
			return { approvedBy: approval.by };
		},
	},
	{
		id: "send_receipt",
		run(ctx) {
			const input = ctx.input as RefundInput;
			const approval = ctx.outputOf<{ approvedBy: string }>("await_approval");
			record(ctx.runId, "email", `${input.customerEmail} approved-by:${approval?.approvedBy ?? "?"}`);
			return { sentTo: input.customerEmail };
		},
	},
];
