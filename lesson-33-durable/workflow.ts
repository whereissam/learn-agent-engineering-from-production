/**
 * The loop, rewritten as something you can write down.
 *
 * Source: `mastra/packages/core/src/workflows/` — `types.ts`, `state-reader.ts`
 * (118 lines), `handlers/control-flow.ts` (1378 lines), and
 * `agent/durable/durable-agent.ts` (2800 lines).
 *
 * ## Why a `while` loop cannot be resumed
 *
 * Every lesson so far has run the agent inside a `while`. That loop's state lives
 * in the JavaScript stack: which iteration, which local variables, where the
 * `await` is parked. **None of that is addressable.** You cannot serialise a
 * stack frame, you cannot ship it to another machine, and when the process dies
 * it is simply gone.
 *
 * Lesson 09 papered over this with an in-process inbox: pause, wait for a human,
 * carry on. It works exactly as long as the process lives. This lesson replaces
 * the `while` with a structure where **the run's position is a value**:
 *
 *     { runId, status, steps: { charge: {status: 'success', output: {...}},
 *                               approve: {status: 'suspended', ...} } }
 *
 * That object is JSON. Write it to disk and the run survives `kill -9`. Read it
 * back in another process and the run continues there.
 *
 * Mastra's `state-reader.ts` is the proof of the idea in its purest form: a set
 * of *pure functions over the serialised state* — `getStatus`, `getStepOutput`,
 * `getSuspendedStep`. Nothing about a run's position needs the process that
 * started it.
 *
 * ## What is deliberately smaller
 *
 * Mastra's `durable-agent.ts` is 2800 lines and its control-flow handlers another
 * 1378, because a real engine has branches, loops, parallel steps, nested
 * workflows, retries, sleeps and scheduling. This file has **a linear sequence of
 * steps**, which is the smallest shape that can still demonstrate the property.
 * Lesson 24 made the same trade for the research loop.
 *
 * Design principle 6 says a lesson should improve the agent loop, not change its
 * shape. This one changes its shape, so — as in Lesson 24 — it is built *beside*
 * `runTurn` and touches nothing that came before.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

// ─────────────────────────────────────────────────────────────
// The state: everything a run is
// ─────────────────────────────────────────────────────────────

export type StepStatus = "pending" | "success" | "suspended" | "failed";

/**
 * One step's record. The timestamp fields are Mastra's
 * (`workflows/types.ts:113` for the suspended shape) and they are not
 * bookkeeping: `startedAt` without `endedAt` on a reloaded run is how you find a
 * step that was executing when the process died.
 */
export interface StepState {
	status: StepStatus;
	startedAt?: number;
	endedAt?: number;
	suspendedAt?: number;
	resumedAt?: number;
	/** Whatever the step returned. The next step reads it from here, never from a closure. */
	output?: unknown;
	/** What the step wants a human to look at while it is suspended. */
	suspendPayload?: unknown;
	/** What the human sent back. */
	resumeData?: unknown;
	error?: string;
}

export interface RunState {
	runId: string;
	status: "running" | "suspended" | "success" | "failed";
	input: unknown;
	steps: Record<string, StepState>;
	/** The output of the final step, once there is one. */
	result?: unknown;
	/** How many times a process has picked this run up. The number Step 4 of the README is about. */
	attempts: number;
}

// ─────────────────────────────────────────────────────────────
// The steps
// ─────────────────────────────────────────────────────────────

/** Thrown by `ctx.suspend()`. Not an error — a control-flow signal that happens to travel like one. */
export class Suspend extends Error {
	constructor(readonly payload: unknown) {
		super("step suspended");
		this.name = "Suspend";
	}
}

export interface StepContext {
	runId: string;
	input: unknown;
	/** Read an earlier step's output. Steps communicate through the state, never through variables. */
	outputOf<T = unknown>(stepId: string): T | undefined;
	/** What a human sent back when this step was resumed, if it was. */
	resumeData<T = unknown>(): T | undefined;
	/** Stop here and wait for a human. Everything before this point stays done. */
	suspend(payload: unknown): never;
}

