/**
 * The execution ledger: a record of **what is known**, not a retry queue.
 *
 * The opening sentence of Hermes's `cron/executions.py` is worth copying whole:
 *
 *   > The ledger records what is known about each attempt; it is not a retry
 *   > queue. Interrupted attempts become `unknown` only after their exact
 *   > owner process is proved gone. Terminal states are immutable.
 *
 * Three things, each of which looks like a detail alone and which together are this lesson's spine:
 *
 * ── 1. There is a third terminal state ──────────────────────
 *
 *   completed  finished, successfully
 *   failed     finished, unsuccessfully
 *   unknown    **the process died midway; whether the side effect happened is unknown**
 *
 * Most hand-rolled schedulers have only the first two, so "the process was killed" is classified
 * as failed and retried automatically — and that job may already have sent the email.
 *
 * > **"Failed" and "unknown" are different things, and recording the second as the first is a lie.**
 *
 * ── 2. Death must be proved, not assumed ───────────────────
 *
 * Seeing a `running` record after a restart does not mean its owner died — another live scheduler
 * may be running it. `_owner_is_live()` compares **pid plus process start time**, because pids get
 * recycled: a new process happening to take the same pid would make you judge a live execution dead.
 *
 * And when the information is unavailable, Hermes writes:
 *
 *   > fail safe: inability to prove death must not rewrite state
 *
 * **If you cannot prove it died, treat it as alive.** The reverse design produces duplicate execution.
 *
 * ── 3. Terminal states are immutable ───────────────────────
 *
 * Every transition is a conditional update (`WHERE status IN ('claimed','running')`), returning null
 * when it matches nothing. So "two places reporting a result at once" cannot overwrite each other.
 *
 * A JSON file is used here rather than SQLite, because this lesson's subject is the state machine
 * rather than the storage engine; a Map expresses conditional-update semantics just as well.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export type ExecutionStatus = "claimed" | "running" | "completed" | "failed" | "unknown";

const TERMINAL: ReadonlySet<ExecutionStatus> = new Set(["completed", "failed", "unknown"]);

export interface Execution {
	id: string;
	jobId: string;
	/** What started it: the schedule, a human, or a catch-up. */
	source: "cron" | "manual" | "catchup";
	/** Which scheduler process claimed it. */
	ownerId: string;
	pid: number;
	/** ⚠️ pids get recycled, so the start time is recorded with it. */
	pidStartedAt: number;
	status: ExecutionStatus;
	/** The **scheduled** time this run corresponds to. */
	scheduledFor: number;
	claimedAt: number;
	startedAt?: number;
	finishedAt?: number;
	error?: string;
}

/**
 * Decide whether an owner process is still alive.
 *
 * It is an interface because this lesson **switches it off**: the `prove=false` version treats
 * "this is not me" as dead, which is exactly the assumption that produces duplicate execution.
 */
export interface OwnerProbe {
	/** Does this pid exist right now. */
	exists(pid: number): boolean;
	/** This pid's start time. undefined when unavailable. */
	startedAt(pid: number): number | undefined;
}

export interface LedgerOptions {
	path?: string;
	/** This scheduler process's id. A restart takes a new one. */
	ownerId: string;
	pid: number;
	pidStartedAt: number;
	probe: OwnerProbe;
	/**
		 * Whether to prove the owner died before rewriting state.
		 * **false is the broken version this lesson demonstrates.**
	 */
	proveDeath?: boolean;
	now?: () => number;
}

export class Ledger {
	private readonly executions = new Map<string, Execution>();
	private counter = 0;

	constructor(private readonly options: LedgerOptions) {}

	private get now(): number {
		return (this.options.now ?? Date.now)();
	}

	static async load(options: LedgerOptions): Promise<Ledger> {
		const ledger = new Ledger(options);
		if (!options.path) return ledger;
		try {
			const raw = await readFile(options.path, "utf8");
			for (const item of JSON.parse(raw) as Execution[]) {
				ledger.executions.set(item.id, item);
				ledger.counter++;
			}
		} catch {
				// No file means this is the first run
		}
		return ledger;
	}

	private async save(): Promise<void> {
		if (!this.options.path) return;
		await mkdir(dirname(this.options.path), { recursive: true });
		await writeFile(
			this.options.path,
			JSON.stringify([...this.executions.values()], null, 2),
			"utf8",
		);
	}

