/**
 * tick(): one pass of "what should run now".
 *
 * Hermes's gateway calls `cron.scheduler.tick()` every 60 seconds
 * (the docstring at `cron/scheduler.py:1-8`). The same shape, with the clock and
 * "how to run a job" extracted as parameters so it can be tested and swapped.
 *
 * This file is short, because the hard parts live in other files:
 *
 *   schedule.ts  what to do about the ones that were missed
 *   ledger.ts    how to record dying mid-run
 *   guard.ts     which jobs should never be created
 *
 * **tick only strings them together.** A scheduler that is large in itself usually means
 * one of those three was never thought through separately.
 */

import { applyCatchUp, type Clock, type Job, missedRuns } from "./schedule.ts";
import type { Execution, Ledger } from "./ledger.ts";

export interface JobRun {
	job: Job;
	/** The scheduled time this run corresponds to (possibly in the past, when catching up). */
	scheduledFor: number;
	source: Execution["source"];
}

/** How to run a job. The demo uses a script; `agent.ts` uses a real agent turn. */
export type JobRunner = (run: JobRun) => Promise<string>;

/** What to do when the same job's previous run has not finished. */
export type OverlapPolicy =
	/** Skip and record it. **The default.** */
	| "skip"
	/** Run anyway. The broken version this lesson demonstrates. */
	| "allow";

export interface SchedulerOptions {
	ledger: Ledger;
	runner: JobRunner;
	clock: Clock;
	overlap?: OverlapPolicy;
	log?: (line: string) => void;
}

export interface TickReport {
	ran: { jobId: string; scheduledFor: number; ok: boolean; output?: string; error?: string }[];
		/** Skipped because the previous run was still going. */
	skipped: { jobId: string; scheduledFor: number; reason: string }[];
		/** How many the catch-up policy dropped. */
	dropped: { jobId: string; count: number; policy: string }[];
}

export class Scheduler {
	private readonly jobs = new Map<string, Job>();

	constructor(private readonly options: SchedulerOptions) {}

	add(job: Job): void {
		this.jobs.set(job.id, job);
	}

	get(jobId: string): Job | undefined {
		return this.jobs.get(jobId);
	}

	list(): Job[] {
		return [...this.jobs.values()];
	}

		/** Do this first after a restart, before ticking. */
	async recover(): Promise<{ recovered: Execution[]; leftAlone: Execution[] }> {
		return await this.options.ledger.recoverInterrupted();
	}

	async tick(): Promise<TickReport> {
		const { ledger, runner, clock, overlap = "skip", log } = this.options;
		const now = clock();
		const report: TickReport = { ran: [], skipped: [], dropped: [] };

		for (const job of this.jobs.values()) {
			const missed = missedRuns(job, now);
			if (missed.length === 0) continue;

			const { runs, dropped } = applyCatchUp(job.catchUp, missed);
			if (dropped > 0) {
				report.dropped.push({ jobId: job.id, count: dropped, policy: job.catchUp });
			}

				// ⚠️ Whether or not anything ran, time advances to the last missed scheduled time.
			//
				// Without this line, the `skip` policy re-sees the same batch of missed runs on **every tick**,
				// so the dropped number grows every minute —
				// and because it executes nothing, that bug has no symptom.
			job.lastScheduledAt = missed[missed.length - 1] as number;

			for (const scheduledFor of runs) {
				const active = ledger.activeFor(job.id);
				if (active && overlap === "skip") {
					report.skipped.push({
						jobId: job.id,
						scheduledFor,
						reason: `the previous run is still going (${active.id}, ${active.status})`,
					});
					log?.(`  ⏭ ${job.name}: skipped, ${active.id} is still ${active.status}`);
					continue;
				}

				const execution = await ledger.claim(
					job.id,
					scheduledFor,
					scheduledFor < now - job.everySeconds * 1000 ? "catchup" : "cron",
				);
				await ledger.markRunning(execution.id);

				try {
					const output = await runner({
						job,
						scheduledFor,
						source: execution.source,
					});
					await ledger.finish(execution.id, true);
					report.ran.push({ jobId: job.id, scheduledFor, ok: true, output });
					log?.(`  ✓ ${job.name}（${execution.id}）`);
				} catch (error) {
						// ⚠️ A killed process **never reaches this point**, which is exactly the point:
						// a failure that can be caught is honestly recorded as failed,
						// and a failure that cannot leaves a running record for the next restart to judge.
					const message = error instanceof Error ? error.message : String(error);
					await ledger.finish(execution.id, false, message);
					report.ran.push({ jobId: job.id, scheduledFor, ok: false, error: message });
					log?.(`  ✗ ${job.name}（${execution.id}）：${message}`);
				}
			}
		}

		return report;
	}
}