export interface Step {
	id: string;
	run(ctx: StepContext): Promise<unknown> | unknown;
}

// ─────────────────────────────────────────────────────────────
// The store
// ─────────────────────────────────────────────────────────────

/**
 * Writing the state so that a crash cannot leave half of it.
 *
 * `writeFileSync` to the real path is not enough: a process killed mid-write
 * leaves a truncated file, and a truncated journal is worse than no journal —
 * it makes the run unreadable rather than merely stale. Write to a temporary
 * file and `rename` it, because rename within a filesystem is atomic. The reader
 * therefore sees either the whole old state or the whole new one.
 *
 * This is the same reasoning as Lesson 28's, and it is worth noticing that the
 * problem recurs at every layer that persists anything.
 */
export class RunStore {
	constructor(private dir: string) {}

	private pathFor(runId: string): string {
		return resolve(this.dir, `${runId}.json`);
	}

	save(state: RunState): void {
		const target = this.pathFor(state.runId);
		mkdirSync(dirname(target), { recursive: true });
		const temporary = `${target}.tmp`;
		writeFileSync(temporary, JSON.stringify(state, null, 2));
		renameSync(temporary, target);
	}

	load(runId: string): RunState | undefined {
		try {
			return JSON.parse(readFileSync(this.pathFor(runId), "utf8")) as RunState;
		} catch {
			return undefined;
		}
	}
}

/** The null store, for the naive mode. Nothing is written, so nothing survives. */
export class NoStore extends RunStore {
	constructor() {
		super("");
	}
	override save(): void {}
	override load(): undefined {
		return undefined;
	}
}

// ─────────────────────────────────────────────────────────────
// The engine
// ─────────────────────────────────────────────────────────────

/**
 * What to do with a step that was executing when the process died.
 *
 * There is no third option, and that is the point. The journal says the step
 * started and does not say whether its side effect landed, so a resuming process
 * is choosing between two ways of being wrong:
 *
 *   "replay"  run it again. At-least-once: the card may be charged twice.
 *   "halt"    stop and ask a human. At-most-once: nothing happens twice, and
 *             nothing happens at all until somebody looks.
 *
 * Picking one is a business decision, not an engineering one — which is why this
 * is a parameter rather than a default buried in the engine. Lesson 34 is about
 * the third thing, which is not a policy but a different contract with the
 * system on the other side.
 */
export type InterruptedPolicy = "replay" | "halt";

export interface RunOptions {
	/** Default `"replay"`, because that is what a naive supervisor does. */
	onInterrupted?: InterruptedPolicy;

	/**
	 * Called after each step's state is written, so the demo can kill the process
	 * at an exact point. A real engine has no such hook; a lesson that wants to
	 * demonstrate a crash has to be able to cause one.
	 */
	afterStep?(stepId: string, state: RunState): void;
	/**
	 * Called after a step's side effect but **before** its result is journalled.
	 * This is the window Lesson 34 is about, and Step 5 of the README measures it.
	 */
	beforeJournal?(stepId: string, state: RunState): void;
}

export function newRun(runId: string, input: unknown): RunState {
	return { runId, status: "running", input, steps: {}, attempts: 0 };
}

/**
 * Advance a run as far as it will go.
 *
 * The whole point is in the first line of the loop: a step whose recorded status
 * is already `success` is **skipped**. Not re-run, not re-checked — skipped,
 * because the journal says it happened. That single `continue` is the difference
 * between charging a card once and charging it twice.
 */
