# Lesson 28: After an Interruption, the Session Must Not Lie

> [繁體中文](README.zh-TW.md)
>
> Second lesson of the OpenCode part. Prerequisites:
> [Lesson 3](../lesson-03-streaming/) (streaming and interruption),
> [Lesson 4](../lesson-04-sessions/) (session persistence).
> Reading [Lesson 29](../lesson-29-evidence/) first helps (it is the simpler
> version of the same problem), but this lesson does not depend on its code.
>
> Source: `opencode/packages/opencode/src/session/processor.ts` (718 lines),
> `packages/schema/src/session-message.ts`

```bash
bun run lesson-28                        # six interruption points × cleanup or not (no key needed)
bun run lesson-28 tool_input             # one cell in detail
CLEANUP=off bun run lesson-28 tool_running

PROVIDER=gemini bun run lesson-28:agent                 # interrupt a real stream
INTERRUPT=tool PROVIDER=gemini bun run lesson-28:agent
```

## Questions this lesson answers

1. Lesson 3's interruption already stops the stream — what is still missing?
2. At the moment of interruption, how many things are unfinished at once?
3. What does a tool that is "still running" become once it is on disk?
4. How do you **reliably** interrupt a stream at a specified point?

---

## Step 0: what Lesson 3 stopped was the stream, not the session

The interruption Lesson 3 taught is `SIGINT` → `AbortController` → the provider
stops reading → emit `{ type: "error", aborted: true }`. That lesson's conclusion
was "an error is an event, not a throw, because you need a chance to save what you
already have".

That conclusion is right, and that lesson used only half of it. The provider
stopping does not make the session consistent, because at the moment of
interruption there may simultaneously be:

```
reasoning is streaming        a part with no end time
text is streaming             the user has already seen half a sentence
one or more tools are running nobody will move them to the next state
tool arguments half received  a chunk of JSON that will not parse
the file changed, the patch is not computed yet   an unrecorded change
the session is still busy     the next load will treat it as still running
```

None of those throws. This is the most concentrated appearance of design
principle 7.

---

## Step 1: how to interrupt a stream reliably

The first thing to solve here is not the cleanup logic but the **apparatus**.
Both intuitive approaches fail:

| Approach | Why it fails |
|---|---|
| `setTimeout(() => abort(), 30)` | which two events those 30ms land between is **luck**. The same test interrupts during reasoning today and during a tool tomorrow, and you will not know it changed |
| actually pressing Ctrl-C | even less controllable, and impossible to write as a test |

`fake-provider.ts`'s approach is **having the stream abort itself at a named
point**:

```ts
const stop = (at: InterruptPoint) => {
  if (point !== at) return false
  controller.abort()
  return true
}

yield { type: "reasoning_delta", ... }
if (stop("reasoning")) return      // ← the interruption point becomes a parameter
yield { type: "reasoning_end", ... }
```

`return` rather than continuing to yield, because that is what a real provider
does: `text_end` and `step_finish` are never coming. Cleanup has to exist
precisely because nobody will emit the finishing events for you.

> For any timing-caused bug, build an apparatus that can specify the timing before
> starting to fix it. This is the third appearance of that rule in the series:
> Lesson 18's fake clock, Lesson 29's `CAPTURE` points, and now interruption
> points.

---

## Step 2: a tool call is a lifecycle, not a function call

opencode's `ToolState` is four types each carrying different fields
(`schema/src/session-message.ts:81-119`):

```ts
pending    { status: "pending";   input: string }              // ⚠️ string
running    { status: "running";   input: Record<...> }
completed  { status: "completed"; input; output }
error      { status: "error";     input; error; interrupted? }
```

`pending.input` being a string rather than an object is the single most worth
copying cell of the whole type. It states a fact at the type level: tool arguments
arrive character by character, and interrupting midway leaves **half a JSON
document**:

```
{"path":"src/a.ts","content        ← will not parse
```

Represent all four states with one `input?: Record` and that fact disappears — and
on the day it disappears you get a `JSON.parse` exception, or worse, an empty
object.

Two smaller details are equally "without it, two situations become
indistinguishable":

- **three timestamps** (`created` / `ran` / `completed`,
  `session-message.ts:132-137`). Without the middle one, "the arguments have not
  finished arriving" and "it is taking a long time" become indistinguishable — two
  completely different kinds of stuck
- **`interrupted: true`** (`processor.ts:589`). Being interrupted and the tool
  breaking are both `error`, but downstream needs to tell them apart: **a broken
  tool is worth retrying, a user interruption is not**

---

## Step 3: the matrix

```bash
bun run lesson-28
```

```
interruption point    CLEANUP=on   CLEANUP=off
reasoning             clean        unfinished-span, message-never-completed
tool_input            clean        in-flight-in-storage, message-never-completed
tool_running          clean        in-flight-in-storage, unfinished-span,
                                   message-never-completed, unrecorded-patch
tool_finishing        clean        (as above)
text                  clean        unfinished-span, message-never-completed,
                                   unrecorded-patch
before_step_finish    clean        message-never-completed, unrecorded-patch
none (no interruption) clean       message-never-completed
```

