# Lesson 22: Retrieval and Ranking

> [繁體中文](README.zh-TW.md)
>
> Prerequisites: [Lesson 20](../lesson-20-search-agent/) (the BM25 baseline),
> [Lesson 21](../lesson-21-crawl/) (`fetch_page`).
>
> This lesson demolishes a very common impression: AI search is not "throw the
> documents into a vector database and take the top 5".

## Questions this lesson answers

1. Where exactly is BM25 not enough? Where is dense retrieval not enough?
2. How do two rankings combine into one? (The score scales are completely
   different — how do you add them?)
3. How do you **compute** "this page is a content farm" rather than labelling it
   yourself?
4. After adding a new signal, how do you know it did not break something else?
5. If ranking improves, does the agent improve?

The answers to the fourth and fifth are both measured, and both differ from what
was expected.

---

## Step 0: the numbers first

Every stage of this lesson is measurable. Eight queries, graded relevance
judgements, deterministic scoring:

```bash
bun run lesson-22:eval
```

```
query               BM25 only    Dense only    + RRF 融合      + 去重     + 品質訊號   + 來源多樣性
q1-main                  0.233       0.212       0.318       0.318       0.705       0.705
q2-chinese               0.000       0.598       0.598       0.598       0.774       0.774
q3-deprecated            0.920       0.834       0.920       0.704       0.784       0.784
q4-joint-order           0.816       0.895       0.908       0.908       0.948       0.948
q5-maintained            0.337       0.141       0.144       0.144       0.616       0.616
q6-license               0.932       0.956       0.956       0.956       0.932       0.932
q7-foot-sliding          1.000       0.877       0.920       0.920       1.000       1.000
q8-dataset               1.000       1.000       1.000       1.000       1.000       1.000
──────────────────────────────────────────────────────────────────────────────────────────
平均 nDCG@5              0.655       0.689       0.720       0.693       0.845       0.845
平均 recall@5            0.675       0.775       0.775       0.744       0.919       0.919
平均 novelty@5           0.950       0.975       0.975       1.000       1.000       1.000
```

0.655 → 0.845. But the most valuable thing in that table is not the last number;
it is the cells in the middle that **got worse**. Each one is a trap found by
measurement, and each is covered below.

> No key needed: the embeddings are precomputed in `embed/cache.json` and
> committed. Only new queries or new documents require
> `bun run lesson-22:embed`.

---

## Step 1: three ways BM25 dies

The BM25 from Lesson 20 does well on three queries (0.920, 0.932, 1.000) and
terribly on three others. Where they go wrong:

| Query | BM25 | Why |
|---|---|---|
| q2 "把影片動作轉到人形機器人的開源專案" | **0.000** | not one English token comes out. Not mis-ranked but **no results at all** |
| q1 open source video to humanoid retargeting for unitree g1 | 0.233 | the SEO farm has the most keywords, and the right answer ranks eighth |
| q5 which project is actively maintained | 0.337 | no page ever writes "am I still alive", so there is nothing literal to match |

All three deaths have one cause: BM25 only knows the literal.

q5 is especially worth a look. What the user wants to know is "has this been
updated recently", and that lives **in the dates, not in the text. Some
questions have answers that are not in the body but in the metadata** — which is
why the quality signals in Step 4 exist.

---

## Step 2: dense retrieval, and how it is not enough either

Turn text into vectors and find by meaning instead of by word.

```bash
bun run lesson-22:eval --show q2
```

The Chinese query scores 0.000 on BM25 and 0.598 on dense. Measured cosine
similarities:

```
cos("video to humanoid retargeting", "把影片動作轉到人形機器人") = 0.817
cos("video to humanoid retargeting", "sous vide cooking times")  = 0.449
```

Cross-language comes free. There is no translation and no bilingual glossary;
two pieces of text simply happen to land near each other in the same vector
space.

### Dimensionality is a trade-off, not "bigger is better"

