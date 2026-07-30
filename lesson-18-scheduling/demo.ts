/**
 * Lesson 18 - 排程與無人值守
 *
 * 五個情境，每一個都對應一個「關掉就看得到失敗」的機制：
 *
 *   catchup   筆電闔了三小時，錯過 36 次。要跑幾次？
 *   overlap   上一輪還沒跑完，下一輪到了
 *   crash     跑到一半進程被殺掉。那筆紀錄是 failed 嗎？
 *   respawn   工作重啟了跑排程的那個東西 ← 真實 issue，會無限迴圈
 *   approval  半夜三點需要批准，沒有人醒著
 *
 * 執行：
 *   bun run lesson-18                  # 全部（不用金鑰，時鐘是假的）
 *   bun run lesson-18 crash            # 只跑一個
 *   RETRY=1 bun run lesson-18 crash    # 把 unknown 當成「重試就好」
 *   PROVE=off bun run lesson-18 crash  # 不證明 owner 死了就改寫狀態
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

/** 假時鐘。排程課如果要真的等，就沒有人跑得完。 */
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
		prompt: "整理今天的收件匣",
		catchUp: "one",
		enabled: true,
		createdAt: 0,
		...overrides,
	};
}

/** 可以數的副作用。跟 Lesson 29 同一個立場：只有外面的世界說了算。 */
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

/** 假的作業系統探針，讓「pid 存不存在」變成可控的。 */
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
	console.log(`\n${bold("── catchup · 筆電闔了三小時")}`);

	const clock = fakeClock(0);
	const every5min = job({
		id: "sync",
		name: "同步收件匣",
		everySeconds: 300,
		lastScheduledAt: 0,
	});

	clock.advance(3 * HOUR);
	const missed = missedRuns(every5min, clock.now());
	console.log(dim(`  每 5 分鐘一次，停機 3 小時 → 錯過 ${missed.length} 次`));

	for (const policy of ["all", "one", "skip"] as const) {
		const { runs, dropped } = applyCatchUp(policy, missed);
		const tag = policy === "one" ? green("one ") : dim(`${policy.padEnd(4)}`);
		console.log(
			`    ${tag} 執行 ${String(runs.length).padStart(2)} 次　丟掉 ${String(dropped).padStart(2)} 次　${dim(describe(policy))}`,
		);
	}

	console.log(dim("\n  三個都對，但對不同的工作。沒有安全的預設值，只有安全的預設方向。"));
}

function describe(policy: string): string {
	switch (policy) {
		case "all":
			return "每一次都要做（逐筆處理佇列）";
		case "one":
			return "只要最新狀態（同步、健康檢查）";
		default:
			return "過期就沒意義（早上七點的提醒）";
	}
}

// ─────────────────────────────────────────────────────────────
// 2. overlap
// ─────────────────────────────────────────────────────────────

async function scenarioOverlap(): Promise<void> {
	console.log(`\n${bold("── overlap · 上一輪還沒跑完，下一輪到了")}`);
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

	// 這個工作每 60 秒排一次，但每次要跑 150 秒（假時鐘裡）。
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
			// 故意不 await 真的時間，用「還沒 finish 就回到 tick」來模擬長工作：
			// 見下面 pending 的處理。
			running--;
			return "ok";
		},
	});

	scheduler.add(job({ id: "slow", name: "慢工作", everySeconds: 60, lastScheduledAt: 0 }));

	// 手動製造一筆「還在跑」的執行，模擬上一輪卡住。
	const stuck = await ledger.claim("slow", 0);
	await ledger.markRunning(stuck.id);
	console.log(dim(`  ${stuck.id} 仍然是 running（模擬上一輪卡住）`));

	clock.advance(3 * MINUTE);
	const report = await scheduler.tick();

	console.log(
		`  本輪執行 ${report.ran.length} 次　跳過 ${report.skipped.length} 次　副作用 ${countRuns()} 筆`,
	);
	for (const skip of report.skipped) console.log(dim(`    ⏭ ${skip.reason}`));

	if (OVERLAP === "allow") {
		console.log(
			red("  ⚠ 同一個工作同時有多個執行在跑。如果它會寄信、扣款、寫檔，那就是重複的副作用。"),
		);
	} else {
		console.log(green("  ✓ 卡住的那一輪還在，新的一輪不會疊上去"));
	}
}

// ─────────────────────────────────────────────────────────────
// 3. crash
// ─────────────────────────────────────────────────────────────

