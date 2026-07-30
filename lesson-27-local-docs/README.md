# Lesson 27: Hybrid Local-Document and Web Retrieval

> [繁體中文](README.zh-TW.md)
>
> Prerequisites: [Lesson 21](../lesson-21-crawl/) (chunking),
> [Lesson 22](../lesson-22-retrieval/) (RRF and ranking).
>
> The AI Search part has searched the web throughout. This lesson points
> retrieval at **your own files**, then ranks both sides together.

## Questions this lesson answers

1. Local documents have no URL, so what is a "source"?
2. Local documents **change** — how does the index avoid recomputing everything?
3. Two completely different sources on different score scales: how do they rank
   together?
4. What happens when one side is entirely irrelevant? (This answer took three
   attempts.)

The corpus is **this repo's own markdown**: 22 files, 214 chunks. No data to
prepare, and you can read every result.

---

## Step 0: run it

```bash
bun run lesson-27:ingest    # 掃描 → 切塊 → 建索引
bun run lesson-27           # 三個示範查詢
```

```
索引：22 個檔案、214 個 chunk
  沿用 0、重切 22、移除 0
  正文共 230,931 字元
  最大的檔案：docs/TODO.md (25 塊)、lesson-23-real-world/README.md (15 塊)
```

Run it again:

```
  沿用 22、重切 0、移除 0
```

That one line is the biggest difference between this lesson and every previous
one.

---

## Step 1: local documents change, a web corpus does not

Lessons 20-26 generate their corpus once and leave it. Local documents are not
like that — edit a README today and the index is stale. And embedding costs money,
so recomputing everything each time is out.

`ingest.ts` uses a content hash to decide what to re-chunk:

```text
雜湊沒變  → 沿用舊 chunk（連帶沿用它們的 embedding）
雜湊變了  → 只重切這一個檔案
檔案不見  → 移除它的 chunk
```

This is where the real engineering in local RAG lives. Many tutorials skip it,
leaving you with a system that starts giving stale answers on its second run.

### Source identity

A web source is a URL: unique by nature and clickable. A local document needs one
constructed:

```text
docs/TODO.md#L120-L168
lesson-21-crawl/README.md#L477-L501
```

Three benefits: a user can read it, an editor can open it, **and Lesson 25's
citation verification can use it to fetch the original text and check**.

To make that possible, `chunkMarkdown` does one thing more than Lesson 21's
`chunkText`: it remembers which lines each chunk covers. Without line numbers, a
local source cannot be verified.

---

## Step 2: fusion needs almost no code (because Lesson 22 chose right)

The two sources' scores are not comparable at all: local is a BM25 score (numbers
like 2.7) and web is a signal-adjusted fusion score (numbers like 0.9).

But **RRF only looks at rank**:

```ts
rrf([localIds, webIds])   // 本地第 1 名 + 網頁第 3 名 → 1/61 + 1/63
```

Lesson 22 chose RRF because "BM25's 2.771 and a cosine's 0.83 are not on the same
scale". That same property now incidentally solves "two sources are not
comparable".

> A good abstraction pays interest where you did not expect it.
> Had a weighted sum been chosen back then, this lesson would have had to redesign
> normalisation.

---

## Step 3: but it goes wrong when one side is entirely irrelevant

The first version had no filtering, taking the top N from each side and fusing.
Then, querying "how do you choose chunk size":

```
1. [本地] 對照原始碼             lesson-21-crawl/README.md#L477-L501
2. [本地] 下一課                 lesson-21-crawl/README.md#L501
3. [網頁] retarget-anything/LICENSE
4. [網頁] A practical guide to sous vide cooking times     ← ???
```

A sous vide cooking guide ranks 4th.

The cause is not broken ranking but a property of RRF: the web corpus is about
robots and has nothing to do with chunk size, yet it still hands over a "top five",
and **RRF gives a high score to anything called "rank 1"**. The absolute level of
relevance is discarded during fusion.

```text
單一來源  top-k 沒事：爛結果排在後面，使用者自己會忽略
跨來源    top-k 有害：爛來源的第 1 名會被當成「第 1 名」對待
```

This is exactly the difference read in Lesson 23 Step 3 and merely noted at the
time: gpt-researcher filters by a **similarity threshold** rather than taking
top-k. What was written then was "a threshold is often better for an agent" — and
now it is clear that **for cross-source fusion it is not better, it is necessary**.

### Second version: a relative threshold. Useless.

"Drop anything below 35% of the top score" — and it **blocked nothing at all**.

Because Lesson 22's `score` is min-max normalised within the candidate set, so
**the top score is always near 1 regardless of whether that batch is relevant**. A
relative threshold means nothing against it.

