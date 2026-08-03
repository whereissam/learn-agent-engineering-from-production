# Lesson 7: Evaluation

> [繁體中文](README.zh-TW.md)
>
> Prerequisites: [Lesson 6](../lesson-06-domain-tools/). This lesson evaluates
> that agent directly.
>
> This is layer 4, and the last lesson of the Pi part. It is the easiest one to
> skip and the one that most clearly separates a demo from a product.

## Questions this lesson answers

1. Is my agent actually any good?
2. Did that prompt change make it better or worse?
3. How do you score without drowning in the infinite ways of writing natural
   language?
4. Which mistakes are "imperfect", and which are "cannot ship"?

---

## Why this lesson exists

Without evaluation, tuning a prompt looks like this:

```
edit the prompt → run it once by hand → "hmm, feels a bit better" → ship
```

The problems:

- you looked at one case, and may have broken the other four
- "feels better" is not data
- switching models tells you nothing about regressions
- three months later someone edits the prompt and nobody notices a case broke

With evaluation:

```
edit the prompt → bun run lesson-07-evaluation/eval.ts --compare baseline
→ real-fall 0 → 12  ← fixed
→ clock-skew 11 → 14 ← fixed
→ no regressions
```

---

## Step 0: run it first

```bash
bun run lesson-07-evaluation/eval.ts
```

Real output, Gemini 3.6 Flash:

```
PASS  crouch-not-fall      100%  12/12  10 calls  36.6s
  ✓ no_dangerous_misclassification no dangerous misclassification
  ✓ classification                 "near_miss" (the best answer)
  ✓ window_overlap                 5360..5860ms overlaps the true window 5000..6200ms
  ✓ has_evidence                   6 pieces of evidence
  ✓ numbers_plausible              31/31 cited numbers match the actual data (100%)
  ✓ calibrated_confidence          confidence=high

────────────────────────────────────────────────────────────────
passed 7/7   total 88/91 (97%)   62 tool calls   207.1s
```

Run one case, save a baseline, compare against one:

```bash
bun run lesson-07-evaluation/eval.ts real-fall
bun run lesson-07-evaluation/eval.ts --save baseline
bun run lesson-07-evaluation/eval.ts --compare baseline
```

> This calls a real model. Seven cases take roughly 3.5 minutes and 62 tool
> calls. Save money with a cheaper model:
> `MODEL=gemini-3.5-flash-lite bun run lesson-07-evaluation/eval.ts`

---

## Step 1: do not score by string comparison

The most common wrong approach:

```ts
// ✗ this will never work
if (report.summary === "the robot fell at 8400ms") pass();
```

Natural language has unbounded correct phrasings. "The robot fell", "a fall
occurred", "robot fell at t=8400ms" are all right, and none equals your
reference answer.

Check verifiable facts instead:

| Check | How it is verified | Weight |
|---|---|---|
| `no_dangerous_misclassification` | enum against a forbidden list | 3 (critical) |
| `classification` | enum against an acceptable list | 3 |
| `window_overlap` | do two numeric ranges intersect | 2 |
| `numbers_plausible` | pull numbers from evidence, compare with real telemetry | 2 |
| `mentions_data_issue` | any keyword hit | 3 (critical) |
| `has_evidence` | array length | 1 |
| `calibrated_confidence` | must not be high when the data has problems | 1 |

Every one is deterministic. Score the same report a hundred times and the number does not move.

### Why not use an LLM as the judge?

LLM-as-judge has its uses, for subjective things like prose quality, tone or
helpfulness. But it makes mistakes of its own, costs money, and is not
reproducible.

> The principle: finish everything that can be checked deterministically
> first, then consider an LLM judge for the rest.

Most people skip the first step and go straight to an LLM judge, ending up
with scores that look scientific and are not reliable.

---

## Step 2: time windows overlap, they do not match

```ts
const overlaps = rs !== null && re !== null && rs <= te && re >= ts;
```

Exact agreement is not required, because when an event started is genuinely
open to interpretation. The real fall is 8200-9000ms, and a model reporting
8400-13980ms is still right: it caught the correct event and included the
lying-still part.

