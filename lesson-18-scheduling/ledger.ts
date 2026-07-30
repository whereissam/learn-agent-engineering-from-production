/**
 * 執行紀錄：一份**只記錄「已知的事」**的帳，不是重試佇列。
 *
 * Hermes 的 `cron/executions.py` 開頭那句話值得整段抄下來：
 *
 *   > The ledger records what is known about each attempt; it is not a retry
 *   > queue. Interrupted attempts become `unknown` only after their exact
 *   > owner process is proved gone. Terminal states are immutable.
 *
 * 三件事，每一件單獨看都會被當成小細節，合起來才是這一課的骨架：
 *
 * ── 1. 有第三個終局狀態 ────────────────────────────────────
 *
 *   completed  跑完了，成功
 *   failed     跑完了，失敗
 *   unknown    **進程死在中間，副作用有沒有發生不知道**
 *
 * 大部分自己寫的排程器只有前兩個，於是「進程被 kill」會被歸類成 failed，
 * 然後自動重試 —— 而那個工作可能已經把信寄出去了。
 *
 * > **「失敗」跟「不知道」是兩件事，把後者記成前者就是在說謊。**
 *
 * ── 2. 「死掉」要證明，不能假設 ───────────────────────────
 *
 * 重開之後看到一筆 `running`，不代表它的主人死了 —— 也可能是另一個
 * 還活著的 scheduler 正在跑。`_owner_is_live()` 的做法是比對
 * **pid + 進程啟動時間**，因為 pid 會被回收：新進程剛好拿到同一個 pid，
 * 你就會把一個活著的執行判定成死的。
 *
 * 而且 Hermes 在拿不到資訊時是這樣寫的：
 *
 *   > fail safe: inability to prove death must not rewrite state
 *
 * **不能證明它死了，就當它還活著。** 反過來設計會產生重複執行。
 *
 * ── 3. 終局狀態不可改寫 ───────────────────────────────────
 *
 * 所有轉移都是條件式更新（`WHERE status IN ('claimed','running')`），
 * 改不到就回傳 null。這樣「兩個地方同時回報結果」不會互相蓋掉。
 *
 * 我們用 JSON 檔而不是 SQLite，因為這一課的主題是狀態機不是儲存引擎；
 * 條件式更新的語意用一個 Map 也表達得出來。
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export type ExecutionStatus = "claimed" | "running" | "completed" | "failed" | "unknown";

const TERMINAL: ReadonlySet<ExecutionStatus> = new Set(["completed", "failed", "unknown"]);

export interface Execution {
	id: string;
	jobId: string;
	/** 誰啟動的：排程、手動、補跑。 */
	source: "cron" | "manual" | "catchup";
	/** 哪一個 scheduler 進程claim 的。 */
	ownerId: string;
	pid: number;
	/** ⚠️ pid 會被回收，所以要連啟動時間一起記。 */
	pidStartedAt: number;
	status: ExecutionStatus;
	/** 這一次對應的**排定**時間。 */
	scheduledFor: number;
	claimedAt: number;
	startedAt?: number;
	finishedAt?: number;
	error?: string;
}

/**
 * 判斷某個 owner 進程是否還活著。
 *
 * 抽成介面是因為這一課要**把它關掉**：`prove=false` 的版本只看
 * 「這不是我」就當成死掉，那正是會產生重複執行的那個假設。
 */
export interface OwnerProbe {
	/** 這個 pid 現在存在嗎。 */
	exists(pid: number): boolean;
	/** 這個 pid 的啟動時間。拿不到回 undefined。 */
	startedAt(pid: number): number | undefined;
}

export interface LedgerOptions {
	path?: string;
	/** 這個 scheduler 進程的 id。重開之後要換一個新的。 */
	ownerId: string;
	pid: number;
	pidStartedAt: number;
	probe: OwnerProbe;
	/**
	 * 要不要真的證明 owner 死了才改寫狀態。
	 * **false 是這一課要示範的錯誤版本。**
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
			// 沒有檔案就是第一次跑
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

	/** 這個工作現在有沒有正在跑的執行（claimed 或 running）。 */
	activeFor(jobId: string): Execution | undefined {
		return this.list(jobId).find((e) => !TERMINAL.has(e.status));
	}

	/**
	 * 佔下一次執行。**在做任何事之前寫，不是做完之後才記。**
	 *
	 * 順序很重要：先寫紀錄再執行，崩潰時才會留下「有人試過」的痕跡。
	 * 反過來（跑完才記）的話，跑到一半死掉會完全沒有紀錄，
	 * 下一次重開會以為從來沒跑過 —— 那就是 Lesson 29 那個
	 * 「沒有訊號的失敗」在排程層的版本。
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

	/** claimed → running。只會成功一次。 */
	async markRunning(id: string): Promise<Execution | undefined> {
		const execution = this.executions.get(id);
		if (!execution || execution.status !== "claimed") return undefined;
		execution.status = "running";
		execution.startedAt = this.now;
		await this.save();
		return execution;
	}

	/** → completed / failed。終局狀態不能再被改寫。 */
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
	 * 重開之後：把**證明得了主人已經不在**的執行標成 unknown。
	 *
	 * 注意它做了什麼、更注意它**沒做**什麼：
	 *   做了　　把狀態從「懸而未決」變成一個終局的、誠實的答案
	 *   沒做　　沒有排任何重試
	 *
	 * 要不要重跑是**工作的性質**決定的（那一步冪等嗎？），
	 * 不是排程器能替你決定的。Lesson 34 專門講這件事。
	 */
	async recoverInterrupted(): Promise<{ recovered: Execution[]; leftAlone: Execution[] }> {
		const recovered: Execution[] = [];
		const leftAlone: Execution[] = [];

		for (const execution of this.executions.values()) {
			if (TERMINAL.has(execution.status)) continue;
			// 自己這個進程 claim 的，當然還活著。
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
		// ⚠️ 拿不到啟動時間的時候要當成「活著」。
		// 證明不了它死了，就不能改寫它的狀態。
		if (startedAt === undefined) return true;

		// pid 一樣但啟動時間不同 = pid 被回收了，原本那個進程確實死了。
		return startedAt === execution.pidStartedAt;
	}
}

/** 真的去問作業系統的版本。 */
export function realProbe(startTimes: Map<number, number>): OwnerProbe {
	return {
		exists(pid) {
			try {
				// signal 0 = 只檢查存在與權限，不真的送訊號。
				process.kill(pid, 0);
				return true;
			} catch {
				return false;
			}
		},
		startedAt(pid) {
			// Node 沒有可攜的「取得任意 pid 啟動時間」API。
			// 自己的進程知道，別人的不知道 —— 而**不知道就要當成活著**。
			return startTimes.get(pid);
		},
	};
}
