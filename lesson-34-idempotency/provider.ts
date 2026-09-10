/**
 * The payment provider, and the half of the guarantee that is not yours.
 *
 * Lesson 33 ended holding a journal that knew a step had been interrupted and
 * could not say whether the money moved. This file is the other side of that
 * call, and it is where the answer actually lives.
 *
 * ## Why the provider is a participant, not a backdrop
 *
 * A stable idempotency key does nothing on its own. It is a request to somebody
 * else to collapse duplicates, and they have to agree. So this provider has two
 * modes, and the demo runs both:
 *
 *   "dedupes"   remembers keys and returns the first charge again
 *   "ignores"   treats every request as new, whatever key it carries
 *
 * Against `"ignores"`, a perfectly stable key produces two charges. That is not
 * a flaw in the mechanism; it is the mechanism's boundary, and a lesson that
 * only ran the cooperative case would be teaching a guarantee that does not
 * exist.
 *
 * Real APIs that honour this: Stripe's `Idempotency-Key` header, PayPal's
 * `PayPal-Request-Id`, most payment rails. Plenty of internal services do not.
 */

import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export const RUN_DIR = resolve(import.meta.dirname, ".runs");

export type ProviderMode = "dedupes" | "ignores";

export interface ChargeRecord {
	at: number;
	pid: number;
	chargeId: string;
	idempotencyKey: string;
	amountCents: number;
	/** True when the provider recognised the key and returned the original charge. */
	deduped: boolean;
}

/**
 * The ledger is a file, not a counter.
 *
 * Same reasoning as Lesson 33's: the process doing the charging is the process
 * being killed, so the evidence has to outlive it.
 */
function ledgerPath(runId: string): string {
	return resolve(RUN_DIR, `${runId}.ledger`);
}

function record(runId: string, entry: ChargeRecord): void {
	mkdirSync(dirname(ledgerPath(runId)), { recursive: true });
	appendFileSync(ledgerPath(runId), `${JSON.stringify(entry)}\n`);
}

export function readLedger(runId: string): ChargeRecord[] {
	try {
		return readFileSync(ledgerPath(runId), "utf8")
			.split("\n")
			.filter((line) => line.trim().length > 0)
			.map((line) => JSON.parse(line) as ChargeRecord);
	} catch {
		return [];
	}
}

/** What the customer was actually billed: charges the provider treated as new. */
export function distinctCharges(runId: string): number {
	return readLedger(runId).filter((entry) => !entry.deduped).length;
}

/** Every request that reached the provider, deduplicated or not. */
export function requestCount(runId: string): number {
	return readLedger(runId).length;
}

/**
 * Charge a card.
 *
 * The key→charge map lives in the ledger file rather than in memory, because the
 * provider has to remember across the process death that this lesson is about.
 * A real provider's memory is its own database and survives for the same reason.
 */
export function charge(
	runId: string,
	idempotencyKey: string,
	amountCents: number,
	mode: ProviderMode,
): { chargeId: string; deduped: boolean } {
	if (mode === "dedupes") {
		const previous = readLedger(runId).find((entry) => entry.idempotencyKey === idempotencyKey);
		if (previous) {
			// The defining behaviour: same key, same answer, no second charge.
			record(runId, { ...previous, at: Date.now(), pid: process.pid, deduped: true });
			return { chargeId: previous.chargeId, deduped: true };
		}
	}

	const chargeId = `ch_${Math.random().toString(36).slice(2, 10)}`;
	record(runId, {
		at: Date.now(),
		pid: process.pid,
		chargeId,
		idempotencyKey,
		amountCents,
		deduped: false,
	});
	return { chargeId, deduped: false };
}