A rubric has to tolerate reasonable variation and catch only real errors. Too
strict and it produces a pile of false failures, after which you start ignoring
the results, and then the evaluation was pointless.

---

## Step 3: catching hallucination by checking cited numbers

Models are good at inventing plausible numbers, so pull the numbers out of the
evidence and compare them with the real telemetry:

```ts
const cited = report.evidence.flatMap(extractNumbers);
const plausible = cited.filter((n) =>
  (n >= 0 && n <= facts.durationMs) ||                          // a plausible timestamp
  realValues.some((v) => v !== 0 && Math.abs((n - v) / v) < 0.15), // close to some real peak
);
```

Measured:

```
numbers_plausible  21/22 cited numbers match the actual data (95%)
numbers_plausible  26/27 cited numbers match the actual data (96%)
```

It is 95% rather than 100% because the model sometimes cites a window average
or a value it derived itself. So the threshold sits at 70%, not 100%.

This check is the most direct evidence of whether the model actually consulted
the data. An agent that writes reports from experience without querying scores
badly here.

---

## Step 4: separate "imperfect" from "cannot ship"

The most important design decision in this lesson. See `rubric.ts`:

```ts
checks.push({
  name: "no_dangerous_misclassification",
  passed: !hitForbidden,
  weight: 3,
  critical: true,     // ← this one
  detail: ...
});
```

When a `critical: true` check fails, the whole case fails regardless of how
the other items scored.

Which ones are critical?

| Case | Forbidden classification | Why |
|---|---|---|
| real-fall | `nominal`, `near_miss` | calling a real fall fine means a broken robot nobody knows about |
| crouch-not-fall | `fall` | a false alarm. 100 a day and nobody reads alarms any more |
| missing-data | `fall`, `external_collision` | a confident conclusion about a window with no data |

Note the `missing-data` row. It is not "wrong answer", it is "an answer where
there should not be one".

An agent that says "inconclusive" when the data is insufficient is far more
useful than one that always sounds confident. Only evaluation can measure
that.

The measured output marks it in red:

```
⚠  2 cases had a dangerous error, which is far worse than a low score
```

---

## Step 5: the logic behind the seven cases

```
sess_001  real-fall            a real fall          → tests "can it be detected"
sess_002  crouch-not-fall      a crouch, not a fall → tests "does it false-alarm"
sess_003  external-collision   an external collision → tests "can the cause be told apart"
sess_004  missing-data         a hole in the data   → tests "does it know what it does not know"
sess_005  clock-skew           a clock offset       → tests "is the trap noticed"
```

The first three test whether the judgement is accurate. The last two test
whether it knows what it does not know.

The last two matter more. The first kind of error is visible when you read the
report; the second looks entirely normal while quietly resting on a false
assumption.

### Every case uses the same prompt

```ts
prompt: "Analyse what happened in this session and write an incident report."
```

Deliberately. If `missing-data`'s prompt said "note that this session has
gaps", you would be testing whether the model follows instructions, not
whether it notices problems on its own.

An evaluation case must not hint at the answer.

---

## Step 6: the whole loop, measured

Running the evaluation once this lesson was written produced this:

```
CRITICAL  real-fall             0%   0/1   1 calls   3.5s
  ✗ produced_report        the agent never called create_incident_report
    error: 400 status code (no body)

PASS      crouch-not-fall     100%  12/12
PASS      external-collision  100%  12/12
PASS      missing-data        100%  13/13

CRITICAL  clock-skew           73%  11/15
  ✓ classification         "near_miss" (the best answer)
  ✓ window_overlap         7000..7380ms overlaps the true window
  ✗ mentions_data_issue    never mentioned the data problem (expected any of: offset, clock, skew, 2300)
  ✗ calibrated_confidence  the data quality is poor, yet it reported high confidence

passed 3/5   total 48/53 (91%)
⚠  2 cases had a dangerous error
```

Two problems, entirely different in kind.

### Problem 1: flaky infrastructure, not the model's fault