`gemini-embedding-001` defaults to 3072 dimensions and the API accepts smaller
ones. Measured:

```
dims=256    cos(英文, 中文)=0.861    cos(英文, 烹飪文)=0.569    差距 0.29
dims=768    cos(英文, 中文)=0.817    cos(英文, 烹飪文)=0.449    差距 0.37
```

What matters is not "how similar to the Chinese" but **the gap between the two**.
At 256 dimensions even a completely unrelated cooking article scores 0.569; the
discrimination is flattened. This lesson uses 768.

### But dense alone loses

Look at the cells where dense is worse than BM25:

```
q3 retarget-anything g1 profile deprecated 2026 sdk    BM25 0.920  →  dense 0.834
q7 foot sliding contact solver flat sole humanoid      BM25 1.000  →  dense 0.877
```

Both have very **precise strings** in them (project names, version numbers,
terminology). Dense dilutes those into "roughly about this topic", and every page
on a nearby topic crowds in.

```text
BM25   認得罕見的專有名詞，看不懂同義詞和其他語言
Dense  抓得到意思，精確字串反而會被稀釋
```

**Their failure modes are complementary**, so the answer is not to pick one.

---

## Step 3: RRF — fusion with no weights to tune

Two rankings have to become one. The intuitive approach is a weighted sum, and it
gets stuck immediately: a BM25 score is 2.771 and a cosine is 0.83, **completely
different scales**. Adding them requires normalisation first, and the choice of
normalisation becomes another parameter to tune.

RRF sidesteps it: look only at ranks, not scores.

```ts
score(d) = Σ  1 / (K + rank_i(d))     // K = 60
```

First on BM25 and third on dense gives `1/61 + 1/63`. No weights to tune.

```
BM25 0.655   Dense 0.689   →   RRF 0.720
```

Better than either alone, and **it introduces no parameter that needs tuning**.
Which is why RRF is so common in practice: it is cheap, parameter-free, and
usually beats a tuned weighted sum.

---

## Step 4: quality signals must be computed, not labelled

This is the easiest place in the lesson to write cheating code.

The corpus's `pages.ts` has a `kind: "spam"` field, and the ranker could just
read it and then claim "look, the farm got pushed down". **That teaches
nothing** — real pages do not confess to being farms.

So all three signals use only things computable from the page itself:

### Freshness: exponential decay, not a threshold

```ts
freshness = exp(-ln2 * days / 540)    // 半衰期 18 個月
```

Why not "discard anything over a year old"? Because **old is not wrong**. An
arXiv paper is useful after three years; an SDK document can be stale in three
months. Decay is a mild preference; a threshold is a cleaver.

### Authority: a hand-maintained domain prior

```ts
"unitree.com": 1.0    "github.com": 0.9    "discourse.ros.org": 0.7
"robotblog.example.com": 0.3    "top-robotics-tools.example.net": 0.1
```

This is a manual table. It looks crude, but **real systems do the same thing**
(domain authority and trust rank are elaborate versions of it). It is a prior,
not a verdict: an irrelevant page on a high-authority domain still does not rank.

### Keyword stuffing: the only one genuinely computed

```ts
最高頻的詞出現幾次 / 總詞數
```

The measured distribution over the corpus:

```
 60 字   "retargeting" × 12  = 20.0%   ← SEO 農場
 73 字   "retargeting" ×  6  =  8.2%   ← 2025 年的懶人包
122 字   "profile"     ×  5  =  4.1%   ← 正常的 repo README
 96 字   "profile"     ×  3  =  3.1%   ← 正常
```

Normal articles sit at 3-4%, farms at 8% and above. The threshold ramps linearly
between 4% and 10%.

With those three signals added: **0.720 → 0.845**, q1 jumping from 0.318 to
0.705 and q5 from 0.144 to 0.616.

---

## Step 5: the evaluation caught a regression nobody saw

This is the most important section in the lesson.

The first version of stuffing detection **looked only at the ratio**. After the
evaluation, the average rose from 0.720 to 0.768, which looks like a success. But
per query:

