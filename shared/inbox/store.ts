/**
 * Inbox: a cross-session queue for human attention.
 *
 * The problem: a schedule runs at 3 AM, the agent needs approval, and you are asleep. What now?
 *
 * Three wrong answers:
 *   1. allow it outright  → you effectively have no approval mechanism
 *   2. deny it outright   → automation never finishes anything
 *   3. skip and continue  → the worst. The agent proceeds on the basis of a step that did not happen
 *
 * The right answer: **store the request, let the agent wait there, and answer when you wake up.**
 *
 * It sounds simple, and it has several non-obvious requirements:
 *   - the same request may be answered from several places (the app, Slack, a phone) → idempotency
 *   - the agent must genuinely pause, rather than poll or give up on a timeout
 *   - when a session is deleted, requests that will never be answered must be cleaned up
 *   - when you come back, you must be able to see what happened while you slept
 *
 * Source: openworker/coworker/inbox.py
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export type ItemKind = "approval" | "question" | "notification";

export type ItemState = "pending" | "resolved";

/**
 * Where this request should appear.
 *
 * The key design (OpenWorker's comment states it well):
 *
 *   > Either way it's the same parked, awaitable, resolve-from-anywhere
 *   > record, only the visibility differs.
 *
 * That is, inline and inbox **use the same mechanism**, differing only in where it is displayed.
 * Not two codebases but one plus a field.
 */
export type Visibility =
	/** A session with somebody present; answered in the conversation. Never enters the cross-session queue. */
	| "inline"
	/** Unattended; joins the cross-session inbox. */
	| "inbox";

export interface InboxItem {
	id: string;
	sessionId: string;
	kind: ItemKind;
	visibility: Visibility;
	title: string;
	body: string;
	/** Which tool call produced it, for reference when you return. */
	toolCallId?: string;
	state: ItemState;
	/** The user's answer. undefined while pending. */
	resolution?: string;
	createdAt: string;
	resolvedAt?: string;
}

export interface AddOptions {
	sessionId: string;
	kind: ItemKind;
	visibility: Visibility;
	title: string;
	body?: string;
	toolCallId?: string;
}

/**
 * The inbox's storage and state machine.
 *
 * The state machine has one edge: pending → resolved.
 * And it **may only be taken once**; the first answer wins.
 */
export class InboxStore {
	private readonly items = new Map<string, InboxItem>();
	/** item id -> whoever is waiting on it. */
	private readonly waiters = new Map<string, Array<(resolution: string) => void>>();
	private readonly path?: string;
	private counter = 0;

	constructor(path?: string) {
		this.path = path;
	}

	static async load(path: string): Promise<InboxStore> {
		const store = new InboxStore(path);
		try {
			const raw = await readFile(path, "utf8");
			for (const item of JSON.parse(raw) as InboxItem[]) {
				store.items.set(item.id, item);
				store.counter++;
			}
		} catch {
				// A missing file is entirely normal
		}
		return store;
	}

	private async save(): Promise<void> {
		if (!this.path) return;
		await mkdir(dirname(this.path), { recursive: true });
		await writeFile(this.path, JSON.stringify([...this.items.values()], null, 2), "utf8");
	}

	async add(options: AddOptions): Promise<InboxItem> {
		const item: InboxItem = {
			id: `itm_${String(++this.counter).padStart(4, "0")}`,
			sessionId: options.sessionId,
			kind: options.kind,
			visibility: options.visibility,
			title: options.title,
			body: options.body ?? "",
			toolCallId: options.toolCallId,
			state: "pending",
			createdAt: new Date().toISOString(),
		};
		this.items.set(item.id, item);
		await this.save();
		return item;
	}

	/**
		 * Answer a request. **Succeeds exactly once.**
	 *
		 * Returning false means "somebody already answered", which is not an error but normal:
		 * you may have pressed allow on your phone, forgotten, and pressed it again in the app.
		 * The second time should quietly become a no-op rather than waking the agent twice.
	 *
		 * This is what OpenWorker means by
	 * 「resolved once, idempotent + first-responder-wins」。
	 */
	async resolve(itemId: string, resolution: string): Promise<boolean> {
		const item = this.items.get(itemId);
		if (!item || item.state === "resolved") return false;

		item.state = "resolved";
		item.resolution = resolution;
		item.resolvedAt = new Date().toISOString();
		await this.save();

			// Wake whoever is waiting
		const waiting = this.waiters.get(itemId) ?? [];
		this.waiters.delete(itemId);
		for (const notify of waiting) notify(resolution);

		return true;
	}

	/**
		 * Wait for a request to be answered. **This is where the agent pauses.**
	 *
		 * Note there is no timeout. That is deliberate:
		 * what would you do after one? Allow (dangerous) or deny (the task fails)?
		 * Neither is good, so it waits. What should have a timeout is **the whole task**,
		 * not a single approval.
	 */
	wait(itemId: string): Promise<string> {
		const item = this.items.get(itemId);
			// Already answered, so return immediately rather than blocking
		if (item?.state === "resolved") return Promise.resolve(item.resolution ?? "");

		return new Promise<string>((resolveWait) => {
			const existing = this.waiters.get(itemId) ?? [];
			existing.push(resolveWait);
			this.waiters.set(itemId, existing);
		});
	}

	get(itemId: string): InboxItem | undefined {
		return this.items.get(itemId);
	}

	list(filter?: { sessionId?: string; state?: ItemState; visibility?: Visibility }): InboxItem[] {
		return [...this.items.values()].filter(
			(i) =>
				(!filter?.sessionId || i.sessionId === filter.sessionId) &&
				(!filter?.state || i.state === filter.state) &&
				(!filter?.visibility || i.visibility === filter.visibility),
		);
	}

	pending(sessionId?: string): InboxItem[] {
		return this.list({ sessionId, state: "pending" });
	}

	/**
		 * When a session is deleted, clean up all of its unanswered requests.
	 *
		 * Why? Because those requests **can never be meaningfully answered** any more
		 * (the session is gone; approving it achieves nothing). Without cleanup:
		 *   - the inbox accumulates zombie items
		 *   - agents still waiting hang forever
	 */
	async resolveSession(sessionId: string, resolution = "session deleted"): Promise<number> {
		let closed = 0;
		for (const item of this.pending(sessionId)) {
			if (await this.resolve(item.id, resolution)) closed++;
		}
		return closed;
	}

	/**
		 * What the user should see when they come back and take over.
	 *
		 * Two parts: what is unanswered (to handle now), and what was answered while you slept (context).
	 *
		 * The second part is easy to overlook and matters: without knowing what happened while you
		 * slept, you cannot trust this agent.
	 */
	reconcileOnResume(sessionId: string): { pending: InboxItem[]; recap: InboxItem[] } {
		return {
			pending: this.pending(sessionId),
			recap: this.list({ sessionId, state: "resolved" }),
		};
	}
}

/** Flatten tool arguments onto one line for the approval card. */
export function argsPreview(args: Record<string, unknown>, limit = 240): string {
	const parts = Object.entries(args).map(([key, value]) => {
		let s = typeof value === "string" ? value : JSON.stringify(value);
		s = String(s).split(/\s+/).join(" ");
		if (s.length > 80) s = `${s.slice(0, 79)}…`;
		return `${key}: ${s}`;
	});
	const out = parts.join(" · ");
	return out.length > limit ? `${out.slice(0, limit - 1)}…` : out;
}
