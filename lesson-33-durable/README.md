# Lesson 33: The Loop Is Not a Loop, It Is a Serialisable State Machine

> [繁體中文](README.zh-TW.md)
>
> Fourth lesson of the Mastra part. Prerequisites:
> [Lesson 09](../lesson-09-unattended/), [Lesson 28](../lesson-28-consistency/),
> [Lesson 32](../lesson-32-tool-search/).
>
> Source: `mastra/packages/core/src/workflows/` — `state-reader.ts` (118 lines),
> `handlers/control-flow.ts` (1378 lines) — and
> `agent/durable/durable-agent.ts` (2800 lines).

Lesson 09 taught the agent to stop and wait for a human. It works exactly as long
as the process lives, because the pause is a `Promise` parked inside a `while`.

This lesson asks the question that breaks it:

> The approval arrives at 9am. The process died at 3am. Where was the run?

```bash
bun run lesson-33
```

Every scenario below really spawns a child process and really sends it `SIGKILL`.
A crash you simulate with `throw` is not a crash — `finally` still runs, buffers
still flush, and you can still tidy up. None of that is available when the kernel
takes the process away, and the whole lesson lives in that difference.

## The pipeline

```text
charge_card  →  await_approval  →  send_receipt
   money           a human            an email
```

The side effect is deliberately one where doing it twice is not a rounding error.
The measurement is a single number: **how many times was the card charged?** It is
counted from an append-only ledger file rather than a variable, because the
process being measured is the one that dies — Lesson 29's rule about evidence
coming from outside the thing making the claim, applied to the instrumentation.

## Step 1: why a `while` loop cannot be resumed

The state of every loop in Lessons 1 to 32 lives in the JavaScript stack: which
iteration, which locals, where the `await` is parked. **None of that is
addressable.** You cannot serialise a stack frame, hand it to another machine, or
find it again after the process is gone.

Replace it with a structure where the run's position is a *value*:

```json
{
  "runId": "durable",
  "status": "suspended",
  "steps": {
    "charge_card":    { "status": "success",   "output": { "capturedCents": 4999 } },
    "await_approval": { "status": "suspended", "suspendPayload": { "question": "..." } }
  }
}
```

That is JSON. Write it to disk and the run outlives `kill -9`; read it back
somewhere else and the run continues there.

Mastra's `state-reader.ts` is this idea in its purest form: a set of *pure
functions over the serialised state* — `getStatus`, `getStepOutput`,
`getSuspendedStep`. A dashboard, an approval screen and a resuming worker all
need to know where a run is, and **none of them is the process that started it.**

## Step 2: the mechanism off

```text
Scenario 1: mechanism off — nothing is written down
  attempt 1: charge the card, then the process is killed
  attempt 2: a supervisor restarts the work
  charges: 2   state on disk: none
```

There is nowhere to look up what already happened, so the only thing a restart
can do is start. This is not a strawman: it is exactly Lesson 09's inbox with the
process killed, and "the supervisor restarts failed work" is what every process
manager does by default.

## Step 3: the mechanism on

```text
Scenario 2: mechanism on — the run's position is a file
  after the kill: status=running completed=[charge_card]
  now suspended at: await_approval
  a human approves, from a third process
  final: status=success  attempts=3  charges: 1  emails: 1
```

Three processes moved one run forward and none of them shared memory. The whole
mechanism is one line in `advance()`:

```ts
if (previous?.status === "success") continue;
```

A step the journal says completed is **skipped**. Not re-run, not re-checked —
skipped. That `continue` is the difference between charging a card once and
charging it twice.

Two details in the store that are not decoration:

- **write to a temporary file and `rename`.** A process killed during
  `writeFileSync` leaves a truncated file, and a truncated journal is worse than a
  stale one: it makes the run unreadable rather than merely out of date. Rename
  within a filesystem is atomic, so a reader sees either the whole old state or
  the whole new one. Lesson 28 reached the same conclusion about session writes,
  and it is worth noticing that this problem recurs at every layer that persists
  anything.
- **write the step record *before* running the step**, not after. It costs a
  second write per step and buys the only thing that makes a crash diagnosable.

## Step 4: what the second write buys, and what it does not

```text
Scenario 3: mechanism on, crash between the effect and the journal
  after the kill: completed=[] in-flight=[charge_card]
  charges: 2
```

