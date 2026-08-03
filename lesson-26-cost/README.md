# Lesson 26: Cost and Budget

> [繁體中文](README.zh-TW.md)
>
> Prerequisite: [Lesson 24](../lesson-24-research-loop/) (structural budgets).
>
> This series has measured accuracy, ranking quality and citation correctness —
> everything except money. This lesson fills that in.

## Questions this lesson answers

1. How many tokens did one call actually use? (Harder than you think.)
2. Where does the money go? (Not where intuition says.)
3. Is one more level worth it?
4. How do you record cost without changing any lesson's code?

---

## Step 0: `total ≠ input + output`

```bash
bun run lesson-26:probe
```

What actually ran (Gemini 3.6 Flash):

```
case                   input  output   total     gap underest.  stopReason
────────────────────────────────────────────────────────────────────────
very short (100)          14       1     109      94      7.3x  end
one sentence (400)        17      16     413     380     12.5x  max_tokens
one sentence (4000)       17      41     520     462      9.0x  end
long answer (2000)        28     746    2024    1250      2.6x  max_tokens
```

The first row: you ask "answer in one word only: hi", and the model returns 1
token. `input + output = 14`.

The billed total is 109.

The 94 in between are **thinking tokens**. They are not in `completion_tokens`,
but you pay for them, usually at the output rate — the most expensive kind.

Computing cost as `input + output` **underestimates this call 7.3x**.

### Change provider and the same field means something else

The same probe against OpenAI:

```
case                   input  output   total     gap underest.  stopReason
very short (100)         118     100     218       0      1.0x  max_tokens
one sentence (400)       120     177     297       0      1.0x  end
one sentence (4000)      120     113     233       0      1.0x  end
long answer (2000)       129    1926    2055       0      1.0x  end
```

Every difference is 0.

Not because gpt-5 does no reasoning, but because it counts reasoning tokens
**inside `completion_tokens`** (broken out in
`completion_tokens_details.reasoning_tokens`). Gemini does not include them
there, but does include them in `total_tokens`.

```text
OpenAI    completion_tokens already includes reasoning  →  total = input + output
Gemini    completion_tokens excludes thinking            →  total > input + output
```

> Same field name, different semantics per vendor. This is the hardest part of a
> provider abstraction, and why this lesson always prices from `total`: for
> OpenAI it equals input + output (nothing double-counted), and for Gemini it is
> the only place thinking shows up. One formula holds for both.

Incidentally, OpenAI's input is 121-134 where Gemini's is 13-26 for the same
short prompt. Different tokenisers, different system overhead — **comparing token
counts across providers is meaningless; compare money.**

### And it eats the maxTokens allowance

Look at the two "one sentence" rows: same question, only `maxTokens` differs.

```
budget 400   → output 16 tokens, stopReason = max_tokens   ← cut off
budget 4000  → output 41 tokens, stopReason = end           ← finished normally
```

A one-sentence answer needs only 41 tokens, but an allowance of 400 is not
enough — because 380 of it went into thinking.

> **For a reasoning model, `maxTokens` is not "the output length limit" but "the
> total allowance for thinking plus writing".**

This directly explains Lesson 24 Step 5's report that stopped mid-URL. The
diagnosis at the time was "13 pieces of evidence are too many for 3000 tokens";
the real cause is that **thinking ate most of the allowance first**. (That
lesson's fix — raising the limit to 6000 — happened to be right for the wrong
reason.)

---

## Step 1: attach metering without changing any lesson

```ts
const provider = withMetering(selectStreamingProvider(), meter, classify);
```

That one line. Lesson 24's `research()`, `steps.ts` and `state.ts` are **untouched
to the character**.

### Why a decorator instead of a parameter

gpt-researcher's approach is passing `cost_callback` into every function that
calls a model (`query_processing.py` and `compression.py` both do). Direct, but:

