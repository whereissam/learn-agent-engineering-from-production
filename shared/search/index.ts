/**
 * Cross-session search: "how did I do this last time?"
 *
 * ## Something that is easy to get wrong
 *
 * The assumption was that this lesson would be "full-text search narrows the field, then an LLM
 * judges relevance" — the pattern of Lesson 6's `find_anomalies`.
 *
 * Reading Hermes's `tools/session_search_tool.py` shows it **deliberately does not**:
 *
 *   > All three modes operate on the SQLite session DB via the FTS5 index...
 *   > **No LLM calls anywhere** - every shape returns actual messages from the DB.
 *
 * And its History note says plainly that the summary path was removed later:
 *
 *   > PR #20238 seeded a fast/summary dual-mode split; ... This module merges
 *   > all of that into a single calling shape with no mode parameter,
 *   > **no summary LLM path**, and explicit scroll support.
 *
 * They tried the summarisation route and took it out.
 *
 * Why? Because the thing calling this tool **is already a model**. You do not need another LLM
 * to judge relevance for it - hand it the raw messages and it judges for itself. The summary
 * layer in between only spends money, adds latency and adds a place to go wrong.
 *
 * So this lesson's point is not "add an LLM" but **ranking hygiene**:
 * how to make the genuinely relevant things surface.
 *
 * Source: hermes-agent/tools/session_search_tool.py (1120 lines)
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
 * A session's source. **This field is the key to ranking quality.**
 *
 * Hermes handles three classes of source; see SOURCE_WEIGHT below.
 */
export type SessionSource =
	/** The user's actual conversation. */
	| "interactive"
	/** Run automatically on a schedule. */
	| "cron"
	/** A subagent's delegated work. */
	| "subagent"
	/** Pushed in by a third-party integration. */
	| "tool";

export interface SessionMeta {
	sessionId: string;
	title: string;
	source: SessionSource;
	startedAt: string;
	messageCount: number;
}

/**
 * Sources that never appear in search or browsing.
 *
 * Hermes's reasoning: subagent and tool sessions "are not part of the user's conversation
 * history". What the user wants is "how did I do this last time", not "what some subagent did".
 */
const HIDDEN_SOURCES = new Set<SessionSource>(["subagent", "tool"]);

/**
 * Sources that stay searchable but are **demoted**.
 *
 * This is a real bug Hermes hit (their issue #19434), and the comment states it well:
 *
 *   > Cron jobs run on a schedule and accumulate large volumes of repetitive
 *   > vocabulary (recurring project names, dates, "session", summaries);
 *   > under bare BM25 they dominate the top-N FTS rows and starve out the
 *   > user's own interactive sessions, producing **"recall blindness"**
 *   > where only cron sessions surface.
 *
 * A scheduled job runs daily and says the same words every time, so its term frequencies bury
 * the user's real conversations. The user searches for something they said and gets the robot's
 * daily reports.
 *
 * The fix is **demoting rather than excluding**:
 *
 *   > Demoting - not excluding - keeps cron content reachable when it's the
 *   > only match, while interactive sessions always win when both match.
 *
 * The trade-off is worth remembering: excluding makes information disappear, demoting only ranks
 * it lower.
 */
const SOURCE_WEIGHT: Record<SessionSource, number> = {
	interactive: 1.0,
	cron: 0.25, // 降權，不排除
	subagent: 0,
	tool: 0,
};

/**
 * Prefixes of the handover summaries context compaction produces.
 *
 * Another real bug (Hermes issue #43175). A compaction summary lives in the session as an
 * ordinary message, so search finds it. The consequence:
 *
 *   > They must be excluded from discovery bookends to avoid **re-introducing
 *   > huge compaction payloads into fresh sessions** via session_search.
 *
 * Consider the loop:
 *   1. an old session is compacted, producing a large summary
 *   2. a new session searches history and finds that summary
 *   3. that summary is pushed into the new session's context
 *   4. the new session grows and is compacted in turn…
 *
 * **Search dragged back what compaction removed.** This is the trap at the seam between Lesson 5
 * and this lesson.
 */
const COMPACTION_PREFIXES = ["[CONTEXT COMPACTION", "[CONTEXT SUMMARY]:", "[以下是這次對話較早部分的摘要"];

function isCompactionArtifact(text: string): boolean {
	const head = text.trimStart();
	return COMPACTION_PREFIXES.some((p) => head.startsWith(p));
}

/**
 * How many FTS results to scan before deduping and ranking.
 *
 * Hermes uses 300, and the reason is:
 *
 *   > The interactive vs automation split below only helps if enough rows are
 *   > in hand to find interactive matches buried under a wall of cron hits.
 *
 * That is, take the top 10 and rank those and all 10 may be cron, so demotion cannot help -
 * the user's conversation never entered the candidate set.
 *
 * **Scan wide, then rank.**
 */