```
q8-dataset      1.000  →  0.131      ← 崩了
```

Looking only at the average, that collapse is buried under the other queries'
gains.

### Diagnosis

```bash
bun run lesson-22:eval --show q8
```

That dataset page ranked **first in both BM25 and dense**, and after the signals
were added it fell out of the top five. Printing every page's stuffing score:

```
 60 字   "retargeting" × 12  = 20.0%  → stuff 1.00   SEO 農場      ✓ 該罰
 28 字   "clips"       ×  3  = 10.7%  → stuff 1.00   資料集頁面    ✗ 冤枉
 25 字   "license"     ×  4  = 16.0%  → stuff 1.00   LICENSE 檔    ✗ 冤枉
 25 字   "food"        ×  2  =  8.0%  → stuff 0.67   烹飪文章      ✗ 冤枉
```

A ratio is systematically biased against short documents. A 25-word licence file
is going to keep saying "license"; that is not cheating, that is just how short
it is.

### The fix

Add an absolute-count threshold: fewer than 5 repeats is never stuffing, however
high the ratio.

```ts
if (top < MIN_REPEATS) return 0;
```

All three false positives go to zero, and the farm (12 repeats) is still caught.

```
平均 nDCG@5   0.768（有 bug）  →  0.845（修好）
q8-dataset    0.131            →  1.000
q7            0.920            →  1.000
```

### What this section is actually teaching

> A rising average does not mean nothing broke.

Without the per-query table, 0.768 would have gone happily into the README and
three more lessons would have been written on top of a "short pages are always
demoted" bug.

Same value as Lesson 7 catching "the agent did not report the video clock
offset": an evaluation's use is not proving you did well, it is telling you what
broke.

---

## Step 6: dedup made the score worse, so another metric was added

The moment the dedup stage is enabled, nDCG drops:

```
+ RRF  0.720   →   + 去重  0.693
q3-deprecated  0.920  →  0.704
```

The reason is clear: in q3's judgements, `retarget-anything`'s GitHub README and
its docs site **are both graded relevance 3** (both genuinely carry the
deprecation notice). Cut one and you lose its points.

### Two roads

One is to change the judgements, demoting the mirror to relevance 1, and the
number immediately looks better. That is editing the exam so the program passes.

The other is to admit that nDCG cannot see duplication at all. The academic
metric for this is α-nDCG (already-seen information gets discounted); here it is
a more legible version, counting how many of the top five are new:

```
平均 novelty@5    0.975（RRF）  →  1.000（去重後）
```

Which makes the accounting for this stage explicit:

```text
nDCG@5     0.720 → 0.693    （-0.027，因為評估集把鏡像也算相關）
novelty@5  0.975 → 1.000    （+0.025，前五名不再有重複內容）
```

**Dedup stays**, for a reason that is not in nDCG: to an agent, a duplicate page
costs one wasted `fetch_page` and a whole chunk of context (Lesson 21). nDCG
cannot measure that cost, but it is real.

> The lesson: **when an existing metric cannot see what you care about, add
> another metric; do not edit the evaluation set.**

### Incidentally, the threshold here was wrong too

The near-duplicate threshold was initially set to 0.5 from intuition — surely a
mirror site is at least half identical. Measured:

```
shingle 長度   鏡像對   第二相似的一對   差距
     2         0.346       0.118       0.228
     3         0.266       0.065       0.201
     4         0.215       0.048       0.167
     5         0.174       0.040       0.133
```

Mirror pairs score only 0.17-0.35, because the docs site in this corpus is not
copy-paste but a rewritten, condensed version — which is what most real-world
mirrors look like.

The consequence of a 0.5 threshold is that **dedup never fired once**, and nDCG
would never tell you, because "did nothing" and "did something with no effect"
look identical in an average. The final choice is n=3 with a threshold of 0.15
(0.266 vs 0.065, safe on both sides).

---