The fix is having the pipeline also return a `denseScore` (the cosine similarity)
— the only score in the whole return value with absolute meaning.

### Third version: copy gpt-researcher's threshold. Still useless.

`SIMILARITY_THRESHOLD = 0.35` (`context/compression.py:123`). Copied over, and it
**still blocked nothing**.

Measuring shows why:

```text
query                          web 結果的 cosine 範圍
"unitree g1 retargeting…"      0.70 - 0.79    ← 真的相關
"chunk 大小要怎麼選"            0.45 - 0.50    ← 完全不相關
"BM25 RRF 融合 排序"            0.47 - 0.52    ← 完全不相關
```

`gemini-embedding-001`'s irrelevant baseline is already 0.45-0.52.
gpt-researcher's 0.35 is calibrated for OpenAI embeddings and stops working the
moment the model changes.

The separation is actually clean (0.52 vs 0.70), so take the middle: **0.60**.

> A threshold is a property of the model, not a general rule. Measure your own
> distribution before copying somebody's constant.
>
> Same class of error as Lesson 22's wrong dedup threshold (0.5 from intuition,
> 0.17 in reality), but easier to fall for: this was **an authoritative project's
> declared constant**, which makes it more comfortable not to verify.

### After the fix

```
chunk 大小要怎麼選
  本地 6 筆、網頁 0 筆（門檻擋掉 本地 0、網頁 6）
```

The cooking guide is gone, and all six results are passages this repo wrote about
chunking.

### So what does the model do with bad results? Not what was predicted

Everything above is measured on the retrieval side. But retrieval is an
intermediate product, and the real question is:

> Once the model has those 8 results (4 about robots, 1 about sous vide), does it
> actually cite them?

```bash
PROVIDER=gemini bun run lesson-27:agent            # 有門檻
FLOOR=off PROVIDER=gemini bun run lesson-27:agent  # 沒門檻
```

The verdict is deterministic: the web corpus is uniformly irrelevant to chunk
size, so any http URL appearing in the answer is wrong.

The prediction was that the model would cite the sous vide guide. **The
measurement says the opposite:**

| | Irrelevant sources retrieved | Did the model cite them (5 runs) |
|---|---|---|
| with the floor | 0 | not applicable |
| without the floor | **4** | **0/5, never once** |

The model avoided them every time. The sous vide guide lay right there in context
and it simply did not touch it.

### So the floor's value is not what it appeared to be

What it blocks is not "garbage that gets cited" but **slots**:

```
有門檻    8 個位置：本地 8 筆
沒門檻    8 個位置：本地 4 筆 + 不相關的網頁 4 筆
                    ↑ 4 筆相關的本地文件被擠掉了
```

> The real damage is crowding out, not hallucination.
>
> Those 4 robot pages did not make the model say anything false; they merely
> **occupied 4 slots** that could have held passages this repo wrote about
> chunking. The user does not see a wrong answer, they see a **thinner** one, and
> they will not know why.

There is a second bill, back to Lesson 26: you pay for those 4 results' tokens.

### Do not read this 0/5 as safety

```
○ 模型自己避開了：不相關的來源進了 context，但沒被引用
   注意這不是門檻在保護你，是模型剛好沒上當。
```

The code deliberately prints `○` rather than `✓`, because the two are entirely
different:

- **✓ with the floor**: the garbage never enters context. That is a structural
  guarantee
- **○ without the floor**: the garbage got in and the model happened not to fall
  for it

Lesson 17 Step 3.5 demonstrated the same thing: a model papers over bad
infrastructure, usually successfully, **but "usually" is not something you can rely
on**. Five for five proves five for five.

---

## Step 4: the source distribution is itself a signal

The three demo queries each represent a situation:

| Query | Local | Web | Meaning |
|---|---|---|---|
| `chunk 大小要怎麼選` | 6 | 0 | the web index does not cover this topic |
| `unitree g1 retargeting deprecated` | 3 | 3 | both sides have it — and they **complement** each other |
| `BM25 RRF 融合 排序` | 6 | 0 | as above; this is our own domain |

The second row is the interesting one. The three local hits are Lesson 20's README
(discussing the traps inside this corpus), and the three web hits are the corpus
itself. **One is "our understanding of this thing", the other is "the raw
material".**

In practice that is hybrid retrieval's most valuable shape:

```text
本地  你的團隊對某件事的結論、決策紀錄、踩過的坑
網頁  外面的原始資料、官方文件、最新變動
```

And "local only" and "web only" are both useful information: the former says the
external index does not cover it, the latter says **your documents have not
written about it yet**.

---

## Step 5: what is not done (an honest list)

