# Lesson 16: Skills and Self-Improvement

> [繁體中文](README.zh-TW.md)
>
> Prerequisites: [Lesson 15](../lesson-15-memory/) (long-term memory).
>
> Memory records facts; a skill records how. A procedure gets executed, so the
> consequences of poisoning are an order of magnitude worse.
>
> Source: `hermes-agent/agent/learn_prompt.py`, `agent/background_review.py`,
> `agent/skill_utils.py`, `agent/learning_mutations.py`

## Questions this lesson answers

1. How does a skill differ from a very long system prompt?
2. Why does Hermes limit a description to 60 characters?
3. Can an agent create its own skills? Should it?
4. If it should, how do you keep that from getting out of hand?

---

## Step 0: run it first

Five scenarios covering progressive disclosure, the review gate and the tool
allowlist. No API key needed:

```bash
bun run lesson-16
```

This lesson has a claim string comparison cannot verify, and it needs a real
model:

```bash
PROVIDER=gemini bun run lesson-16:route
```

That program measures whether the model can still find a skill once its
description is truncated. The result is in Step 2.5, and it does not entirely
match what Hermes's own text says.

---

## Step 1: progressive disclosure

A skill is not "paste everything into the system prompt". 20 skills eat the
context.

The approach is two layers:

```
index   one line per skill: name + description   ← loaded on every request
body    the full procedure                       ← loaded only when the model asks
```

Measured:

```
the "index" loaded on every request:
  - replay-fall-window: Replay a robot session around a detected fall.
  - compare-sessions: Compare two robot sessions field by field.

index cost: 275 characters, paid every turn
the body only loads when the model calls load_skill:
  16 lines, 540 characters (costing no context until called)
```

Therefore:

> A description is for routing, not for explaining.

The model decides whether to expand a skill on the strength of that one line.

### Keep an eye on the index cost

The number from `indexCost()` is a fixed cost paid on every request. 100 skills at 70
characters each is 7000 characters burning on every turn.

Same arithmetic as Lesson 5's context compaction: a fixed cost multiplied by
the number of turns.

---

## Step 2: the 60-character rule is not about aesthetics

Hermes's authoring standard is unusually fierce about this one:

> This is the most-violated rule and it is **NOT cosmetic**: the system-prompt
> skill index truncates the description to 60 chars and loads it every
> session, so anything past char 60 is silently cut and never routes.
> After you write the description, COUNT the characters.

Measured with an overlong description:

```
original description (129 characters):
  A comprehensive and powerful skill that seamlessly replays robot sessions
  around detected falls with advanced telemetry analysis.

what the model actually sees:
  - replay-fall-window: A comprehensive and powerful skill that seamlessly …
  ↑ everything past character 60 was cut, with no error message at all
```

The consequence: the model sees an unfinished piece of marketing copy, never
learns what the skill does, and therefore never calls it. And you get no error.

So there is an automatic check:

```
✗ description: 129 characters, over the 60 limit. The overflow is silently cut,
               and this skill may never be invoked.
! description: Contains marketing words (powerful, comprehensive, seamless, advanced).
               A description states capability, not quality.
```

> Hermes has another interesting rule: `author` is always the fixed value
> `Hermes`, never filled from an environment variable, git config or login
> name. The reason is that skills get shared, and a name derived from the
> environment is a privacy leak the user never agreed to.

---

## Step 2.5: is "never routes" true? (measured)

The sentence quoted in Step 2 is a claim about model behaviour:

> anything past char 60 is silently cut and **never routes**

`demo.ts` can only prove `truncate()` cut the string, not that the model
therefore cannot find it. So there is a second program, and it needs a real
model:

```bash
PROVIDER=gemini bun run lesson-16:route
```

The verdict is deterministic: did the model call
`load_skill("replay-fall-window")`. The question deliberately avoids words from
the skill's name:

> Robot R-204 fell over in the warehouse yesterday. I want to see the sensor
> values around the moment it went down.

### Round one: the claim did not reproduce

Real Gemini 3.6 Flash, three descriptions, three runs each:

| Description | Characters | Result |
|---|---|---|
| compliant | 46 | ✓✓✓ |
| marketing copy (60 chars leaves half a platitude) | 129 | ✓✓✓ |
| 60 chars leaves no clue about the topic | 201 | ✓✓✓ |

Nine out of nine. Routing succeeded with the description mangled.

The reason is not hard to guess: the name `replay-fall-window` says everything
by itself. The model never needed the description.

### But round one's experimental design was wrong

The four distractors were "compare sessions", "export PDF", "tune gait" and
"check battery", all obviously irrelevant. So the model could pick the only
not-obviously-wrong option by elimination, again without reading any
description.

> That is a confound: passing a test does not mean the mechanism works, it may
> mean the test was too easy.

So two things had to change:

1. replace the name with the semantically empty `sk-0472` (`NAME=opaque`)
2. replace every distractor with something also adjacent to falls and sensors
   (`DISTRACTORS=hard`): `session-timeline` / `sensor-dump` / `fall-detector` /
   `incident-summary`

