# Lesson 24: The Deep Research Loop

> [繁體中文](README.zh-TW.md)
>
> Prerequisites: [Lesson 21](../lesson-21-crawl/) (fetch),
> [22](../lesson-22-retrieval/) (retrieval),
> [23](../lesson-23-real-world/) (having read the real projects' source).
>
> This lesson solves the problem from Lesson 22 Step 8: the agent does not know
> when to stop. The solution is not a better prompt.

## Questions this lesson answers

1. Why can a "smarter agent" not solve "it never finishes"?
2. Where does the stopping condition belong?
3. Research runs three levels deep — why does context not explode?
4. How much does one research run cost — can you compute it **before it starts**?

---

## Step 0: what a completed run looks like

```bash
bun run lesson-24
```

```
問題：有哪些 open source 專案可以把影片動作 retarget 到 Unitree G1？現在還能用嗎？

預算：breadth=3 depth=2 pages=2  →  最多 9 次搜尋、18 次抓取、約 13 次模型呼叫
（這個上界是開跑前就算得出來的。對照 Lesson 22：那個 agent 的上界是「撞到步數上限」）

研究過程
[depth=2 breadth=3] 3 條 query
  ? Unitree G1 video human motion retargeting open source github
      ✓ https://arxiv.org/abs/2603.04417
      ✓ https://github.com/openmotion/retarget-anything
      → 3 條結論，3 個後續問題
  ? Unitree G1 pose estimation teleoperation retargeting framework
      ✓ https://openmotion.dev/docs/retarget-anything/getting-started
      ✓ https://www.unitree.com/g1/developer
      → 3 條結論，3 個後續問題
  ? human motion capture to Unitree G1 humanoid robot retargeting code
      → 沒有新頁面可讀（都讀過了或都抓不到）
  [depth=1 breadth=2] 2 條 query
    ? retarget anything CPU installation dependencies and Booster T1 support
        ✓ https://github.com/openmotion/retarget-anything/blob/main/LICENSE
        ✓ https://discourse.ros.org/t/g1-retargeting-foot-sliding/45211
        → 3 條結論，3 個後續問題
    ? Unitree G1 23 DoF SDK joint index mapping 2024 vs 2026
        ✓ https://blog.kinelabs.dev/humanoid-mimic-0-7
        ✓ https://github.com/kinelabs/humanoid-mimic
        → 3 條結論，3 個後續問題

實際用掉
  搜尋 7  抓取 9  模型呼叫 9  耗時 28.0s
  擋掉重複：URL 22 次、query 0 次
  證據 13 條，來自 9 個不重複的網址
```

Same question: Lesson 22's agent ran twice, hit the 16-step ceiling both times,
and produced no answer.

Here it finishes in 28 seconds with 13 pieces of evidence, each carrying a real
URL, and a report with conclusions and caveats.

And note that "blocked duplicates: URL 22 times" — without that mechanism it
would have re-fetched the same pages 22 times.

---

## Step 1: who holds the control flow

The most important sentence in this lesson:

> Deep Research is not a smarter agent. It is a program that uses an agent as a
> component.

```text
Agent loop（Lesson 1-23）
  while (模型還在呼叫工具) { 問模型下一步 }
  ↑ 控制流在模型手上。它覺得要再搜一次，你就得再搜一次。

Research loop（這一課）
  for (每一層) { 生 query → 平行搜尋 → 抓 → 壓成結論 → 深一層 }
  ↑ 控制流在程式手上。模型只被叫來做四件小事，每件都有明確的輸入輸出。
```

Four steps (`steps.ts`):

| Step | Input | Output |
|---|---|---|
| `clarify` | the question | 3 clarifying questions |
| `generateQueries` | a direction plus known conclusions | N queries (each with "why search this") |
| `extractLearnings` | query plus page body | conclusions (with sources) plus follow-up questions |
| `writeReport` | all conclusions | the report |

Each is a **single call with no tools, testable in isolation, swappable to a
different model in isolation**.

Lesson 22's agent did not fail because it was stupid but because **nobody was
managing it**. A stronger model would only find better reasons to search five
more times.

---

## Step 2: the budget is computed, not collided with

Copied from `deep-research/src/deep-research.ts:230`:

```ts
const newBreadth = Math.ceil(breadth / 2);
const newDepth = depth - 1;
```

Each level deeper halves the breadth and decrements the depth. The model gets no
say in whether to continue at any point.

Why halve the breadth? Because without it the cost is `breadth^depth`:

```text
breadth=4, depth=3, 不砍半    4 + 16 + 64 = 84 次搜尋
breadth=4, depth=3, 砍半      4 + 8 + 8   = 20 次搜尋
```

And with a fixed rule, `estimateCost()` becomes writable:

```
預算：breadth=3 depth=2 pages=2  →  最多 9 次搜尋、18 次抓取、約 13 次模型呼叫
```

> This is a completely different thing from `MAX_STEPS = 16`.
> MAX_STEPS is a circuit breaker: it acts only after you have already burned 16
> steps, and its action is "give up". A budget is a plan: it tells you the ceiling
> before you press Enter, and there is a result at the end.

Measured at 7 searches and 9 fetches, both inside the bound — **being under the
bound is normal**, because dedup and failed fetches pull the actual numbers down.
A bound is a guarantee, not a prediction.

---

## Step 3: what flows through the loop is learnings, not pages

Research runs three levels deep; why does context not explode? Because each
level's pages are compressed into conclusions before being passed down.

```text
搜尋 → 抓 2 頁正文（幾千字）
      → extractLearnings
      → 最多 3 條一句話結論 + 3 個後續問題
      → 下一層只帶結論走
```

Against `deep-research.ts:102`, the shape is identical.

This is Lesson 5's context compaction growing inside a research loop. The
difference is that Lesson 5's compaction is reactive (compress when context is
nearly full) while this one is proactive (compress at every level, full or not).