## Step 7: two stages that did nothing, reported anyway

### Source diversity: no effect whatsoever

```
+ 品質訊號 0.845   →   + 來源多樣性 0.845
```

Identical. Because this corpus has at most 3 pages per domain, and none of the
eight queries puts one domain in the top five three times.

It is dead code on this corpus. It stays because real corpora certainly need it
(a documentation site can have tens of thousands of pages), but pretending it
contributed here would be dishonest.

### LLM rerank: +0.013

The final stage has the model re-rank the top 8 (`retrieve/rerank.ts`). It is the
most expensive step in the pipeline, so it is off by default:

```bash
bun run lesson-22:eval --rerank
```

```
+ 來源多樣性 0.845   →   + LLM rerank 0.858
```

Only one of the eight queries improved (q2, the Chinese one, 0.774 → 0.876); the
other seven did not move at all.

Why so small? Because the earlier stages already surfaced the right answers among
14 documents, leaving rerank nothing to fix. Real corpora are **millions of pages
with candidates of wildly varying quality**, and that is where rerank earns its
keep.

> Do this arithmetic yourself: one extra model call per query and a few hundred
> milliseconds of latency in exchange for +0.013. Not worth it on this corpus,
> possibly very worth it on yours. The point is having a number to compute rather
> than "everyone says you need rerank".

The textbook approach is a cross-encoder (the `ms-marco-MiniLM` family), orders
of magnitude cheaper than an LLM. An LLM is used here only to avoid a model-weight
dependency; **the shape is the same**: a model that sees the query and the full
document re-scores it.

---

## Step 8: ranking improved, the agent did not

This is the most surprising section.

Retrieval quality measured offline went from 0.655 to 0.845 — and the agent? Rerun
Lesson 20's question:

```bash
bun run lesson-22
> 有哪些 open source 專案可以把影片動作 retarget 到 Unitree G1？
```

Two runs, both:

```
web_search × 14
fetch_page × 2
[已達 16 步上限]        ← 沒有答案
```

Control: Lesson 21 (same question, same model, worse ranking) took 11 searches
plus 2 fetches and **did answer**.

Better ranking made this question worse.

### Why

Look at what it searched for:

```
web_search("HumanPlus" humanoid video retargeting github)
web_search(dex-retargeting github Unitree G1)
web_search("Open-TeleVision" github Unitree G1)
web_search("GMR" "General Motion Retargeting" humanoid github)
```

`HumanPlus`, `dex-retargeting`, `Open-TeleVision`, `GMR` — **none of these
projects exist in the corpus**. They come from the model's training data.

It is not looking for an answer; it is looking for links to things it remembers.
The very first search already had the right answer near the top, but the model did
not stop, because nothing told it "you have found it, you can stop".

```text
排序解決的是：「回來的東西好不好」
排序不解決的是：「要搜幾次、什麼時候停、已經搜過什麼」
```

The second is entirely on the agent's side and has nothing to do with retrieval.
**That is Lesson 24's subject:**

```ts
type ResearchState = {
  visitedUrls: Set<string>       // 已經讀過什麼
  evidence: Evidence[]           // 哪些證據支持哪個 claim
  unresolvedQuestions: string[]  // 還缺什麼
  iteration: number              // 該不該停
}
```

> This lesson still has a conclusion worth keeping: **retrieval quality is
> offline-measurable and regression-testable, and that alone is valuable.** You
> do not want to tune BM25 parameters against something as noisy as agent
> behaviour.
>
> Get the offline-measurable part to a level you are happy with first, then deal
> with agent behaviour.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `這段文字不在 embedding 快取裡` | a new query and no key | `bun run lesson-22:embed`, or use a query from the evaluation set |
| `找不到 Lesson 20 的語料` | the corpus is not generated | `bun run lesson-20:corpus` |
| the scores differ from the README | the embedding model changed | the cache has a model field; check it is `gemini-embedding-001` |
| `--rerank` errors | that stage needs a key | leave `--rerank` off; it is off by default |
| the freshness scores look odd | "today" is hardcoded to 2026-07-27 | see `TODAY` in `rank.ts`; it is there for reproducibility |

