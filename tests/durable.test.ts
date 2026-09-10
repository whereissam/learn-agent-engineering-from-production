import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, test } from "node:test";
import {
	advance,
	completedSteps,
	getSuspendedStep,
	inFlightSteps,
	newRun,
	NoStore,
	resume,
	RunStore,
	type RunState,
	type Step,
} from "../lesson-33-durable/workflow.ts";

const temporaryDirs: string[] = [];
function scratch(): string {
	const dir = mkdtempSync(resolve(tmpdir(), "lesson33-"));
	temporaryDirs.push(dir);
	return dir;
}
afterEach(() => {
	for (const dir of temporaryDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Steps that count their own executions, which is the only thing these tests need to see. */
function pipeline() {
	const ran: string[] = [];
	const steps: Step[] = [
		{
			id: "first",
			run() {
				ran.push("first");
				return { value: 1 };
			},
		},
		{
			id: "gate",
			run(ctx) {
				ran.push("gate");
				const answer = ctx.resumeData<{ ok: boolean }>() ?? ctx.suspend({ question: "ok?" });
				if (!answer.ok) throw new Error("rejected");
				return { approved: true };
			},
		},
		{
			id: "last",
			run(ctx) {
				ran.push("last");
				return { saw: ctx.outputOf<{ value: number }>("first")?.value };
			},
		},
	];
	return { steps, ran };
}

describe("suspend（Lesson 33）", () => {
	test("stops the run at the gate and records what it is asking", async () => {
		const { steps, ran } = pipeline();
		const state = await advance(steps, newRun("r1", {}), new NoStore());

		assert.equal(state.status, "suspended");
		assert.deepEqual(ran, ["first", "gate"]);
		assert.deepEqual(getSuspendedStep(state), { stepId: "gate", suspendPayload: { question: "ok?" } });
		assert.deepEqual(completedSteps(state), ["first"]);
	});

	test("a step after the gate does not run", async () => {
		const { steps, ran } = pipeline();
		await advance(steps, newRun("r1", {}), new NoStore());
		assert.ok(!ran.includes("last"));
	});
});

describe("resume（Lesson 33）", () => {
	test("does not re-run a step the journal says completed", async () => {
		const store = new RunStore(scratch());
		const first = pipeline();
		await advance(first.steps, newRun("r1", {}), store);

		// A second, independent set of steps — as if a different process.
		const second = pipeline();
		const reloaded = store.load("r1");
		assert.ok(reloaded);
		resume(reloaded, "gate", { ok: true });
		const done = await advance(second.steps, reloaded, store);

		assert.equal(done.status, "success");
		assert.ok(!second.ran.includes("first"), "first ran a second time");
		assert.deepEqual(second.ran, ["gate", "last"]);
	});

	test("a later step reads an earlier one's output out of the store, not a closure", async () => {
		const store = new RunStore(scratch());
		await advance(pipeline().steps, newRun("r1", {}), store);
		const reloaded = store.load("r1");
		assert.ok(reloaded);
		resume(reloaded, "gate", { ok: true });
		const done = await advance(pipeline().steps, reloaded, store);
		assert.deepEqual(done.result, { saw: 1 });
	});

	test("resuming a step that is not suspended is refused rather than silently ignored", () => {
		const state: RunState = {
			runId: "r1",
			status: "running",
			input: {},
			steps: { first: { status: "success" } },
			attempts: 1,
		};
		assert.throws(() => resume(state, "first", {}), /not suspended/);
	});
});

describe("the run is a value（Lesson 33）", () => {
	test("state survives a JSON round trip with nothing lost", async () => {
		const state = await advance(pipeline().steps, newRun("r1", { a: 1 }), new NoStore());
		const clone = JSON.parse(JSON.stringify(state)) as RunState;
		assert.deepEqual(clone, state);
		assert.deepEqual(getSuspendedStep(clone), getSuspendedStep(state));
	});

	test("a run written by one store is readable by another pointed at the same directory", async () => {
		const dir = scratch();
		await advance(pipeline().steps, newRun("r1", {}), new RunStore(dir));
		const other = new RunStore(dir).load("r1");
		assert.equal(other?.status, "suspended");
	});

	test("loading a run that does not exist returns undefined rather than throwing", () => {
		assert.equal(new RunStore(scratch()).load("nope"), undefined);
	});

	test("the atomic write leaves no .tmp file behind", async () => {
		const dir = scratch();
		await advance(pipeline().steps, newRun("r1", {}), new RunStore(dir));
		assert.deepEqual(readdirSync(dir), ["r1.json"]);
	});
});

describe("an interrupted step（Lesson 33）", () => {
	/** A run whose process died inside `first`: started, never ended. */
	function interrupted(): RunState {
		return {
			runId: "r1",
			status: "running",
			input: {},
			steps: { first: { status: "pending", startedAt: Date.now() } },
			attempts: 1,
		};
	}

	test("is visible in the state, which is the whole reason to write before running", () => {
		assert.deepEqual(inFlightSteps(interrupted()), ["first"]);
		assert.deepEqual(completedSteps(interrupted()), []);
	});

	test("replay runs it again — at-least-once", async () => {
		const { steps, ran } = pipeline();
		await advance(steps, interrupted(), new NoStore(), { onInterrupted: "replay" });
		assert.ok(ran.includes("first"));
	});

	test("halt refuses to run it and fails the run — at-most-once", async () => {
		const { steps, ran } = pipeline();
		const state = await advance(steps, interrupted(), new NoStore(), { onInterrupted: "halt" });
		assert.equal(state.status, "failed");
		assert.ok(!ran.includes("first"));
		assert.match(String(state.steps.first?.error), /a human must decide/);
	});
});

describe("without the mechanism（Lesson 33）", () => {
	test("NoStore keeps nothing, so every attempt is attempt one", async () => {
		const store = new NoStore();
		await advance(pipeline().steps, newRun("r1", {}), store);
		assert.equal(store.load(), undefined);
	});

	test("attempts counts how many processes have picked the run up", async () => {
		const store = new RunStore(scratch());
		await advance(pipeline().steps, newRun("r1", {}), store);
		const again = store.load("r1");
		assert.ok(again);
		await advance(pipeline().steps, again, store);
		assert.equal(store.load("r1")?.attempts, 2);
	});
});
