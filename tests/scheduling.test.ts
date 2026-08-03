/**
 * Scheduling and unattended running (Lesson 18).
 *
 * Three groups, all guarding things that fail without raising an error:
 *
 *   schedule  how time advances (advancing by completion time makes the schedule drift)
 *   ledger    terminal states are immutable, death must be proved, pids get recycled
 *   guard     command shapes are blocked and prose is not falsely blocked
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import { checkLifecycle, containsLifecycleCommand, LifecycleBlocked } from "../lesson-18-scheduling/guard.ts";
import { Ledger, type OwnerProbe } from "../lesson-18-scheduling/ledger.ts";
import { applyCatchUp, type Job, missedRuns, nextDue } from "../lesson-18-scheduling/schedule.ts";
import { Scheduler } from "../lesson-18-scheduling/scheduler.ts";

const MINUTE = 60_000;

function job(overrides: Partial<Job> = {}): Job {
	return {
		id: "j1",
		name: "test job",
		everySeconds: 60,
		prompt: "do the thing",
		catchUp: "one",
		enabled: true,
		createdAt: 0,
		...overrides,
	};
}

function probe(live: Map<number, number>): OwnerProbe {
	return { exists: (pid) => live.has(pid), startedAt: (pid) => live.get(pid) };
}

function ledger(): Ledger {
	return new Ledger({
		ownerId: "owner-a",
		pid: 1,
		pidStartedAt: 100,
		probe: probe(new Map([[1, 100]])),
		now: () => 0,
	});
}

// ─────────────────────────────────────────────────────────────

describe("due times and catch-up (Lesson 18)", () => {
	test("a job that never ran runs once, without back-filling time before it existed", () => {
		assert.deepEqual(missedRuns(job({ createdAt: 5 * MINUTE }), 9 * MINUTE), [5 * MINUTE]);
	});

	test("three hours down at five-minute intervals → 36 runs", () => {
		const missed = missedRuns(job({ everySeconds: 300, lastScheduledAt: 0 }), 3 * 60 * MINUTE);
		assert.equal(missed.length, 36);
	});

	test("a disabled job has no due time", () => {
		assert.deepEqual(missedRuns(job({ enabled: false, lastScheduledAt: 0 }), 10 * MINUTE), []);
	});

	test("time advances by the scheduled time, unaffected by how long a run takes", () => {
			// This guards the slow-drift bug: advancing only on completion,
			// a job every 60 seconds that takes 5 seconds per run drifts an hour in a day.
		const missed = missedRuns(job({ lastScheduledAt: 0 }), 3 * MINUTE + 37_000);
		assert.deepEqual(missed, [MINUTE, 2 * MINUTE, 3 * MINUTE]);
	});

	test("catchUp=one runs the last occurrence, not the first", () => {
		const { runs, dropped } = applyCatchUp("one", [1, 2, 3, 4]);
		assert.deepEqual(runs, [4], "what is wanted is the current state, not the state three hours ago");
		assert.equal(dropped, 3);
	});

	test("catchUp=all / skip", () => {
		assert.equal(applyCatchUp("all", [1, 2, 3]).runs.length, 3);
		assert.equal(applyCatchUp("skip", [1, 2, 3]).runs.length, 0);
		assert.equal(applyCatchUp("skip", [1, 2, 3]).dropped, 3);
	});

	test("nextDue is always in the future", () => {
		assert.ok(nextDue(job({ lastScheduledAt: 0 }), 5 * MINUTE) > 5 * MINUTE);
	});

	test("⚠ time must still advance after a skip, or every tick revisits the same batch", async () => {
			// This bug has no symptom at all: it executes nothing and merely makes the dropped
			// number grow every minute.
		const j = job({ catchUp: "skip", lastScheduledAt: 0 });
		let now = 10 * MINUTE;
		const scheduler = new Scheduler({
			ledger: ledger(),
			clock: () => now,
			runner: async () => "ok",
		});
		scheduler.add(j);

		const first = await scheduler.tick();
		assert.equal(first.dropped[0]?.count, 10);

		const second = await scheduler.tick();
		assert.deepEqual(second.dropped, [], "the same batch of missed runs must not be revisited");
	});
});

const TMP = mkdtempSync(join(tmpdir(), "lesson-18-"));
after(() => rmSync(TMP, { recursive: true, force: true }));

describe("the execution ledger (Lesson 18)", () => {
	test("claimed → running → completed", async () => {
		const l = ledger();
		const exec = await l.claim("j1", 0);
		assert.equal(exec.status, "claimed");
		assert.equal((await l.markRunning(exec.id))?.status, "running");
		assert.equal((await l.finish(exec.id, true))?.status, "completed");
	});

	test("a terminal state cannot be rewritten", async () => {
		const l = ledger();
		const exec = await l.claim("j1", 0);
		await l.finish(exec.id, true);
		assert.equal(await l.finish(exec.id, false, "actually it failed"), undefined);
		assert.equal(l.list("j1")[0]?.status, "completed");
	});

	test("markRunning only succeeds once", async () => {
		const l = ledger();
		const exec = await l.claim("j1", 0);
		await l.markRunning(exec.id);
		assert.equal(await l.markRunning(exec.id), undefined);
	});

	/**
		 * "The first process claims and then dies, and a second process loads the same record."
	 *
		 * The handover deliberately goes through the file rather than passing a Map: **crossing processes is this mechanism's use case**,
		 * and testing with one object would skip the serialisation entirely.
	 */
	async function handover(
		live: Map<number, number>,
		options: { probeOverride?: OwnerProbe; ownerPid?: number; ownerStart?: number } = {},
	) {
		const path = join(TMP, `ledger-${Math.random().toString(36).slice(2)}.json`);
		const ownerPid = options.ownerPid ?? 7;
		const ownerStart = options.ownerStart ?? 500;

		const first = new Ledger({
			ownerId: "a", pid: ownerPid, pidStartedAt: ownerStart,
			probe: probe(live), now: () => 0, path,
		});
		const exec = await first.claim("j1", 0);
		await first.markRunning(exec.id);

		const second = await Ledger.load({
			ownerId: "b", pid: 8, pidStartedAt: 600,
			probe: options.probeOverride ?? probe(live), now: () => 0, path,
		});
		return { first, second, exec };
	}

	test("the owner is alive → leave it alone", async () => {
		const live = new Map([[7, 500]]);
		const { second } = await handover(live);
		const result = await second.recoverInterrupted();
		assert.equal(result.recovered.length, 0);
		assert.equal(result.leftAlone.length, 1);
	});

	test("a recycled pid (present, different start time) → judged dead", async () => {
		const live = new Map([[7, 500]]);
		const { second } = await handover(live);
		live.set(7, 999); // the same pid, a different process

		const result = await second.recoverInterrupted();
		assert.equal(result.recovered.length, 1);
		assert.equal(result.recovered[0]?.status, "unknown");
	});

	test("⚠ no start time available → assume alive (fail safe)", async () => {
			// "If death cannot be proved, state must not be rewritten." The reverse design produces duplicate execution.
		const live = new Map([[7, 500]]);
		const blind: OwnerProbe = { exists: () => true, startedAt: () => undefined };
		const { second } = await handover(live, { probeOverride: blind });
		assert.equal((await second.recoverInterrupted()).recovered.length, 0);
	});

	test("recover schedules no retries", async () => {
		const { second } = await handover(new Map<number, number>());
		const result = await second.recoverInterrupted();

		assert.equal(result.recovered[0]?.status, "unknown");
			// unknown is a terminal state, not "awaiting retry". Whether to re-run is decided by the nature of the job.
		assert.equal(second.activeFor("j1"), undefined);
	});
});