async function scenarioCrash(): Promise<void> {
	console.log(`\n${bold("── crash · 跑到一半進程被殺掉")}`);
	console.log(dim(`  PROVE=${PROVE_DEATH ? "on" : "off"}　RETRY=${RETRY_UNKNOWN ? "1" : "0"}`));
	await resetState();

	const clock = fakeClock(0);
	// live: pid → 啟動時間。這是那個「假的作業系統」。
	const live = new Map<number, number>([[4242, 1000]]);

	// ── A. 真的死了 ─────────────────────────────────────────
	console.log(`\n  ${bold("A. owner 真的死了")}`);

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
	await sideEffect("digest@0 (信寄出去了)");
	console.log(dim(`    ${exec.id} running → 副作用已經發生（${countRuns()} 筆）`));
	console.log(red("    💀 進程在寫終局狀態之前被 kill"));

	// ⚠️ pid 被回收給別人了：4242 還在，但啟動時間不一樣。
	// 只比對「pid 存不存在」的話，這裡會判成「還活著」，那筆紀錄
	// 就永遠停在 running。比對啟動時間才問得出真正的問題：
	// **是不是同一個進程。**
	live.set(4242, 2000);
	console.log(dim("    （pid 4242 被回收給另一個進程了：存在，但啟動時間不同）"));

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
		console.log(`    ${item.id} → ${yellow(item.status)}　${dim(item.error?.slice(0, 52) ?? "")}…`);
	}

	if (RETRY_UNKNOWN) {
		for (const item of recovered) {
			await sideEffect(`${item.jobId}@${item.scheduledFor} (重試)`);
		}
		console.log(red(`    ⚠ 自動重試 unknown → 副作用 ${countRuns()} 筆。那封信寄了兩次。`));
	} else {
		console.log(
			green(`    ✓ 不自動重試 → 副作用維持 ${countRuns()} 筆`) +
				dim("（要不要重跑是工作的性質決定的）"),
		);
	}

	// ── B. 還沒死，只是你不知道 ──────────────────────────────
	//
	// 這一段才是 PROVE 這個開關真正要示範的東西。
	console.log(`\n  ${bold("B. owner 其實還活著（另一台 scheduler 正在跑同一個工作）")}`);
	await resetState();

	live.set(7777, 5000); // sched-3 活得好好的
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
	await sideEffect("digest@0 (sched-3 正在寄)");
	console.log(dim(`    ${inflight.id} running，pid 7777 仍然活著（${countRuns()} 筆副作用）`));

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
		`    sched-4 啟動：標成 unknown ${outcome.recovered.length} 筆，維持原狀 ${outcome.leftAlone.length} 筆`,
	);

	// 接著它 tick 一次。重疊檢查看的就是「有沒有非終局的執行」。
	const scheduler = new Scheduler({
		ledger: newcomer,
		clock: clock.now,
		runner: async ({ job: j, scheduledFor }) => {
			await sideEffect(`${j.id}@${scheduledFor} (sched-4 也寄了)`);
			return "sent";
		},
	});
	scheduler.add(job({ id: "digest", name: "每日摘要", everySeconds: 60, lastScheduledAt: 0 }));
	clock.advance(2 * MINUTE);
	const report = await scheduler.tick();

	if (PROVE_DEATH) {
		console.log(
			green(`    ✓ sched-3 的執行沒被動 → sched-4 跳過（${report.skipped.length} 次），副作用維持 ${countRuns()} 筆`),
		);
	} else {
		console.log(
			red(
				`    ⚠ 活著的執行被標成 unknown → 重疊檢查看不到它 → sched-4 照跑（${report.ran.length} 次）\n` +
					`      副作用 ${countRuns()} 筆。同一封信，兩台 scheduler 各寄一次。`,
			),
		);
	}

	console.log(
		dim(
			"\n  unknown 不是 failed。failed 是「跑完了，沒成功」，\n" +
				"  unknown 是「不知道副作用有沒有發生」——把後者記成前者就是在說謊。\n" +
				"  而「不能證明它死了就當它活著」是另一半：猜錯的代價是重複的副作用。",
		),
	);
}

// ─────────────────────────────────────────────────────────────
// 4. respawn
// ─────────────────────────────────────────────────────────────

