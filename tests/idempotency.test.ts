import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, test } from "node:test";
import {
	Context,
	invoke,
	InvocationStore,
	newInvocation,
	type Handler,
} from "../lesson-34-idempotency/durable.ts";

const dirs: string[] = [];
function scratch(): string {
	const dir = mkdtempSync(resolve(tmpdir(), "lesson34-"));
	dirs.push(dir);
	return dir;
}
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function ctxFor(keyMode: "stable" | "unstable" = "stable", id = "inv-1") {
	const store = new InvocationStore(scratch());
	return new Context(newInvocation(id), store, keyMode);
}

describe("ctx.run journals the effect（Lesson 34）", () => {
	test("executes on the first attempt and replays on the second, without re-running", async () => {
		const store = new InvocationStore(scratch());
		const invocation = newInvocation("inv-1");
		let executions = 0;

		const handler: Handler = async (ctx) => ctx.run("charge", () => ++executions);

		await invoke(handler, invocation, store, "stable");
		assert.equal(executions, 1);

		// A second attempt on the same invocation: the code runs again, the effect does not.
		await invoke(handler, store.load("inv-1") ?? invocation, store, "stable");
		assert.equal(executions, 1, "the side effect ran a second time");
	});

	test("the replayed value is the journaled one, not a fresh computation", async () => {
		const store = new InvocationStore(scratch());
		let counter = 0;
		const handler: Handler = async (ctx) => ctx.run("next", () => ++counter);

		const first = await invoke(handler, newInvocation("inv-1"), store, "stable");
		const second = await invoke(handler, store.load("inv-1") ?? newInvocation("inv-1"), store, "stable");
		assert.equal(first.result, second.result);
	});

	/**
	 * Restate consults the journal by position, and the constraint that creates is
	 * the whole reason `ctx.rand` has to exist. Pinned so the design cannot drift
	 * into name-keyed lookup, which would tolerate reordering and then silently
	 * hand a renamed step an old result.
	 */
	test("the journal is keyed by call order, not by name", async () => {
		const store = new InvocationStore(scratch());
		const invocation = newInvocation("inv-1");
		await invoke(
			async (ctx) => {
				await ctx.run("first", () => "a");
				await ctx.run("second", () => "b");
				return null;
			},
			invocation,
			store,
			"stable",
		);
		assert.deepEqual(
			(store.load("inv-1")?.journal ?? []).map((entry) => [entry.name, entry.value]),
			[
				["first", "a"],
				["second", "b"],
			],
		);
	});

	test("attempts are counted, because a retry that is invisible cannot be debugged", async () => {
		const store = new InvocationStore(scratch());
		const handler: Handler = async (ctx) => ctx.run("noop", () => 1);
		await invoke(handler, newInvocation("inv-1"), store, "stable");
		await invoke(handler, store.load("inv-1") ?? newInvocation("inv-1"), store, "stable");
		assert.equal(store.load("inv-1")?.attempts, 2);
	});

	test("the atomic write leaves no .tmp behind", async () => {
		const dir = scratch();
		const store = new InvocationStore(dir);
		await invoke(async (ctx) => ctx.run("noop", () => 1), newInvocation("inv-1"), store, "stable");
		assert.deepEqual(readdirSync(dir), ["inv-1.json"]);
	});
});

describe("ctx.rand（Lesson 34）", () => {
	test("stable mode returns the same key for the same invocation and position", () => {
		assert.equal(ctxFor("stable", "inv-1").rand.uuidv4(), ctxFor("stable", "inv-1").rand.uuidv4());
	});

	test("different invocations get different keys, or one customer's retry would dedupe another's charge", () => {
		assert.notEqual(ctxFor("stable", "inv-1").rand.uuidv4(), ctxFor("stable", "inv-2").rand.uuidv4());
	});

	test("unstable mode is a fresh key every call, which is the failure being demonstrated", () => {
		const ctx = ctxFor("unstable");
		assert.notEqual(ctx.rand.uuidv4(), ctx.rand.uuidv4());
	});

	test("the stable key looks like a uuid, since it goes in an Idempotency-Key header", () => {
		assert.match(ctxFor("stable").rand.uuidv4(), /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
	});
});

describe("failure is recorded, not swallowed（Lesson 34）", () => {
	test("a throwing handler marks the invocation failed and keeps the reason", async () => {
		const store = new InvocationStore(scratch());
		const final = await invoke(
			async () => {
				throw new Error("provider said no");
			},
			newInvocation("inv-1"),
			store,
			"stable",
		);
		assert.equal(final.status, "failed");
		assert.match(String(final.error), /provider said no/);
	});

	test("effects journalled before the failure are not re-run on the next attempt", async () => {
		const store = new InvocationStore(scratch());
		let charges = 0;
		let shouldFail = true;
		const handler: Handler = async (ctx) => {
			await ctx.run("charge", () => ++charges);
			if (shouldFail) throw new Error("later step failed");
			return "done";
		};

		await invoke(handler, newInvocation("inv-1"), store, "stable");
		assert.equal(charges, 1);

		shouldFail = false;
		const final = await invoke(handler, store.load("inv-1") ?? newInvocation("inv-1"), store, "stable");
		assert.equal(final.status, "success");
		assert.equal(charges, 1, "the charge was replayed from the journal, not repeated");
	});
});
