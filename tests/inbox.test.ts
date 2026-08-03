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

describe("the state machine (Lesson 9)", () => {
	test("a new item is pending", async () => {
		const store = new InboxStore();
		const item = await makeItem(store);
		assert.equal(item.state, "pending");
		assert.equal(store.pending("s1").length, 1);
	});

	test("resolve succeeds once; the first answer wins", async () => {
		const store = new InboxStore();
		const item = await makeItem(store);

		assert.equal(await store.resolve(item.id, "allow"), true);
		assert.equal(await store.resolve(item.id, "deny"), false, "the second call should be a no-op");

		assert.equal(store.get(item.id)?.resolution, "allow", "the first answer must not be overwritten");
	});

	test("resolving a non-existent item returns false rather than throwing", async () => {
		const store = new InboxStore();
		assert.equal(await store.resolve("itm_9999", "allow"), false);
	});

	test("wait is woken by resolve", async () => {
		const store = new InboxStore();
		const item = await makeItem(store);

		const waiting = store.wait(item.id);
		await store.resolve(item.id, "allow");

		assert.equal(await waiting, "allow");
	});

	test("wait on an already-resolved item returns immediately (it does not hang)", async () => {
		const store = new InboxStore();
		const item = await makeItem(store);
		await store.resolve(item.id, "deny");

			// With no timeout protection, a hang would hang this test
		assert.equal(await store.wait(item.id), "deny");
	});

	test("every waiter is woken", async () => {
		const store = new InboxStore();
		const item = await makeItem(store);

		const waiters = [store.wait(item.id), store.wait(item.id), store.wait(item.id)];
		await store.resolve(item.id, "allow");

		assert.deepEqual(await Promise.all(waiters), ["allow", "allow", "allow"]);
	});
});

describe("reclaiming orphans (Lesson 9 Step 5)", () => {
	test("deleting a session releases every waiter", async () => {
		const store = new InboxStore();
		const a = await makeItem(store, "doomed");
		const b = await makeItem(store, "doomed");
		const other = await makeItem(store, "healthy");

		const waiting = [store.wait(a.id), store.wait(b.id)];
		const closed = await store.resolveSession("doomed");

		assert.equal(closed, 2);
			// Without the release this line would hang forever
		assert.deepEqual(await Promise.all(waiting), ["session deleted", "session deleted"]);
		assert.equal(store.get(other.id)?.state, "pending", "other sessions must be unaffected");
	});
});

describe("the recap on return (Lesson 9 Step 6)", () => {
	test("returns both pending and resolved", async () => {
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

describe("approvers are interchangeable (Lesson 9 Step 2)", () => {
	test("the inbox approver maps an answer to an outcome", async () => {
		const store = new InboxStore();
		const approve = inboxApprover(store, "s1");

		const running = approve({
			sessionId: "s1",
			toolName: "send_email",
			args: { to: "a@b.c" },
			reason: "approval needed",
		});

			// Wait for it to create the item
		await new Promise((r) => setTimeout(r, 10));
		const item = store.pending("s1")[0];
		assert.ok(item, "there should be one pending item");

		await store.resolve(item.id, "always");
		assert.equal(await running, "always");
	});

	test("the auto approver is the same interface", async () => {
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
	test("collapses to one line", () => {
		const out = argsPreview({ path: "a.md", content: "line1\nline2\n\nline3" });
		assert.ok(!out.includes("\n"));
	});

	test("long values are truncated", () => {
		const out = argsPreview({ content: "x".repeat(500) });
		assert.ok(out.length < 300);
	});
});
