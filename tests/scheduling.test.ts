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

describe("到期與補跑（Lesson 18）", () => {
	test("沒跑過的工作只跑一次，不會把建立之前的時間補回來", () => {
		assert.deepEqual(missedRuns(job({ createdAt: 5 * MINUTE }), 9 * MINUTE), [5 * MINUTE]);
	});

	test("停機三小時、每五分鐘 → 36 次", () => {
		const missed = missedRuns(job({ everySeconds: 300, lastScheduledAt: 0 }), 3 * 60 * MINUTE);
		assert.equal(missed.length, 36);
	});

	test("停用的工作不會有到期時間", () => {
		assert.deepEqual(missedRuns(job({ enabled: false, lastScheduledAt: 0 }), 10 * MINUTE), []);
	});

	test("時間以「排定時間」推進，不受執行耗時影響", () => {
			// This guards the slow-drift bug: advancing only on completion,
			// a job every 60 seconds that takes 5 seconds per run drifts an hour in a day.
		const missed = missedRuns(job({ lastScheduledAt: 0 }), 3 * MINUTE + 37_000);
		assert.deepEqual(missed, [MINUTE, 2 * MINUTE, 3 * MINUTE]);
	});

	test("catchUp=one 補的是最後一個，不是第一個", () => {
		const { runs, dropped } = applyCatchUp("one", [1, 2, 3, 4]);
		assert.deepEqual(runs, [4], "要的是現在的狀態，不是三小時前的");
		assert.equal(dropped, 3);
	});

	test("catchUp=all / skip", () => {
		assert.equal(applyCatchUp("all", [1, 2, 3]).runs.length, 3);
		assert.equal(applyCatchUp("skip", [1, 2, 3]).runs.length, 0);
		assert.equal(applyCatchUp("skip", [1, 2, 3]).dropped, 3);
	});

	test("nextDue 一定在未來", () => {
		assert.ok(nextDue(job({ lastScheduledAt: 0 }), 5 * MINUTE) > 5 * MINUTE);
	});

	test("⚠ skip 之後時間仍然要推進，否則每次 tick 都重看同一批", async () => {
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
		assert.deepEqual(second.dropped, [], "同一批錯過的排程不該被重看一次");
	});
});

const TMP = mkdtempSync(join(tmpdir(), "lesson-18-"));
after(() => rmSync(TMP, { recursive: true, force: true }));

describe("執行紀錄（Lesson 18）", () => {
	test("claimed → running → completed", async () => {
		const l = ledger();
		const exec = await l.claim("j1", 0);
		assert.equal(exec.status, "claimed");
		assert.equal((await l.markRunning(exec.id))?.status, "running");
		assert.equal((await l.finish(exec.id, true))?.status, "completed");
	});

	test("終局狀態不可改寫", async () => {
		const l = ledger();
		const exec = await l.claim("j1", 0);
		await l.finish(exec.id, true);
		assert.equal(await l.finish(exec.id, false, "其實失敗了"), undefined);
		assert.equal(l.list("j1")[0]?.status, "completed");
	});

	test("markRunning 只會成功一次", async () => {
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

	test("owner 還活著 → 不碰它", async () => {
		const live = new Map([[7, 500]]);
		const { second } = await handover(live);
		const result = await second.recoverInterrupted();
		assert.equal(result.recovered.length, 0);
		assert.equal(result.leftAlone.length, 1);
	});

	test("pid 被回收（存在但啟動時間不同）→ 判定為死", async () => {
		const live = new Map([[7, 500]]);
		const { second } = await handover(live);
		live.set(7, 999); // 同一個 pid，換了一個進程

		const result = await second.recoverInterrupted();
		assert.equal(result.recovered.length, 1);
		assert.equal(result.recovered[0]?.status, "unknown");
	});

	test("⚠ 拿不到啟動時間 → 當成活著（fail safe）", async () => {
			// "If death cannot be proved, state must not be rewritten." The reverse design produces duplicate execution.
		const live = new Map([[7, 500]]);
		const blind: OwnerProbe = { exists: () => true, startedAt: () => undefined };
		const { second } = await handover(live, { probeOverride: blind });
		assert.equal((await second.recoverInterrupted()).recovered.length, 0);
	});

	test("recover 不會排任何重試", async () => {
		const { second } = await handover(new Map<number, number>());
		const result = await second.recoverInterrupted();

		assert.equal(result.recovered[0]?.status, "unknown");
			// unknown is a terminal state, not "awaiting retry". Whether to re-run is decided by the nature of the job.
		assert.equal(second.activeFor("j1"), undefined);
	});
});

describe("生命週期守衛（Lesson 18）", () => {
	test("四種指令形狀都擋得住", () => {
		assert.ok(containsLifecycleCommand("agentd restart"));
		assert.ok(containsLifecycleCommand("agentd stop"));
		assert.ok(containsLifecycleCommand("launchctl kickstart -k gui/501/ai.agentd"));
		assert.ok(containsLifecycleCommand("systemctl --user restart agentd.service"));
		assert.ok(containsLifecycleCommand("pkill -f agentd"));
	});

	test("start 刻意不擋", () => {
			// Starting a daemon inside the daemon is harmless, and a legitimate job may need to
			// start a different profile. Blocking it produces inexplicable failures.
		assert.equal(containsLifecycleCommand("agentd start"), false);
	});

	test("不相干的散文不會誤擋", () => {
		assert.equal(
			containsLifecycleCommand("幫我研究 Kong API gateway 的 autoscaling 和 restart 行為"),
			false,
		);
		assert.equal(containsLifecycleCommand("每天重啟一次資料庫連線池"), false);
	});

	test("prompt 和 script 合起來看，拆成兩半也擋得住", () => {
		assert.throws(
			() => checkLifecycle("先清快取，然後執行 cleanup.sh", "#!/bin/sh\nagentd restart\n"),
			LifecycleBlocked,
		);
	});

	test("錯誤訊息要講替代做法，不能只說不行", () => {
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
