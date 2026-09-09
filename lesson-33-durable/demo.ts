/**
 * Lesson 33: kill the process and see what the run remembers.
 *
 * No API key. What is measured is not model behaviour but a property of the
 * system: **after a crash, how many times did the card get charged?**
 *
 * Every scenario really spawns a child process and really sends it SIGKILL.
 *
 * Run: bun run lesson-33
 */

import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { countEffect, PIPELINE, readLedger, RUN_DIR, type RefundInput } from "./pipeline.ts";
import {
	advance,
	completedSteps,
	getSuspendedStep,
	inFlightSteps,
	resume,
	RunStore,
} from "./workflow.ts";

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;

const INPUT: RefundInput = {
	chargeId: "ch_DEMOONLY4471",
	amountCents: 4999,
	customerEmail: "customer@example.invalid",
};

const WORKER = resolve(import.meta.dirname, "worker.ts");
const store = new RunStore(RUN_DIR);

/**
 * Spawn one attempt and wait for it to end, however it ends.
 *
 * Resolving on `close` rather than `exit` matters: a SIGKILLed child still has
 * output buffered in the pipe, and `exit` can fire before it has been drained.
 */
function attempt(runId: string, env: Record<string, string>): Promise<void> {
	return new Promise((done) => {
		const child = spawn("bun", ["run", WORKER], {
			env: { ...process.env, RUN_ID: runId, INPUT: JSON.stringify(INPUT), ...env },
			stdio: ["ignore", "pipe", "pipe"],
		});
		let output = "";
		child.stdout.on("data", (chunk) => {
			output += String(chunk);
		});
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

const results: Array<{ scenario: string; charges: number; emails: number; note: string }> = [];

console.log(bold("Lesson 33: the loop as a serialisable state machine"));
console.log(dim("charge_card → await_approval → send_receipt, with a real SIGKILL in the middle\n"));

// ─────────────────────────────────────────────────────────────
// Scenario 1: no journal. Lesson 09's inbox, in a process that dies.
// ─────────────────────────────────────────────────────────────

console.log(bold("Scenario 1: mechanism off — nothing is written down"));
{
	const runId = "naive";
	fresh(runId);
	console.log(dim("  attempt 1: charge the card, then the process is killed"));
	await attempt(runId, { MODE: "naive", CRASH_AT: "charge_card" });
	console.log(dim("  attempt 2: a supervisor restarts the work"));
	await attempt(runId, { MODE: "naive" });

	const charges = countEffect(runId, "charge");
	console.log(
		`  charges: ${charges === 1 ? green(String(charges)) : red(String(charges))}   ` +
			`state on disk: ${store.load(runId) ? "yes" : red("none")}`,
	);
	results.push({
		scenario: "naive, crash after charge",
		charges,
		emails: countEffect(runId, "email"),
		note: "restart re-runs everything",
	});
}
console.log(
	dim("\n  There is nowhere to look up what already happened, so the only thing a\n" +
		"  restart can do is start. The customer is charged twice.\n"),
);

// ─────────────────────────────────────────────────────────────
// Scenario 2: the journal, and a crash after it is written
// ─────────────────────────────────────────────────────────────

console.log(bold("Scenario 2: mechanism on — the run's position is a file"));
{
	const runId = "durable";
	fresh(runId);
	console.log(dim("  attempt 1: charge the card, journal it, then die"));
	await attempt(runId, { MODE: "durable", CRASH_AT: "charge_card" });

	const afterCrash = store.load(runId);
	console.log(
		`  after the kill: status=${afterCrash?.status ?? "?"} ` +
			`completed=[${afterCrash ? completedSteps(afterCrash).join(", ") : ""}]`,
	);

	console.log(dim("  attempt 2: a different process picks the run up"));
	await attempt(runId, { MODE: "durable" });

	const suspended = store.load(runId);
	const waiting = suspended ? getSuspendedStep(suspended) : undefined;
	console.log(`  now suspended at: ${yellow(waiting?.stepId ?? "nothing")}`);
	console.log(dim(`    asking: ${JSON.stringify(waiting?.suspendPayload)}`));

	// The human answers. This process is not the one that started the run, and
	// nothing about it needs to be — the approval is just a write to the store.
	const state = store.load(runId);
	if (!state) throw new Error("run vanished");
	resume(state, "await_approval", { approved: true, by: "ops@example.invalid" });
	store.save(state);
	console.log(dim("  a human approves, from a third process"));

	await advance(PIPELINE, store.load(runId) ?? state, store);

	const done = store.load(runId);
	const charges = countEffect(runId, "charge");
	console.log(
		`  final: status=${done?.status ?? "?"}  attempts=${done?.attempts ?? 0}  ` +
			`charges: ${charges === 1 ? green(String(charges)) : red(String(charges))}  ` +
			`emails: ${countEffect(runId, "email")}`,
	);
	results.push({
		scenario: "durable, crash after charge",
		charges,
		emails: countEffect(runId, "email"),
		note: "resumed at the suspended step",
	});
}
console.log(
	dim("\n  The completed step is skipped because the journal says it completed.\n" +
		"  Three processes moved one run forward and none of them shared memory.\n"),
);

// ─────────────────────────────────────────────────────────────
// Scenario 3: the window the journal does not cover
// ─────────────────────────────────────────────────────────────

console.log(bold("Scenario 3: mechanism on, crash between the effect and the journal"));
{
	const runId = "gap";
	fresh(runId);
	console.log(dim("  attempt 1: charge the card, then die BEFORE writing it down"));
	await attempt(runId, { MODE: "durable", CRASH_BEFORE_JOURNAL: "charge_card" });

	const afterCrash = store.load(runId);
	console.log(
		`  after the kill: completed=[${afterCrash ? completedSteps(afterCrash).join(", ") : ""}] ` +
			`in-flight=[${afterCrash ? inFlightSteps(afterCrash).join(", ") : ""}]`,
	);

	console.log(dim("  attempt 2: a supervisor restarts the work"));
	await attempt(runId, { MODE: "durable" });

	const charges = countEffect(runId, "charge");
	console.log(`  charges: ${charges === 1 ? green(String(charges)) : red(String(charges))}`);
	results.push({
		scenario: "durable, crash before journal",
		charges,
		emails: countEffect(runId, "email"),
		note: "the step is in-flight, not done",
	});
}
console.log(
	yellow(
		"\n  Durability did not help here, and this is not a bug in the implementation.\n" +
			"  Between 'the money moved' and 'we wrote that the money moved' there is a\n" +
			"  window, and no amount of journalling closes it — the journal is not the\n" +
			"  same system as the payment provider. Lesson 34 is about what does.\n",
	),
);

// ─────────────────────────────────────────────────────────────
// Scenario 4: the other way of being wrong
// ─────────────────────────────────────────────────────────────

console.log(bold("Scenario 4: same crash, but the resume refuses to replay"));
{
	const runId = "halt";
	fresh(runId);
	console.log(dim("  attempt 1: charge the card, then die BEFORE writing it down"));
	await attempt(runId, { MODE: "durable", CRASH_BEFORE_JOURNAL: "charge_card" });

	console.log(dim("  attempt 2: restart with ON_INTERRUPTED=halt"));
	await attempt(runId, { MODE: "durable", ON_INTERRUPTED: "halt" });

	const state = store.load(runId);
	const charges = countEffect(runId, "charge");
	console.log(
		`  charges: ${charges === 1 ? green(String(charges)) : red(String(charges))}   ` +
			`status: ${yellow(state?.status ?? "?")}`,
	);
	console.log(dim(`    ${state?.steps.charge_card?.error ?? ""}`));
	results.push({
		scenario: "durable, halt on interrupted",
		charges,
		emails: countEffect(runId, "email"),
		note: "nothing runs twice, nothing finishes",
	});
}
console.log(
	dim("\n  The card is charged once and the refund never completes. That is not a\n" +
		"  better answer than scenario 3, it is the opposite trade: at-most-once\n" +
		"  instead of at-least-once. Which one you want depends on the step.\n"),
);

// ─────────────────────────────────────────────────────────────

console.log(bold("Summary"));
console.log(`  ${"scenario".padEnd(34)}${"charges".padStart(9)}${"emails".padStart(8)}  note`);
console.log(dim(`  ${"─".repeat(78)}`));
for (const row of results) {
	const charges = row.charges === 1 ? green(String(row.charges).padStart(9)) : red(String(row.charges).padStart(9));
	console.log(`  ${row.scenario.padEnd(34)}${charges}${String(row.emails).padStart(8)}  ${dim(row.note)}`);
}

console.log(dim("\n  The ledger for the durable run, which three processes wrote between them:"));
for (const entry of readLedger("durable")) {
	console.log(dim(`    pid ${entry.pid}  ${entry.effect.padEnd(6)} ${entry.detail}`));
}

console.log(bold("\nIn one sentence"));
console.log(
	dim(
		"A run that can be resumed is a run whose position is a value, not a stack frame —\n" +
			"and the journal makes replay safe only up to the last thing it managed to write.\n",
	),
);