| Approach | Benefit | Cost |
|---|---|---|
| pass a callback into every function | precise; the caller knows who it is | one more parameter in every signature, and one missed call is one missed charge |
| **wrap the provider** | zero intrusion, impossible to miss | it only sees the request, so it has to guess which step this was |

The latter is used here, with a `classify(request)` function recognising the step
from the prompt. Slightly crude, but the crude part **stays entirely inside Lesson
26** and does not contaminate Lesson 24.

> This is design principle 6 in practice: add features beside the core, do not
> change the core.

### Failed calls need accounting too

```ts
// An interrupted or failed stream never emits done. That call still costs money.
if (!recorded) meter.calls.push({ label: `${classify(request)} (incomplete)`, ... });
```

Without that, you will believe failed calls are free. They are not.

---

## Step 2: where the money goes (not where intuition says)

```bash
PRICE_INPUT=0.30 PRICE_OUTPUT=2.50 bun run lesson-26 -- --shapes
```

> Those two prices are **made-up placeholder values**, there only to make the
> numbers look like money. `prices.ts` ships empty; Step 4 explains why.

What actually ran:

```
breadth=2 depth=1
  estimated ceiling: 2 searches, 4 fetches, 4 model calls  actual: 2 searches, 4 fetches, 4 model calls
  6 pieces of evidence
  step               calls   total token   share         USD
  extractLearnings       2         6,377   54.7%    $0.01064
  writeReport            1         4,510   38.7%    $0.00963
  generateQueries        1           774    6.6%    $0.00140
  ─ totals: input 3,399, output 1,689, total 11,661 (thinking is 56%)
  total $0.0217

breadth=3 depth=2
  estimated ceiling: 9 searches, 18 fetches, 13 model calls  actual: 7 searches, 6 fetches, 7 model calls
  9 pieces of evidence
  step               calls   total token   share         USD
  extractLearnings       3         8,186   45.4%    $0.01381
  writeReport            1         5,421   30.1%    $0.01148
  generateQueries        3         4,416   24.5%    $0.00760
  ─ totals: input 5,532, output 2,337, total 18,023 (thinking is 56%)
  total $0.0329
```

Three findings:

### 1. The most expensive step is not writing the report but summarising pages

`extractLearnings` takes 45-55% and `writeReport` only 30-39%.

Intuition says "writing three pages of report" is the expensive part, but
**compressing six web pages into three conclusions** is the bulk, because that
step has a long input (whole page bodies) and runs many times.

That conclusion decides directly where to optimise. To save money: trim the body
text fed to `extractLearnings` first, rather than asking the report to be shorter.

### 2. The thinking share rises with depth

```
breadth=2 depth=1   thinking is 56%
breadth=3 depth=2   thinking is 56%
```

Over half the tokens you pay for on this model are never shown to anybody.
**Cost does not grow linearly with visible output; more than half of it is
invisible before you start.**

### 3. But the unit price per piece of evidence barely moves

```
breadth=2 depth=1    $0.0217 / 6 items  =  $0.0036 each
breadth=3 depth=2    $0.0329 / 9 items  =  $0.0037 each
```

One more level did not get more expensive. This is the lesson's most practical
number: it turns "should I run another level" from a feeling into arithmetic.

> Note this is the result for this corpus, this question and this model. The point
> is not the $0.003 but that **you can now compute it**.

---

## Step 3: another missing charge (this time in our own provider)

Once metering was attached, the probe's last three cases printed "this provider
does not report usage".

Tracing it: `shared/streaming/openai.ts` returns early when
`stopReason === "max_tokens"`, and that path **did not carry usage**.

```diff
  if (stopReason === "max_tokens") {
      yield { type: "done", response: {
          blocks: ..., raw: ..., stopReason,
+         usage,   // ← missing for three lessons
      }};
      return;
  }
```

The irony: **truncated calls are usually the most expensive ones** (the model
thought for a long time before being cut off), and that was the one path where
recording was missing.