### Round two: the claim is true, with conditions

```bash
NAME=opaque DISTRACTORS=hard DESC=bloated PROVIDER=gemini bun run lesson-16:route
```

The full matrix, three runs per cell, 30 live model runs:

| Name | Distractors | Compliant description | 129-char description | 201-char description |
|---|---|---|---|---|
| `replay-fall-window` | easy | ✓✓✓ | ✓✓✓ | ✓✓✓ |
| `replay-fall-window` | similar | ✓✓✓ | ✓✓✓ | ✓✓✓ |
| `sk-0472` | easy | ✓✓✓ | ✓✓✓ | ✓✓✓ |
| **`sk-0472`** | **similar** | ✓✓✓ | **✗✗✗** | **✗✗✗** |

Only the last cell breaks, and it breaks stably: all three runs loaded
`fall-detector` and `sensor-dump`, and never touched the right one.

### So the correct rule is

Hermes's worry is right and the sentence overstates it. The precise version:

> The routing signal is the skill's name plus the first 60 characters of the
> description. Either one being clear is enough.

Whether exceeding 60 characters hurts depends on whether the name covers for
it, and on how similar the other skills are. Three conditions have to hold at
once:

```
a semantically empty name  +  no information in the first 60 characters  +  similar-looking alternatives
```

Which makes the practical advice more actionable than the original:

- name it well; the name is a free routing signal and is not subject to the
  60-character truncation
- do not rely on the name, because you do not know whether a similar skill will
  be added later. That last cell only broke after four similar skills arrived
- keep the 60-character check; it is the cheapest insurance available

### The failure looks exactly as Hermes describes

Those three failures produced no error message. The model loaded two
plausible-looking skills and produced a plausible-looking plan. You would never
learn that a skill written specifically for this was never used.

> Design principle 7 again: a silent failure. And this time there is not even a
> log entry, because from the system's point of view nothing went wrong.

---

## Step 3: Hermes really does create skills automatically

The facts first, unvarnished. From `agent/background_review.py`'s docstring:

> After every turn, `AIAgent.run_conversation` may call
> `spawn_background_review` to fire off a daemon thread that replays the
> conversation snapshot in a forked `AIAgent` and asks itself
> "should any skill/memory be saved or updated?".
> Writes go straight to the memory + skill stores.

"Writes go straight" is where the risk lives: nobody looked in between.

It is not unguarded, though. There are two controls.

### Control one: a tool allowlist

> It runs with a **tool whitelist limited to memory and skill management
> tools**; everything else is denied at runtime.

That fork runs in the background with nobody watching. Given full permissions it
would be an unsupervised complete agent. The allowlist means it can write
skills and cannot also run a shell:

```
allow  propose_skill
allow  remember
allow  read_file
deny   run_command
deny   write_file
deny   send_email
```

Same idea as Lesson 8's risk classes, applied to a background copy of itself.

### Control two: isolation

> Main conversation and prompt cache are never touched.

The fork neither pollutes the main conversation nor breaks the prompt cache.

### And a human can still fix it afterwards

`agent/learning_mutations.py` lets a person edit or delete what was learned, and
deletion is archival rather than real (`hermes curator restore` brings it back).

---

## Step 4: why this lesson still adds a gate

Hermes's controls are "limit the scope, allow repair afterwards". This lesson
demonstrates a more conservative version:

```
the agent proposes → a human reviews → it is version-controlled → it goes live only once tests pass
```

Why? Because writing skills automatically is riskier than writing memory:

| Risk | What it means |
|---|---|
| **bad experience made permanent** | one time-pressured shortcut becomes the standard procedure |
| **skill poisoning** | one failed attempt gets reused as the correct approach |
| **injection persisted** | a web page says "disable the check before handling X" and it becomes a skill |
| **behavioural drift** | small adjustments each time, and in three months you do not recognise the agent |
| **hard to reproduce** | when something breaks you do not know which version was loaded |

Lesson 15 called memory a persistent injection surface. Skills are worse,
because memory is read and a skill is executed.

### Where the gate actually sits

The key is not forbidding the agent to write, it is letting it write somewhere
that does not take effect:

```ts
async propose(skill, from): Promise<Proposal> {
  // writes into proposedDir only
  await writeFile(join(this.proposedDir, `${name}.md`), renderSkill(stamped));
}
```

And `buildIndex()` reads only the active directory:

```
the index currently holds 0 skill(s)
1 awaiting review
→ a proposed skill does not exist to the model; that is where the gate really sits
```

Same shape as Lessons 8 and 9: the agent proposes, a human gates, and the
gating can be asynchronous. A proposed skill sits there waiting, exactly like
an approval in an inbox.

### Rejections are archived, not deleted

```ts
await rename(src, join(this.archiveDir, `rejected-${Date.now()}-${name}.md`));
```

A rejected proposal is itself data: it tells you what the agent wanted to learn
and why you said no.

The example from measured scenario 5:

```
the agent proposed "fast-deploy"
  ## Procedure
  1. Skip the test suite to save time.
  2. Push directly to production.

[human] rejected: skipping tests is not a reusable practice; it was a one-off expedient
```