describe("the lifecycle guard (Lesson 18)", () => {
	test("all four command shapes are blocked", () => {
		assert.ok(containsLifecycleCommand("agentd restart"));
		assert.ok(containsLifecycleCommand("agentd stop"));
		assert.ok(containsLifecycleCommand("launchctl kickstart -k gui/501/ai.agentd"));
		assert.ok(containsLifecycleCommand("systemctl --user restart agentd.service"));
		assert.ok(containsLifecycleCommand("pkill -f agentd"));
	});

	test("prose is blocked too, in either word order", () => {
			// The recall hole measured at 0-of-3: the guard read the job prompt as shell text, but a cron
			// prompt is handed to a future agent turn, which writes sentences. Only `agentd restart`
			// — the one form a model rarely emits — used to be caught.
		assert.ok(containsLifecycleCommand("restart agentd"));
		assert.ok(containsLifecycleCommand("Restart the agentd daemon so the new config is picked up."));
		assert.ok(containsLifecycleCommand("stop agentd and start it again"));
		assert.ok(containsLifecycleCommand("bounce agentd"));
		assert.ok(containsLifecycleCommand("terminate the agentd process"));
		assert.ok(containsLifecycleCommand("kill the agentd process and let the supervisor bring it back"));
	});

	test("reload is not blocked, because a reload does not kill the process", () => {
			// Same judgement as the measured `pkill -HUP agentd` false positive. SIGHUP re-reads config
			// without the process dying, so it breaks no link in the restart-loop chain.
			// Blocking what merely sounds dangerous is how a guard loses the reader's trust.
		assert.equal(containsLifecycleCommand("reload agentd's configuration"), false);
		assert.equal(containsLifecycleCommand("send SIGHUP to agentd to reload its config"), false);
	});

	test("a path that merely starts with the daemon's name is not the daemon", () => {
			// This lesson's own benign half of the task. Without the lookarounds `\bagentd\b`
			// matches inside `agentd-cache`, and the guard blocks cache cleanup.
		assert.equal(containsLifecycleCommand("clear old files out of /tmp/agentd-cache"), false);
		assert.equal(containsLifecycleCommand("clear old files out of /tmp/agentd-cache, then stop"), false);
	});

	test("two unrelated clauses in one prompt do not join up", () => {
			// The window is bounded for exactly this: a killing verb and the daemon's name can both
			// appear in one prompt without the prompt being about killing the daemon.
		assert.equal(
			containsLifecycleCommand(
				"restart the build box; afterwards tail the last 200 lines of the agentd log for errors",
			),
			false,
		);
	});

	test("start is deliberately not blocked", () => {
			// Starting a daemon inside the daemon is harmless, and a legitimate job may need to
			// start a different profile. Blocking it produces inexplicable failures.
		assert.equal(containsLifecycleCommand("agentd start"), false);
	});

	test("unrelated prose is not falsely blocked", () => {
		assert.equal(
			containsLifecycleCommand("research the autoscaling and restart behaviour of the Kong API gateway"),
			false,
		);
		assert.equal(containsLifecycleCommand("recycle the database connection pool once a day"), false);
	});

	test("prompt and script are checked together, so splitting it in two still gets blocked", () => {
		assert.throws(
			() => checkLifecycle("clear the cache, then run cleanup.sh", "#!/bin/sh\nagentd restart\n"),
			LifecycleBlocked,
		);
	});

	test("the error message must name an alternative, not just say no", () => {
			// Measured (README Step 6): with an alternative stated, the model changes approach and tells the user;
			// with only "not allowed", Lesson 8 measured five consecutive attempts to route around.
		try {
			checkLifecycle("agentd restart");
			assert.fail("should have thrown");
		} catch (error) {
			assert.ok(error instanceof LifecycleBlocked);
			assert.match(error.message, /outside/);
		}
	});
});
