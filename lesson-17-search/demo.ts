/**
 * Lesson 17's demonstration: cross-session search, and two real ranking bugs.
 *
 * No API key needed.
 *
 * Run: bun run lesson-17-search/demo.ts
 */

import type { Message } from "../shared/providers/types.ts";
import { SessionSearchIndex, type SessionSource } from "../shared/search/index.ts";

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;

const user = (text: string): Message => ({ role: "user", text });
const assistant = (text: string): Message => ({
	role: "assistant",
	blocks: [{ type: "text", text }],
	raw: null,
});

function build(): SessionSearchIndex {
	const index = new SessionSearchIndex();

		// The user's real conversation: one of them, and exactly what they are looking for
	index.addSession(
		{
			sessionId: "sess_real",
			title: "修 telemetry 取樣率的 bug",
			source: "interactive",
			startedAt: "2026-07-20T10:00:00Z",
			messageCount: 6,
		},
		[
			user("我們的 telemetry 取樣率設定好像有問題"),
			assistant("我看一下 config。目前 sample_rate_hz 寫死 50Hz。"),
			user("對，但 go2-c 那台實際是 100Hz"),
			assistant(
				"找到了。config.ts 把取樣率寫死了，應該從 session metadata 讀。" +
					"我改成 meta.sample_rate_hz，並在缺值時 fallback 到 50。",
			),
			user("測試過了嗎"),
			assistant("跑了 bun test，5 pass 0 fail。"),
		],
	);

		// Scheduled jobs: run daily, saying the same words, in volume
	for (let day = 1; day <= 12; day++) {
		index.addSession(
			{
				sessionId: `sess_cron_${day}`,
				title: `每日 telemetry 摘要 ${day}`,
				source: "cron",
				startedAt: `2026-07-${String(day).padStart(2, "0")}T03:00:00Z`,
				messageCount: 2,
			},
			[
				user("產生每日 telemetry 摘要"),
				assistant(
					"今日 telemetry 摘要：取樣率正常，session 數量 14，" +
						"telemetry 取樣率 50Hz，無異常。telemetry 資料完整。",
				),
			],
		);
	}

		// A subagent's work: it must not appear in the user's history
	index.addSession(
		{
			sessionId: "sess_sub",
			title: "subagent: 檢查 telemetry",
			source: "subagent",
			startedAt: "2026-07-21T10:00:00Z",
			messageCount: 2,
		},
		[user("檢查 telemetry 取樣率"), assistant("取樣率 50Hz。")],
	);

		// A compacted session: the summary lives as an ordinary message
	index.addSession(
		{
			sessionId: "sess_compacted",
			title: "很長的除錯對話",
			source: "interactive",
			startedAt: "2026-07-19T14:00:00Z",
			messageCount: 3,
		},
		[
			user(
				"[以下是這次對話較早部分的摘要。原始訊息已從 context 中移除以節省空間。]\n\n" +
					"- 使用者回報 telemetry 取樣率問題\n- 檢查了 config.ts、store.ts、server.ts\n" +
					"- 發現取樣率寫死\n- 嘗試了三種修法\n- " +
					"（這裡原本還有 2000 字的摘要內容…）",
			),
			user("所以結論是什麼"),
			assistant("結論是取樣率應該從 metadata 讀。"),
		],
	);

	return index;
}

// ─────────────────────────────────────────────────────────────

function scenario1(): void {
	console.log(bold("\n情境 1：三種模式，同一個工具"));
	console.log(dim("Hermes 的 session_search 沒有 mode 參數，從引數推斷。\n"));

	const index = build();
	const s = index.stats();
	console.log(dim(`  索引：${s.sessions} 個 session、${s.messages} 則訊息、${s.terms} 個詞\n`));

	console.log(dim("  ① DISCOVERY  給 query"));
	console.log(dim("  ② SCROLL     給 session_id + around_message_id"));
	console.log(dim("  ③ BROWSE     什麼都不給\n"));

	console.log(dim("  BROWSE 的結果（最近的 session）："));
	for (const meta of index.browse(4)) {
		console.log(`    ${cyan(meta.sessionId.padEnd(16))} ${dim(meta.source.padEnd(12))} ${meta.title}`);
	}
	console.log(dim("\n  注意 sess_sub（subagent）沒有出現，它不屬於使用者的歷史。"));
}

function scenario2(): void {
	console.log(bold("\n\n情境 2：recall blindness（真實 bug）"));
	console.log(dim("排程任務每天講一樣的話，會把使用者的真實對話壓掉。\n"));

	const index = build();

	console.log(dim("  搜尋「telemetry 取樣率」"));
	console.log(dim("  資料裡有 1 個使用者對話 + 12 個內容雷同的排程 session\n"));

	const show = (label: string, list: ReturnType<typeof index.discover>) => {
		console.log(dim(`  ${label}`));
		for (const [i, r] of list.entries()) {
			const tag = r.hit.source === "interactive" ? green("interactive") : yellow("cron       ");
			console.log(
				`    ${i + 1}. ${tag}  ${r.hit.sessionTitle.padEnd(24)} ${dim(`score=${r.hit.score.toFixed(1)}`)}`,
			);
		}
		const top = list[0];
		const ok = top?.hit.source === "interactive";
		console.log(`    → 第一名是 ${ok ? green("interactive ✓") : red("cron（recall blindness）✗")}\n`);
	};

		// First the version without demotion, which is the bug itself
	show("❌ 所有來源同權（Hermes issue #19434 的狀況）：",
		index.discover("telemetry 取樣率", 3, 2, { disableSourceWeighting: true }));

	show("✅ cron 降權到 0.25：", index.discover("telemetry 取樣率", 3));

	console.log(dim("\n  Hermes 的修法是**降權而不是排除**："));
	console.log(dim("    排除 → cron 內容永遠找不到"));
	console.log(dim("    降權 → cron 是唯一結果時還找得到，但兩者都命中時 interactive 一定贏"));
}

