# Lesson 21: Crawling and Content Extraction

> [繁體中文](README.zh-TW.md)
>
> Prerequisite: [Lesson 20](../lesson-20-search-agent/) (the smallest search
> agent).
>
> This lesson adds exactly one tool: `fetch_page`. But it changes whether the
> agent can be honest.

## Questions this lesson answers

1. How much of an HTML page is actually body text? What is the rest?
2. What is wrong with "strip the tags and you have the body"? How wrong?
3. How many ways are there to fail to fetch a page, and what should the model do
   about each?
4. How does a ten-thousand-word page fit into context?
5. When the extractor misses something, how does the model know it did not see
   it?

The fifth is the most expensive question here, and Step 5 has the full record:
the same question run three times, with the first two burning the step ceiling
without producing an answer.

---

## Step 0: the body is only half of it

The extractor can be measured on its own, no model and no key:

```bash
bun run lesson-21:measure
```

This lesson has a rare luxury: **the right answer is known**. Lesson 20's
`corpus/index.json` holds each page's body text, because the HTML was generated
from that text in the first place. So it can be scored directly:

```
recall = how much of the body was extracted   noise = how much of the extract is not body

                                          stripTags        extractMain
                                        recall  noise    recall  noise
github-com-openmotion-retarget-anyth  100.0% 29.5%   100.0%  0.0%
robotblog-example-com-best-retargeti  100.0% 45.8%   100.0%  0.0%
top-robotics-tools-example-net-unitr  100.0% 52.1%   100.0%  0.0%
huggingface-co-datasets-openmotion-h  100.0% 65.8%   100.0%  0.0%
cookingwith-example-com-sous-vide-gu  100.0% 68.3%   100.0%  0.0%
──────────────────────────────────────────────────────────────────────
average                               100.0% 51.0%   100.0%  0.0%

actual body size        8688 characters
stripTags extracted     17403 characters  (2.00x)
extractMain extracted   8688 characters  (1.00x)
```

`stripTags` is the version everybody writes the first time they write a crawler:

```ts
html.replace(/<[^>]+>/g, " ")
```

Its recall is 100% (not one word of the body is lost), so it **looks completely
correct**. The problem is noise: half of what comes out is not body text.

One page makes it obvious:

```bash
bun run lesson-21:measure --show retarget-anything
```

```
[stripTags] just remove the tags, surely?

We use cookies to improve your experience. Accept all Reject github.com Home Docs Blog
Pricing Sign in openmotion/retarget-anything: … Never miss an update Join 24,000 engineers
getting our weekly newsletter. Subscribe Sponsored: Ship your robot fleet faster with
RoboOps Cloud. Start free. Related posts 10 things nobody tells you about humanoid robots …
© 2026 github.com. All rights reserved. Terms · Privacy · Contact
```

This goes into context, gets billed, and **gets cited by the model as content**.
When an answer says "according to that page, you can speed up deployment with
RoboOps Cloud", this is where it came from.

> Twice the noise is not just twice the money. It dilutes the real evidence.

`extractMain` has no magic in it, just three steps:

```text
1. drop whole elements: script / style / nav / header / footer / aside / form
2. drop blocks whose class or id hits a blocklist (cookie / newsletter / sidebar / ad / related …)
3. pick the body container: <article> first, then <main>, falling back to <body>
```

> The 0% noise is fake. The corpus HTML was generated from one template, and the
> extractor happens to be written against that template. Real pages are never
> this clean — Step 5 shows how it breaks on a different layout.
>
> For real work, use Readability, trafilatura or Crawl4AI. They are the same
> family of heuristics underneath, only with longer blocklists and text-density
> statistics on top. No extractor is "correct in principle".

---

## Step 1: exactly one new tool

```diff
- const registry = new ToolRegistry([webSearchTool]);
+ const registry = new ToolRegistry([webSearchTool, fetchPageTool]);
```

`web_search` is `import`ed directly from Lesson 20, not copied. `runTurn` still
has not changed a line since Lesson 3.

What this lesson proves is what one added tool changes, so everything else has to
be identical.