| Not done | Why |
|---|---|
| dense retrieval over local chunks | embedding all 214 chunks costs money, and every file edit means recomputing. Pure BM25 is in fact adequate for your own documents, because you search with words you wrote |
| PDF / docx / slides | a format-parsing problem with nothing to do with retrieval. Wire up something like `pdf-parse` and the chunking strategy stays the same |
| code indexing | code's vocabulary distribution is too far from prose, and mixing them degrades retrieval. Doing it properly needs a different chunking strategy (split by function) |
| an authority signal for local documents | Lesson 22's `HOST_PRIOR` means nothing locally. Doing it means defining your own (say `docs/` over drafts), and that is each team's own rule |
| conflict detection | flagging when local says A and web says B. That needs semantic comparison, out of scope here |

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `本地索引是空的` | not ingested yet | `bun run lesson-27:ingest` |
| edited a file but the results did not change | the index is not updated | re-run ingest (it tells you how many were re-chunked) |
| `dense 不可用` | no key and the query is not in the cache | normal; it degrades to pure keyword. Set a key for full function |
| every web result is blocked | the 0.6 floor is too high for your embeddings | **measure your own distribution** before tuning, see Step 3 |
| it scanned the cloned reference projects | `SKIP_DIRS` does not cover them | add them in `ingest.ts` |

---

## Exercises

### Exercise 1: edit one file and watch the incremental update ⭐

Change any line of `docs/TODO.md` and re-run `bun run lesson-27:ingest`.

You should see "沿用 21、重切 1". This step is the watershed for whether local RAG
can ship.

### Exercise 2: measure your own model's threshold ⭐⭐

Step 3's 0.60 came from measuring `gemini-embedding-001`. Change embedding model
(`EMBED_MODEL=text-embedding-3-small` with an OpenAI key) and measure the
distribution again.

Care to guess whether it lands on 0.35?

### Exercise 3: wire local sources into Lesson 25's citation verification ⭐⭐

`verifyClaim` currently only understands URLs. Add local sources:
`docs/TODO.md#L120-L168` can read those exact lines back for comparison.

Finish this and your citation verification covers both source types.

### Exercise 4: let Lesson 24's research use local documents ⭐⭐⭐

Replace `retrieve` in `research.ts` with `hybridSearch`.

Then think two things through:

1. A local chunk has no "page" to `fetch_page`, so how does `runQuery` change?
   (Hint: the chunk is the content; there is nothing to fetch again)
2. Local sources have no publication date, so what happens to Lesson 22's
   freshness signal? (Hint: a file has an mtime, but that is "modification time",
   not "content freshness")

### Exercise 5: add conflict detection ⭐⭐⭐

Same query, both local and web return results, and they disagree.

Work out **how to define "disagree"** first — much harder than implementing it.
(Hint: start with the narrowest case, such as the same number differing on the two
sides. Do not start by trying to build general semantic contradiction detection.)

---

## Compared with the sources

| Concept in this lesson | Reference |
|---|---|
| local document loading | `gpt-researcher/gpt_researcher/document/` (5 files, including Azure and LangChain loaders) |
| a local vector store | `gpt-researcher/gpt_researcher/vector_store/` |
| a similarity threshold instead of top-k | `gpt-researcher/gpt_researcher/context/compression.py:123` |
| RRF | this series' [Lesson 22](../lesson-22-retrieval/) |

> gpt-researcher supports local documents by treating them as another retriever,
> the same shape as here. The difference is that it embeds local documents too
> while this lesson only does BM25 — **because these documents keep changing,
> while their use case is "one fixed dataset for one research run". Different use
> case, different trade-off.**

---

## The AI Search part (Lessons 20-27) ends here

```text
20  snippet 不是網頁；query 決定你看到頁面的哪一面
21  正文只佔一半；抽取失敗是靜默的
22  BM25 + dense + 融合 + 訊號；平均分數會騙人
23  真實專案怎麼做；抄回來炸出潛伏三課的 bug
24  控制流從模型手上拿回來；預算是算出來的
25  引用要驗；評估自己也會錯
26  total ≠ input + output；thinking 吃掉 maxTokens
27  本地文件會變；門檻是模型的性質不是通則
```

Six of the eight lessons ended with a conclusion different from the prediction
made before work started. Those differences are the content.

---

## Next lesson

The AI Search part ends here. What comes next is planned in
[docs/TODO.md](../docs/TODO.md): Lessons 28-37 handle "the ring around the loop" —
evidence of execution, schema compatibility, durable state machines, sandboxing.

The highest priority among them is **Lesson 29, "evidence of completion"**,
because it answers the question Lesson 8 left behind: the permission engine
blocked every operation, not one byte of the file changed, and then the model told
the user it was done.