function scenario3(): void {
	console.log(bold("\n\n情境 3：壓縮摘要的迴圈（另一個真實 bug）"));
	console.log(dim("壓縮摘要是以普通訊息存的，所以搜尋會搜到它。\n"));

	console.log(dim("  想一下這個迴圈："));
	console.log(dim("    1. 舊 session 被壓縮，產生一大段摘要"));
	console.log(dim("    2. 新 session 搜尋歷史，搜到那段摘要"));
	console.log(dim("    3. 摘要被塞進新 session 的 context"));
	console.log(dim("    4. 新 session 變大，又被壓縮…"));
	console.log(red("\n  搜尋把 Lesson 5 好不容易壓縮掉的東西又搬回來了。\n"));

	const index = build();
	const results = index.discover("取樣率 結論", 5);

	console.log(dim("  搜尋結果裡有沒有壓縮摘要？"));
	const hasCompaction = results.some(
		(r) =>
			r.hit.snippet.includes("以下是這次對話較早部分的摘要") ||
			r.bookendStart.some((m) => m.text.includes("以下是這次對話較早部分的摘要")),
	);
	console.log(`    ${hasCompaction ? red("有（防禦失敗）") : green("沒有 ✓")}`);

	const compacted = results.find((r) => r.hit.sessionId === "sess_compacted");
	if (compacted) {
		console.log(dim("\n  sess_compacted 有被找到，但 bookend 跳過了摘要那則："));
		for (const m of compacted.bookendStart) {
			console.log(`    ${dim(`[${m.role}] ${m.text.slice(0, 50)}`)}`);
		}
	}
}

function scenario4(): void {
	console.log(bold("\n\n情境 4：bookend 提供定位感"));
	console.log(dim("只給你命中的那一句，你不知道那個 session 本來在幹嘛。\n"));

	const index = build();
	const [result] = index.discover("sample_rate_hz 寫死", 1);
	if (!result) return;

	console.log(`  ${bold(result.hit.sessionTitle)}  ${dim(result.hit.sessionId)}`);

	console.log(dim("\n  session 開頭（這個對話本來在幹嘛）："));
	for (const m of result.bookendStart) console.log(`    ${dim(`[${m.role}] ${m.text.slice(0, 60)}`)}`);

	console.log(dim("\n  命中處前後（實際發生了什麼）："));
	for (const m of result.window) {
		const isHit = m.messageId === result.hit.messageId;
		const line = `    [${m.role}] ${m.text.slice(0, 60)}`;
		console.log(isHit ? green(line) : dim(line));
	}

	console.log(dim("\n  session 結尾（最後結論是什麼）："));
	for (const m of result.bookendEnd) console.log(`    ${dim(`[${m.role}] ${m.text.slice(0, 60)}`)}`);

	console.log(dim("\n  三段合起來，模型不用再翻就知道上次發生了什麼。"));
}

function scenario5(): void {
	console.log(bold("\n\n情境 5：為什麼這裡沒有 LLM"));
	console.log(dim("我原本以為要用「檢索 + LLM 判斷相關性」的兩段式。\n"));

	console.log(dim("  Hermes 的 docstring："));
	console.log(dim("    「No LLM calls anywhere - every shape returns actual messages from the DB.」"));
	console.log(dim("\n  而且 History 註記說那是**後來拿掉的**："));
	console.log(dim("    「PR #20238 seeded a fast/summary dual-mode split; ..."));
	console.log(dim("     this module merges all of that into a single calling shape"));
	console.log(dim("     with no mode parameter, **no summary LLM path**...」"));

	console.log(dim("\n  為什麼？因為**呼叫這個工具的本來就是模型**。"));
	console.log(dim("  你不需要另一個 LLM 幫它判斷相關性，把原始訊息給它就好。"));
	console.log(dim("  中間那層摘要只是多花一次錢、多一次延遲、多一個會錯的地方。"));

	console.log(yellow("\n  跟 Lesson 6 的差別值得想清楚："));
	console.log(dim("    Lesson 6  find_anomalies：規則負責 recall，模型負責 precision"));
	console.log(dim("              → 因為那裡的「模型」是要下判斷的那個 agent"));
	console.log(dim("    Lesson 17 session_search：規則負責全部，不加模型"));
	console.log(dim("              → 因為結果本來就是要給 agent 看的，它自己會判斷"));
	console.log(dim("\n  判準：**你是在幫模型縮小範圍，還是在替模型做決定？**"));
	console.log(dim("  前者值得加一層，後者不值得。"));
}

// ─────────────────────────────────────────────────────────────

console.log(bold("Lesson 17：跨 session 搜尋"));

scenario1();
scenario2();
scenario3();
scenario4();
scenario5();

console.log(bold("\n\n一句話總結"));
console.log(dim("搜尋品質大部分不是靠加模型，是靠排序衛生：\n"));
console.log(dim("  哪些來源不該出現、哪些該降權、哪些是自己產生的雜訊。\n"));