One rule changed in the system prompt. Lesson 20 had two labels; here there are
three:

```diff
- CONFIRMED: a snippet you retrieved literally says it.
+ CONFIRMED:     you fetched the page and its text states this.
+ SNIPPET-ONLY:  a search snippet says it but you did not open the page.
+ UNVERIFIED:    neither.
```

Lesson 20 ended by saying a prompt can demand honesty but only tools can make it
possible. The tool now exists; time to see whether anything changed.

---

## Step 2: same question, the answer flips

When Lesson 20 asked "does retarget-anything still work", the model got it
right, but only because the query happened to hit the deprecation paragraph.
This time the question is harder:

```bash
bun run lesson-21
```

```
> Does retarget-anything still work with the G1 on the 2026 SDK? If not, what is the alternative?
```

The real trajectory (Gemini 3.6 Flash, 6 tool calls):

```
→ web_search("retarget-anything" OR "retarget_anything" G1 unitree)
→ fetch_page(https://discourse.ros.org/t/g1-retargeting-foot-sliding/45211)
→ web_search("retarget-anything" "2026 SDK" OR "joint ordering" OR "G1")
→ fetch_page(https://github.com/openmotion/retarget-anything)
→ fetch_page(https://github.com/kinelabs/humanoid-mimic)
→ fetch_page(https://www.unitree.com/g1/developer)
```

The answer (excerpted):

```markdown
**No, `retarget-anything` does not work out-of-the-box with the Unitree G1 on the 2026 SDK.**

### Why It Fails
* Deprecated G1 Profile: in v2.0 (March 2026) the maintainers deprecated the G1
  profile. It was originally created against the 2024 G1 URDF and joint layout
  (CONFIRMED: github.com/openmotion/retarget-anything).
* 2026 SDK Joint Index Revision: left_hip_pitch changed from index 7 to 1, and
  waist_yaw from 1 to 13 (CONFIRMED: unitree.com/g1/developer).
* Protective Stop: the index shift makes trajectories target the wrong actuators,
  which the controller detects as a joint tracking error
  (CONFIRMED: discourse.ros.org/t/g1-retargeting-foot-sliding/45211).

### Recommended Alternative: `humanoid-mimic`
* 2026 SDK Support: v0.7 (June 2026) added a native G1 profile built against the
  2026 SDK joint ordering and verified on physical hardware.
* Real-time Pipeline: ~50 Hz control loop, ~18 ms latency on an RTX 4070 class GPU.
* Known Limitation & Workaround: foot sliding on fast movements; slowing to ~0.8x
  playback makes it stable on hardware
  (CONFIRMED: discourse.ros.org/t/g1-retargeting-foot-sliding/45211).
```

Every `CONFIRMED` now really did read the page. The last one, "0.8x", is
especially worth looking at: it is one engineer's improvised workaround from a
forum thread, **obtainable only by reading the whole page**. A snippet would
never have cut to it.

Against Lesson 20's "supports the G1 out of the box" answer, the difference is
not that the model got smarter. It finally had a way to open the page.

---

## Step 3: four shapes of failing to fetch

`fetcher.ts` encodes the four most common real-web failures as rules. **The next
step differs for each**, so the error message must be able to state the
difference:

```
✗ https://top-robotics-tools.example.net/…
  top-robotics-tools.example.net/robots.txt disallows crawling this path.
  This is a policy decision, not a technical failure: retrying will not help, and
  neither will a different user agent. Use the search snippet for this page and say
  in your answer that the page itself could not be read.

✗ https://technews.example.com/2026/07/humanoid-robot-funding-round
  technews.example.com returned HTTP 403. The site is blocking automated access and
  does not say why (paywall, bot detection, and geo-blocking all look the same from
  here). Do not retry. Look for the same information on another site.

✗ https://huggingface.co/datasets/openmotion/human-motion-video
  Fetched … but found no readable text. The page renders its content with JavaScript,
  so the HTML is an empty shell.
  IMPORTANT: this means the content is unknown, NOT that the page is empty.
  Do not conclude anything about what this page does or does not say.

✗ https://github.com/openmotion/fake-repo
  HTTP 404. This URL is not in the index. Note that you cannot invent URLs:
  run web_search and fetch one of the URLs it returned.
```

