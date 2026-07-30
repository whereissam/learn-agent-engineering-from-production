# Lesson 25: Citations and Evaluation

> [繁體中文](README.zh-TW.md)
>
> Prerequisites: [Lesson 7](../lesson-07-evaluation/) (deterministic scoring),
> [Lesson 24](../lesson-24-research-loop/) (the evidence research produces).
>
> The last lesson of the AI Search main line (26 and 27 are follow-ups). What it
> catches is a mistake that **looks entirely compliant**.

## Questions this lesson answers

1. Every sentence in the report carries a URL — how do you know that page really
   says it?
2. This sounds like a semantic judgement; why not use an LLM as the judge?
3. How much does a crude deterministic check catch? What does it miss?

---

## Step 0: a real mistake

This is a sentence from a report Lesson 24 actually produced (`fixtures.ts`, not
one character changed):

```markdown
* **軟體授權**：代碼庫本身採用 MIT 授權發布，但其運作所需的預訓練姿勢骨幹
  模型權重必須單獨下載，且屬於非商業授權
  (https://github.com/kinelabs/humanoid-mimic,
   https://discourse.ros.org/t/g1-retargeting-foot-sliding/45211,
   https://blog.kinelabs.dev/humanoid-mimic-0-7)
```

Three URLs. The first and the third genuinely discuss licensing. **The second is
a forum thread about foot sliding that never mentions licensing at all.**

This is **citation grafting**:

```text
網址是真的
頁面是真的抓過的（Lesson 24 已經擋掉編網址）
內容也是真的
但這一頁不支持這句話
```

It is more dangerous than a wholesale hallucination, because **every layer of
checking lets it through**. You click, see a genuine technical article, and
believe the whole sentence.

---

## Step 1: why not use an LLM as the judge

"Is this sentence supported by this page" sounds exactly like a semantic
judgement, and having a model score it feels natural. But Lesson 7's principle
holds here too:

> Scoring must be deterministic, or you cannot answer "did that change make
> things worse".

If the judge itself drifts, `--compare` becomes meaningless — you cannot tell
whether the system regressed or the judge is in a different mood today. Lesson 22
Step 5's "average rose while one query collapsed" was caught precisely by
deterministic scoring.

So this lesson uses a very crude method:

```text
1. 從句子裡抽出可查核的「原子」：數字、版本、日期、識別字、授權名稱
2. 去每一個被引用的來源正文裡找這些原子
3. 一個原子都找不到的來源  → 這個引用是嫁接的
4. 所有來源都找不到的原子  → 這個數字是編的或改過的
```

It checks no semantics, only whether these specific things are present.

---

## Step 2: run it

```bash
bun run lesson-25
```

Four reports: one is Lesson 24's real output, three are **deliberately corrupted**
versions of it (the corruptions are written in `fixtures.ts` so you can check them
yourself).

```
Lesson 24 的真實輸出（一個字沒改）
  claims 12  uncited 1  atoms 68  unsupported 5  grafted 1  unknown 0

數字漂移        埋的錯：0.8x → 0.5x、18 ms → 8 ms、50 Hz → 120 Hz
  claims 12  uncited 1  atoms 68  unsupported 8  grafted 1
  ✓ unsupported 8 ≥ 3

引用嫁接        埋的錯：關節索引那條多掛一個烹飪網站；腳步滑動那條改掛募資新聞
  claims 12  uncited 1  atoms 68  unsupported 10  grafted 3
  ✓ grafted 3 ≥ 2

裸露斷言        埋的錯：把一半行數的引用整個拔掉
  claims 12  uncited 6  atoms 68  unsupported 37  grafted 0
  ✓ uncited 6 ≥ 5
```

All three corrupted versions are caught. But **the first one is the interesting
part**.

---

## Step 3: what the checker found in the real output

```bash
bun run lesson-25 -- --show real
```

The real report has 12 claims and 68 atoms, and three problems were found, **all
three genuine**:

### 1. An assertion with no citation at all

```
✗ 目前有兩個主要的 Open Source 專案可用於將影片動作重定向至 Unitree G1：
  kinelabs/humanoid-mimic 與 openmotion/retarget-anything
    沒有引用
```

This is the report's **central conclusion**, and it carries no source. Every
detail below it has citations, but the most important sentence does not. Very
typical: the model attaches citations to "details" and feels a "summary" needs no
source.

