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
案例               input  output   total      差額      低估倍數  stopReason
────────────────────────────────────────────────────────────────────────
極短 (100)            13       1     107      93      7.6x  end
一句話 (400)           16      13     412     383     14.2x  max_tokens
一句話 (4000)          16      47     686     623     10.9x  end
長篇 (2000)           26     643    2022    1353      3.0x  max_tokens
```

The first row: you ask "answer in one word only: hi", and the model returns 1
token. `input + output = 14`.

The billed total is 107.

The 93 in between are **thinking tokens**. They are not in `completion_tokens`,
but you pay for them, usually at the output rate — the most expensive kind.

Computing cost as `input + output` **underestimates this call 7.6x**.

### Change provider and the same field means something else

The same probe against OpenAI:

```
案例               input  output   total      差額      低估倍數  stopReason
極短 (100)           121     100     221       0      1.0x  max_tokens
一句話 (400)          124     195     319       0      1.0x  end
一句話 (4000)         124     260     384       0      1.0x  end
長篇 (2000)          134    2000    2134       0      1.0x  max_tokens
```

Every difference is 0.

Not because gpt-5 does no reasoning, but because it counts reasoning tokens
**inside `completion_tokens`** (broken out in
`completion_tokens_details.reasoning_tokens`). Gemini does not include them
there, but does include them in `total_tokens`.

```text
OpenAI    completion_tokens 已含 reasoning   →  total = input + output
Gemini    completion_tokens 不含 thinking    →  total > input + output
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
額度 400   → output 13 個 token，stopReason = max_tokens   ← 被砍斷
額度 4000  → output 47 個 token，stopReason = end          ← 正常說完
```

A one-sentence answer needs only 47 tokens, but an allowance of 400 is not
enough — because 383 of it went into thinking.

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
// 串流中斷或出錯時不會有 done 事件。這種呼叫一樣要付錢。
if (!recorded) meter.calls.push({ label: `${classify(request)} (未完成)`, ... });
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
  預估上界：搜尋 2、抓取 4、模型呼叫 4    實際：搜尋 2、抓取 4、模型呼叫 4
  證據 6 條
  步驟                    次數   total token      占比          美元
  extractLearnings       2         5,503   55.9%    $0.00846
  writeReport            1         3,595   36.5%    $0.00742
  generateQueries        1           752    7.6%    $0.00134
  ─ 合計 input 3,364、output 1,859、total 9,850（thinking 佔 47%）
  合計 $0.0172

breadth=3 depth=2
  預估上界：搜尋 9、抓取 18、模型呼叫 13   實際：搜尋 7、抓取 8、模型呼叫 11
  證據 16 條
  步驟                    次數   total token      占比          美元
  extractLearnings       6        12,520   47.2%    $0.02255
  writeReport            1         7,363   27.7%    $0.01540
  generateQueries        4         6,669   25.1%    $0.01121
  ─ 合計 input 7,826、output 2,724、total 26,552（thinking 佔 60%）
  合計 $0.0492
  ⚠ 2 次呼叫被 maxTokens 截斷
```

Three findings:

### 1. The most expensive step is not writing the report but summarising pages

`extractLearnings` takes 47-56% and `writeReport` only 28-37%.

Intuition says "writing three pages of report" is the expensive part, but
**compressing six web pages into three conclusions** is the bulk, because that
step has a long input (whole page bodies) and runs many times.

That conclusion decides directly where to optimise. To save money: trim the body
text fed to `extractLearnings` first, rather than asking the report to be shorter.

### 2. The thinking share rises with depth

```
breadth=2 depth=1   thinking 佔 47%
breadth=3 depth=2   thinking 佔 60%
```

Deeper means more for the model to weigh, so it thinks longer. **Cost does not
grow linearly with tokens; it grows with how hard the judgements are.**

### 3. But the unit price per piece of evidence barely moves

```
breadth=2 depth=1    $0.0172 / 6 條  =  $0.0029 / 條
breadth=3 depth=2    $0.0492 / 16 條 =  $0.0031 / 條
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
+         usage,   // ← 漏了三課
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
token 是可以量測的事實      → 一定顯示
錢是需要外部資訊的推算      → 你自己填，而且要記下確認日期
```

```ts
export interface Price {
  input: number;   // 每百萬 token 美元
  output: number;
  verifiedOn: string;  // 沒有這個欄位的價格不值得相信
}
```

Everything runs with no prices filled in; it just does not show amounts.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| "沒有價目表，只顯示 token" | default behaviour | `PRICE_INPUT=… PRICE_OUTPUT=… bun run lesson-26` |
| "這個 provider 沒有回報 usage" | `stream_options.include_usage` is off | already enabled in `shared/streaming/openai.ts` |
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
本地文件沒有 URL，「來源」是什麼？（檔名 + 第幾段）
本地文件沒有新鮮度和權威度，排序公式要怎麼改？
本地和網路說得不一樣時，相信誰？
PDF、docx 怎麼變成 chunk？
```