export async function advance(
	steps: Step[],
	state: RunState,
	store: RunStore,
	options: RunOptions = {},
): Promise<RunState> {
	state.attempts += 1;
	state.status = "running";
	store.save(state);

	const onInterrupted = options.onInterrupted ?? "replay";

	for (const step of steps) {
		const previous = state.steps[step.id];

		if (previous?.status === "success") continue;

		// Started, never finished: the process died inside this step.
		if (previous?.status === "pending" && previous.startedAt !== undefined) {
			if (onInterrupted === "halt") {
				state.status = "failed";
				previous.error = `interrupted mid-step; a human must decide whether ${step.id} took effect`;
				store.save(state);
				return state;
			}
		}

		// A suspended step only proceeds once a human has put something in `resumeData`.
		if (previous?.status === "suspended" && previous.resumeData === undefined) {
			state.status = "suspended";
			store.save(state);
			return state;
		}

		const record: StepState = {
			...previous,
			status: "pending",
			startedAt: Date.now(),
			...(previous?.status === "suspended" ? { resumedAt: Date.now() } : {}),
		};
		state.steps[step.id] = record;

		// Written *before* the step runs, not after.
		//
		// This costs a second write per step and buys the only thing that makes a
		// crash diagnosable: a step killed mid-execution leaves `startedAt` with no
		// `endedAt`. Without this line an interrupted step is indistinguishable from
		// one that never began, and the restart has no question to ask.
		store.save(state);

		const context: StepContext = {
			runId: state.runId,
			input: state.input,
			outputOf: <T,>(stepId: string) => state.steps[stepId]?.output as T | undefined,
			resumeData: <T,>() => previous?.resumeData as T | undefined,
			suspend: (payload: unknown) => {
				throw new Suspend(payload);
			},
		};

		try {
			const output = await step.run(context);

			// The side effect has happened. It is not yet written down.
			options.beforeJournal?.(step.id, state);

			record.status = "success";
			record.endedAt = Date.now();
			record.output = output;
			store.save(state);
			options.afterStep?.(step.id, state);
		} catch (error) {
			if (error instanceof Suspend) {
				record.status = "suspended";
				record.suspendedAt = Date.now();
				record.suspendPayload = error.payload;
				state.status = "suspended";
				store.save(state);
				options.afterStep?.(step.id, state);
				return state;
			}

			record.status = "failed";
			record.endedAt = Date.now();
			record.error = error instanceof Error ? error.message : String(error);
			state.status = "failed";
			store.save(state);
			return state;
		}
	}

	const last = steps[steps.length - 1];
	state.status = "success";
	state.result = last ? state.steps[last.id]?.output : undefined;
	store.save(state);
	return state;
}

/** Put a human's answer into the suspended step. The run is now resumable by any process that can read the store. */
export function resume(state: RunState, stepId: string, resumeData: unknown): RunState {
	const step = state.steps[stepId];
	if (!step || step.status !== "suspended") {
		throw new Error(`step ${stepId} is not suspended (status: ${step?.status ?? "unknown"})`);
	}
	step.resumeData = resumeData;
	return state;
}

// ─────────────────────────────────────────────────────────────
// Reading a run without running it
// ─────────────────────────────────────────────────────────────

/**
 * Mastra's `state-reader.ts` in miniature. These are pure functions over the
 * serialised state, and that is the thesis of the lesson in three lines: a
 * dashboard, an approval UI and a resuming worker all need to know where a run
 * is, and **none of them is the process that started it.**
 */
export function getSuspendedStep(state: RunState): { stepId: string; suspendPayload: unknown } | undefined {
	for (const [stepId, step] of Object.entries(state.steps)) {
		if (step.status === "suspended" && step.resumeData === undefined) {
			return { stepId, suspendPayload: step.suspendPayload };
		}
	}
	return undefined;
}

export function completedSteps(state: RunState): string[] {
	return Object.entries(state.steps)
		.filter(([, step]) => step.status === "success")
		.map(([stepId]) => stepId);
}

/**
 * Steps that started and never finished — the signature of a process that died
 * mid-step. Their side effects may or may not have happened, and the journal
 * cannot tell you which. That ambiguity is Lesson 34's subject.
 */
export function inFlightSteps(state: RunState): string[] {
	return Object.entries(state.steps)
		.filter(([, step]) => step.status === "pending" && step.startedAt !== undefined)
		.map(([stepId]) => stepId);
}