### 2. Citation grafting

```
✗ * **軟體授權**：代碼庫本身採用 MIT 授權發布…
    https://github.com/kinelabs/humanoid-mimic          支持 2 個原子
    https://discourse.ros.org/t/…/45211                 嫁接：這一頁沒有支持這句話的任何內容
    https://blog.kinelabs.dev/humanoid-mimic-0-7        支持 2 個原子
```

That is Step 0's sentence. The checker found by itself what previously took a
pair of eyes.

### 3. A word with no source

```
✗ 執行需使用 Python 3.11 與 CUDA 12，純 CPU 推論速度比 GPU 推論慢約 40 倍
    查無來源：GPU
```

The source's original text is:

```text
CPU-only inference works but runs roughly 40x slower
```

It says "CPU-only is roughly 40x slower" and **never says slower than what**. The
report supplied "than GPU" — a reasonable inference, but the model added it; the
source did not say it.

That kind of small completion is the most common way a report distorts, and it is
nearly impossible to find by manual spot-checking.

---

## Step 4: three traps, all on the evaluation side

The part of this lesson most worth keeping is the **three times the evaluation
itself was wrong**. A broken evaluation is more dangerous than a broken system,
because it sends you to fix something that is not broken.

### Trap 1: the sentence-splitter's placeholders broke, so every citation went empty

The first version of `splitSentences` replaced URLs with placeholders, split, and
then restored them. The placeholder was written wrongly (a character that should
have been whitespace was something else), so **no URL was ever restored**.

Result:

```
claims 12  uncited 12  atoms 82  unsupported 82  grafted 0
```

Every claim "has no citation" and every atom "has no source". And the program
raised nothing; all four reports "completed".

Looking only at "did it complete", Lesson 24's report would have looked
catastrophically bad.

The fix is not fixing the placeholder but **removing placeholders entirely** —
`。！？` never appear inside a URL, and an ASCII `.` only splits when followed by
whitespace, which never happens after a dot inside a URL. One less mechanism is
one less thing that can break.

### Trap 2: the source the evaluation reads is not the source the agent read

After that fix, the joint-mapping claim was judged:

```
查無來源：7, 9, 3, 17, 15, left_hip_pitch, left_knee, rad/s
```

But those numbers are **plainly on the page**.

The cause: Lesson 21's `fetcher.ts` returns a **dynamically generated long
document** for `unitree.com/g1/developer` (that SDK migration guide), while the
evaluation read the short version straight from `corpus/index.json`.

```text
agent 讀到的   ≠   拿來對答案的
```

So **correct citations were judged hallucinated**. The fix is making the
evaluation go through exactly the same `fetchPage` plus `extractMain` path as
`runQuery`.

> The evaluation's sources must be the same sources the system actually saw.
> That sounds trivial, and it is the most expensive line in this lesson.

### Trap 3: normalisation glued adjacent numbers together

Two false positives remained: the `6` in "2026 年 6 月" and the `2004` in
"Apache License… 2004 年 1 月".

The sources are English (`released June 2026`), so month conversion turned
`june → 6`, and then all whitespace was removed to make comparison easier:

```text
"released June 2026"  →  "released 6 2026"  →  "released62026"
原子 6 的比對條件是「前後不能接數字」  →  後面接著 2  →  判定查無來源
```

The fix: **numbers and identifiers need different normalisation**. Identifiers
drop whitespace (so `Apache-2.0` equals `Apache - 2.0`), while numbers keep a
single space as a boundary.

With all three traps fixed, the real report went from "14 unsourced" to "5", and
the remaining 5 are **all genuine problems**.

---

## Step 5: what this method cannot catch (stated up front)

| Catches | Misses |
|---|---|
| citing a source that does not say it | all atoms present but the causality reversed |
| numbers altered or invented | subjective sentences with no atoms, like "A is better than B" |
| factual sentences with no citation at all | the source says "unsupported" and the report says "supported" |
| citing a URL that does not exist | quoting out of context (the citation exists, the context is opposite) |

The last cell deserves particular care: finding all of a sentence's atoms does not
make the sentence true.

So why is it worth doing?

> Better a deterministic check that catches 70% of problems than an LLM judge
> claiming 95% whose results differ every run.

