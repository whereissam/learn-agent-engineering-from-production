/**
 * 跨 session 搜尋：「上次我是怎麼做的？」
 *
 * ## 一個我原本想錯的地方
 *
 * 我本來以為這課會是「全文檢索先縮小範圍，再用 LLM 判斷相關性」，
 * 也就是 Lesson 6 `find_anomalies` 的那個模式。
 *
 * 讀了 Hermes 的 `tools/session_search_tool.py` 才發現**它刻意不這樣做**：
 *
 *   > All three modes operate on the SQLite session DB via the FTS5 index...
 *   > **No LLM calls anywhere** - every shape returns actual messages from the DB.
 *
 * 而且它的 History 註記寫得很清楚，那是「後來拿掉的」：
 *
 *   > PR #20238 seeded a fast/summary dual-mode split; ... This module merges
 *   > all of that into a single calling shape with no mode parameter,
 *   > **no summary LLM path**, and explicit scroll support.
 *
 * 他們試過摘要路線，然後移除了。
 *
 * 為什麼？因為呼叫這個工具的**本來就是模型**。你不需要另一個 LLM
 * 幫它判斷相關性 - 把原始訊息給它，它自己會判斷。中間那層摘要
 * 只是多花一次錢、多一次延遲、多一個會出錯的地方。
 *
 * 所以這一課的重點不是「加 LLM」，而是**排序衛生**：
 * 怎麼讓真正相關的東西浮上來。
 *
 * 對照：hermes-agent/tools/session_search_tool.py（1120 行）
 */

import type { Message } from "../providers/types.ts";

export interface SearchableMessage {
	sessionId: string;
	messageId: string;
	role: string;
	text: string;
	timestamp: string;
}

/**
 * session 的來源。**這個欄位是排序品質的關鍵。**
 *
 * Hermes 把來源分成三類處理，見下面 SOURCE_WEIGHT。
 */
export type SessionSource =
	/** 使用者實際對話。 */
	| "interactive"
	/** 排程自動跑的。 */
	| "cron"
	/** 子 agent 的委派工作。 */
	| "subagent"
	/** 第三方整合塞進來的。 */
	| "tool";

export interface SessionMeta {
	sessionId: string;
	title: string;
	source: SessionSource;
	startedAt: string;
	messageCount: number;
}

/**
 * 完全不出現在搜尋與瀏覽裡的來源。
 *
 * Hermes 的理由：subagent 跟 tool 的 session「不屬於使用者的對話歷史」。
 * 使用者要找的是「我上次怎麼做的」，不是「某個子 agent 內部做了什麼」。
 */
const HIDDEN_SOURCES = new Set<SessionSource>(["subagent", "tool"]);

/**
 * 保留可搜尋、但**降權**的來源。
 *
 * 這是 Hermes 踩過的一個真實 bug（他們的 issue #19434），註解寫得很好：
 *
 *   > Cron jobs run on a schedule and accumulate large volumes of repetitive
 *   > vocabulary (recurring project names, dates, "session", summaries);
 *   > under bare BM25 they dominate the top-N FTS rows and starve out the
 *   > user's own interactive sessions, producing **"recall blindness"**
 *   > where only cron sessions surface.
 *
 * 排程任務每天跑、每次講一樣的話，於是它的詞頻統計把使用者的真實對話
 * 完全壓過去。使用者搜尋自己講過的東西，結果全是機器人的日報。
 *
 * 修法是**降權而不是排除**：
 *
 *   > Demoting - not excluding - keeps cron content reachable when it's the
 *   > only match, while interactive sessions always win when both match.
 *
 * 這個取捨很值得記：排除會讓資訊消失，降權只是讓它排後面。
 */
const SOURCE_WEIGHT: Record<SessionSource, number> = {
	interactive: 1.0,
	cron: 0.25, // 降權，不排除
	subagent: 0,
	tool: 0,
};

/**
 * context 壓縮產生的交接摘要的前綴。
 *
 * 這是另一個真實 bug（Hermes issue #43175）。壓縮摘要是以普通訊息的形式
 * 存在 session 裡的，所以搜尋會搜到它們。後果：
 *
 *   > They must be excluded from discovery bookends to avoid **re-introducing
 *   > huge compaction payloads into fresh sessions** via session_search.
 *
 * 想一下那個迴圈：
 *   1. 舊 session 被壓縮，產生一大段摘要
 *   2. 新 session 搜尋歷史，搜到那段摘要
 *   3. 那段摘要被塞進新 session 的 context
 *   4. 新 session 因此變大，又被壓縮……
 *
 * **搜尋把壓縮掉的東西又搬回來了。** 這是 Lesson 5 跟這一課交界處的坑。
 */
const COMPACTION_PREFIXES = ["[CONTEXT COMPACTION", "[CONTEXT SUMMARY]:", "[以下是這次對話較早部分的摘要"];

