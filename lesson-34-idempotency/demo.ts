/**
 * Lesson 34: the crash Lesson 33 could not survive, survived.
 *
 * No API key. Every run really spawns a child process and really sends it
 * SIGKILL, in the window between the payment happening and the journal recording
 * it — the exact window Lesson 33 measured and could not close.
 *
 * Run: bun run lesson-34
 */

import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { distinctCharges, readLedger, requestCount, RUN_DIR } from "./provider.ts";
import { InvocationStore } from "./durable.ts";

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;

const WORKER = resolve(import.meta.dirname, "worker.ts");
const store = new InvocationStore(RUN_DIR);

function attempt(runId: string, env: Record<string, string>): Promise<void> {
	return new Promise((done) => {
		const child = spawn("bun", ["run", WORKER], {
			env: { ...process.env, RUN_ID: runId, ...env },
			stdio: ["ignore", "pipe", "pipe"],
		});
		let output = "";
		child.stdout.on("data", (chunk) => {
			output += String(chunk);
		});
		// Resolve on close, not exit: a SIGKILLed child still has buffered output.
		child.on("close", () => {
			for (const line of output.split("\n")) if (line.trim()) console.log(dim(`    ${line}`));
			done();
		});
	});
}

function fresh(runId: string): void {
	rmSync(resolve(RUN_DIR, `${runId}.json`), { force: true });
	rmSync(resolve(RUN_DIR, `${runId}.ledger`), { force: true });
}

interface Row {
	label: string;
	charges: number;
	requests: number;
	note: string;
}

const rows: Row[] = [];

console.log(bold("Lesson 34: durable execution does not close the window"));
console.log(dim("The crash lands between the payment and the journal write, every time.\n"));

/**
 * Every scenario is the same crash. Only the key's stability and the provider's
 * cooperation change, which is what makes the four rows comparable.
 */
async function scenario(
	label: string,
	runId: string,
	env: Record<string, string>,
	note: string,
): Promise<void> {
	console.log(bold(label));
	fresh(runId);

	console.log(dim("  attempt 1: charge the card, then die before journalling it"));
	await attempt(runId, { ...env, CRASH_BEFORE_JOURNAL: "process payment" });

	console.log(dim("  attempt 2: the runtime retries the invocation"));
	await attempt(runId, env);

	const charges = distinctCharges(runId);
	const requests = requestCount(runId);
	const invocation = store.load(runId);
	console.log(
		`  charges billed: ${charges === 1 ? green(String(charges)) : red(String(charges))}` +
			dim(`   requests sent: ${requests}   attempts: ${invocation?.attempts ?? 0}   status: ${invocation?.status}`),
	);
	console.log();
	rows.push({ label, charges, requests, note });
}

await scenario(
	"1. unstable key, provider dedupes",
	"unstable",
	{ KEY_MODE: "unstable", PROVIDER_MODE: "dedupes" },
	"a fresh key each attempt looks like a new customer intent",
);

await scenario(
	"2. stable key, provider dedupes",
	"stable",
	{ KEY_MODE: "stable", PROVIDER_MODE: "dedupes" },
	"the retry carries the same identity, so the provider collapses it",
);

await scenario(
	"3. stable key, provider ignores it",
	"ignored",
	{ KEY_MODE: "stable", PROVIDER_MODE: "ignores" },
	"a key is a request to somebody else; they can decline",
);

// ─────────────────────────────────────────────────────────────

console.log(bold("Summary"));
console.log(`  ${"scenario".padEnd(34)}${"billed".padStart(8)}${"requests".padStart(10)}  note`);
console.log(dim(`  ${"─".repeat(88)}`));
for (const row of rows) {
	const billed = row.charges === 1 ? green(String(row.charges).padStart(8)) : red(String(row.charges).padStart(8));
	console.log(`  ${row.label.padEnd(34)}${billed}${String(row.requests).padStart(10)}  ${dim(row.note)}`);
}

console.log(
	yellow(
		"\n  Row 2 is the one Lesson 33 could not reach, and notice what did NOT change\n" +
			"  to get there: the crash is identical and the payment still happened twice.\n" +
			"  Two requests reached the provider in every row. Durable execution did not\n" +
			"  close the window between the effect and the journal — nothing can. It made\n" +
			"  the second request carry the same identity as the first, and moved the\n" +
			"  decision to the only party that can make it.\n",
	),
);

console.log(bold("The ledger for row 2"));
for (const entry of readLedger("stable")) {
	const tag = entry.deduped ? green("deduped") : red("BILLED ");
	console.log(dim(`  pid ${entry.pid}  ${tag}  key=${entry.idempotencyKey.slice(0, 13)}…  ${entry.chargeId}`));
}

console.log(bold("\nIn one sentence"));
console.log(
	dim(
		"Exactly-once is not something a runtime gives you; it is something two systems\n" +
			"agree on, and a stable key is the whole of the agreement.\n",
	),
);
