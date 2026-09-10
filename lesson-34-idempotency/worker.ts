/**
 * One attempt at the refund handler, in its own process so that killing it means
 * something.
 *
 * Same reasoning as Lesson 33's worker: a crash you simulate with `throw` still
 * runs `finally` and still flushes. `SIGKILL` does neither, and the whole claim
 * depends on the difference.
 *
 * Not run directly — `bun run lesson-34` drives it.
 *
 *   RUN_ID=<id>          which invocation to work on
 *   KEY_MODE=stable|unstable
 *   PROVIDER=dedupes|ignores
 *   CRASH_BEFORE_JOURNAL=<step name>   die after the effect, before it is written down
 */

import { charge, type ProviderMode, RUN_DIR } from "./provider.ts";
import { type Context, type Handler, invoke, InvocationStore, type KeyMode, newInvocation } from "./durable.ts";

const runId = process.env.RUN_ID;
if (!runId) throw new Error("RUN_ID is required");

const keyMode = (process.env.KEY_MODE ?? "stable") as KeyMode;
const providerMode = (process.env.PROVIDER_MODE ?? "dedupes") as ProviderMode;
const crashBefore = process.env.CRASH_BEFORE_JOURNAL;

const AMOUNT_CENTS = 4999;

/**
 * The handler, written exactly as Restate's `workflow-sequential.ts` writes one:
 * a plain async function whose side effects are wrapped in `ctx.run`.
 *
 * Read it as ordinary code. The durability is entirely in `ctx.run` and
 * `ctx.rand`, which is the point — Lesson 33 had to restructure the loop into a
 * step list to get resumability, and this does not.
 */
const handler: Handler = async (ctx: Context) => {
	const validated = await ctx.run("validate claim", () => ({ refundable: true, amountCents: AMOUNT_CENTS }));
	if (!validated.refundable) return { refunded: false };

	// The key is generated INSIDE the handler, on the replayed code path. That is
	// the only reason its stability is interesting: an unstable one is re-rolled
	// on every attempt, and the provider then sees two unrelated requests.
	const idempotencyKey = ctx.rand.uuidv4();

	const result = await ctx.run("process payment", () =>
		charge(runId, idempotencyKey, validated.amountCents, providerMode),
	);

	const receipt = await ctx.run("send receipt", () => ({ sentTo: "customer@example.invalid" }));
	return { refunded: true, chargeId: result.chargeId, receipt };
};

const store = new InvocationStore(RUN_DIR);
const invocation = store.load(runId) ?? newInvocation(runId);

const final = await invoke(handler, invocation, store, keyMode, {
	beforeJournal(name) {
		if (name === crashBefore) {
			console.log(`[worker ${process.pid}] did "${name}", journal not yet written — SIGKILL to self`);
			process.kill(process.pid, "SIGKILL");
			throw new Error("killed");
		}
	},
});

console.log(`[worker ${process.pid}] attempt finished with status=${final.status}`);