The verdict comes from five rules in `audit.ts`, run **against the saved file**
(save → reload → audit), because the whole point of interruption is whether what
is left behind can be trusted once the process is gone.

| Rule | What it guards against |
|---|---|
| `in-flight-in-storage` | storage contains pending / running → the spinner on screen turns until the end of the universe |
| `unfinished-span` | created without completed → duration cannot be computed, and nobody knows if it is alive |
| `message-never-completed` | the reloaded session is treated as still running |
| `terminal-without-result` | "changing it to error counts as handling it", but no content means no message |
| `unrecorded-patch` | the filesystem says it changed, the session says it did not (→ Lesson 29) |

### The last row, `none`, is worth a look

No interruption, a normal complete run, and CLEANUP=off is still broken. Because
"mark the message finished" is one of cleanup's jobs in the first place. Cleanup is
not "a remedy for interruption"; it is **something every turn must do**, and
interruption only makes it visible.

### The `tool_finishing` cell: why a grace window

opencode gives a tool 250ms before giving up on it (`processor.ts:573`):

```ts
Deferred.await(call.done).pipe(Effect.timeout("250 millis"), Effect.ignore)
```

That cell's tool comes back after 20ms, so it is recorded as **completed, not
interrupted**.

> That window is not for performance but for **correctness**.
> Without it, a tool that actually succeeded gets recorded as interrupted — the
> record would state something that did not happen.

---

## Step 4: cleanup's five jobs, in a meaningful order

```ts
async cleanup(reason) {
  1. tools still running → wait (to the end on a normal finish; a grace window on an interruption)
  2. the ones that did not make it → error + interrupted, not left running
  3. unfinished reasoning / text → fill in an end time and keep the content
  4. compute the patch anyway — an interrupted turn can still have changed files
  5. close the message off (completed + finish)
}
```

Step 3's "keep the content" is not thrift but consistency: **half an answer is
something the user has already seen**, and discarding it makes the screen and the
record disagree.

Step 4 corresponds to `processor.ts:539-552`: opencode's cleanup computes patches
too. That is the seam between that lesson (29) and this one — an interruption must
not become a hole through which records vanish.

### A path only the real model found

The first version applied the 250ms grace window to every case. Then on one real
model run, **the model called a tool without emitting text first**, so the stream
finished normally, went into `cleanup("end")` with that tool still running, the
250ms elapsed, and it was marked `interrupted` — **with `finish` being `"end"`**.

```
finish=end
tool write_file [error (interrupted)] Tool execution interrupted
```

A self-contradictory record, with no error anywhere.

> The grace window belongs to the interruption path only. On a normal finish, "the
> tool has not come back" is not an anomaly, only not-yet-done — so wait for it.
>
> And why it was caught is worth recording: that path was never designed; the
> model walked it. Every cell of the scripted six-case matrix is a situation
> somebody imagined, and the real model went through the one nobody did.
> `tests/consistency.test.ts` now has a case guarding it.

---

## Step 5: the real model can only reproduce two of the six cells

```bash
PROVIDER=gemini bun run lesson-28:agent                 # interrupt during text
INTERRUPT=tool PROVIDER=gemini bun run lesson-28:agent  # interrupt during tool execution
```

**And the reason the other four are missing is in our own abstraction:**

| Interruption point | Real model | Why |
|---|---|---|
| `text` | | there is a `text_delta` event |
| `tool_running` | | the tool is executed by us |
| `reasoning` | | `shared/streaming` has no reasoning stream events |
| `tool_input` | | `tool_call` is **emitted only once the arguments are complete** |

The last row cites the deliberate simplification at
`shared/streaming/types.ts:44-51` directly:

> Note that this is emitted only **after** the arguments are fully received.
> Some providers stream tool arguments token by token, but half a JSON object is
> useless to a UI, so we wait for it to be complete.

That decision is right for Lessons 3-27. But it makes "interrupted mid-arguments"
**unrepresentable in the type system**.

> **A good abstraction hides what you do not need;
> you only discover what it hid on the day you need it.**
>
> This is not an argument for exposing every provider event. It is a reminder:
> your event model determines which failures you can observe.

### Measured with a real model (Gemini 3.6 Flash)

**Interrupted during tool execution:**

```
→ write_file {"path":"a.ts","content":"export const A = 2;\n"}
interrupted after the tool started running

CLEANUP=on                                    CLEANUP=off
tool write_file [error (interrupted)]         tool write_file [running]
finish=interrupted                            finish=(none)
filesystem: a.ts changed                      filesystem: a.ts changed
audit: no violations                          audit: 4 violations
```

The four in the `CLEANUP=off` column: `in-flight-in-storage`,
`unfinished-span`, `message-never-completed`, and **`unrecorded-patch`** — the
last being the valuable one: the file really changed, and the record does not say
so.