Three design decisions are worth stating.

The robots.txt check comes first. Ask "may I fetch this" before asking "can I
fetch this". And remember: **robots.txt has no enforcement**. It is a request,
and your crawler is the one that has to honour it. What actually stops you is
legal and IP blocking, not that file.

**The JS-shell message is the longest**, because it is the most dangerous. A
model easily reads "no content extracted" as "this page does not have that
information", and then writes "the page does not mention the G1" — a **negative
conclusion invented out of nothing**. So the error message closes that road
explicitly: `this means the content is unknown, NOT that the page is empty`.

The 404 also mentions "do not invent URLs". Models love assembling a
plausible-looking URL from a repo name they remember and fetching it.

> A real crawler also handles timeouts, retries and backoff, redirect chains,
> PDFs, robots crawl-delay, and ETag conditional requests. None of that is here;
> Exercise 5 is the timeout one.

---

## Step 4: long pages need chunking

`https://www.unitree.com/g1/developer` is an SDK migration document. It extracts
to 13,514 characters, which does not fit in one go.

Why not just truncate like Lesson 2? Because what you want is usually near the
end. Truncating means never reaching section 18.

```
# Unitree G1 - developer resources and SDK - SDK migration guide
url: https://www.unitree.com/g1/developer
published: 2026-04-18
chunk 1 of 7  (13514 characters extracted in total)

The Unitree G1 humanoid ships with a 23 degree-of-freedom configuration …

---
This is chunk 1/7. You have NOT seen the rest of this page. Call fetch_page again with
chunk=2 to continue, and do not describe the page as a whole until you have read what
you need.
```

Three design decisions (`extract/chunk.ts`):

| Decision | Why |
|---|---|
| cut only at **paragraph boundaries** | cutting mid-sentence produces half a sentence, and the model completes the other half itself — the finest breeding ground for hallucination |
| adjacent chunks **overlap** a little | when a passage lands exactly on a boundary, without overlap neither side reads it whole |
| every chunk is labelled **which one of how many** | without it, the model answers questions about the whole document from chunk 1 |

---

## Step 5: the most expensive lesson — silent extraction failure

This section came out of measurement, running the same question three times.

```
> What index is the G1's waist_yaw joint in the 2026 SDK?
```

The answer sits in an HTML `<table>` in that migration document:
`waist_yaw | 1 | 13`.

### First run: 16-step ceiling, no answer

`extractMain` at the time took only `<p>`, so the table was thrown away. The
model's trajectory:

```
web_search × 6
fetch_page(unitree.com/g1/developer) chunk 1,2,3,4,5,6,7   ← the whole document read
fetch_page(blog.kinelabs.dev) / (openmotion.dev) / (humanoid-mimic)
web_search × 2
[hit the 16-step cap]
```

16 tool calls, no answer, and not one sentence saying "I cannot find it". It read
all seven chunks of the document because it believed the answer was in there —
and the answer *was* on that page, just not in **the extracted text**.

> This is far more dangerous than failing to fetch. A failed fetch at least has
> an error message. Wrong extraction has no signal at all; neither the model nor
> you will notice.

The good news is it did not invent a number. The bad news is it could not say "I
cannot find it" either; it was cut off by the step ceiling — with a higher
ceiling it would have kept burning money.

### Second run: added a warning, still hit the 16-step ceiling

