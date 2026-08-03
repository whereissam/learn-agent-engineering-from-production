# Lesson 19: Handing Work Off, and What It Can See

> [繁體中文](README.zh-TW.md)
>
> Last lesson of the Hermes part. Prerequisites:
> [Lesson 5](../lesson-05-compaction/) (context compaction),
> [Lesson 9](../lesson-09-unattended/) (approval),
> [Lesson 18](../lesson-18-scheduling/) (unattended running).
>
> Source: `hermes-agent/tools/delegate_tool.py` (3697 lines),
> `tools/async_delegation.py` (1069 lines). CrewAI serves as a second reference
> (see the end).

```bash
bun run lesson-19                      # all four mechanisms, no key needed
BLOCK=off bun run lesson-19 blocklist  # recursive delegation
APPROVE=auto bun run lesson-19 approval

PROVIDER=gemini bun run lesson-19:agent                # one agent doing three things
MODE=delegate PROVIDER=gemini bun run lesson-19:agent  # three agents doing one each
```

## Questions this lesson answers

1. What can a subagent see? What can it not see?
2. What is a subagent **absolutely not allowed** to do, and why?
3. When a subagent needs approval, who does it ask?
4. Do more agents make it smarter?

---

## Step 0: write the prediction down first

This lesson comes with a ready-made trap: multi-agent demos **look**
impressive (three roles talking to each other, dividing work, consolidating),
and "looks impressive" is not "works better".