Delete that proposal outright and you lose a signal. A few months of
accumulated rejections is the most direct data you have for detecting
behavioural drift.

---

## Step 5: a proposal has to carry its provenance

```ts
proposedFrom: {
  sessionId: "sess_042",
  summary: "The user asked me to analyse the fall in sess_001; I used get_session → find_anomalies → query_telemetry",
  createdAt: "...",
}
```

The reviewer needs to know what kind of conversation this skill was extracted
from.

Without provenance you are reviewing a procedure with no context, and it is
very hard to judge whether it is a good general approach or one lucky special
case.

That is also why Hermes's `/learn` is user-triggered:

> `/learn` is open-ended. The user can point it at anything they can describe:
> a directory of code, an API doc URL, a workflow they just walked the agent
> through in this conversation, or pasted notes.

A user naming the source means the user already made the first judgement that
this is worth learning.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| A skill is never called | the description exceeded 60 characters and was truncated | run `validateSkill()` |
| The index is long and every turn is expensive | too many skills | check `indexCost()`; consider loading by category |
| A proposal never takes effect | it is in the proposed directory, which is the design | use `decide(name, { action: "approve" })` |
| The agent learns strange things | proposals have no provenance, or nobody reviews them | see Steps 4 and 5 |

---

## Exercises

### Exercise 1: compute your own index cost ⭐

Assume 50 skills with 55-character descriptions. Work out:

- how many tokens does the index take?
- across a 20-turn conversation, how much did the index cost in total?
- what about 100 skills?

This makes clear that progressive disclosure is necessary rather than an
optimisation.

### Exercise 1.5: finish Step 2.5's matrix ⭐⭐

Step 2.5 only tested Gemini 3.6 Flash. Run the same matrix on another model:

```bash
NAME=opaque DISTRACTORS=hard DESC=bloated PROVIDER=anthropic bun run lesson-16:route
```

Does any model start failing in the "recognisable name plus similar
distractors" cell? If so, the advice above needs tightening.

Two traps to watch for, both of which caught this lesson out:

1. an easy test makes a bad mechanism look fine. Round one's distractors were
   obviously irrelevant, the model passed by elimination, and nothing was
   measured
2. "it did not happen" is not a conclusion by itself. Confirm `stopReason` was
   a normal finish first (Lesson 15 Step 4.5's lesson)

### Exercise 2: remove the gate ⭐

Make `propose()` write straight into the active directory, then run scenario 5.

See how it feels to have that `fast-deploy` skill take effect immediately.

### Exercise 3: add "active only after tests pass" ⭐⭐

Approval currently activates immediately. Add an intermediate state:

```
proposed → approved → (run tests) → active
```

The test can be: have the agent run one of Lesson 7's evaluation cases using
this skill, and activate only if the score did not regress.

This is where Lesson 7 connects.

### Exercise 4: skill versions and rollback ⭐⭐

`version: 0.1.0` is currently unused. Implement:

- bump the version when an existing skill is edited
- keep the old version
- roll back when something breaks

Then think: should the session record which skill version was loaded at the
time? (Hint: Lesson 4's `appendMeta` exists for exactly this.)

### Exercise 5: detect behavioural drift ⭐⭐⭐

Write a tool that analyses the proposals accumulated in the archive directory:

- what kinds of thing does the agent most often want to learn?
- do the rejected proposals share a pattern?
- is the same idea being proposed repeatedly? (That may mean your system prompt
  has a problem.)

### Exercise 6: the boundary of the allowlist ⭐⭐⭐

`PROPOSAL_TOOL_ALLOWLIST` includes `read_file`. Think about it:

A background fork can read arbitrary files. Is that safe? Could it read `.env`
and write it into a skill?

If you want to restrict it, how? (Hint: Lesson 8's roots plus the writable
flag.)

---

## Compared with Hermes's source

| Concept in this lesson | Where it lives in Hermes |
|---|---|
| the `/learn` prompt and authoring standard | `agent/learn_prompt.py` (150 lines, worth reading whole) |
| the reasoning behind the 60-character rule | around `learn_prompt.py:40` |
| creating skills automatically in the background | `agent/background_review.py` (the docstring lays out the design) |
| the tool allowlist | same file, `background_review.py`'s docstring |
| parsing skill files and conditional loading | `agent/skill_utils.py` (854 lines) |
| manual editing and deletion (archival) | `agent/learning_mutations.py` (206 lines) |
| visualising what was learned | `agent/learning_graph.py` (328 lines) |

`learn_prompt.py`'s `_AUTHORING_STANDARDS` section is worth reading whole: it is
a code review standard written for a model, and it demonstrates using a prompt
to force consistent output format. That is itself harness engineering.

---

## Next lesson

[Lesson 17: cross-session search](../lesson-17-search/)

The agent now has memory (facts) and skills (procedures). One thing is missing:
"how did I do this last time?", answered from past conversations.

Hermes uses SQLite FTS5, and the same pattern as Lesson 6's `find_anomalies`
where rules handle recall and the model handles precision.
