/**
 * Lesson 18 - scheduling and unattended running
 *
 * Five scenarios, each matching a mechanism whose failure is visible once it is switched off:
 *
 *   catchup   the laptop was shut for three hours and 36 runs were missed. How many should run?
 *   overlap   the previous run has not finished and the next is due
 *   crash     the process was killed mid-run. Is that record failed?
 *   respawn   the job restarted the thing running the schedule ← a real issue, an infinite loop
 *   approval  approval is needed at 3 AM with nobody awake
 *
 * Run:
 *   bun run lesson-18                  # everything (no key needed; the clock is fake)
 *   bun run lesson-18 crash            # one scenario
 *   RETRY=1 bun run lesson-18 crash    # treat unknown as "just retry"
 *   PROVE=off bun run lesson-18 crash  # rewrite state without proving the owner died
 *   OVERLAP=allow bun run lesson-18 overlap
 *   GUARD=off bun run lesson-18 respawn
 */

import { appendFile, mkdir, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { InboxStore } from "../shared/inbox/store.ts";
import { checkLifecycle, LifecycleBlocked } from "./guard.ts";
import { Ledger, type OwnerProbe } from "./ledger.ts";
import { applyCatchUp, type Job, missedRuns } from "./schedule.ts";
import { Scheduler } from "./scheduler.ts";

const STATE = resolve(import.meta.dirname, ".state");
const RUNS_LOG = resolve(STATE, "runs.log");

const RETRY_UNKNOWN = process.env.RETRY === "1";
const PROVE_DEATH = process.env.PROVE !== "off";
const OVERLAP = (process.env.OVERLAP as "skip" | "allow" | undefined) ?? "skip";
const GUARD_ON = process.env.GUARD !== "off";

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** A fake clock. A scheduling lesson that really waited would never finish. */
function fakeClock(start: number) {
	let now = start;
	return {
		now: () => now,
		advance: (ms: number) => {
			now += ms;
		},
		set: (t: number) => {
			now = t;
		},
	};
}

function job(overrides: Partial<Job> & Pick<Job, "id" | "name" | "everySeconds">): Job {
	return {
		prompt: "tidy up today's inbox",
		catchUp: "one",
		enabled: true,
		createdAt: 0,
		...overrides,
	};
}

/** A countable side effect. The same position as Lesson 29: only the outside world decides. */
async function sideEffect(line: string): Promise<void> {
	await mkdir(STATE, { recursive: true });
	await appendFile(RUNS_LOG, `${line}\n`, "utf8");
}

function countRuns(): number {
	try {
		return readFileSync(RUNS_LOG, "utf8").split("\n").filter(Boolean).length;
	} catch {
		return 0;
	}
}

async function resetState(): Promise<void> {
	await rm(STATE, { recursive: true, force: true });
}

/** A fake operating system probe, making "does this pid exist" controllable. */
function fakeProbe(live: Map<number, number>): OwnerProbe {
	return {
		exists: (pid) => live.has(pid),
		startedAt: (pid) => live.get(pid),
	};
}

// ─────────────────────────────────────────────────────────────
// 1. catchup
// ─────────────────────────────────────────────────────────────

async function scenarioCatchup(): Promise<void> {
	console.log(`\n${bold("── catchup · the laptop was shut for three hours")}`);

	const clock = fakeClock(0);
	const every5min = job({
		id: "sync",
		name: "sync inbox",
		everySeconds: 300,
		lastScheduledAt: 0,
	});

	clock.advance(3 * HOUR);
	const missed = missedRuns(every5min, clock.now());
	console.log(dim(`  every 5 minutes, 3 hours down → ${missed.length} runs missed`));

	for (const policy of ["all", "one", "skip"] as const) {
		const { runs, dropped } = applyCatchUp(policy, missed);
		const tag = policy === "one" ? green("one ") : dim(`${policy.padEnd(4)}`);
		console.log(
			`    ${tag} ran ${String(runs.length).padStart(2)}  dropped ${String(dropped).padStart(2)}  ${dim(describe(policy))}`,
		);
	}

	console.log(dim("\n  All three are right, for different jobs. There is no safe default value, only a safe default direction."));
}

function describe(policy: string): string {
	switch (policy) {
		case "all":
			return "every occurrence matters (working through a queue)";
		case "one":
			return "only the latest state matters (syncing, health checks)";
		default:
			return "worthless once stale (a 7am reminder)";
	}
}

// ─────────────────────────────────────────────────────────────
// 2. overlap
// ─────────────────────────────────────────────────────────────

async function scenarioOverlap(): Promise<void> {
	console.log(`\n${bold("── overlap · the previous run is not done and the next one is due")}`);
	console.log(dim(`  OVERLAP=${OVERLAP}`));
	await resetState();

	const clock = fakeClock(0);
	const live = new Map([[process.pid, 1]]);
	const ledger = new Ledger({
		ownerId: "sched-a",
		pid: process.pid,
		pidStartedAt: 1,
		probe: fakeProbe(live),
		now: clock.now,
	});

	// This job is scheduled every 60 seconds and takes 150 seconds per run (in the fake clock).
	let running = 0;
	let maxConcurrent = 0;
	const scheduler = new Scheduler({
		ledger,
		clock: clock.now,
		overlap: OVERLAP,
		runner: async ({ job: j, scheduledFor }) => {
			running++;
			maxConcurrent = Math.max(maxConcurrent, running);
			await sideEffect(`${j.id}@${scheduledFor}`);
				// Deliberately not awaiting real time; a long job is simulated by returning to tick
				// before finish is called: see the pending handling below.
			running--;
			return "ok";
		},
	});

	scheduler.add(job({ id: "slow", name: "slow job", everySeconds: 60, lastScheduledAt: 0 }));

	// Manufacture a "still running" execution by hand, simulating a stuck previous round.
	const stuck = await ledger.claim("slow", 0);
	await ledger.markRunning(stuck.id);
	console.log(dim(`  ${stuck.id} is still running (simulating a stuck previous run)`));

	clock.advance(3 * MINUTE);
	const report = await scheduler.tick();

	console.log(
		`  this tick ran ${report.ran.length}  skipped ${report.skipped.length}  side effects ${countRuns()}`,
	);
	for (const skip of report.skipped) console.log(dim(`    ⏭ ${skip.reason}`));

	if (OVERLAP === "allow") {
		console.log(
			red("  ⚠ One job has several runs going at once. If it sends mail, charges a card or writes a file, those side effects are duplicated."),
		);
	} else {
		console.log(green("  ✓ the stuck run stays, and no new run piles on top of it"));
	}
}

// ─────────────────────────────────────────────────────────────
// 3. crash
// ─────────────────────────────────────────────────────────────

async function scenarioCrash(): Promise<void> {
	console.log(`\n${bold("── crash · the process is killed mid-run")}`);
	console.log(dim(`  PROVE=${PROVE_DEATH ? "on" : "off"}  RETRY=${RETRY_UNKNOWN ? "1" : "0"}`));
	await resetState();

	const clock = fakeClock(0);
	// live: pid → start time. This is the "fake operating system".
	const live = new Map<number, number>([[4242, 1000]]);

	// ── A. It really died ───────────────────────────────────
	console.log(`\n  ${bold("A. the owner really did die")}`);

	const first = new Ledger({
		ownerId: "sched-1",
		pid: 4242,
		pidStartedAt: 1000,
		probe: fakeProbe(live),
		now: clock.now,
		path: resolve(STATE, "ledger.json"),
	});

	const exec = await first.claim("digest", 0);
	await first.markRunning(exec.id);
	await sideEffect("digest@0 (the message went out)");
	console.log(dim(`    ${exec.id} running → the side effect already happened (${countRuns()} of them)`));
	console.log(red("    💀 the process is killed before it writes the final state"));

	// ⚠️ The pid was recycled to somebody else: 4242 still exists with a different start time.
	// Comparing only "does this pid exist" concludes "still alive" and leaves that record
	// in running forever. Comparing start times asks the real question:
	// **is it the same process.**
	live.set(4242, 2000);
	console.log(dim("    (pid 4242 was recycled to another process: it exists, but its start time differs)"));

	const second = await Ledger.load({
		ownerId: "sched-2",
		pid: 5151,
		pidStartedAt: 3000,
		probe: fakeProbe(live),
		proveDeath: PROVE_DEATH,
		now: clock.now,
		path: resolve(STATE, "ledger.json"),
	});

	const { recovered } = await second.recoverInterrupted();
	for (const item of recovered) {
		console.log(`    ${item.id} → ${yellow(item.status)}  ${dim(item.error?.slice(0, 52) ?? "")}…`);
	}

	if (RETRY_UNKNOWN) {
		for (const item of recovered) {
			await sideEffect(`${item.jobId}@${item.scheduledFor} (retry)`);
		}
		console.log(red(`    ⚠ auto-retrying unknown → ${countRuns()} side effects. That message was sent twice.`));
	} else {
		console.log(
			green(`    ✓ no auto-retry → side effects stay at ${countRuns()}`) +
				dim(" (whether to re-run is decided by the nature of the job)"),
		);
	}

	// ── B. Not dead, you just do not know ────────────────────
	//
	// This section is what the PROVE switch really demonstrates.
	console.log(`\n  ${bold("B. the owner is actually alive (another scheduler is running the same job)")}`);
	await resetState();

	live.set(7777, 5000); // sched-3 is perfectly alive
	const busy = new Ledger({
		ownerId: "sched-3",
		pid: 7777,
		pidStartedAt: 5000,
		probe: fakeProbe(live),
		now: clock.now,
		path: resolve(STATE, "ledger-b.json"),
	});
	const inflight = await busy.claim("digest", 0);
	await busy.markRunning(inflight.id);
	await sideEffect("digest@0 (sched-3 is sending it)");
	console.log(dim(`    ${inflight.id} running, pid 7777 still alive (${countRuns()} side effects)`));

	const newcomer = await Ledger.load({
		ownerId: "sched-4",
		pid: 8888,
		pidStartedAt: 6000,
		probe: fakeProbe(live),
		proveDeath: PROVE_DEATH,
		now: clock.now,
		path: resolve(STATE, "ledger-b.json"),
	});
	const outcome = await newcomer.recoverInterrupted();
	console.log(
		`    sched-4 starts: marked ${outcome.recovered.length} as unknown, left ${outcome.leftAlone.length} alone`,
	);

	// Then it ticks once. The overlap check looks at "is there a non-terminal execution".
	const scheduler = new Scheduler({
		ledger: newcomer,
		clock: clock.now,
		runner: async ({ job: j, scheduledFor }) => {
			await sideEffect(`${j.id}@${scheduledFor} (sched-4 sent it too)`);
			return "sent";
		},
	});
	scheduler.add(job({ id: "digest", name: "daily digest", everySeconds: 60, lastScheduledAt: 0 }));
	clock.advance(2 * MINUTE);
	const report = await scheduler.tick();

	if (PROVE_DEATH) {
		console.log(
			green(`    ✓ sched-3's run was untouched → sched-4 skipped (${report.skipped.length}), side effects stay at ${countRuns()}`),
		);
	} else {
		console.log(
			red(
				`    ⚠ a live run was marked unknown → the overlap check cannot see it → sched-4 runs anyway (${report.ran.length})\n` +
					`      ${countRuns()} side effects. The same message, sent once by each scheduler.`,
			),
		);
	}

	console.log(
		dim(
			'\n  unknown is not failed. failed means "it finished and did not succeed";\n' +
				'  unknown means "nobody knows whether the side effect happened". Recording the latter as the former is a lie.\n' +
				'  And "if you cannot prove it died, assume it lives" is the other half: guessing wrong costs you duplicated side effects.',
		),
	);
}

// ─────────────────────────────────────────────────────────────
// 4. respawn
// ─────────────────────────────────────────────────────────────

async function scenarioRespawn(): Promise<void> {
	console.log(`\n${bold("── respawn · the job restarts the thing that runs the schedule")}`);
	console.log(dim(`  GUARD=${GUARD_ON ? "on" : "off"}`));

	const spec = {
		name: "daily temp-file cleanup",
		prompt: "clear old files under /tmp/agentd-cache, then agentd restart so the config takes effect",
	};

	if (GUARD_ON) {
		try {
			checkLifecycle(spec.prompt);
			console.log(red("  the guard did not block it (should not happen)"));
		} catch (error) {
			if (!(error instanceof LifecycleBlocked)) throw error;
			console.log(green("  ✓ blocked at creation time"));
			console.log(dim(`    ${error.message.split(". ").slice(0, 2).join(". \n    ")}`));
			console.log(
				dim("\n  Note it blocks at **creation**, not at **execution**.\n" +
					"  Blocking at execution would make that job fail silently once a day."),
			);
		}
		return;
	}

	// The guard off: run the causal chain out.
	console.log(dim("  The job was created. Here is the causal chain:\n"));

	let daemonAlive = true;
	let restarts = 0;
	let resumedTurns = 0;
	const LIMIT = 8;

	for (let i = 0; i < LIMIT; i++) {
		console.log(
			`    ${dim(`[${String(i + 1).padStart(2)}]`)} the job fires → agentd is restarted` +
				dim("  → the supervisor revives it → auto-resume picks up the same session → that turn runs again"),
		);
		daemonAlive = false;
		restarts++;
			// The supervisor (launchd KeepAlive / systemd Restart=)
		daemonAlive = true;
			// auto-resume picks the interrupted turn back up → re-runs the same logic
		resumedTurns++;
	}

	console.log(
		red(`\n  after ${LIMIT} rounds: ${restarts} restarts, ${resumedTurns} re-run turns, daemon ${daemonAlive ? "alive" : "dead"}`),
	);
	console.log(
		dim("  The cap here is 8; in reality it is one round every ~10 seconds until somebody intervenes by hand (Hermes #30719)."),
	);
	console.log(
		yellow(
			"\n  ⚠ Each piece is a correct design on its own: scheduling, supervisor auto-restart, resume-after-interrupt.\n" +
				"    The loop is what they multiply into.",
		),
	);
}

// ─────────────────────────────────────────────────────────────
// 5. approval
// ─────────────────────────────────────────────────────────────

async function scenarioApproval(): Promise<void> {
	console.log(`\n${bold("── approval · approval needed at 3am")}`);
	await resetState();

	const inbox = new InboxStore();
	const clock = fakeClock(3 * HOUR);
	const live = new Map([[process.pid, 1]]);
	const ledger = new Ledger({
		ownerId: "sched-night",
		pid: process.pid,
		pidStartedAt: 1,
		probe: fakeProbe(live),
		now: clock.now,
	});

	let parkedItemId: string | undefined;

	const scheduler = new Scheduler({
		ledger,
		clock: clock.now,
		runner: async ({ job: j }) => {
				// This job sends an email — Lesson 8's EXTERNAL risk, which must be approved.
			const item = await inbox.add({
				sessionId: `cron:${j.id}`,
				kind: "approval",
				visibility: "inbox",
				title: "Run send_email?",
				body: 'to team@example.com, subject "Daily digest"',
			});
			parkedItemId = item.id;
			console.log(dim(`    ${j.name} → inbox ${item.id} (pending); the run stops here`));

			const resolution = await inbox.wait(item.id);
			if (resolution !== "allow") return "the user declined; nothing was sent";
			await sideEffect("email@3am");
			return "sent";
		},
	});

	scheduler.add(
		job({ id: "digest", name: "daily digest", everySeconds: 3600, lastScheduledAt: 2 * HOUR }),
	);

	// tick never returns, because that job is stopped in inbox.wait().
	const ticking = scheduler.tick();
	await new Promise((r) => setTimeout(r, 20));

	const pending = inbox.pending();
	console.log(`  inbox pending ${pending.length}  side effects ${countRuns()}  ${dim("(you are still asleep)")}`);
	const active = ledger.activeFor("digest");
	console.log(dim(`    ledger: ${active?.id} is still ${active?.status} — that is not a failure, it is unfinished`));

	console.log(dim("\n  ☀️  morning: you wake up and tap allow:"));
	await inbox.resolve(parkedItemId as string, "allow");
	const report = await ticking;

	console.log(
		green(`  ✓ the run continued and finished`) +
			dim(`  ledger: ${ledger.list("digest")[0]?.status}  side effects ${countRuns()}`),
	);
	console.log(dim(`    output: ${report.ran[0]?.output}`));

	console.log(
		dim(
			"\n  Scheduling and unattended operation are two halves of one problem: **anything on a schedule runs unattended.**\n" +
				"  Lesson 9 already built the inbox, so nothing here changes; only the approver is swapped.",
		),
	);
}

// ─────────────────────────────────────────────────────────────

const SCENARIOS: Record<string, () => Promise<void>> = {
	catchup: scenarioCatchup,
	overlap: scenarioOverlap,
	crash: scenarioCrash,
	respawn: scenarioRespawn,
	approval: scenarioApproval,
};

async function main(): Promise<void> {
	const only = process.argv[2];
	const names = only ? [only] : Object.keys(SCENARIOS);

	for (const name of names) {
		const scenario = SCENARIOS[name];
		if (!scenario) {
			console.error(`Unknown scenario: ${name}. Available: ${Object.keys(SCENARIOS).join(", ")}`);
			process.exitCode = 1;
			return;
		}
		await scenario();
	}

	await resetState();
	console.log(dim("\n(.state cleared)"));
}

await main();
