/**
 * Inbox：跨 session 的「人類注意力佇列」。
 *
 * 問題：排程半夜三點跑，agent 需要批准，但你在睡覺。怎麼辦？
 *
 * 三個錯誤答案：
 *   1. 直接放行  → 你等於沒有批准機制
 *   2. 直接拒絕  → 自動化永遠做不完事
 *   3. 跳過繼續  → 最糟。agent 會基於「那步沒做成」繼續往下做
 *
 * 正確答案：**把要求存起來，讓 agent 停在那裡等，你醒來再回答。**
 *
 * 聽起來簡單，但有幾個不明顯的要求：
 *   - 同一個要求可能從多個地方被回答（App、Slack、手機）→ 要冪等
 *   - agent 要真的「暫停」，不是輪詢，也不是逾時放棄
 *   - session 被刪掉時，那些永遠不會被回答的要求要收乾淨
 *   - 你回來的時候，要看得到「睡覺時發生了什麼」
 *
 * 對照：openworker/coworker/inbox.py
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export type ItemKind = "approval" | "question" | "notification";

export type ItemState = "pending" | "resolved";

/**
 * 這個要求要在哪裡出現。
 *
 * 關鍵設計（OpenWorker 的註解講得很好）：
 *
 *   > Either way it's the same parked, awaitable, resolve-from-anywhere
 *   > record, only the visibility differs.
 *
 * 也就是說 inline 跟 inbox **用的是同一套機制**,差別只在「顯示在哪」。
 * 不是兩套程式碼，是同一套加一個欄位。
 */
export type Visibility =
	/** 有人在場的 session,在對話框裡回答。不進跨 session 佇列。 */
	| "inline"
	/** 無人值守，加入跨 session 的 inbox。 */
	| "inbox";

export interface InboxItem {
	id: string;
	sessionId: string;
	kind: ItemKind;
	visibility: Visibility;
	title: string;
	body: string;
	/** 哪一個工具呼叫產生的，方便回來時對照。 */
	toolCallId?: string;
	state: ItemState;
	/** 使用者的回答。pending 時是 undefined。 */
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
 * Inbox 的儲存與狀態機。
 *
 * 狀態機只有一條邊：pending → resolved。
 * 而且**只能走一次**,第一個回答的人贏。
 */
export class InboxStore {
	private readonly items = new Map<string, InboxItem>();
	/** item id -> 正在等它的人。 */
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
			// 檔案不存在很正常
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
	 * 回答一個要求。**只會成功一次。**
	 *
	 * 回傳 false 代表「已經被別人回答過了」，這不是錯誤，是正常情況：
	 * 你可能在手機上按了允許，又忘記了，再從 App 按一次。
	 * 第二次應該安靜地變成 no-op,而不是把 agent 叫醒兩次。
	 *
	 * 這就是 OpenWorker 說的
	 * 「resolved once, idempotent + first-responder-wins」。
	 */
	async resolve(itemId: string, resolution: string): Promise<boolean> {
		const item = this.items.get(itemId);
		if (!item || item.state === "resolved") return false;

		item.state = "resolved";
		item.resolution = resolution;
		item.resolvedAt = new Date().toISOString();
		await this.save();

		// 叫醒正在等的人
		const waiting = this.waiters.get(itemId) ?? [];
		this.waiters.delete(itemId);
		for (const notify of waiting) notify(resolution);

		return true;
	}

	/**
	 * 等一個要求被回答。**這就是 agent 暫停的地方。**
	 *
	 * 注意它沒有 timeout。這是刻意的：
	 * 逾時之後你要做什麼？放行（危險）還是拒絕（任務失敗）？
	 * 兩個都不好，所以就一直等。真正該有 timeout 的是「整個任務」,
	 * 不是「單一個批准」。
	 */
	wait(itemId: string): Promise<string> {
		const item = this.items.get(itemId);
		// 已經被回答了就直接回傳，不要卡住
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
	 * session 被刪掉時，把它所有還沒回答的要求收乾淨。
	 *
	 * 為什麼需要？因為那些要求**永遠不可能被有意義地回答**了
	 * （session 都不在了，批准它幹嘛）。不收的話：
	 *   - inbox 會累積一堆殭屍項目
	 *   - 還在等的 agent 會永遠卡著
	 */
	async resolveSession(sessionId: string, resolution = "session deleted"): Promise<number> {
		let closed = 0;
		for (const item of this.pending(sessionId)) {
			if (await this.resolve(item.id, resolution)) closed++;
		}
		return closed;
	}

	/**
	 * 使用者回來接手時要看到的東西。
	 *
	 * 兩部分：還沒回答的（現在要處理）、以及睡覺時已經被回答的（補上下文）。
	 *
	 * 第二部分容易被忽略但很重要：你不知道「睡覺時發生了什麼」的話,
	 * 就不敢相信這個 agent。
	 */
	reconcileOnResume(sessionId: string): { pending: InboxItem[]; recap: InboxItem[] } {
		return {
			pending: this.pending(sessionId),
			recap: this.list({ sessionId, state: "resolved" }),
		};
	}
}

/** 把工具參數壓成一行，給批准卡片顯示用。 */
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