	list(jobId?: string): Execution[] {
		const all = [...this.executions.values()];
		return jobId ? all.filter((e) => e.jobId === jobId) : all;
	}

	/** Whether this job currently has a live execution (claimed or running). */
	activeFor(jobId: string): Execution | undefined {
		return this.list(jobId).find((e) => !TERMINAL.has(e.status));
	}

	/**
	 * Claim the next run. **Write before doing anything, not after finishing.**
	 *
	 * Order matters: record first and execute second, so a crash leaves the trace "somebody tried".
	 * The other way round (record after finishing) means dying midway leaves no record at all, and
	 * the next restart believes it never ran — which is Lesson 29's "failure with no signal" in its
	 * scheduling form.
	 */
	async claim(
		jobId: string,
		scheduledFor: number,
		source: Execution["source"] = "cron",
	): Promise<Execution> {
		const execution: Execution = {
			id: `exe_${String(++this.counter).padStart(4, "0")}`,
			jobId,
			source,
			ownerId: this.options.ownerId,
			pid: this.options.pid,
			pidStartedAt: this.options.pidStartedAt,
			status: "claimed",
			scheduledFor,
			claimedAt: this.now,
		};
		this.executions.set(execution.id, execution);
		await this.save();
		return execution;
	}

	/** claimed → running. Succeeds exactly once. */
	async markRunning(id: string): Promise<Execution | undefined> {
		const execution = this.executions.get(id);
		if (!execution || execution.status !== "claimed") return undefined;
		execution.status = "running";
		execution.startedAt = this.now;
		await this.save();
		return execution;
	}

	/** → completed / failed. A terminal state cannot be rewritten. */
	async finish(id: string, success: boolean, error?: string): Promise<Execution | undefined> {
		const execution = this.executions.get(id);
		if (!execution || TERMINAL.has(execution.status)) return undefined;
		execution.status = success ? "completed" : "failed";
		execution.finishedAt = this.now;
		if (!success) execution.error = error ?? "unknown failure";
		await this.save();
		return execution;
	}

	/**
	 * After a restart: mark executions whose owner can be **proved gone** as unknown.
	 *
	 * Note what it does, and note more carefully what it **does not**:
	 *   does      turn "undecided" into a terminal, honest answer
	 *   does not  schedule any retry
	 *
	 * Whether to re-run is decided by **the nature of the job** (is that step idempotent?),
	 * not by the scheduler. Lesson 34 covers exactly this.
	 */
	async recoverInterrupted(): Promise<{ recovered: Execution[]; leftAlone: Execution[] }> {
		const recovered: Execution[] = [];
		const leftAlone: Execution[] = [];

		for (const execution of this.executions.values()) {
			if (TERMINAL.has(execution.status)) continue;
				// Claimed by this very process, so obviously alive.
			if (execution.ownerId === this.options.ownerId) continue;

			if (this.options.proveDeath !== false && this.ownerIsLive(execution)) {
				leftAlone.push(execution);
				continue;
			}

			execution.status = "unknown";
			execution.finishedAt = this.now;
			execution.error =
				"Scheduler restarted after this execution's owner exited before a durable " +
				"terminal state; whether side effects ran is unknown.";
			recovered.push(execution);
		}

		if (recovered.length > 0) await this.save();
		return { recovered, leftAlone };
	}

	private ownerIsLive(execution: Execution): boolean {
		if (!this.options.probe.exists(execution.pid)) return false;

		const startedAt = this.options.probe.startedAt(execution.pid);
			// ⚠️ An unavailable start time must be treated as alive.
			// If death cannot be proved, its state must not be rewritten.
		if (startedAt === undefined) return true;

			// Same pid with a different start time = the pid was recycled and the original process really died.
		return startedAt === execution.pidStartedAt;
	}
}

/** The version that really asks the operating system. */
export function realProbe(startTimes: Map<number, number>): OwnerProbe {
	return {
		exists(pid) {
			try {
					// signal 0 = check existence and permission only, sending no actual signal.
				process.kill(pid, 0);
				return true;
			} catch {
				return false;
			}
		},
		startedAt(pid) {
				// Node has no portable API for "get an arbitrary pid's start time".
				// Our own process knows; other processes do not — and **not knowing means treating it as alive**.
			return startTimes.get(pid);
		},
	};
}