The first attempted fix was making the tool tell the truth (Lesson 6, "tools
should report data quality unprompted"):

```ts
NOTE: this extractor keeps paragraphs only. This page also contains 1 table(s) and
24 list(s) whose contents are NOT included above. If the fact you need looks tabular
(indices, versions, limits), report that it could not be extracted from this page.
Do NOT conclude that the page does not contain it, and do not guess the value.
```

The tool dutifully printed that warning on every chunk. Result:

```
[hit the 16-step cap]
```

It still did not stop. It read all seven chunks and searched six more times,
including this rather desperate query at the end:

```
web_search("waist_yaw" "G1" "12" OR "13" OR "14" OR "11" OR "0" OR "15")
```

It was guessing the number and trying to search its way to confirmation.

### Third run: actually extract the table, correct in 8 steps

Stopping the bleeding is not a fix. The real fix is making the extractor **pull
the table out**:

```ts
const pattern = options.includeStructures
  ? /<(p|ul|ol|table)\b[^>]*>([\s\S]*?)<\/\1>/gi
  : /<(p)\b[^>]*>([\s\S]*?)<\/\1>/gi;
```

Tables become pipe-separated plain text (what is preserved is which values share
a row, not the markup language), lists become `- item`, and everything goes back
**in original order** — move a table to the end of the document and the relation
"the paragraph above is talking about the table below" is severed.

Run again:

```
→ web_search × 3
→ fetch_page(unitree.com/g1/developer) chunk 1,2,3,4
→ fetch_page(blog.kinelabs.dev/humanoid-mimic-0-7)

According to Unitree's official G1 SDK migration guide, the waist_yaw joint is index 13 in the 2026 SDK.
* 2026 SDK joint index: 13 [CONFIRMED: https://www.unitree.com/g1/developer]
* 2024 SDK old index:   1  [CONFIRMED: https://www.unitree.com/g1/developer]
```

Eight steps, correct answer, correct citation.

### What this section is actually teaching

```text
16 steps (no answer) → add a warning → 16 steps (still no answer) → fix the extractor → 8 steps (correct)
```

Lesson 6 has a principle: what the harness can guarantee should not be left to
prayer in a prompt. This measurement is one negative and one positive example of
it:

| Approach | Layer | Result |
|---|---|---|
| warn the model in the tool output | a plea at the prompt layer | useless |
| make the extractor actually get the table | a fix at the harness layer | worked |

The warning is not worthless — it remains the last line of defence when
something genuinely cannot be extracted (the code is still there and shows up
when `includeStructures: false`). But **do not settle for a warning about
something you can fix**.

---

## Step 6: missed reading is fixed, invention is not

Do not assume `fetch_page` settles everything. On another run of "which projects
support the G1", the model added a whole section beyond the two correct repos:

```markdown
### 2. The community's usual "two-stage custom retargeting toolchain"
* WHAM / GVHMR / HMR 2.0 [SNIPPET-ONLY: https://arxiv.org/abs/2603.04417]
* MediaPipe / OpenPose / MMPose [SNIPPET-ONLY: https://robotblog.example.com/…]
* Pink (Python IK based on Pinocchio) [UNVERIFIED] can load the Unitree G1's
  URDF directly (the 23-DoF configuration) [CONFIRMED: https://www.unitree.com/g1/developer]
* DexRetargeting [UNVERIFIED]
```

Those projects **do not exist in the corpus at all**. They come from training
data.

The good news: the three-level labels genuinely got used. Lesson 20's run had
**every line CONFIRMED**; this one has `SNIPPET-ONLY` and `UNVERIFIED` — once
tools made honesty possible, the prompt's demand started to work.

The bad news: look at that Pink line. "Can load the G1's URDF directly" is
tagged `CONFIRMED` and attached to unitree.com — but that page only says the G1
is 23 DoF and never mentions Pink. The citation was grafted on.

```text
fetch_page fixes "the model did not read enough".
It does not fix "the model wrote more than it read", and it does not guarantee
a citation actually supports the sentence attached to it.
```

Catching that kind of error means going back and verifying every citation: does
the body text at that URL actually contain something supporting the sentence?
**That is Lesson 25's subject**, and like Lesson 7 it will be a deterministic
check rather than another model handing out scores.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Lesson 20's corpus not found` | the corpus is not generated | `bun run lesson-20:corpus` |
| `robots.txt disallows` | by design | see Step 3; that page should not be crawled |
| `found no readable text` | a JS-rendered page | see Step 3. **It does not mean the page is empty** |
| the model concludes from chunk 1 alone | the "how many chunks remain" note is not emphatic enough | see the footer in `tools/fetch.ts` |
| the model can never find the number in the table | the extractor threw `<table>` away | see Step 5, `includeStructures` |
| the extraction is mixed with "Subscribe" and "Sponsored" | you used `stripTags` | that is the counter-example; use `extractMain` |

---

## Exercises

### Exercise 1: turn includeStructures off ⭐

Set `{ includeStructures: false }` in `tools/fetch.ts`, then ask "which index is
waist_yaw in the 2026 SDK".

See Step 5's first version with your own eyes: the model reads the entire
document and then hits the step ceiling. Two minutes of work, and you will
remember what a silent failure looks like.

### Exercise 2: measure the long document too ⭐⭐

`extract/measure.ts` currently measures only Lesson 20's 14 pages (one template,
hence 0% noise). Add the long document produced by `fetcher.ts`.

