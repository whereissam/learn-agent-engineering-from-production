/**
 * Session 持久化 ， append-only 的 JSONL 檔案。
 *
 * 為什麼是 JSONL（一行一個 JSON）而不是一個大 JSON 檔？
 *
 *   1. 只要 append，不用每次重寫整個檔案
 *   2. 程式當掉時最多壞掉最後一行，前面的都還在
 *   3. 用 tail -f 就能即時看
 *   4. 不用把整份載入記憶體就能處理
 *
 * 為什麼是「樹」而不是「陣列」？見 README。簡短版：
 * 使用者會編輯訊息重問、會退回去重試。這些操作會產生分支。
 *
 * 對照 Pi：packages/agent/src/harness/session/jsonl-storage.ts
 */

import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Message } from "../providers/types.ts";

/**
 * 檔案裡的一筆記錄。
 *
 * 關鍵是 parentId：它讓這些「一行一筆」的記錄組成一棵樹。
 * 大部分時候 parentId 就是前一筆，形成一條直線。
 * 但當你退回去重問時，新的分支會指向更早的節點。
 */
export interface SessionEntry {
	id: string;
	/** 上一筆的 id。第一筆是 null。 */
	parentId: string | null;
	timestamp: string;
	message: Message;
}

/** 額外記錄的事件（不是對話內容，但值得留下來）。 */
export interface SessionMeta {
	type: "meta";
	id: string;
	parentId: string | null;
	timestamp: string;
	/** 例如 "model_change"、"compaction" */
	kind: string;
	detail: Record<string, unknown>;
}

export type SessionRecord = SessionEntry | SessionMeta;

export class Session {
	private readonly path: string;
	private readonly records: SessionRecord[] = [];
	/** 目前這條分支的最後一筆。新訊息會掛在它下面。 */
	private head: string | null = null;
	private counter = 0;

	private constructor(path: string) {
		this.path = path;
	}

	/** 開一個新的 session 檔案。 */
	static async create(path: string): Promise<Session> {
		await mkdir(dirname(path), { recursive: true });
		return new Session(path);
	}

	/**
	 * 從檔案讀回一個 session。
	 *
	 * 注意：讀回來之後，head 是「最後一筆記錄」。這代表你續跑的是
	 * 最後那條分支，不一定是最長的那條。
	 */
	static async load(path: string): Promise<Session> {
		const session = new Session(path);

		let raw: string;
		try {
			raw = await readFile(path, "utf8");
		} catch {
			throw new Error(`Session file not found: ${path}`);
		}

		for (const [index, line] of raw.split("\n").entries()) {
			if (!line.trim()) continue;
			try {
				const record = JSON.parse(line) as SessionRecord;
				session.records.push(record);
				session.head = record.id;
				session.counter++;
			} catch {
				// 壞掉的一行不該讓整個 session 讀不回來。
				// 這正是 JSONL 的好處：損壞是局部的。
				console.warn(`[session] skipping malformed line ${index + 1}`);
			}
		}

		return session;
	}

	get file(): string {
		return this.path;
	}

	get size(): number {
		return this.records.length;
	}

	/** 加一則訊息，寫進磁碟。 */
	async append(message: Message): Promise<SessionEntry> {
		const entry: SessionEntry = {
			id: this.nextId(),
			parentId: this.head,
			timestamp: new Date().toISOString(),
			message,
		};

		this.records.push(entry);
		this.head = entry.id;

		// 先寫檔再回傳。當機時「已經回傳但沒寫進去」比「寫進去但沒回傳」難處理得多。
		await appendFile(this.path, `${JSON.stringify(entry)}\n`, "utf8");
		return entry;
	}

	/** 記一筆非對話的事件（換 model、壓縮……）。 */
	async appendMeta(kind: string, detail: Record<string, unknown>): Promise<void> {
		const meta: SessionMeta = {
			type: "meta",
			id: this.nextId(),
			parentId: this.head,
			timestamp: new Date().toISOString(),
			kind,
			detail,
		};
		this.records.push(meta);
		this.head = meta.id;
		await appendFile(this.path, `${JSON.stringify(meta)}\n`, "utf8");
	}

	/**
	 * 從 head 往回走，組出「目前這條分支」的訊息串。
	 *
	 * 這就是要送給模型的東西。注意它「不是」整個檔案，
	 * 被放棄的分支不會出現在這裡。
	 */
	messages(): Message[] {
		const byId = new Map(this.records.map((r) => [r.id, r]));
		const chain: Message[] = [];

		let cursor = this.head;
		while (cursor) {
			const record = byId.get(cursor);
			if (!record) break;

			// meta 記錄不進對話
			if (!("type" in record)) {
				chain.push(record.message);
			}
			cursor = record.parentId;
		}

		// 我們是從後往前走的，要反過來
		return chain.reverse();
	}

	/**
	 * 退回到某一筆記錄，之後的新訊息會從那裡長出新分支。
	 *
	 * 舊的分支「不會被刪掉」，它還在檔案裡，只是不在目前這條路徑上。
	 * 這就是為什麼 append-only 值得：你永遠不會弄丟東西。
	 */
	rewindTo(entryId: string): void {
		if (!this.records.some((r) => r.id === entryId)) {
			throw new Error(`No such entry: ${entryId}`);
		}
		this.head = entryId;
	}

	/** 目前這條分支上的所有記錄（含 meta），最舊到最新。 */
	branch(): SessionRecord[] {
		const byId = new Map(this.records.map((r) => [r.id, r]));
		const out: SessionRecord[] = [];
		let cursor = this.head;
		while (cursor) {
			const record = byId.get(cursor);
			if (!record) break;
			out.push(record);
			cursor = record.parentId;
		}
		return out.reverse();
	}

	/** 全部記錄，包含被放棄的分支。 */
	all(): readonly SessionRecord[] {
		return this.records;
	}

	private nextId(): string {
		// 遞增的 id 就夠了，而且比 UUID 好讀，你要用肉眼看 JSONL 檔。
		return `e${String(++this.counter).padStart(4, "0")}`;
	}
}
