# Lesson 34: Exactly-Once Is an Agreement, Not a Runtime Feature

> [繁體中文](README.zh-TW.md)
>
> Prerequisites: [Lesson 33](../lesson-33-durable/) — this lesson answers the
> question that one ends on. [Lesson 09](../lesson-09-unattended/) for approvals.
>
> Source: `restate-ai-examples/typescript-restate-only/tour-of-agents/src/`,
> particularly `workflow-sequential.ts`.

Lesson 33 ended holding a journal that knew a step had been interrupted and could
not say whether the money had moved. It offered two ways to be wrong — replay and
charge twice, or halt and never finish — and said a third thing was needed.

This is the third thing, and it is smaller and stranger than it sounds.

```bash
bun run lesson-34
```

## Step 1: a different shape of durability

Lesson 33 modelled a run as a **list of steps** and resumed by skipping the ones
marked `success`. Restate does not do that. It re-executes your handler **from
the top** on every attempt, and each `ctx.run` consults the journal first:

```ts
const amountUsd = await ctx.run("Convert currency", async () =>
  convertCurrency(output.amount, output.currency, "USD"),
)
```

First attempt: `convertCurrency` runs, the result is appended to the journal.
Every later attempt: the journaled value comes back and `convertCurrency` is
never called. **The code is replayed; the effects are not.**

The handler in `worker.ts` reads as ordinary async code — no step list, no state
machine. That is the trade: Lesson 33 restructured the loop to get resumability,
and this does not.

## Step 2: what replaying the code immediately breaks

If the handler runs from the top again, everything in it must produce what it
produced last time, or the replay diverges from the journal. `Date.now()` and
`Math.random()` do not. So the runtime hands you replacements, and Restate's line
is the one this whole lesson turns on:

```ts
const confirmation = await ctx.run("Process payment", async () =>
  processPayment(ctx.rand.uuidv4(), amountUsd),
)
```

`ctx.rand` is seeded from the invocation id. `uuidv4()` therefore returns **the
same value on every replay** — Restate's own guide names this use: stable UUIDs
for idempotency keys.

That is the sentence Lesson 33 was missing. It could not decide whether to replay
an interrupted payment because a replayed payment would be a *second* payment.
It is only a second payment if it carries a different identity.

## Step 3: the same crash, three ways

Every scenario kills the worker in the identical place — after the charge, before
the journal write. Only the key's stability and the provider's cooperation
change.

| scenario | billed | requests |
|---|---|---|
| unstable key, provider dedupes | 2 | 2 |
| **stable key, provider dedupes** | **1** | 2 |
| stable key, provider ignores it | 2 | 2 |

Read the `requests` column before the `billed` one. **It is 2 in every row.** The
crash is unchanged and the payment really did happen twice; two requests reached
the provider every time.

Durable execution did not close the window between the effect and the journal
write. Nothing can — the journal is not the same system as the payment provider,
which is exactly what Lesson 33 concluded. What changed in row 2 is that the
second request carried the same identity as the first:

```text
  pid 42543  BILLED   key=9c4c6573-5600…  ch_mp4p44j1
  pid 42544  deduped  key=9c4c6573-5600…  ch_mp4p44j1
```

Two requests, one charge, because the provider recognised the key and returned
the original charge instead of making a new one.

## Step 4: row 3 is not a bug

A stable idempotency key does nothing on its own. It is **a request to somebody
else to collapse duplicates**, and they have to agree. Against a provider that
ignores the key, a perfectly stable key still bills twice.

That is the boundary of the mechanism, and a lesson that only ran the cooperative
case would be teaching a guarantee that does not exist. Stripe's
`Idempotency-Key`, PayPal's `PayPal-Request-Id` and most payment rails honour
it. Plenty of internal services do not, and "we retry safely" is a claim about
*them*, not about your runtime.

So the thing durable execution actually buys is narrower than the marketing and
more useful than it sounds:

> It makes the retry *addressable*. Whether the address is honoured is somebody
> else's decision, and now it is a decision somebody can make.

## Step 5: where this leaves the three lessons

| lesson | question | answer |
|---|---|---|
| 09 | approval at 3am | an in-process inbox |
| 33 | the process died | the run's position is a value, so another process resumes it |
| 34 | the effect happened but was not recorded | the retry carries the same identity, and the other system decides |

None of them achieves exactly-once alone. Lesson 33 showed there are exactly two
ways to be wrong; this one does not add a third option, it changes who is asked.

## What this lesson deliberately leaves out

| Left out | Why |
|---|---|
| running a real `restate-server` | it needs a separate binary and a registered deployment. The TODO's design principle 1 says build the minimal journal yourself, as Lesson 12 built a 200-line MCP server |
| Restate's virtual objects and durable promises | real, and they answer concurrency and signalling rather than this lesson's question |
| retry policies and backoff | `maxRetryAttempts` appears in the source and is orthogonal — it changes how often you land in the window, never how wide it is |
| the LLM steps from the source example | the source wraps `generateText` in `ctx.run` too. A model call adds cost and non-determinism to an experiment whose verdict is a charge count |
| distributed transactions, sagas | the honest alternative when the other side will not dedupe, and a subject rather than a paragraph |

## The contract test

```bash
bun test tests/idempotency.test.ts
```

No API key. It pins that a journaled effect never runs twice, that the journal is
keyed by call order (the constraint that makes `ctx.rand` necessary), that a
stable key is stable across contexts and differs across invocations, that an
unstable one does not, and that effects journalled before a later failure survive
into the next attempt.

## Exercises

### Exercise 1: break the replay ⭐

Put a bare `Math.random()` in the handler outside any `ctx.run`, branch on it,
and run the demo. The journal and the code now disagree about what happened.
Decide what a runtime *should* do when it notices, then look up what Restate
does.

### Exercise 2: key the key ⭐⭐

`ctx.rand.uuidv4()` keys on invocation plus call position. Change it to derive
from the *business* identity — the charge id and amount — and work out which
retries that makes safe and which it makes dangerous. Both answers are real.

### Exercise 3: crash after the journal ⭐⭐

Move the crash to after the journal write and re-run all three rows. One row
changes and two do not. Explain why before you look.

### Exercise 4: give Lesson 33 the key ⭐⭐⭐

Take Lesson 33's step engine and add a stable key to `charge_card`. You can now
reach 1 charge with `replay` instead of `halt` — so write down what Lesson 33's
`InterruptedPolicy` is *for*, once idempotency exists. It still has a job; naming
it is the exercise.