Observe: with a different layout, does `extractMain` still have 0% noise? (Hint:
that document has no `<article>`, so it falls back to `<body>`.)

### Exercise 3: add code blocks ⭐⭐

`<pre>` and `<code>` are currently discarded. For technical documents that is
fatal.

To think about: should code keep its indentation? Should the language be tagged?
Should a large code block count towards the chunk character limit?

### Exercise 4: sentence-level splitting ⭐⭐

When `chunkText` meets a single paragraph that exceeds the limit, it puts the
whole paragraph in, so that chunk exceeds `maxChars`. Change it to split at
sentence boundaries.

The hard part: the periods in `"see Fig. 3"`, `"v2.0"` and `"e.g."` are not
sentence ends. You will find this fiddlier than expected — which is why many
people just use an off-the-shelf splitter.

### Exercise 5: timeout and retry ⭐⭐⭐

Add a rule to `fetcher.ts` where a given domain always times out on the first
attempt and succeeds on the second.

Then answer three questions:

1. How long should the backoff be? Fixed interval or exponential?
2. Should the retry be done by the **tool**, or should the error go back so the
   **model** decides?
3. If the model retries itself, how do you stop it spending the whole step
   ceiling on one URL?

The second has no standard answer, but it is worth thinking through: give it to
the tool and the model cannot see the delay; give it to the model and it may
retry five times. That is harness design.

### Exercise 6: point fetch_page at the real network ⭐⭐⭐

Replace `fetcher.ts`'s `readFileSync` with a real `fetch()`, paired with a real
search source (SearXNG or any search API).

You will immediately meet the things this lesson mentions but the corpus does not
contain: redirects, gzip, character encodings, cookie walls, Cloudflare, PDFs,
infinite scroll.

Finish this and you will know what Firecrawl and Crawl4AI are actually selling.

---

## Compared with the sources

| Concept in this lesson | Reference |
|---|---|
| HTML → LLM-friendly text | [Crawl4AI](https://github.com/unclecode/crawl4ai) (Apache-2.0, easy to modify) |
| scrape / crawl / extract as a service | [Firecrawl](https://github.com/firecrawl/firecrawl) (core is AGPL-3.0) |
| body-extraction heuristics | Readability, trafilatura |
| output truncation vs chunking | this series' `shared/tools/truncate.ts` (Lesson 2) |
| tools reporting data quality unprompted | this series' Lesson 6 Step 4 |

> The source of these projects has not been read line by line, so only concepts
> are matched up, without line numbers (design principle 4).

One distinction worth knowing first: Crawl4AI leans library, Firecrawl leans
platform. Read the former to embed it in your own pipeline, the latter to
understand how to turn it into a service. Lesson 23 assembles this lesson and
Lesson 22 into a service, and returns to this comparison then.

---

## Next lesson

[Lesson 22: retrieval and ranking](../lesson-22-retrieval/): Lesson 20's BM25 put
the SEO farm first and the correct answer eighth. Now that the agent can read
whole pages, that problem is more visible rather than less — every page it reads
was chosen by the ranking.

```text
BM25 + dense retrieval + RRF fusion + cross-encoder rerank
deduplication (the same content at two URLs)
freshness (a 2025 round-up)
authority (an official repo vs a content farm)
source diversity
```

That pair of near-duplicate pages in the corpus (the GitHub README and the docs
site) was prepared for that lesson.