const SCAN_LIMIT = 300;

/** A cap on user query length, guarding against pathological input. */
export const MAX_QUERY_CHARS = 2048;

// ─────────────────────────────────────────────────────────────
// The index
// ─────────────────────────────────────────────────────────────

export interface SearchHit {
	sessionId: string;
	sessionTitle: string;
	source: SessionSource;
	messageId: string;
	/** The matching message. */
	snippet: string;
	score: number;
	timestamp: string;
}

export interface DiscoverResult {
	hit: SearchHit;
	/** N messages either side of the hit, for context. */
	window: SearchableMessage[];
	/** The session's opening messages, so you know what it was about. */
	bookendStart: SearchableMessage[];
	/** The session's closing messages, so you know how it concluded. */
	bookendEnd: SearchableMessage[];
}

export interface SearchOptions {
	/**
		 * Turn source demotion off, weighting every source equally.
	 *
		 * **This option exists for one purpose: letting you see recall blindness yourself.**
		 * A real system should not have this switch.
	 */
	disableSourceWeighting?: boolean;
}

export class SessionSearchIndex {
	private readonly messages: SearchableMessage[] = [];
	private readonly sessions = new Map<string, SessionMeta>();
	/** term -> which messages it appears in (index positions). */
	private readonly postings = new Map<string, Set<number>>();
	/** term -> how many messages contain it, for IDF. */
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
		 * Mode one: DISCOVERY. Given keywords, find relevant sessions.
	 */
	discover(query: string, limit = 3, windowSize = 2, options: SearchOptions = {}): DiscoverResult[] {
		if (query.length > MAX_QUERY_CHARS) {
			throw new Error(`查詢太長（${query.length} > ${MAX_QUERY_CHARS}）`);
		}

		const terms = tokenize(query);
		if (terms.length === 0) return [];

			// 1. Gather candidates (scan wide)
		//
			// Scoring is a simplified BM25: IDF (how rare the term is) times TF (how often it occurs here).
		//
			// **The TF term is what causes recall blindness.** Scheduled summaries repeat the same words
			// ("telemetry", "sample rate", "session"), so their TF is high, and under pure
			// term-frequency ranking they bury the user's natural conversation. Real BM25 does the same.
		const candidates = new Map<number, number>();
		for (const term of terms) {
			const idf = Math.log(1 + this.messages.length / ((this.docFreq.get(term) ?? 0) + 1));
			for (const position of this.postings.get(term) ?? []) {
				const text = this.messages[position]?.text.toLowerCase() ?? "";
				const tf = countOccurrences(text, term);
					// Square root saturation, so a word repeated 50 times does not scale without bound
				candidates.set(position, (candidates.get(position) ?? 0) + idf * Math.sqrt(tf));
			}
		}

			// 2. Filtering and weighting
		const scored: SearchHit[] = [];
		for (const [position, rawScore] of candidates) {
			const message = this.messages[position];
			if (!message) continue;

			const meta = this.sessions.get(message.sessionId);
			if (!meta) continue;

				// Hidden sources simply never appear
			if (HIDDEN_SOURCES.has(meta.source)) continue;

				// Compaction summaries never appear (see the loop described above)
			if (isCompactionArtifact(message.text)) continue;

				// disableSourceWeighting exists only to demonstrate the bug; see SearchOptions
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

			// 3. Keep only the best hit per session
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
		 * Mode two: SCROLL. The position is known; page forwards or backwards.
	 *
		 * Hermes's pagination is worth learning: **no offset, but re-anchoring**.
		 * To page forwards, use the id of this result's last message as the new anchor.
	 *
		 * The benefit is that a message inserted in between causes no skip and no duplicate.
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
		 * Mode three: BROWSE. Given nothing, list the most recent sessions.
	 */
	browse(limit = 10): SessionMeta[] {
		return [...this.sessions.values()]
			.filter((s) => !HIDDEN_SOURCES.has(s.source))
			.sort((a, b) => b.startedAt.localeCompare(a.startedAt))
			.slice(0, limit);
	}

	/**
		 * A session's bookends.
	 *
		 * Why they are needed: given only the matching sentence, you do not know what that session
		 * was about or how it concluded. The two ends provide **bearings**.
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
 * Tokenisation.
 *
 * Chinese has no spaces, so it is split character by character. Crude, but **adequate for
 * search**, and it introduces no segmentation dependency.
 *
 * (Hermes loads FTS5's CJK extension for this; see `load_fts5_cjk_extension` in
 * `hermes_state.py`.)
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