`real-fall`'s 400 is intermittent. Running the same session by hand works
fine, with the classification and window both correct.

That is normal for a real API. The fix is retries:

```ts
const MAX_ATTEMPTS = 3;
for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
  try {
    await runTurn(...);
    break;
  } catch (e) {
    error = ...;
    if (attempt < MAX_ATTEMPTS) await sleep(1000 * 2 ** (attempt - 1));
  }
}
```

But retry infrastructure errors only, never a wrong answer. Retrying until it
is right is self-deception.

Without retries your scores mix in network noise, and then you conclude the
prompt change broke something.

### Problem 2: something genuinely undone, and it was the prompt

`clock-skew` got the classification and the window right, and never mentioned
the 2300ms video clock offset at all.

The tool did say so (`get_session` reports the offset) and the model saw it,
and judged it not worth putting in the report.

That is a hole in the prompt. The fix:

```diff
  1. Call get_session FIRST. It reports sampling gaps and clock offsets.
     If there is a gap, you cannot conclude anything about that window.
+    If get_session reports ANY data quality issue (a sampling gap, or a clock
+    offset between video and telemetry), you MUST record it in the report's
+    caveats, even if it did not change your conclusion. A reader of the report
+    cannot see the tool output, so an unmentioned caveat is an invisible one.
```

That last sentence is the operative one: the report's reader cannot see tool
output, so a caveat left out does not exist. Giving the model a reason works
better than giving it an instruction.

### After the fix

```bash
bun run lesson-07-evaluation/eval.ts --compare gemini-baseline
```

```
passed 7/7   total 88/91 (97%)   72 tool calls   208.3s

compared against baseline "gemini-baseline"
baseline: gemini/gemini-3.6-flash  2026-07-31T14:35:47.197Z

  real-fall            12 → 12  ±0
  crouch-not-fall      12 → 12  ±0
  external-collision   12 → 12  ±0
  missing-data         13 → 13  ±0
  clock-skew           14 → 14  ±0
  two-events           15 → 15  ±0
  slow-tip             10 → 10  ±0

no regressions
```

Two consecutive runs of the same seven cases, and every case scored identically.
That is what you want from `--compare`: the model is stochastic, and the score is
stable enough that a real regression would stand out.

> The two remaining points are left there deliberately: `clock-skew`'s
> `calibrated_confidence` (it noticed the offset and still said high) and
> `slow-tip`'s `window_overlap` (it copied `find_anomalies`' 7060.. candidate
> instead of the true 4000.. start). Both are the failures those cases were
> written to catch, and both are still caught.

That is the full value of evaluation:

```
measure → find a specific problem → fix → measure again → confirm it really improved with no side effects
```

Without that loop you are tuning prompts on feel.