async function scenarioRespawn(): Promise<void> {
	console.log(`\n${bold("── respawn · 工作重啟了跑排程的那個東西")}`);
	console.log(dim(`  GUARD=${GUARD_ON ? "on" : "off"}`));

	const spec = {
		name: "每天清理暫存檔",
		prompt: "清掉 /tmp/agentd-cache 底下的舊檔案，然後 agentd restart 讓設定生效",
	};

	if (GUARD_ON) {
		try {
			checkLifecycle(spec.prompt);
			console.log(red("  守衛沒擋住（不該發生）"));
		} catch (error) {
			if (!(error instanceof LifecycleBlocked)) throw error;
			console.log(green("  ✓ 建立時就被擋下來"));
			console.log(dim(`    ${error.message.split(". ").slice(0, 2).join("。\n    ")}`));
			console.log(
				dim("\n  注意它是在**建立**時擋，不是在**執行**時擋。\n" +
					"  執行時擋的話，那個工作會每天安靜地失敗一次。"),
			);
		}
		return;
	}

	// 守衛關掉：把那條因果鏈跑出來。
	console.log(dim("  排程建立成功。以下是那條因果鏈：\n"));

	let daemonAlive = true;
	let restarts = 0;
	let resumedTurns = 0;
	const LIMIT = 8;

	for (let i = 0; i < LIMIT; i++) {
		console.log(
			`    ${dim(`[${String(i + 1).padStart(2)}]`)} 工作觸發 → agentd 被 restart` +
				dim("　→ 監管者救活 → auto-resume 撿回同一個 session → 那一輪重跑"),
		);
		daemonAlive = false;
		restarts++;
		// 監管者（launchd KeepAlive / systemd Restart=）
		daemonAlive = true;
		// auto-resume 撿回被中斷的那一輪 → 重跑同樣的邏輯
		resumedTurns++;
	}

	console.log(
		red(`\n  ${LIMIT} 輪之後：重啟 ${restarts} 次、重跑 ${resumedTurns} 輪，daemon ${daemonAlive ? "活著" : "死著"}`),
	);
	console.log(
		dim("  這裡設了 8 次上限，真實情況是每 ~10 秒一輪直到有人手動介入（Hermes #30719）。"),
	);
	console.log(
		yellow(
			"\n  ⚠ 每一個環節單獨看都是對的設計：排程、監管者自動重啟、中斷後自動恢復。\n" +
				"    迴圈是它們相乘出來的。",
		),
	);
}

// ─────────────────────────────────────────────────────────────
// 5. approval
// ─────────────────────────────────────────────────────────────

async function scenarioApproval(): Promise<void> {
	console.log(`\n${bold("── approval · 半夜三點需要批准")}`);
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
			// 這個工作要寄信 —— Lesson 8 的 EXTERNAL 風險，一定要批准。
			const item = await inbox.add({
				sessionId: `cron:${j.id}`,
				kind: "approval",
				visibility: "inbox",
				title: "執行 send_email？",
				body: "收件人 team@example.com，主旨「每日摘要」",
			});
			parkedItemId = item.id;
			console.log(dim(`    ${j.name} → inbox ${item.id}（pending），執行停在這裡`));

			const resolution = await inbox.wait(item.id);
			if (resolution !== "allow") return "使用者拒絕，沒有寄出";
			await sideEffect("email@3am");
			return "已寄出";
		},
	});

	scheduler.add(
		job({ id: "digest", name: "每日摘要", everySeconds: 3600, lastScheduledAt: 2 * HOUR }),
	);

	// tick 不會回來，因為那個工作停在 inbox.wait()。
	const ticking = scheduler.tick();
	await new Promise((r) => setTimeout(r, 20));

	const pending = inbox.pending();
	console.log(`  inbox 待辦 ${pending.length} 筆　副作用 ${countRuns()} 筆　${dim("（你還在睡）")}`);
	const active = ledger.activeFor("digest");
	console.log(dim(`    ledger：${active?.id} 仍然是 ${active?.status} —— 這不是失敗，是還沒結束`));

	console.log(dim("\n  ☀️  早上起來，按下允許："));
	await inbox.resolve(parkedItemId as string, "allow");
	const report = await ticking;

	console.log(
		green(`  ✓ 執行繼續並完成`) +
			dim(`　ledger：${ledger.list("digest")[0]?.status}　副作用 ${countRuns()} 筆`),
	);
	console.log(dim(`    輸出：${report.ran[0]?.output}`));

	console.log(
		dim(
			"\n  排程 + 無人值守是同一個問題的兩半：**排程跑起來一定是無人值守。**\n" +
				"  Lesson 9 已經把 inbox 做好了，這裡一行都不用改，只是換一個 approver。",
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
			console.error(`不認得的情境：${name}。可用：${Object.keys(SCENARIOS).join(", ")}`);
			process.exitCode = 1;
			return;
		}
		await scenario();
	}

	await resetState();
	console.log(dim("\n（.state 已清掉）"));
}

await main();