The next level's query is not the original question either but the previous
level's product (`deep-research.ts:252`):

```ts
`Previous research goal: ${goal}
Follow-up directions:
${followUps.map((q) => `- ${q}`).join("\n")}`
```

So the research **goes deeper** rather than rephrasing the same thing. The second
level's queries in Step 0 show it:

```
retarget anything CPU installation dependencies and Booster T1 support
Unitree G1 23 DoF SDK joint index mapping 2024 vs 2026
```

Neither could have been generated from the original question; they are only
askable after reading the first level.

---

## Step 4: three guards, each matching an injury from an earlier lesson

### 1. Skip URLs already read

Copied from `_get_new_urls` in
`gpt-researcher/gpt_researcher/skills/researcher.py:801`. That Set is **shared
across the whole research tree**, and the comment at `:108` specifically says not
to clear it.

Measured at 22 blocks. Eight queries over the same small corpus makes duplication
inevitable.

> Interestingly, **deep-research does not do this**. Its `visitedUrls` is only
> used to list Sources at the end of the report (`:229`, `:292`), never to avoid
> re-fetching. The two projects chose differently here; this lesson follows
> gpt-researcher.

### 2. Skip queries already run

The prompt already says "do not repeat queries you have run". But that is a plea.

The fake provider repeated two on its first run, so it went into code:

```ts
const seen = new Set(state.queriesRun.map(normalizeQuery));
```

`normalizeQuery` sorts the words before comparing, so "unitree g1 retargeting"
and "retargeting unitree g1" count as one.

### 3. One failed query does not take down the round

Copied from `deep-research.ts:282`: catch and return an empty result, other
branches continue.

Paired with a concurrency of 2 (`ConcurrencyLimit`, which is also 2 by default in
`deep-research.ts:30`).

---

## Step 5: two silent failures, both self-inflicted

The first real-model run after writing this lesson had two broken things, and
**neither produced any error message**.

### Failure one: four pages fetched, 0 conclusions

