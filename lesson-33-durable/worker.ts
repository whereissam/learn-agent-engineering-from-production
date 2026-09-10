/**
 * One attempt at the pipeline, in its own process, so that killing it means
 * something.
 *
 * `demo.ts` spawns this and sends SIGKILL. It is a separate file for one reason:
 * **a crash you simulate inside the same process is not a crash.** A `throw`
 * still runs `finally` blocks, still flushes, still lets you tidy up. SIGKILL
 * does none of that, and every claim in this lesson depends on the difference.
 *
 * Not run directly — `bun run lesson-33` drives it.
 *
 *   MODE=naive|durable   whether state is written between steps
 *   RUN_ID=<id>          which run to work on
 *   CRASH_AT=<stepId>    die immediately after that step is journalled
 *   CRASH_BEFORE_JOURNAL=<stepId>   die after the side effect, before the journal
 *   ON_INTERRUPTED=replay|halt      what to do with a step that never finished
 */

import { PIPELINE, RUN_DIR } from "./pipeline.ts";
import { advance, newRun, NoStore, RunStore } from "./workflow.ts";

const mode = process.env.MODE ?? "durable";
const runId = process.env.RUN_ID;
if (!runId) throw new Error("RUN_ID is required");

const input = JSON.parse(process.env.INPUT ?? "{}");
const crashAt = process.env.CRASH_AT;
const crashBeforeJournal = process.env.CRASH_BEFORE_JOURNAL;

const store = mode === "naive" ? new NoStore() : new RunStore(RUN_DIR);

// The naive mode's whole character is here: it cannot load, so every attempt is
// attempt one, and every step runs again.
const state = store.load(runId) ?? newRun(runId, input);

const suicide = (why: string) => {
	console.log(`[worker ${process.pid}] ${why} — SIGKILL to self`);
	// Not process.exit(): that is an orderly shutdown. This is the real thing.
	process.kill(process.pid, "SIGKILL");
	// Unreachable, but the engine must not proceed while the signal is delivered.
	throw new Error("killed");
};

const final = await advance(PIPELINE, state, store, {
	onInterrupted: process.env.ON_INTERRUPTED === "halt" ? "halt" : "replay",
	beforeJournal(stepId) {
		if (stepId === crashBeforeJournal) suicide(`did ${stepId}, journal not yet written`);
	},
	afterStep(stepId) {
		if (stepId === crashAt) suicide(`journalled ${stepId}`);
	},
});

console.log(`[worker ${process.pid}] finished attempt with status=${final.status}`);
