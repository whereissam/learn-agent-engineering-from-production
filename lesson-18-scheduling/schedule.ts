/**
 * When it should run: due times, and **what to do about the ones that were missed**.
 *
 * "Run every 5 minutes" sounds like one parameter, and when a laptop is shut for three hours and reopened
 * you have to answer a question every scheduler eventually meets:
 *
 *     36 runs were missed. How many run now?
 *
 * All three answers are right, **for different jobs**:
 *
 *   all   run all 36    for jobs where every run matters (processing a queue entry by entry)
 *   one   run one       for jobs that only take the latest state (syncing an inbox)
 *   skip  run none      for jobs that are meaningless once late (a 7 AM reminder)
 *
 * ⚠️ **There is no safe default value, only a safe default direction.**
 * The default here is `one`, because `all` fires 36 side effects the moment you open your laptop,
 * while `skip` lets a job like "back up every day" quietly not happen — both are bad,
 * and the former is a **loud failure** while the latter is silent. So the real default should lean loud,
 * and `one` is the only option between them that acts without flooding.
 *
 * Against Hermes: `cron/scheduler.py` (4298 lines). Its tick() is called by the gateway
 * every 60 seconds; the shape here is the same, with the clock extracted so tests can run.
 */

/** The clock is injected, because "wait three hours and see" is not something you can write as a test. */
export type Clock = () => number;

export type CatchUpPolicy = "all" | "one" | "skip";

export interface Job {
	id: string;
	name: string;
	/** The interval. Parsing real cron syntax is not this lesson's point; see the README's "deliberately not done". */
	everySeconds: number;
	/** What this job does (the words fed to the model). */
	prompt: string;
	catchUp: CatchUpPolicy;
	enabled: boolean;
	/** The last **scheduled** time (not the time it finished; see below). */
	lastScheduledAt?: number;
	createdAt: number;
}

/**
 * Which scheduled times this job missed between `lastScheduledAt` and `now`.
 *
 * ⚠️ **Advance by scheduled time, not by completion time.**
 *
 * Advancing by completion time accumulates each run's seconds into an offset:
 * a job every 60 seconds that takes 5 seconds per run drifts an hour in a day.
 * That bug never raises an error; it just turns "every day at nine" slowly into ten.
 */
export function missedRuns(job: Job, now: number, limit = 10_000): number[] {
	if (!job.enabled) return [];

	const interval = job.everySeconds * 1000;
	if (interval <= 0) throw new Error(`job ${job.id}: everySeconds must be > 0`);

	// A job that never ran: count from now rather than back-filling time before it was created.
	if (job.lastScheduledAt === undefined) {
		return now >= job.createdAt ? [job.createdAt] : [];
	}

	const out: number[] = [];
	for (let t = job.lastScheduledAt + interval; t <= now; t += interval) {
		out.push(t);
			// The cap stops a "once a second, down for three months" job eating all the memory.
			// Reaching the cap must itself be visible, so the caller receives limit entries and judges for itself.
		if (out.length >= limit) break;
	}
	return out;
}

/** Apply the catch-up policy and return "how many runs happen this tick, at which scheduled times". */
export function applyCatchUp(
	policy: CatchUpPolicy,
	missed: number[],
): { runs: number[]; dropped: number } {
	if (missed.length === 0) return { runs: [], dropped: 0 };

	switch (policy) {
		case "all":
			return { runs: missed, dropped: 0 };
		case "one":
				// Catch up the last one, not the first. What is wanted is the current state, not three hours ago's.
			return { runs: [missed[missed.length - 1] as number], dropped: missed.length - 1 };
		case "skip":
			return { runs: [], dropped: missed.length };
	}
}

/** When it will next run (for humans). */
export function nextDue(job: Job, now: number): number {
	const interval = job.everySeconds * 1000;
	const base = job.lastScheduledAt ?? job.createdAt;
	let next = base + interval;
	while (next <= now) next += interval;
	return next;
}

export function formatDelta(ms: number): string {
	const s = Math.round(ms / 1000);
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	if (m < 60) return `${m}m${s % 60 ? ` ${s % 60}s` : ""}`;
	const h = Math.floor(m / 60);
	return `${h}h${m % 60 ? ` ${m % 60}m` : ""}`;
}