Durability did not help, and this is not a bug in the implementation.

The step record says `startedAt` with no `endedAt`, so the resuming process knows
**the step was interrupted**. It does not know **whether the money moved**. Those
are different facts and the journal only ever had access to the first one. Between
"the payment provider committed" and "we wrote down that it committed" there is a
window, and no amount of journalling closes it, because the journal is not the
same system as the payment provider.

Without the write-before-running from Step 3, it is worse still: an interrupted
step is indistinguishable from one that never began, and the restart does not even
have a question to ask.

## Step 5: there are exactly two ways to be wrong

```text
Scenario 4: same crash, but the resume refuses to replay
  charges: 1   status: failed
    interrupted mid-step; a human must decide whether charge_card took effect
```

| policy | on an interrupted step | what you get |
|---|---|---|
| `replay` | run it again | at-least-once. The card may be charged twice |
| `halt` | stop, ask a human | at-most-once. Nothing runs twice, nothing finishes |

Scenario 4 is not a better answer than Scenario 3. It is the opposite trade, and
which one you want depends on the step: replaying `send_receipt` sends a duplicate
email, replaying `charge_card` takes money that is not yours.

So this is a parameter in `advance()` rather than a default buried in the engine:

```ts
export type InterruptedPolicy = "replay" | "halt";
```

Full results:

| scenario | charges | emails |
|---|---|---|
| naive, crash after charge | 2 | 0 |
| durable, crash after charge | 1 | 1 |
| durable, crash before journal | 2 | 0 |
| durable, halt on interrupted | 1 | 0 |

Only one row has both numbers right, and it is the row where the crash happened
to land somewhere the journal could see.

## Step 6: what actually fixes it is not in this lesson

Neither policy gives exactly-once, and no fifth policy does either. That is not a
gap in the design; it is the well-known result that two systems cannot agree with
one round trip. What changes the answer is a **different contract with the system
on the other side**:

- an idempotency key the provider deduplicates on, so replay is safe by
  construction
- a durable execution runtime that journals the *intent* before the call and
  reconciles afterwards

That second one is Lesson 34 (Restate), and this lesson exists partly to make it
unavoidable: you cannot appreciate what durable execution buys until you have
watched a perfectly good journal fail to answer the only question that mattered.

## What this lesson deliberately leaves out

| Left out | Why |
|---|---|
| branches, loops, parallel and nested steps | Mastra's `handlers/control-flow.ts` is 1378 lines for exactly this; a linear sequence is the smallest shape that still shows the property |
| the `inngest` and `temporal` adapters | that is "how to connect to a durable execution service", not "why durability is needed" |
| retries and backoff | orthogonal, and it would blur what the charge count is measuring |
| rewriting `runTurn` | design principle 6 — this changes the loop's shape, so like Lesson 24 it is built beside the old loop and touches nothing |
| putting a model in the loop | the thesis is a deterministic property of a crash, and a model would only add noise to a verdict that is already binary |

## The contract test

```bash
bun test tests/durable.test.ts
```

No API key, no child processes — the crash lives in the demo, the invariants live
here: a completed step is never re-run, a suspended step blocks the ones after it,
the state survives a JSON round trip unchanged, the atomic write leaves no `.tmp`
behind, and the two interrupted-step policies do what they say.

## Exercises

### Exercise 1: add an idempotency key ⭐

Give `charge_card` a key derived from `runId + stepId` and have the ledger refuse
a duplicate. Re-run scenario 3. You have now moved the problem, not solved it —
work out where it moved to, and what the ledger would have to be for it to be
solved.

### Exercise 2: crash during the resume ⭐⭐

`CRASH_AT=send_receipt` after approval. Does the human have to approve again?
Should they? The answer is in whether `resumeData` is part of the journal or part
of the request.

### Exercise 3: two workers, one run ⭐⭐

Start two workers on the same `RUN_ID` at once. The store has no locking, so both
will charge the card. Add the smallest thing that stops it and name what you have
just built.

### Exercise 4: put the agent loop inside ⭐⭐⭐

Make each model call a step, with the assistant message as the step's output.
Suspend on a tool that needs approval. You now have Lesson 09's inbox with
Lesson 33's durability — and a new problem, which is that a model's response is
not deterministic, so a replayed step does not produce what the journal says it
produced.