So following Lesson 7's method, **write the prediction before running**
(`docs/TODO.md`'s exact words):

> Multi-agent is not smarter; it makes state boundaries explicit. Without a
> genuine isolation requirement it only adds communication cost.

The measurements are in Step 5. **Both halves of that turned out wrong** — but
not at the same time, and the order in which they failed is the point.

---

## Step 1: delegation is an information boundary

The top of Hermes's `delegate_tool.py` states the whole contract:

> Each child gets:
> - A fresh conversation (no parent history)
> - Its own task_id (own terminal session, file ops cache)
> - The parent's toolsets, with child-only blocked tools stripped
> - A focused system prompt built from the delegated goal + context
>
> **The parent's context only sees the delegation call and the summary
> result, never the child's intermediate tool calls or reasoning.**

```bash
bun run lesson-19 isolation
```

```
the parent agent's conversation:
  │ user: our staging environment has been throwing E-118 since last week.
  │ user: oh, and **the staging data is fake, do not draw conclusions from it**.
  │ assistant: understood, let me look at logs/.

the subagent's entire context:
  │ count the most frequent error code in logs/inventory.log
  │ Context: The file is under the workspace.

did "the staging data is fake" cross over: no
```

> One mechanism is both the feature and the bug, depending on whether that
> sentence mattered. The parent's context does not get flooded by the child's
> ten tool calls (the feature), but the child also does not know the data is
> fake (the bug).
>
> What goes into the `context` argument is the parent's decision, and the parent
> frequently forgets.

Which is why delegation is not "more brains". It is a boundary, and both sides
pay for it.

---

## Step 2: five prohibitions, five different reasons

The blocklist at `delegate_tool.py:46-54`, comments copied along with it:

```python
DELEGATE_BLOCKED_TOOLS = frozenset([
    "delegate_task",  # no recursive delegation
    "clarify",        # no user interaction
    "memory",         # no writes to shared MEMORY.md
    "send_message",   # no cross-platform side effects
    "cronjob",        # no scheduling more work in the parent's name
])
```

Five lines look like five examples of one rule. They are not.

| Tool | What it blocks |
|---|---|
| `delegate_task` | **resources**: it expands exponentially |
| `clarify` | **the channel**: there is no user on the child's side at all |
| `memory` | **shared state**: if anyone can write it, the isolation is fake |
| `send_message` | **external side effects**: unrecallable, and the parent does not know |
| `cronjob` | **identity**: scheduling future work in the parent's name |

The last one is the easiest to miss, because it is not about what happens now
but **whose name something later happens under**.

> It also connects straight back to [Lesson 18](../lesson-18-scheduling/): that
> lesson's guard blocks **the content of a job** (would it kill the daemon),
> and this blocklist blocks **who is entitled to schedule jobs**. Neither is
> sufficient alone; drop either and there is a hole.

### With it turned off

```bash
bun run lesson-19 blocklist              # 1 subagent
BLOCK=off bun run lesson-19 blocklist    # 15 of them
```

Two per level with a depth cap of 4 gives 15. **Reality has no depth cap**; the
cap is your API quota or your wallet, and the parent only sees the top level's
summary — it does not know what happened below, or how much it cost.

### And absent from the list is not the same as never called

The blocklist removes tools from the **tool list**, so normally the model cannot
call them. But `runChild` keeps a second check anyway, because **models call
tools they were never given** — in Lesson 20 the model searched for a project
name that did not exist anywhere in the corpus, which is the same behaviour.
`tests/delegation.test.ts` has a case guarding this.

---

## Step 3: when a subagent needs approval, who does it ask

```bash
bun run lesson-19 approval                 # the default: deny
APPROVE=auto bun run lesson-19 approval    # the file gets written
```

Hermes's default is **automatic denial**, and the reason has two layers
(`delegate_tool.py:60-76`):

```
safety    nobody watches a subagent's actions, so it should have no irreversible side effects
liveness  a subagent runs in a worker thread with no interactive approval callback;
          falling back to input() fights the parent's TUI for stdin — deadlock
```

> The second layer is why this comment is worth copying. "Subagents should not
> have side effects" is a policy you can argue with; "not doing this deadlocks"
> is a fact.
>
> A safe default that also solves a liveness problem does not get removed when
> somebody is in a hurry.

Hermes has `delegation.subagent_auto_approve` to turn it on, and the comment
says `opt-in YOLO for cron/batch` — honestly labelled as what it is.

---

## Step 4: when it breaks, can you tell which step

```bash
bun run lesson-19 locate
```

```
the truth (recorded by the demo)      the tool result the parent received:
  count checkout's error codes    tool ok      The most common one is E-400.
  count inventory's error codes   tool failed  The most common one is E-118.   ← the file could not be read at all
  count notify's error codes      tool ok      The most common one is E-402.
```

Delegation **simultaneously** improves and degrades observability:

| | Delegated | Single agent |
|---|---|---|
| "which step broke" | ✓ every subtask has a name | ✗ the error is scattered through a long chain of tool calls |
| "did anything break" | ✗ **a natural-language summary sits in between** | ✓ the tool result is right there in context |

> A summary is not evidence. This is [Lesson 29](../lesson-29-evidence/)'s
> conclusion in its delegation form: a child's summary and an assistant's
> self-report are the same kind of thing — generated by a model, looking very
> much like a conclusion, with nothing guaranteeing it corresponds to what
> happened.
>
> The fix is structural in the same way: return the child's tool-result counts
> (how many succeeded, how many failed) **alongside** the summary, not the
> summary alone.

---

## Step 5: measured — one agent doing three things vs three agents doing one each

```bash
PROVIDER=gemini bun run lesson-19:agent
MODE=delegate PROVIDER=gemini bun run lesson-19:agent
```

Same question (the most frequent error code in each of three services), same
corpus, same model. The verdict is entirely deterministic: `includes()` against
the three error codes, plus the caveat about the "old numbering scheme".

**Real Gemini 3.6 Flash, three runs each:**

| | Model calls | Subagents | Tokens (total) | Error codes | Caveat |
|---|---|---|---|---|---|
| solo | 7 / 6 / 6 | 0 | 14,654 / 9,509 / 11,912 | 3/3 3/3 3/3 | yes yes yes |
| delegate | 12 / 10 / 13 | 3 | 13,265 / 13,763 / 17,664 | 3/3 3/3 3/3 | yes yes **no** |

### What delegation costs you, and it is not tokens

Look at the last column before any of the others.

In one delegate run of three, the parent's answer came back **without** the line
saying "codes before 2026-07-14 use the old numbering scheme" — a caveat planted
three lines into `logs/inventory.log` and tagged `NOTE:`. The parent wrote a
confident, well-cited, wrong-in-one-respect answer.

```
solo       caveat present 3/3      the parent read the file itself
delegate   caveat present 2/3      the parent read a summary of the file
```

Nothing failed. No tool errored, no subagent crashed, no step was skipped. The
summary was accurate about everything it mentioned; the caveat simply was not
one of the things it mentioned. **And the parent has no way to know**, because
by construction the parent never sees the child's intermediate work — that is
Step 1's information boundary, working exactly as designed.

The per-subagent breakdown the program prints makes the loss concrete, and it is
not random which child drops it:

```
run 1 · sub 2 (inventory)  yes      ← the one whose log carries the caveat
run 2 · sub 2 (inventory)  yes
run 3 · sub 2 (inventory)  yes
```

Even in run 3, where the final answer lost the caveat, **the subagent's own
summary still contained it**. So the loss happened one layer further up: at the
parent, folding three summaries into one answer. There are two lossy summary
layers here, not one, and the failure moved between them across runs.

> A summary is lossy, and **which** part it loses is decided by a model, per
> run, silently. That is not a bug in the summary layer. It is what a summary
> layer *is*.
>
> Same conclusion as [Lesson 29](../lesson-29-evidence/) reached about a model's
> self-report, arriving here in delegation's clothing: **a summary is not
> evidence.**

This is the finding that survived re-measurement, and it is the one to design
against. Everything below is why it took a second measurement to see it.

### The cost argument, which no longer carries the lesson

```
accuracy   identical (3/3 vs 3/3)
cost       1.24x the tokens, 1.84x the model calls
```

That number has now been measured three times, on **unchanged code and the same
question**:

| Measured | Tokens | Model calls | Caveat lost |
|---|---|---|---|
| when the lesson was written | **3.9x** | 3.9x | 0 of 3 |
| re-measured five days later | **1.07x** | 1.6x | 1 of 3 |
| re-measured again | **1.24x** | 1.84x | 1 of 3 |

The first row's raw figures, for comparison — subagents used to re-explore far
more than they do now:

| | Model calls | Subagents | Tokens (total) |
|---|---|---|---|
| solo | 6 / 6 / 4 | 0 | 11,251 / 9,718 / 9,983 |
| delegate | 23 / 23 / 22 | 3 | 35,203 / 41,546 / 39,147 |

**The headline number this lesson was originally built around ranges over 3.6x
across three measurements of the same thing.** Meanwhile the caveat loss has
now reproduced twice at the same rate. That is the whole reason the caveat leads
this step and the cost does not:

> Between two findings, prefer the one that **re-measures the same**.
> Not because it is more interesting — the 3.9x was far more quotable — but
> because it is the only one you can still design against next month.

### The prediction was half right, then the halves swapped

> **The right half at the time**: multi-agent was not smarter, it only paid more
> communication cost — measured at **3.9x**, larger than the 1.5-2x guess.
>
> The wrong half at the time: the caveat was predicted to be dropped at the
> summary layer. It was not; it survived 3/3.

Both halves have since inverted. Neither number is a property of delegation;
both are properties of **delegation on this model this month**.

> That is the durable lesson here, and it is not about token counts:
> **the boundary is structural and the cost of the boundary is not.** A subagent
> can never see what the parent did not pass down — that is true on every model,
> forever. How much you pay for it, and how often it bites, is measured, not
> known.
>
> Same family of caution as Lesson 16's first round and Lesson 30's first round:
> a result you cannot re-measure is a story, not a finding (proposed
> principle 10).

### Where the 3.9x came from, and why it is still worth reading

The number is gone; the mechanism behind it is not, and it is the one that
decides whether delegation pays off for *your* task. The trace from the
expensive round says it: **every subagent re-explored from scratch**.

```
→ delegate_task  "Analyze logs/notify.log …"
    ↳ read_file(logs/notify.log)      ← its own job
    ↳ list_files()
    ↳ read_file(package.json)
    ↳ read_file(logs/checkout.log)    ← somebody else's job
    ↳ read_file(logs/inventory.log)   ← somebody else's job
    ↳ list_files(logs)
  ← summary 901 chars, 6 tool calls
```

The parent had already run `list_files`, but that knowledge **does not cross the
boundary**. Every child has to work out where the files are by itself.

> What delegation saves is the parent's context; what it pays is every child's
> re-exploration. When the subtasks are small and independent, re-exploration
> costs **more** than it saves.
>
> Which also makes the conditions for delegation paying off clear: **the
> subtask must be big enough** (so exploration is a small fraction), **its
> intermediate process must be messy enough** (otherwise there is nothing to
> save), and **its summary must genuinely be much shorter than the original**.
> When none of those hold, you have merely split one thing into four
> conversations.

### This is not "do not use multi-agent"

When isolation is genuinely required (different permissions, different models,
different tool sets, mutually hostile inputs), that boundary is the thing you
want, and 3.9x is its price. This lesson's contribution is printing the price
tag, not telling you not to buy.

---

## What this lesson deliberately leaves out

| Left out | Why |
|---|---|
| running subagents in parallel | Hermes has it (ThreadPoolExecutor plus a batch mode). It makes wall-clock look better but **does not change token cost by a cent** — and token cost is what this lesson measures |
| role play (Researcher / Writer / Reviewer) | that is prompt design, not mechanism. What is worth studying in CrewAI is not the role names but how task dependencies are expressed |
| live streaming of a subagent | Hermes has `delegation_live_log.py` (424 lines, a per-entry log you can `tail -f`). Good thing, but it belongs to observability |
| subagents on a different model | very practical (cheap models for subtasks), but that is Lesson 26's cost question, not delegation's mechanism |
| how to do recursive delegation properly | it is simply forbidden here. Allowing it needs a depth budget plus a global token budget, which is Lesson 24's shape |

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| the subagent knows nothing | that is the design. To make it know, write it into the `context` argument |
| the subagent keeps saying "I need to ask the user" | `clarify` is blocked, and there really is nobody on its side. Put the information in `context` |
| delegate mode is not faster | this lesson runs sequentially (see "deliberately left out"). And parallel would not reduce tokens either |
| the caveat got dropped | that is the thing being measured. Look at the subagent-summary section of the output and **identify which layer dropped it** |
| `lesson-19:agent` demands PROVIDER | that program measures model behaviour and needs a key |

---

## Exercises

### Exercise 1: replace the summary with a structured report ⭐

Right now the child returns a paragraph of prose. Change it to
`{ summary, toolCalls: n, failures: n, filesRead: [...] }`, then re-run Step 4's
`locate`.

**This is Lesson 29's approach moved onto delegation**: do not ask the child
what happened, record what happened.

### Exercise 2: make information actually get lost ⭐⭐

Step 5's caveat survived because the task was too easy. Design one that will not:
bury the caveat mid-file, drop the `NOTE:` marker, or make it hold only when
**two files are cross-referenced** (for instance, checkout's E-402 and notify's
E-402 are actually the same batch of requests).

Write down which run you expect it to drop on before you run it.

### Exercise 3: parallel plus a budget ⭐⭐

Switch to `Promise.all` for the three subagents, then add a **global token
budget**: stop delegating once it is exceeded.

Doing it exposes an unanticipated problem: parallel children cannot know the
budget was already spent by someone else. This is Lesson 24's `Budget` in its
multi-agent form.

### Exercise 4: break the blocklist five ways ⭐⭐⭐

Remove one at a time and design an experiment proving why each is there:

| Removed | What to prove |
|---|---|
| `delegate_task` | exponential expansion (`BLOCK=off` already shows it; switch to measuring tokens) |
| `clarify` | the child hangs or deadlocks |
| `memory` | two children write at once and only one survives |
| `send_message` | the parent does not know the email went out |
| `cronjob` | the child scheduled a job that runs tomorrow under the parent's identity |

Finishing the last one loops back to Lesson 18: that job can be anything,
including one that restarts the daemon.

---

## Compared with the source

| Concept in this lesson | Hermes |
|---|---|
| the child's contract (fresh conversation / own task_id / summary return) | the docstring at `tools/delegate_tool.py:1-19` |
| the five forbidden tools | `tools/delegate_tool.py:46-54` |
| child approval defaults to denial, and the deadlock reason | `tools/delegate_tool.py:60-95` |
| per-entry streaming (`tail -f` a child) | `tools/delegation_live_log.py:113-139` |
| how a background fan-out notifies the parent on completion | `tools/process_registry.py:2131-2145` |
| delegated sessions stay out of cross-session search | `tools/session_search_tool.py:38-40` (`_HIDDEN_SESSION_SOURCES`) |

> That last row is small and exactly right: a child's session **should not**
> appear in [Lesson 17](../lesson-17-search/)'s cross-session search results.
> They are implementation details, not the user's conversation with you — mixing
> them in only floods the results. Same problem as Lesson 17's flood of cron
> summaries.

### CrewAI as a second reference

What is worth studying is not role names like Researcher / Writer / Reviewer but
three things: how task dependencies are expressed, when context should be
isolated, and what happens to the whole workflow when one agent fails. Step 5's
experiment was designed to answer the second.

---

## Next lesson

**The Hermes part is now complete**: 15 memory → 16 skills → 17 search →
18 scheduling → 19 delegation. Looking back, those five lessons answer five
facets of one question:

> How does a long-lived agent keep existing while you are not watching?

**In reading order**, next is the evidence thread:
[Lesson 29](../lesson-29-evidence/) → 28 → 37. This lesson's Step 4 already
gave its opening line — **a summary is not evidence**.