This is the fifth instance of the same disease in the series: **nothing errored,
there was just no data** (design principle 7).

---

## Step 4: why `prices.ts` is empty

Because design principle 3 says do not invent, and price is the easiest thing to
invent:

1. It changes every few months
2. The same model differs by region, by tier, and by whether caching applies
3. A precise-looking but stale number is more dangerous than no number — you will
   make decisions with it

So this lesson's position is:

```text
tokens are a measurable fact          → always shown
money is an estimate needing outside information → you fill it in, and record when you checked
```

```ts
export interface Price {
  input: number;   // USD per million tokens
  output: number;
  verifiedOn: string;  // a price without this field is not worth trusting
}
```

Everything runs with no prices filled in; it just does not show amounts.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| "No price table, so only tokens are shown" | default behaviour | `PRICE_INPUT=… PRICE_OUTPUT=… bun run lesson-26` |
| "this provider reports no usage" | `stream_options.include_usage` is off | already enabled in `shared/streaming/openai.ts` |
| `PROVIDER=fake` has no token counts | the fake provider produces no usage | normal; fake is only for seeing the structure |
| Anthropic has no usage | `shared/streaming/anthropic.ts` is not wired up | Exercise 1 |

---

## Exercises

### Exercise 1: wire up Anthropic's usage ⭐⭐

`shared/streaming/anthropic.ts` does not report usage yet. Anthropic's stream
carries usage in the `message_start` and `message_delta` events, in a different
shape from OpenAI's.

Once wired, **run the probe**: are Anthropic's thinking tokens counted the same
way? (This exercise shows that every vendor's usage semantics differ, which is the
hardest part of a provider abstraction.)

### Exercise 2: find the cheapest-per-evidence shape ⭐⭐

Run several breadth/depth combinations and plot cost per piece of evidence.

Is there a sweet spot? Does it get more expensive past a point (as duplicate
evidence accumulates)? This uses Lesson 24's dedup counters.

### Exercise 3: add a hard budget ⭐⭐⭐

Give `CostMeter` a ceiling and make later calls fail once it is exceeded. Then
answer:

1. When the budget runs out, abort or "write a report from the evidence so far"?
2. How does the research loop learn it is nearly out of money, rather than finding
   out by hitting the wall?
3. If half the evidence is collected, how should the report mark "these are
   partial conclusions within budget"?

**The third matters most**: a dishonest half-finished report is worse than no
report.

### Exercise 4: tiered models ⭐⭐⭐

`extractLearnings` takes over half the cost, but what it does is not hard (read a
passage, extract a few facts).

Switch `extractLearnings` to a cheap model and leave the expensive one for
`writeReport`.

Then — **this is the point** — run Lesson 25's citation check and confirm evidence
quality did not drop. Saving money is easy; saving money without losing quality is
engineering.

---

## Compared with the sources

| Concept in this lesson | Reference |
|---|---|
| a cost accumulator | `gpt-researcher/gpt_researcher/utils/costs.py:63` (`estimate_llm_cost`) |
| threading cost through every call | `gpt-researcher/gpt_researcher/agent.py:773` (`add_costs`) plus `cost_callback` throughout |
| structural budgets (bounds on counts) | this series' `estimateCost()` in [Lesson 24](../lesson-24-research-loop/) |

> gpt-researcher uses **estimates** (tokens estimated from character counts) where
> this lesson uses the **actual values** the provider reports. An estimate can
> block a too-expensive request before sending; an actual value is accurate. A
> mature system wants both: estimate at the gate, reconcile on receipt.

---

## Next lesson

[Lesson 27: hybrid local-document and web retrieval](../lesson-27-local-docs/):
point Lesson 22's retrieval at your own files.

```text
local documents have no URL, so what is a "source"? (a filename plus a paragraph number)
local documents have no freshness or authority, so how does the ranking formula change?
when local and web disagree, which do you believe?
how do PDF and docx become chunks?
```