> The remaining point (`clock-skew`'s `calibrated_confidence`) is left there
> deliberately. The model did notice the clock offset and still reported high
> confidence. That is a calibration problem, much milder than not noticing.
> Whether to keep tuning the prompt for one point is a product decision, not a
> technical one. The purpose of evaluation is not a perfect score, it is
> knowing where you stand.

---

## Step 7: wire it into CI

`--compare` sets `process.exitCode = 1` on a regression:

```ts
if (regressions > 0) {
  console.log(red(bold(`⚠  ${regressions} cases regressed`)));
  process.exitCode = 1;   // ← so CI can block on it
}
```

So you can use it like this:

```yaml
- run: bun run lesson-07-evaluation/eval.ts --compare production
```

Someone edits a prompt and causes a regression, and the PR goes red. That is
the step that turns agent quality into engineering discipline.

Practical advice:

- evals are slow and expensive, so do not run them per commit. Trigger by
  label or on a schedule
- 5 to 10 cases is plenty to start; what matters is covering different failure
  modes
- every time production breaks, add that case. The evaluation set becomes your
  most valuable asset over time

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `no baseline "xxx"` | never saved one | `--save xxx` first |
| The score differs every run | models are stochastic | expected. Watch the trend, not one run; average several |
| One case fails intermittently | intermittent API errors | retries exist. Check the `error` field to confirm it is infrastructure |
| Everything scores 0 | the agent never wrote a report | run `bun run lesson-06` alone to see where it stalls |
| It takes ages | 5 cases × about 10 tool calls each | use a cheaper model, or run one case |

---

## Exercises

### Exercise 1: break the prompt on purpose ⭐

Delete the part of `SYSTEM_PROMPT` about foot contact being the discriminating
signal, then run `--compare`.

See whether `crouch-not-fall` turns into `fall`, a dangerous error. This
exercise shows you what evaluation is defending.

### Exercise 2: compare models ⭐

```bash
MODEL=gemini-3.5-flash-lite bun run lesson-07-evaluation/eval.ts --compare gemini-baseline
```

How many points does the cheap model lose? On which checks? Is it worth it?

This is one of evaluation's most practical uses: deciding on a cheaper model
with data.

### Exercise 3: add a cost metric ⭐⭐

Only tool call counts are recorded today. Add token usage and estimated cost,
and show them in the comparison.

You will hit a real trade-off: two more points for 40% more cost. Worth it?

### Exercise 4: add a new failure-mode case ⭐⭐

Add a session to `generate.ts`, for example two events (agents often report
only the first) or a very slow tip-over (three seconds to fall, which
threshold detection may miss).

Then write the matching evaluation case. This is the exercise closest to real
work.

### Exercise 5: an LLM judge alongside the deterministic checks ⭐⭐⭐

Some things code cannot check, such as whether the report is useful to an
on-call engineer.

Add an LLM-scored check, but:

- give it a small share of the weight (deterministic checks stay dominant)
- low temperature, fixed prompt
- run it three times and take the majority (to damp the judge's own variance)

Then compare: do the LLM judge's scores fight the deterministic ones? Which is
more stable?

### Exercise 6: write cases for your own domain ⭐⭐⭐

This is the final assignment of the series.

Pick your domain and write five evaluation cases. At minimum include:

- a normal case
- a looks-like-it-but-is-not case (false alarms)
- an insufficient-data case (does it know what it does not know)

The third matters most and is the one almost nobody writes.

---

## Compared with Pi's source

This lesson has no direct counterpart in Pi. Pi is a coding agent, and its
`packages/evals/` holds two files doing behavioural testing with
`vitest-evals`: run a real agent session, check the final reply. Much smaller
in scope than this lesson.

| Concept in this lesson | Where it lives in Pi |
|---|---|
| the skeleton of a behavioural eval | `packages/evals/src/pi-harness.ts` |
| a reproducible fake provider for tests | `packages/ai/src/providers/faux.ts` |

That is deliberate. An evaluation set is welded to your domain and no open
source project can write it for you, so this lesson was designed from the
layer-4 principles rather than copied from Pi.

---

## You have finished the series

Seven lessons in:

| Layer | Lessons | What you built |
|---|---|---|
| **1. Agent mechanics** | 1-5 | the loop, tools, streaming, interruption, persistence, compaction |
| **2. Harness** | 2, 5 | approval, output truncation, context management |
| **3. Domain tools** | 6 | building "which signal to look at" into the tool |
| **4. Evaluation** | 7 | measure, find the problem, fix, confirm no regression |

And that core while loop has not changed by a single line between Lesson 1 and
Lesson 7.

Back to the sentence at the start:

> An agent is small. The engineering around it is large.

You have now built both sides.

### Where to go next

1. Read [Pi](https://github.com/earendil-works/pi)'s source. You are equipped.
2. Swap Lessons 6 and 7 for your own domain. That is the only part that
   produces a moat.
3. Practise layer 2 in the project you already have. You do not need a new
   agent app: write `AGENTS.md`, add `scripts/verify`, build
   `tests/fixtures/`, and require your coding agent to run the whole loop
   every time.

---

## Next lesson

[Lesson 8: from a boolean to risk classes](../lesson-08-permissions/): the Pi
part ends here, with an engine that runs, domain tools, and a way to measure
quality.

Next comes a different set of questions: how far can this agent be trusted?
Lesson 2's `mutating: boolean` cannot carry a real product, and the next
lesson shows why.