function isCompactionArtifact(text: string): boolean {
	const head = text.trimStart();
	return COMPACTION_PREFIXES.some((p) => head.startsWith(p));
}

/**
 * 掃描多少筆 FTS 結果才做去重與排序。
 *
 * Hermes 設 300，理由是：
 *
 *   > The interactive vs automation split below only helps if enough rows are
 *   > in hand to find interactive matches buried under a wall of cron hits.
 *
 * 也就是說，如果你只取前 10 筆就排序，那 10 筆可能全是 cron，
 * 降權也救不了 - 因為使用者的對話根本沒進到候選集。
 *
 * **先撈寬，再排序。**
 */
const SCAN_LIMIT = 300;

/** 使用者輸入的查詢長度上限，防止病態輸入。 */
export const MAX_QUERY_CHARS = 2048;

// ─────────────────────────────────────────────────────────────
// 索引
// ─────────────────────────────────────────────────────────────

export interface SearchHit {
	sessionId: string;
	sessionTitle: string;
	source: SessionSource;
	messageId: string;
	/** 命中的那則訊息。 */
	snippet: string;
	score: number;
	timestamp: string;
}

export interface DiscoverResult {
	hit: SearchHit;
	/** 命中前後各 N 則，提供上下文。 */
	window: SearchableMessage[];
	/** session 開頭的幾則，讓你知道這個 session 本來在幹嘛。 */
	bookendStart: SearchableMessage[];
	/** session 結尾的幾則，讓你知道最後結論是什麼。 */
	bookendEnd: SearchableMessage[];
}

export interface SearchOptions {
	/**
	 * 關掉來源降權，讓所有來源同權。
	 *
	 * **這個選項的存在只有一個目的：讓你親眼看到 recall blindness。**
	 * 真實系統不該有這個開關。
	 */
	disableSourceWeighting?: boolean;
}

export class SessionSearchIndex {
	private readonly messages: SearchableMessage[] = [];
	private readonly sessions = new Map<string, SessionMeta>();
	/** term -> 出現在哪些訊息（index 位置）。 */
	private readonly postings = new Map<string, Set<number>>();
	/** term -> 有幾則訊息含它，算 IDF 用。 */
	private readonly docFreq = new Map<string, number>();

	addSession(meta: SessionMeta, messages: Message[]): void {
		this.sessions.set(meta.sessionId, meta);

		for (const [i, message] of messages.entries()) {
			const text = messageText(message);
			if (!text.trim()) continue;

			const entry: SearchableMessage = {
				sessionId: meta.sessionId,
				messageId: `${meta.sessionId}:${i}`,
				role: message.role,
				text,
				timestamp: meta.startedAt,
			};

			const position = this.messages.length;
			this.messages.push(entry);

			const seen = new Set<string>();
			for (const term of tokenize(text)) {
				if (!this.postings.has(term)) this.postings.set(term, new Set());
				this.postings.get(term)?.add(position);
				if (!seen.has(term)) {
					seen.add(term);
					this.docFreq.set(term, (this.docFreq.get(term) ?? 0) + 1);
				}
			}
		}
	}

	/**
	 * 模式一：DISCOVERY。給關鍵字，找相關的 session。
	 */
	discover(query: string, limit = 3, windowSize = 2, options: SearchOptions = {}): DiscoverResult[] {
		if (query.length > MAX_QUERY_CHARS) {
			throw new Error(`查詢太長（${query.length} > ${MAX_QUERY_CHARS}）`);
		}

		const terms = tokenize(query);
		if (terms.length === 0) return [];

		// 1. 撈候選（撈寬）
		//
		// 計分是簡化版的 BM25：IDF（詞有多罕見）× TF（在這則訊息出現幾次）。
		//
		// **TF 那一項是 recall blindness 的成因。** 排程摘要會反覆講同樣的詞
		// （「telemetry」「取樣率」「session」），TF 因此很高，於是它們在
		// 純詞頻排序下把使用者的自然對話壓下去。真實的 BM25 也是這個行為。
		const candidates = new Map<number, number>();
		for (const term of terms) {
			const idf = Math.log(1 + this.messages.length / ((this.docFreq.get(term) ?? 0) + 1));
			for (const position of this.postings.get(term) ?? []) {
				const text = this.messages[position]?.text.toLowerCase() ?? "";
				const tf = countOccurrences(text, term);
				// 開根號做飽和，避免一個詞重複 50 次就無限拉高分數
				candidates.set(position, (candidates.get(position) ?? 0) + idf * Math.sqrt(tf));
			}
		}

		// 2. 過濾與加權
		const scored: SearchHit[] = [];
		for (const [position, rawScore] of candidates) {
			const message = this.messages[position];
			if (!message) continue;

			const meta = this.sessions.get(message.sessionId);
			if (!meta) continue;

			// 隱藏來源直接不出現
			if (HIDDEN_SOURCES.has(meta.source)) continue;

			// 壓縮摘要不出現（見上面的迴圈說明）
			if (isCompactionArtifact(message.text)) continue;

			// disableSourceWeighting 只是為了示範 bug，見 SearchOptions
			const weight = options.disableSourceWeighting ? 1 : SOURCE_WEIGHT[meta.source];
			if (weight === 0) continue;

			scored.push({
				sessionId: message.sessionId,
				sessionTitle: meta.title,
				source: meta.source,
				messageId: message.messageId,
				snippet: snippet(message.text, terms),
				score: rawScore * weight,
				timestamp: message.timestamp,
			});
		}

		scored.sort((a, b) => b.score - a.score);
		const scanned = scored.slice(0, SCAN_LIMIT);

		// 3. 同一個 session 只留最佳的一筆
		const bySession = new Map<string, SearchHit>();
		for (const hit of scanned) {
			const existing = bySession.get(hit.sessionId);
			if (!existing || hit.score > existing.score) bySession.set(hit.sessionId, hit);
		}

		return [...bySession.values()]
			.sort((a, b) => b.score - a.score)
			.slice(0, limit)
			.map((hit) => ({
				hit,
				window: this.windowAround(hit.messageId, windowSize),
				bookendStart: this.bookend(hit.sessionId, "start", 2),
				bookendEnd: this.bookend(hit.sessionId, "end", 2),
			}));
	}