And it is cheap (no model), reproducible, CI-able, and regression-testable. The
remaining 30% needs manual spot-checking — but the scope of that checking has been
narrowed to the sentences whose atoms all line up.

---

## Step 6: regression comparison

Same shape as Lesson 7:

```bash
bun run lesson-25 -- --save      # 存成基準
bun run lesson-25 -- --compare   # 之後每次改動都比一次
```

```
跟基準比較
  ✓ 所有指標跟基準一致
```

Run this after changing Lesson 24's prompt, switching models, or adjusting
breadth. A worse metric is stated outright, along with which report and which
metric.

Without this step, all you have is "feels like it got better".

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `找不到 Lesson 20 的語料` | the corpus is not generated | `bun run lesson-20:corpus` |
| every claim reads "no citation" | the report format is not "URLs in parentheses at the end of a sentence" | change `URL_PATTERN` and footnote parsing in `report.ts` |
| correct citations judged as grafted | the evaluation reads different sources from the system | see Step 4, trap 2 |
| `還沒有基準` | `--save` has never run | `bun run lesson-25 -- --save` |

---

## Exercises

### Exercise 1: wire Lesson 24's output in ⭐⭐

The fixtures are hardcoded. Read Lesson 24's actual report instead (add a `--json`
output to `demo.ts`, or just write it to a file).

Then: run the same question three times and see how far the metrics differ across
the three reports. That tells you Lesson 24's stability, which is something
nothing has measured so far.

### Exercise 2: add an "opposite context" check ⭐⭐⭐

Step 5 says it cannot catch "the source says unsupported, the report says
supported".

Devise a deterministic method. Hint: the presence of negations (not, no longer,
deprecated, 不再, 已棄用) in the source versus in the claim makes a crude but
useful signal.

Work out its false-positive rate first, then decide whether to build it.

### Exercise 3: make it a gate in Lesson 24 ⭐⭐

Right now it evaluates after the fact. Change it: after `writeReport` produces the
report, **verify first**, and strip a grafted citation before output.

To think about: stripping the citation turns that sentence into a bare assertion —
is that worse? Or should the whole sentence go? Who decides?

### Exercise 4: run it on a different domain ⭐⭐⭐

This is the real homework. Feed in an AI-generated report from your own domain
(just put the source bodies into the corpus map).

You will probably find three things:

1. Atom extraction needs tuning (your domain has its own identifier formats)
2. There will be more false positives than here (real sources are messier than this
   corpus)
3. **It will still catch things** — usually the kind you would not find in ten
   readings

---

## Compared with the sources

| Concept in this lesson | Reference |
|---|---|
| deterministic rubric, `--save` / `--compare` | this series' [Lesson 7](../lesson-07-evaluation/) |
| evidence bound to sources | this series' `Learning.sources` in `lesson-24-research-loop/state.ts` |
| writing a long report without losing citations | `gpt-researcher/gpt_researcher/actions/report_generation.py` (309 lines) |

> None of the four real projects (deep-research, gpt-researcher, firecrawl,
> crawl4ai) **has citation verification**. They produce citations, but not one of
> them goes back to check the citations hold. That is not a knock on them — this
> is something only someone inside the domain can do, because only you know what
> your sources look like and which errors your users care about.

---

## The AI Search part ends here

Six lessons, from "one agent plus one search tool" to "a measurable research
pipeline":

```text
20  搜尋回來的不是網頁，是 snippet；query 決定你看到頁面的哪一面
21  正文只佔一半；抽取失敗是靜默的
22  BM25 + dense + 融合 + 去重 + 訊號；平均分數會騙人
23  真實專案怎麼做的；抄回來之後炸出一個潛伏三課的 bug
24  控制流從模型手上拿回來；預算是算出來的，不是撞出來的
25  引用要驗；評估自己也會錯
```

Every lesson has a measurement record, and **every lesson's conclusion differs
from the prediction made before the work started**. Those differences are what
this part is actually about.

---

## Next lesson

[Lesson 26: cost and budget](../lesson-26-cost/): none of these six lessons ever
measured money. gpt-researcher threads a `cost_callback` through **every** LLM
call; here there is not one.

That lesson measures something counter-intuitive: `total` is far larger than
`input + output`, and the difference not only costs money but eats into your
`maxTokens` allowance.
