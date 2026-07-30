/**
 * Session persistence — an append-only JSONL file.
 *
 * Why JSONL (one JSON per line) rather than one big JSON file?
 *
 *   1. appending only, without rewriting the whole file each time
 *   2. a crash damages at most the last line, and everything before it survives
 *   3. tail -f shows it live
 *   4. it can be processed without loading the whole thing into memory
 *
 * Why a **tree** rather than an array? See the README. The short version:
 * users edit a message and ask again, and go back and retry. Those operations create branches.
 *
 * Against Pi: packages/agent/src/harness/session/jsonl-storage.ts
 */

import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Message } from "../providers/types.ts";

/**
 * One record in the file.
 *
 * The key is parentId: it turns these one-per-line records into a tree.
 * Most of the time parentId is simply the previous record, forming a straight line.
 * When you go back and ask again, the new branch points at an earlier node.
 */
export interface SessionEntry {
	id: string;
	/** The previous record's id. null for the first. */
	parentId: string | null;
	timestamp: string;
	message: Message;
}

/** An extra recorded event (not conversation content, and worth keeping). */
export interface SessionMeta {
	type: "meta";
	id: string;
	parentId: string | null;
	timestamp: string;
	/** For example "model_change" or "compaction" */
	kind: string;
	detail: Record<string, unknown>;
}

export type SessionRecord = SessionEntry | SessionMeta;

export class Session {
	private readonly path: string;
	private readonly records: SessionRecord[] = [];
	/** The last record on the current branch. New messages hang beneath it. */
	private head: string | null = null;
	private counter = 0;

	private constructor(path: string) {
		this.path = path;
	}

		/** Open a new session file. */
	static async create(path: string): Promise<Session> {
		await mkdir(dirname(path), { recursive: true });
		return new Session(path);
	}

	/**
		 * Read a session back from a file.
	 *
		 * Note: after reading, head is the **last record**. That means you continue
		 * the last branch, which is not necessarily the longest one.
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
					// One broken line must not make the whole session unreadable.
					// That is JSONL's benefit: damage is local.
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

		/** Add a message and write it to disk. */
	async append(message: Message): Promise<SessionEntry> {
		const entry: SessionEntry = {
			id: this.nextId(),
			parentId: this.head,
			timestamp: new Date().toISOString(),
			message,
		};

		this.records.push(entry);
		this.head = entry.id;

			// Write before returning. "Returned but not written" is far harder to handle after a crash than "written but not returned".
		await appendFile(this.path, `${JSON.stringify(entry)}\n`, "utf8");
		return entry;
	}

		/** Record a non-conversation event (a model change, a compaction…). */
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
		 * Walk back from head to assemble the current branch's message list.
	 *
		 * This is what gets sent to the model. Note it is **not** the whole file;
		 * abandoned branches never appear here.
	 */
	messages(): Message[] {
		const byId = new Map(this.records.map((r) => [r.id, r]));
		const chain: Message[] = [];

		let cursor = this.head;
		while (cursor) {
			const record = byId.get(cursor);
			if (!record) break;

				// meta records are not part of the conversation
			if (!("type" in record)) {
				chain.push(record.message);
			}
			cursor = record.parentId;
		}

			// We walked backwards, so reverse it
		return chain.reverse();
	}

	/**
		 * Go back to a record, so new messages grow a new branch from there.
	 *
		 * The old branch is **not deleted**; it is still in the file, just not on the current path.
		 * Which is why append-only is worth it: you never lose anything.
	 */
	rewindTo(entryId: string): void {
		if (!this.records.some((r) => r.id === entryId)) {
			throw new Error(`No such entry: ${entryId}`);
		}
		this.head = entryId;
	}

		/** Every record on the current branch (including meta), oldest to newest. */
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

		/** Every record, including abandoned branches. */
	all(): readonly SessionRecord[] {
		return this.records;
	}

	private nextId(): string {
			// An incrementing id is enough, and reads better than a UUID — you will be reading this JSONL by eye.
		return `e${String(++this.counter).padStart(4, "0")}`;
	}
}
