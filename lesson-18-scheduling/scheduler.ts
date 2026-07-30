/**
 * tick()：一次「現在有什麼該跑」。
 *
 * Hermes 的 gateway 每 60 秒呼叫一次 `cron.scheduler.tick()`
 * （`cron/scheduler.py:1-8` 的 docstring）。形狀一樣，只是把時鐘和
 * 「怎麼跑一個工作」都抽成參數，才測得動、才換得掉。
 *
 * 這個檔案本身很短，因為難的部分都在別的檔案：
 *
 *   schedule.ts  錯過的那些怎麼辦
 *   ledger.ts    跑到一半死掉怎麼記
 *   guard.ts     哪些工作根本不該被建立
 *
 * **tick 只負責把它們串起來。** 一個排程器如果自己很大，
 * 通常代表這三件事有某一件沒有被單獨想清楚。
 */

import { applyCatchUp, type Clock, type Job, missedRuns } from "./schedule.ts";
import type { Execution, Ledger } from "./ledger.ts";

export interface JobRun {
	job: Job;
	/** 這一次對應的排定時間（可能是過去的，補跑時）。 */
	scheduledFor: number;
	source: Execution["source"];
}

/** 怎麼跑一個工作。demo 用腳本，`agent.ts` 用真的 agent turn。 */
export type JobRunner = (run: JobRun) => Promise<string>;

/** 同一個工作上一輪還沒跑完，這一輪怎麼辦。 */
export type OverlapPolicy =
	/** 跳過，並且記下來。**預設**。 */
	| "skip"
	/** 照跑。這是這一課要示範的錯誤版本。 */
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
	/** 因為上一輪還在跑而跳過的。 */
	skipped: { jobId: string; scheduledFor: number; reason: string }[];
	/** 補跑政策丟掉的次數。 */
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

	/** 重開之後先做這件事，再開始 tick。 */
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

			// ⚠️ 不管有沒有真的跑，時間都要推進到最後一個錯過的排定時間。
			//
			// 少了這一行，`skip` 政策會在**每一次 tick** 重新看到同一批
			// 錯過的排程，於是 dropped 的數字每分鐘都在長 ——
			// 而且因為它沒有真的執行任何東西，這個 bug 不會有任何症狀。
			job.lastScheduledAt = missed[missed.length - 1] as number;

			for (const scheduledFor of runs) {
				const active = ledger.activeFor(job.id);
				if (active && overlap === "skip") {
					report.skipped.push({
						jobId: job.id,
						scheduledFor,
						reason: `上一輪還在跑（${active.id}，${active.status}）`,
					});
					log?.(`  ⏭ ${job.name}：跳過，${active.id} 還在 ${active.status}`);
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
					// ⚠️ 進程被殺掉的時候**不會走到這裡**，那正是重點：
					// catch 得到的失敗會被誠實地記成 failed，
					// catch 不到的失敗會留下一筆 running，等下次重開來判定。
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