	/**
	 * 模式二：SCROLL。已經知道位置，往前後翻。
	 *
	 * Hermes 的翻頁方式很值得學：**不用 offset，用「重新錨定」**。
	 * 要往後翻就用這次結果最後一則的 id 當新的 anchor。
	 *
	 * 好處是即使中間插入了新訊息，也不會跳過或重複。
	 */
	windowAround(messageId: string, size = 5): SearchableMessage[] {
		const index = this.messages.findIndex((m) => m.messageId === messageId);
		if (index === -1) return [];

		const sessionId = this.messages[index]?.sessionId;
		return this.messages
			.slice(Math.max(0, index - size), index + size + 1)
			.filter((m) => m.sessionId === sessionId);
	}

	/**
	 * 模式三：BROWSE。什麼都不給，就列最近的 session。
	 */
	browse(limit = 10): SessionMeta[] {
		return [...this.sessions.values()]
			.filter((s) => !HIDDEN_SOURCES.has(s.source))
			.sort((a, b) => b.startedAt.localeCompare(a.startedAt))
			.slice(0, limit);
	}

	/**
	 * session 的頭尾。
	 *
	 * 為什麼需要？因為只給你「命中的那一句」，你不知道那個 session
	 * 本來在幹嘛、最後結論是什麼。頭尾兩段提供**定位感**。
	 */
	bookend(sessionId: string, end: "start" | "end", count = 3): SearchableMessage[] {
		const inSession = this.messages.filter(
			(m) => m.sessionId === sessionId && !isCompactionArtifact(m.text),
		);
		return end === "start" ? inSession.slice(0, count) : inSession.slice(-count);
	}

	stats(): { sessions: number; messages: number; terms: number } {
		return {
			sessions: this.sessions.size,
			messages: this.messages.length,
			terms: this.postings.size,
		};
	}
}

// ─────────────────────────────────────────────────────────────

function messageText(message: Message): string {
	switch (message.role) {
		case "user":
			return message.text;
		case "assistant":
			return message.blocks
				.map((b) => (b.type === "text" ? b.text : `[${b.name}]`))
				.join(" ");
		case "toolResult":
			return message.results.map((r) => r.content).join(" ");
	}
}

/**
 * 斷詞。
 *
 * 中文沒有空格，所以逐字切。這很粗糙，但**對搜尋來說夠用**，
 * 而且不需要引入斷詞套件。
 *
 * （Hermes 為此載入了 FTS5 的 CJK extension，
 * 見 `hermes_state.py` 的 `load_fts5_cjk_extension`。）
 */
function tokenize(text: string): string[] {
	return text
		.toLowerCase()
		.split(/[^\p{L}\p{N}]+/u)
		.flatMap((token) => (/[一-鿿]/.test(token) ? [...token] : [token]))
		.filter(Boolean);
}

function countOccurrences(haystack: string, needle: string): number {
	if (!needle) return 0;
	let count = 0;
	let at = haystack.indexOf(needle);
	while (at !== -1) {
		count++;
		at = haystack.indexOf(needle, at + needle.length);
	}
	return count;
}

function snippet(text: string, terms: string[], radius = 60): string {
	const lower = text.toLowerCase();
	let best = -1;
	for (const term of terms) {
		const at = lower.indexOf(term);
		if (at !== -1 && (best === -1 || at < best)) best = at;
	}
	if (best === -1) return text.slice(0, radius * 2);

	const from = Math.max(0, best - radius);
	const to = Math.min(text.length, best + radius);
	return (from > 0 ? "…" : "") + text.slice(from, to).trim() + (to < text.length ? "…" : "");
}