---

## Exercises

### Exercise 1: remove MIN_REPEATS ⭐

Comment out `if (top < MIN_REPEATS) return 0` in `retrieve/rank.ts` and re-run
the evaluation.

Watch q8 fall from 1.000 to 0.131 while the average **still rises**. Two minutes
of work, and you will never forget why per-query numbers matter.

### Exercise 2: tune RRF's K ⭐

Change K from 60 to 10 and to 200, and watch nDCG move.

To think about: as K shrinks, does the gap between first and second place widen or
narrow? When would you want a very small K?

### Exercise 3: add a "content depth" signal ⭐⭐

None of the current signals care how much substance a page has. Add one: body
length, presence of concrete numbers, presence of version numbers or dates.

Think first: will this signal also be systematically biased against some class of
page? (Recall Step 5. A LICENSE file is short, and it is supposed to be.)

Run the evaluation afterwards, per query.

### Exercise 4: make dense chunk-level ⭐⭐

Right now one document is one vector. A long document gets "averaged" into
something resembling nothing (this is called dilution). Switch to Lesson 21's
`chunkText`, one vector per chunk, representing the document by its most similar
chunk.

Observe: does it matter on this corpus of short documents? (Possibly not — then
record that honestly.)

### Exercise 5: change embedding model ⭐⭐

Use `EMBED_MODEL=text-embedding-3-small` with an OpenAI key, rebuild the cache,
and re-run the evaluation.

This exercise practises **regression testing**: changing model is a large change,
and you need to be able to answer "did it get better or worse" rather than "feels
about the same".

### Exercise 6: make rerank worth its price ⭐⭐⭐

Step 7 says rerank added only 0.013. Find a way to make it matter:

1. Raise `CANDIDATES` above 10 so rerank has worse candidates to fix
2. Or turn the quality signals off and let rerank do their job

Which is better? What should cheap deterministic rules be responsible for, and
what should an expensive model? (Recall Lesson 6: rules for recall, the model for
precision.)

---

## Compared with the sources

| Concept in this lesson | Reference |
|---|---|
| hybrid sparse + dense + graph indexing | [txtai](https://github.com/neuml/txtai) |
| the vector index itself (HNSW, payload filters) | [Qdrant](https://github.com/qdrant/qdrant) |
| RRF | Cormack et al., 2009 |
| result normalisation after multi-source aggregation | [SearXNG](https://github.com/searxng/searxng) (Lesson 23) |
| deterministic scoring, per-query regression | this series' [Lesson 7](../lesson-07-evaluation/) |

> The source of these projects has not been read line by line, so only concepts
> are matched up (design principle 4).

One positioning worth remembering: **Qdrant is a part, txtai is an assembled
layer, and this lesson assembles the parts by hand once.** You would not
hand-write HNSW in production, but you do need to know how much work remains
after top-k comes back — and no vector database does any of it for you.

---

## Next lesson

[Lesson 23: against the real source](../lesson-23-real-world/): Step 8's result,
where retrieval improved and the agent did not, is not something ranking can fix.
Ranking decides how good what comes back is, not how many searches to run or when
to stop.

So the next lesson writes nothing new. It reads the source of four real projects
(deep-research, gpt-researcher, Firecrawl, Crawl4AI), copies their query rules
back, **changes only the system prompt**, and runs the same question again.

> 📌 The original plan for that lesson was "build a Tavily-lite", wrapping
> Lessons 20-22 into an HTTP service. **That plan was rejected**, with the reason
> recorded in [docs/TODO.md](../docs/TODO.md): taken apart, very little of
> "wrapping it as a service" is actually learning AI search — `POST /search` and
> deployment are web development, while "how many pages to fetch at once, how to
> divide a latency budget" is really a **caller-side** decision, belonging to
> Lesson 24.