**Interrupted during text output** (after the second delta):

```
CLEANUP=on   text "I am going to use the `write_file` tool to rewrite `a.ts`,"  finish=interrupted  audit clean
CLEANUP=off  text "I will read and update the contents of `a.ts`, changing the constant from 1 to"…  finish=(none)  2 violations
```

The half sentence **is kept**, which is precisely what the user saw on screen.

One unanticipated detail in passing: `AFTER_DELTAS` was 4 in the first version,
and Gemini finished that sentence in two or three chunks, so **the interruption
never happened**. Delta granularity is not yours to control — another instance of
"a negative result must first prove the test can discriminate".

---

## What this lesson deliberately leaves out

| Left out | Why |
|---|---|
| introducing 13 kinds of stream event | this lesson's criterion is that matrix, not an event list. **This is the lesson's biggest risk**, written down in advance in `docs/TODO.md` |
| computing a real git diff | `diff()` is a parameter. "How do you know a file really changed" is [Lesson 29](../lesson-29-evidence/)'s subject, and its `snapshot.patch()` is the real version |
| how to **resume** after an interruption | that is Lesson 33 (serialisable state machines). This lesson only cares whether the record left behind is honest |
| multi-turn / multi-message sessions | one turn suffices to show all six cells. A session tree would only blur the matrix |
| retrying an interrupted tool | **deliberately not done**: whether an `interrupted` tool deserves a retry is decided by the nature of the job (Lesson 18's `unknown`, Lesson 34's idempotency) |

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| every cell audits clean | check `CLEANUP` is really off. `bun run lesson-28` runs both columns together so the difference shows |
| `INTERRUPT=text` did not interrupt | the model emitted no text first (or too few deltas). The program warns; set `AFTER_DELTAS=1` or use `INTERRUPT=tool` |
| a tool marked interrupted when it actually succeeded | the grace window is too short, or you applied it on the normal-finish path (Step 4's bug) |
| half a JSON document crashes the program | do not parse `pending.input`. It is a string, and **deliberately** a string |

---

## Exercises

### Exercise 1: add a sixth rule ⭐

`finish === "interrupted"` while every tool is `completed` — is that legal? (Hint:
the grace window.) Decide whether it is a violation before deciding whether to
write the rule.

The point of this exercise: not everything that looks odd is wrong.

### Exercise 2: wire reasoning streaming into the provider ⭐⭐

`shared/streaming/anthropic.ts` already handles thinking blocks. Add a set of
`reasoning_*` events, and the third cell becomes measurable.

Doing it brings a decision: should reasoning be stored in the session? Storing it
bloats the session and it may be rejected when sent back on the next round; not
storing it means an interrupted turn loses something the user saw.

### Exercise 3: multi-turn sessions ⭐⭐

The audit currently covers one message. Change it to the whole session file, then
add a rule: only one message may be unfinished at a time.

A session with two unfinished messages is almost certainly a bug — work out why.

### Exercise 4: wire up a real patch ⭐⭐

Replace `diff()` with Lesson 29's `Snapshot`. Once done, `unrecorded-patch` goes
from "a demonstration" to "a real measurement".

You will also discover something: **the snapshot has to be taken before the stream
starts** (Lesson 29 Step 4), so these two lessons' cleanup is really two halves of
the same code.

---

## Compared with the source

| Concept in this lesson | OpenCode |
|---|---|
| four tool states, `pending.input` a string | `packages/schema/src/session-message.ts:81-119` |
| a tool's three timestamps | `session-message.ts:132-137` |
| reasoning's `completed` is optional | `session-message.ts:153-156` |
| a message's `time.completed` is optional | `session-message.ts:185-188` |
| `cleanup()`'s five jobs | `session/processor.ts:539-595` |
| 250ms of grace for a running tool | `session/processor.ts:573` |
| tools that cannot be cleared get `interrupted: true` | `session/processor.ts:589` |
| patches are computed on interruption too | `session/processor.ts:540-552` |
| finishing the message | `session/processor.ts:595` |

> There is one more piece of opencode not copied here: `message-v2.ts:349-357`
> converts `pending`/`running` tools into `output-error` **before sending them back
> to the provider**, with the comment giving the reason as "Anthropic/Claude APIs
> require every tool_use to have a corresponding tool_result" — precisely the hard
> rule from Lesson 3.
>
> So the same problem has three locations: **storage must not lie, the screen must
> not lie, and the history sent back to the model must not lie either.** Miss the
> third and the symptom is not an inconsistent record but a 400 on the next round.

---

## Next lesson

In reading order, the evidence thread continues with
[Lesson 37](../lesson-37-trajectory/) (the action/observation trajectory). This
lesson gave parts a lifecycle; 37 goes one step further and **writes "who said it"
into the type** (an observation's source is always `"environment"`).

29 attacks it through measurement, 28 through lifecycles and 37 through data
structures. All three are about one thing: a record must not be more optimistic
than the facts.