```
? human video motion retargeting Unitree G1 humanoid
    ✓ arxiv.org/abs/2603.04417
    ✓ github.com/kinelabs/humanoid-mimic
    ✓ github.com/openmotion/retarget-anything
    ✓ www.unitree.com/g1/developer
    → 0 條結論，0 個後續問題
```

Four pages fetched, extraction succeeded, and then nothing. No exception, no
warning.

There are three possible causes, and the code at the time **could not tell them
apart**:

```text
模型根本沒回出可解析的 JSON
模型回了結論但覺得沒東西可講
模型回了結論，但引用了沒抓過的網址，被我們的來源過濾丟掉
```

The fix is forcing it to state the reason (`Extraction.failure` in `steps.ts`):

```
→ 0 條結論，0 個後續問題 （模型沒有回出可解析的 JSON）
→ 0 條結論，0 個後續問題 （2 條被丟掉：引用了沒抓過的網址）
```

### Failure two: the report stopped in the middle of a URL

The first run's report ended like this:

```
...會導致足部滑移 (https://github.com/kin
```

13 pieces of evidence do not fit in `maxTokens: 3000`. And **it looks exactly
like it finished**.

`ask()` received `stopReason === "max_tokens"` and ignored it. The fix:

```ts
if (response.stopReason === "max_tokens") {
  state.trace.push(`⚠ 輸出撞到 ${maxTokens} token 上限，內容不完整`);
  state.budget.truncatedOutputs++;
}
```

### Why both belong in the lesson

Because they are the same disease, and this is the fourth time in the series:

```text
Lesson 21 Step 5   抽取器丟掉表格，沒有任何訊號       → 燒掉兩次 16 步上限
Lesson 22 Step 5   訊號有偏誤，被平均分數蓋住          → 一題從 1.000 崩到 0.131
Lesson 23 Step 6   平行工具呼叫被合併，潛伏三課        → 400 no body
Lesson 24 Step 5   萃取 0 條、報告被截斷，都不出聲     → 你以為它做完了
```

> A failure that explodes is not frightening; a silent one is.
> Every time you add a stage, ask once: "when this step does nothing at all, can
> I see it?"

---

## Step 6: head to head against Lesson 22's agent

Same question, same model, same corpus, same retrieval pipeline.

| | Lesson 22's agent | Lesson 24's loop |
|---|---|---|
| who holds control flow | the model | the program |
| upper bound | `MAX_STEPS=16` (circuit breaker) | computable before starting (a budget) |
| stopping condition | the model stops calling tools | `depth` reaches zero |
| context growth | the whole conversation accumulates | compressed per level, pages never accumulate |
| duplicate URLs | no mechanism | 22 blocked |
| failure isolation | one tool error enters the history and affects every later round | one failed query affects only that query |
| **measured (two runs)** | **both hit the ceiling, no answer** | **28 seconds, 13 sourced pieces of evidence** |

To be clear: this does not mean the agent loop is worse.

Lessons 1-23's agent loop suits tasks where you do not know how many steps are
needed — editing code, debugging, exploring. Research is a task whose **shape is
known**: decompose, gather, read, summarise. A task with a known shape should have
its flow controlled by a program, with the model placed in the small boxes it is
good at.

> Choosing the wrong shape costs far more than choosing the wrong model.

---

## Step 7: one thing here goes beyond deep-research

The learning at `deep-research.ts:107` is a plain string:

```ts
learnings: z.array(z.string())
```

So when writing the report all it can do is dump everything into the prompt and
append a list of "all URLs visited". That list cannot tell you which sentence came
from which URL.

The `Learning` here also stores `sources`, and enforces a check in code:

```ts
// steps.ts：只留真的抓過的網址
sources: rawSources.filter((s) => known.has(s))
```

Models love to helpfully add a plausible-looking URL — which is exactly the
**citation grafting** seen in Lesson 21 Step 6. Here a program blocks it instead
of a prompt asking nicely.

