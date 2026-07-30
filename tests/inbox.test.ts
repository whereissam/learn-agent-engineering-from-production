/**
 * The inbox state machine (Lesson 9).
 *
 * It guards the contract "pending → resolved, once only, first answer wins".
 * Concurrency-related behaviour, invisible to the eye and only testable.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { autoApprover, inboxApprover } from "../shared/inbox/approvers.ts";
import { argsPreview, InboxStore } from "../shared/inbox/store.ts";

function makeItem(store: InboxStore, sessionId = "s1") {
	return store.add({
		sessionId,
		kind: "approval",
		visibility: "inbox",
		title: "Run send_email?",
		body: "to: a@b.c",
	});
}

describe("狀態機（Lesson 9）", () => {
	test("新項目是 pending", async () => {
		const store = new InboxStore();
		const item = await makeItem(store);
		assert.equal(item.state, "pending");
		assert.equal(store.pending("s1").length, 1);
	});

	test("resolve 只成功一次，第一個回答的人贏", async () => {
		const store = new InboxStore();
		const item = await makeItem(store);

		assert.equal(await store.resolve(item.id, "allow"), true);
		assert.equal(await store.resolve(item.id, "deny"), false, "第二次應該是 no-op");

		assert.equal(store.get(item.id)?.resolution, "allow", "第一個答案不該被覆蓋");
	});

	test("resolve 不存在的項目回 false，不 throw", async () => {
		const store = new InboxStore();
		assert.equal(await store.resolve("itm_9999", "allow"), false);
	});

	test("wait 會被 resolve 喚醒", async () => {
		const store = new InboxStore();
		const item = await makeItem(store);

		const waiting = store.wait(item.id);
		await store.resolve(item.id, "allow");

		assert.equal(await waiting, "allow");
	});

	test("已經 resolved 的項目，wait 立刻回傳（不會卡住）", async () => {
		const store = new InboxStore();
		const item = await makeItem(store);
		await store.resolve(item.id, "deny");

			// With no timeout protection, a hang would hang this test
		assert.equal(await store.wait(item.id), "deny");
	});

	test("多個等待者都會被喚醒", async () => {
		const store = new InboxStore();
		const item = await makeItem(store);

		const waiters = [store.wait(item.id), store.wait(item.id), store.wait(item.id)];
		await store.resolve(item.id, "allow");

		assert.deepEqual(await Promise.all(waiters), ["allow", "allow", "allow"]);
	});
});

describe("孤兒回收（Lesson 9 Step 5）", () => {
	test("刪 session 會釋放所有等待者", async () => {
		const store = new InboxStore();
		const a = await makeItem(store, "doomed");
		const b = await makeItem(store, "doomed");
		const other = await makeItem(store, "healthy");

		const waiting = [store.wait(a.id), store.wait(b.id)];
		const closed = await store.resolveSession("doomed");

		assert.equal(closed, 2);
			// Without the release this line would hang forever
		assert.deepEqual(await Promise.all(waiting), ["session deleted", "session deleted"]);
		assert.equal(store.get(other.id)?.state, "pending", "不該影響其他 session");
	});
});

describe("回來時的 recap（Lesson 9 Step 6）", () => {
	test("同時給待處理與已處理", async () => {
		const store = new InboxStore();
		const done = await makeItem(store, "s1");
		await store.resolve(done.id, "allow");
		await makeItem(store, "s1");

		const { pending, recap } = store.reconcileOnResume("s1");
		assert.equal(pending.length, 1);
		assert.equal(recap.length, 1);
		assert.equal(recap[0]?.resolution, "allow");
	});
});

describe("approver 可互換（Lesson 9 Step 2）", () => {
	test("inbox approver 把回答對應成 outcome", async () => {
		const store = new InboxStore();
		const approve = inboxApprover(store, "s1");

		const running = approve({
			sessionId: "s1",
			toolName: "send_email",
			args: { to: "a@b.c" },
			reason: "需要批准",
		});

			// Wait for it to create the item
		await new Promise((r) => setTimeout(r, 10));
		const item = store.pending("s1")[0];
		assert.ok(item, "應該要有一個待處理項目");

		await store.resolve(item.id, "always");
		assert.equal(await running, "always");
	});

	test("auto approver 是同一個介面", async () => {
		const outcome = await autoApprover("once")({
			sessionId: "s1",
			toolName: "x",
			args: {},
			reason: "",
		});
		assert.equal(outcome, "once");
	});
});

describe("argsPreview", () => {
	test("壓成一行", () => {
		const out = argsPreview({ path: "a.md", content: "line1\nline2\n\nline3" });
		assert.ok(!out.includes("\n"));
	});

	test("長值會截斷", () => {
		const out = argsPreview({ content: "x".repeat(500) });
		assert.ok(out.length < 300);
	});
});
