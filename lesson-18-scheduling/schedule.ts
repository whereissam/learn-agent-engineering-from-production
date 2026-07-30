/**
 * 什麼時候該跑：到期時間，以及**錯過的那些怎麼辦**。
 *
 * 「每 5 分鐘跑一次」聽起來只有一個參數，但筆電闔上三小時再打開的時候，
 * 你必須回答一個排程器一定會遇到的問題：
 *
 *     錯過了 36 次。現在要跑幾次？
 *
 * 三個答案都對，但**對不同的工作**：
 *
 *   all   36 次全部補跑    對「每次都要做」的工作（例如逐筆處理佇列）
 *   one   補跑一次          對「反正是取最新狀態」的工作（例如同步收件匣）
 *   skip  一次都不補        對「過期就沒意義」的工作（例如早上七點的提醒）
 *
 * ⚠️ **沒有安全的預設值，只有安全的預設方向。**
 * 我們預設 `one`，因為 `all` 會在你打開筆電的瞬間打出 36 次副作用，
 * 而 `skip` 會讓「每天備份」這種工作安靜地不發生 —— 兩種都糟，
 * 但前者是**吵的失敗**，後者是安靜的。所以真正的預設應該偏向吵的那邊，
 * 而 `one` 是兩者之間唯一一個「有動作、但不會爆量」的選項。
 *
 * 對照 Hermes：`cron/scheduler.py`（4298 行）。它的 tick() 由 gateway
 * 每 60 秒呼叫一次，這裡的形狀一樣，只是把時鐘抽出來，測試才跑得動。
 */

/** 注入時鐘，因為「等三小時再看結果」不是一個可以寫成測試的東西。 */
export type Clock = () => number;

export type CatchUpPolicy = "all" | "one" | "skip";

export interface Job {
	id: string;
	name: string;
	/** 間隔。真的 cron 語法解析不是這一課的重點，見 README「刻意不做」。 */
	everySeconds: number;
	/** 這個工作要做什麼（餵給模型的話）。 */
	prompt: string;
	catchUp: CatchUpPolicy;
	enabled: boolean;
	/** 上一次**排定**的時間（不是實際跑完的時間，見下面）。 */
	lastScheduledAt?: number;
	createdAt: number;
}

/**
 * 從 `lastScheduledAt` 到 `now` 之間，這個工作錯過了哪些排定時間。
 *
 * ⚠️ **要以「排定時間」推進，不是以「跑完時間」推進。**
 *
 * 用跑完時間推進的話，每次執行花的秒數都會累積成偏移：
 * 一個每 60 秒的工作，每次跑 5 秒，一天之後會漂掉一小時。
 * 這個 bug 不會報錯，只會讓「每天早上九點」慢慢變成早上十點。
 */
export function missedRuns(job: Job, now: number, limit = 10_000): number[] {
	if (!job.enabled) return [];

	const interval = job.everySeconds * 1000;
	if (interval <= 0) throw new Error(`job ${job.id}: everySeconds must be > 0`);

	// 沒跑過的工作：從現在起算，不要把「建立之前」的時間補回來。
	if (job.lastScheduledAt === undefined) {
		return now >= job.createdAt ? [job.createdAt] : [];
	}

	const out: number[] = [];
	for (let t = job.lastScheduledAt + interval; t <= now; t += interval) {
		out.push(t);
		// 上限是為了防止一個「每秒一次、停機三個月」的工作把記憶體吃光。
		// 到達上限本身要被看見，所以呼叫端會拿到 limit 筆並自己判斷。
		if (out.length >= limit) break;
	}
	return out;
}

/** 套用補跑政策，回傳「這一次 tick 真的要執行幾次、用哪些排定時間」。 */
export function applyCatchUp(
	policy: CatchUpPolicy,
	missed: number[],
): { runs: number[]; dropped: number } {
	if (missed.length === 0) return { runs: [], dropped: 0 };

	switch (policy) {
		case "all":
			return { runs: missed, dropped: 0 };
		case "one":
			// 補最後一個，不是第一個。要的是「現在的狀態」，不是三小時前的。
			return { runs: [missed[missed.length - 1] as number], dropped: missed.length - 1 };
		case "skip":
			return { runs: [], dropped: missed.length };
	}
}

/** 下一次會在什麼時候跑（給人看的）。 */
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