Measured effective: all 13 pieces of evidence carry URLs that were genuinely
fetched.

But that only blocks "cited a page that was never fetched". Another error remains
unblocked: citing a page that *was* fetched, which does not actually say the
sentence.

Verifying that requires comparing sentence against body text, **which is Lesson
25's subject**. This lesson's `sources` field is the road being paved for it.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `找不到 Lesson 20 的語料` | the corpus is not generated | `bun run lesson-20:corpus` |
| `這段文字不在 embedding 快取裡` | the model generated a new query and you have no key | `PROVIDER=fake bun run lesson-24`, or set a key |
| 0 pieces of evidence | read the reason in parentheses in the trace | see Step 5; the three causes are reported separately |
| `輸出被 token 上限截斷` | too much evidence for the report to finish | lower `--breadth`/`--depth`, or raise `writeReport`'s maxTokens |
| it takes a long time | the defaults are breadth=3 depth=2 | `--breadth 2 --depth 1` is much cheaper |

---

## Exercises

### Exercise 1: raise depth to 3 ⭐

```bash
bun run lesson-24 -- --breadth 3 --depth 3
```

Look at the budget bound it prints first, then at what it actually spent.

Is the third level's query worth that money? No standard answer, but you will for
the first time be able to answer with numbers.

### Exercise 2: remove the visited dedup ⭐

Comment out `state.visited.has(hit.url)` in `research.ts`.

Watch fetches rise from 9 to whatever, and see whether the evidence count grows.
(Measured here: more fetches, almost identical evidence — **the extra money buys
the same content**.)

### Exercise 3: make `--ask` actually wait for the user ⭐⭐

`--ask` currently only prints the clarifying questions. Make it read the user's
answers and append them to `state.question` before research starts.

(`shared/repl.ts` has a `LineReader` ready to use.)

Observe: are the queries more accurate after an answer?

### Exercise 4: add "run another level when evidence is thin" ⭐⭐⭐

The budget is currently purely structural: at `depth` zero it stops, however much
evidence was found.

Change it: if the run ends with fewer than N pieces of evidence, automatically run
one more level (with a hard cap on total levels).

**The hard part is not the code but thinking through:**

1. Does this degrade into "the model decides"?
2. How do you define "thin evidence" without fooling yourself? (3 bad pieces vs 1
   good one)
3. What should the hard cap be? Based on what?

### Exercise 5: wrap the research loop as a tool for an agent ⭐⭐⭐

The other way round: give Lesson 22's agent a `deep_research(question)` tool whose
body is this lesson's loop.

To think about: when should the agent use `web_search` and when
`deep_research`? How do you word the tool description so it does not reach for the
expensive one every time?

---

## Compared with the sources

| Mechanism in this lesson | Source |
|---|---|
| `breadth/2`, `depth-1` | `deep-research/src/deep-research.ts:230` |
| next round's query = researchGoal plus followUps | `deep-research.ts:252` |
| learnings rather than pages flowing through the loop | `deep-research.ts:102` |
| a small hardcoded concurrency | `deep-research.ts:30` |
| one failed branch returns an empty result | `deep-research.ts:282` |
| `visited_urls` filtering, shared across levels | `gpt-researcher/gpt_researcher/skills/researcher.py:801`, `:108` |
| clarifying questions before research | `deep-research/src/feedback.ts` |
| defensive JSON parsing | `gpt-researcher/gpt_researcher/actions/query_processing.py:6` |

All verifiable:

```bash
bun run lesson-23:check
```

---

## Next lesson

[Lesson 25: citations and evaluation](../lesson-25-citations/): every piece of
evidence here carries a URL, but **nobody checked that the page really says that
sentence**.

```text
引用的句子在來源正文裡真的存在嗎？
數字有沒有在轉述中被改掉？
報告裡有沒有哪一句話沒有任何證據支持？
換模型、調 breadth 之後，這些指標有沒有退步？
```

The scoring will be **deterministic** as in Lesson 7, not another model handing
out marks.
