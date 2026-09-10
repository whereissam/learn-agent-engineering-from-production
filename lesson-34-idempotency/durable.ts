/**
 * Durable execution: the code runs again, the effects do not.
 *
 * Source: `restate-ai-examples/typescript-restate-only/tour-of-agents/src/`,
 * particularly `workflow-sequential.ts:60-68`.
 *
 * ## A different shape from Lesson 33
 *
 * Lesson 33 modelled a run as a **list of steps** with a journal keyed by step
 * id. To resume, it walked the list and skipped the ones marked `success`.
 *
 * Restate does not do that, and the difference is the whole reason this lesson
 * exists. Restate re-executes **your handler function from the top** on every
 * attempt. What makes that safe is that each `ctx.run(...)` call consults the
 * journal first:
 *
 *     const amount = await ctx.run("Convert currency", () => convert(...))
 *
 * On the first attempt that executes `convert` and appends the result to the
 * journal. On every later attempt it returns the journaled value **without
 * calling `convert` at all**. The code is replayed; the side effects are not.
 *
 * ## What that immediately breaks
 *
 * If your handler is re-executed from the top, everything in it must produce the
 * same values it produced last time — otherwise the replay diverges from the
 * journal. `Date.now()` and `Math.random()` do not. So a durable runtime has to
 * hand you replacements, and Restate does:
 *
 *     processPayment(ctx.rand.uuidv4(), amountUsd)     // workflow-sequential.ts:67
 *
 * `ctx.rand` is seeded from the invocation id, so `uuidv4()` returns **the same
 * value on every replay**. Restate's own guide names this use: stable UUIDs for
 * idempotency keys.
 *
 * That is the sentence Lesson 33 was missing. Lesson 33 could not decide whether
 * to replay an interrupted step because a replayed payment would be a *second*
 * payment. It is only a second payment if it carries a different identity.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";

/** One journaled result, in call order. The order is the key — see `Context.run`. */
export interface JournalEntry {
	/** The label passed to `ctx.run`, kept for diagnosis rather than lookup. */
	name: string;
	value: unknown;
}

export interface Invocation {
	id: string;
	journal: JournalEntry[];
	/** How many times a process has picked this invocation up. */
	attempts: number;
	status: "running" | "success" | "failed";
	result?: unknown;
	error?: string;
}

export function newInvocation(id: string): Invocation {
	return { id, journal: [], attempts: 0, status: "running" };
}

/**
 * The journal on disk, written the way Lesson 33's store writes: temp file plus
 * rename, because a process killed mid-write must not leave a half-journal.
 */
export class InvocationStore {
	constructor(private dir: string) {}

	private pathFor(id: string): string {
		return resolve(this.dir, `${id}.json`);
	}

	save(invocation: Invocation): void {
		const target = this.pathFor(invocation.id);
		mkdirSync(dirname(target), { recursive: true });
		const temporary = `${target}.tmp`;
		writeFileSync(temporary, JSON.stringify(invocation, null, 2));
		renameSync(temporary, target);
	}

	load(id: string): Invocation | undefined {
		try {
			return JSON.parse(readFileSync(this.pathFor(id), "utf8")) as Invocation;
		} catch {
			return undefined;
		}
	}
}

/**
 * How the idempotency key is produced.
 *
 *   "unstable"   `crypto.randomUUID()` — a fresh key on every attempt
 *   "stable"     seeded from the invocation id and the call index, so a replay
 *                reproduces the same key. Restate's `ctx.rand`
 *
 * This is the switch. Everything else in the lesson is held constant.
 */
export type KeyMode = "unstable" | "stable";

export interface RunOptions {
	/** Fires after a step's effect has run but before its result is journalled. */
	beforeJournal?(name: string, invocation: Invocation): void;
}

export class Context {
	/** Which `ctx.run`/`ctx.rand` call we are on. Replay depends on this order being identical. */
	private cursor = 0;

	constructor(
		readonly invocation: Invocation,
		private store: InvocationStore,
		private keyMode: KeyMode,
		private options: RunOptions = {},
	) {}

	/**
	 * Execute a side effect once, ever.
	 *
	 * The journal is consulted by **position**, not by name. That is Restate's
	 * design and it is worth understanding rather than copying: it means the
	 * sequence of `ctx.run` calls must be the same on every replay, which is
	 * exactly the constraint that makes `ctx.rand` necessary. Looking up by name
	 * would tolerate reordering and would then silently mismatch a *renamed* step
	 * with an old result.
	 */
	async run<T>(name: string, fn: () => Promise<T> | T): Promise<T> {
		const index = this.cursor++;
		const existing = this.invocation.journal[index];
		if (existing !== undefined) {
			// Replay: the effect already happened, somewhere, some attempt ago.
			return existing.value as T;
		}

		const value = await fn();

		// The window Lesson 33 measured: the effect has happened and is not written
		// down. A crash here loses the journal entry, not the effect.
		this.options.beforeJournal?.(name, this.invocation);

		this.invocation.journal[index] = { name, value };
		this.store.save(this.invocation);
		return value;
	}

	/**
	 * Restate's `ctx.rand`, reduced to the one member this lesson needs.
	 *
	 * Deterministic by construction: the invocation id plus the call index, hashed.
	 * Two different steps get different keys; the same step on a later attempt gets
	 * the same one.
	 */
	readonly rand = {
		uuidv4: (): string => {
			if (this.keyMode === "unstable") return crypto.randomUUID();
			const index = this.cursor;
			const digest = createHash("sha256").update(`${this.invocation.id}:${index}`).digest("hex");
			return [
				digest.slice(0, 8),
				digest.slice(8, 12),
				digest.slice(12, 16),
				digest.slice(16, 20),
				digest.slice(20, 32),
			].join("-");
		},
	};
}

export type Handler = (ctx: Context) => Promise<unknown>;

/**
 * Run one attempt of a handler, from the top.
 *
 * Note what this does *not* do: it does not resume at a step. It runs the whole
 * function again and lets the journal make the already-done parts free. Lesson
 * 33's `advance()` is the other model, and the READMEs compare them.
 */
export async function invoke(
	handler: Handler,
	invocation: Invocation,
	store: InvocationStore,
	keyMode: KeyMode,
	options: RunOptions = {},
): Promise<Invocation> {
	invocation.attempts += 1;
	invocation.status = "running";
	store.save(invocation);

	const ctx = new Context(invocation, store, keyMode, options);
	try {
		invocation.result = await handler(ctx);
		invocation.status = "success";
	} catch (error) {
		invocation.status = "failed";
		invocation.error = error instanceof Error ? error.message : String(error);
	}
	store.save(invocation);
	return invocation;
}
