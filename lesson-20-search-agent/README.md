# Lesson 20: The Smallest Search Agent

> [繁體中文](README.zh-TW.md)
>
> Prerequisite: [Lesson 3](../lesson-03-streaming/) (streaming). Having read
> [Lesson 6](../lesson-06-domain-tools/) helps.
>
> This is the first lesson of the **AI Search part**.

## Questions this lesson answers

1. Why not start with "how to call the Tavily API"?
2. What exactly does a search engine hand back to an agent?
3. Who generates the query, and why is query quality the same thing as search
   quality?
4. What kinds of mistakes does an agent make when it can search but cannot open
   a page?

---

## The conclusion first

```text
搜尋回來的不是網頁，是 snippet。
snippet 是「跟你的 query 最像的那一段」，不是「這一頁的結論」。
所以：換一個 query，同一個頁面可以給你相反的答案。
```

Two measured runs back that sentence up shortly: **same model, same corpus,
opposite conclusions**.

---

## Why not just teach Tavily

Because that only teaches how to use one search tool, not AI search.

Products like Tavily wrap six things into one API: discovering pages, fetching,
cleaning, indexing, retrieval ranking, and returning to the LLM. Start from the
API and those six stay a black box forever, so the next time you wonder "why
can't it find what I want" the only move left is trying a different vendor.

So this part works backwards: **take every layer apart and write it once**, then
reassemble at the end (Lesson 23 combines 20-22 into a Tavily-lite service).

This lesson does only the topmost layer: **one agent plus one search tool**, and
deliberately without the ability to open a page. You need to see what is missing
first.

---

## This lesson's "internet"

Hitting Google for real has three problems: it needs a key, the ranking changes
daily, and you do not know the right answer. So there is a fake 14-page web
here, for the same reason Lesson 6 generated its own telemetry.

```bash
bun run lesson-20:corpus
```

```
已產生 14 個頁面到 lesson-20-search-agent/corpus/pages
索引：lesson-20-search-agent/corpus/index.json（正文共 8688 字元）
```

It produces two things, and that split is exactly the boundary between Lesson 20
and 21:

| Output | What it is | Who uses it |
|---|---|---|
| `corpus/index.json` | already-cleaned plain text | **this lesson** (pretending someone cleaned it for you) |
| `corpus/pages/*.html` | raw HTML with nav bars, ads, cookie banners, footers | Lesson 21 (extract the body yourself) |

The corpus is **deliberately diseased**, carrying every ailment the real web has:

```text
snippet 講的跟正文不一樣（而且兩個方向都有）
同一份內容有兩個網址（GitHub README 和 docs 站）
關鍵字塞滿但沒有內容的 SEO 農場
兩年前的懶人包還在到處被引用
已經封存的 repo，頁面上看不太出來
提到關鍵字很多次但其實無關的新聞
```

A clean corpus teaches you nothing about ranking. Lesson 22 deals with these.

> Each page's "actual fact" lives in the `groundTruth` field of
> `corpus/pages.ts`. As in Lesson 6, it is **not** written into the generated
> data; the agent cannot see the answer.

---

## Step 0: play with ranking first, no model needed

The search engine runs on its own, no API key and no network:

```bash
bun run lesson-20:search "unitree g1 retargeting"
```

The real top four:

```
query: unitree g1 retargeting
斷詞:  [unitree, g1, retargeting]
8 筆結果

1. Unitree G1 retargeting: best open source video to humanoid retargeting 2026
   https://top-robotics-tools.example.net/…  2026-07-01  score=2.771
   … Unitree G1 retargeting, open source retargeting, video to humanoid retargeting or
   humanoid motion retargeting, you have come to the right place for Unitree G1 retargeting …

2. 7 best open source motion retargeting tools for Unitree robots
   https://robotblog.example.com/best-retargeting-tools  2025-01-22  score=2.539
   Looking for open source motion retargeting for your Unitree robot? We rounded up the 7
   best retargeting tools for the Unitree G1, the Unitree H1 and other humanoid robots …

3. Unitree G1 - developer resources and SDK
   https://www.unitree.com/g1/developer  2026-04-18  score=2.018

4. openmotion/retarget-anything: video to humanoid motion retargeting
   https://github.com/openmotion/retarget-anything  2026-05-12  score=1.859
```

Three things are worth stopping on:

| Rank | What it is | The problem |
|---|---|---|
| **1** | SEO farm | highest keyword density, so BM25 scores it highest. The page contains no information at all |
| **2** | a 2025 listicle | the content is stale (it says humanoid-mimic does not support the G1, which is wrong) |
| **8** | the `humanoid-mimic 0.7` release announcement | **this is the correct answer**, ranked eighth |

And `github.com/kinelabs/humanoid-mimic`, the repo that should actually be given
to the user, is not in the top eight at all.

> This is not a broken ranker. This is what pure keyword retrieval looks like.
> BM25 only knows which words appear how often; it does not know who is
> trustworthy, who is recent, who is an advertisement. Lesson 22 is what fills
> those in.

The ranking code is in `search/engine.ts`, 229 lines with comments, of which the
BM25 core is about 20.

---

## Step 1: not one line of the loop changed

As in Lesson 6, the most important thing first: `agent.ts`'s `runTurn` is
**identical** to Lesson 3's and Lesson 6's.

```diff
- const registry = new ToolRegistry([listSessionsTool, queryTelemetryTool, ...]);
+ const registry = new ToolRegistry([webSearchTool]);

- const SYSTEM_PROMPT = "You are an incident analyst for a quadruped robot fleet...";
+ const SYSTEM_PROMPT = "You are a research assistant. You answer questions using web search...";
```

From Lesson 1 to this, the 20th, that while loop still has not changed.
New tools plus a new prompt equals a new domain, and search is no exception.

---

## Step 2: what comes back is not the page

```bash
bun run lesson-20
```

```
> 有哪些 open source 專案可以把影片動作 retarget 到 Unitree G1？
```

What actually ran (Gemini 3.6 Flash). It searched **11 times**:

```
→ web_search(Unitree G1 motion retargeting open source github)
→ web_search(github "Unitree G1" retargeting)
→ web_search(github video retargeting "Unitree G1" OR "G1" humanoid)
→ web_search(github "dex-retargeting" unitree g1)
→ web_search(github Open-TeleVision Unitree G1)
→ web_search(github Human2Humanoid unitree)
→ web_search(github unitree retargeting motion)
→ web_search(github dex-retargeting unitree)
→ web_search("humanoid-mimic" OR "retarget-anything" github)
→ web_search(github "Unitree" "G1" retargeting video OR pose OR motion)
→ web_search(github "dex-retargeting" OR "dex_retargeting" "unitree")
```

Then it answered (excerpted):

```markdown
### 1. openmotion/retarget-anything
* Unitree G1 支援：開箱即用（Out of the box），內建 Unitree G1（23 自由度）
  以及 Unitree H1 等預設 Profile。 [CONFIRMED: https://github.com/openmotion/retarget-anything]
* 開源授權：Apache License 2.0。 [CONFIRMED: .../blob/main/LICENSE]

### 2. kinelabs/humanoid-mimic
* Unitree G1 支援：提供對應 Unitree G1 的設定檔，並針對 SDK 的關節順序
  進行適配與實機測試。 [CONFIRMED: https://github.com/kinelabs/humanoid-mimic]

### 實務開發注意事項
2. 關節對應：請務必確認 SDK 的關節排序是否與重定向工具中的配對檔案一致
   [CONFIRMED: https://discourse.ros.org/t/g1-retargeting-foot-sliding/45211]
```

It looks extremely professional. Categorised, linked, every line tagged
`CONFIRMED`.

But the first item is wrong.

The fourth paragraph of the `retarget-anything` page says:

```text
Deprecation notice, v2.0, March 2026: the G1 profile is deprecated and no longer
maintained. … trajectories produced by the G1 profile will not load on current firmware.
We are not planning to fix it.
```

The model never saw that paragraph, because **the snippet only reached the first
one**.

Worse is the last line. The title of that ROS forum thread is "G1 retargeting:
foot sliding with retarget-anything, **switched to** humanoid-mimic", and the
content is "we spent two weeks failing and gave up". The model cited it as
"remember to check joint ordering" — a piece of evidence saying "this does not
work" turned into a mild operational reminder.

> What the `CONFIRMED` tag actually means is "the snippet said so", not "this is
> true". With only snippets, those two cannot be told apart.

---

## Step 3: same page, different query, opposite conclusion

This is the part of the lesson most worth remembering. Same model, same corpus,
a different phrasing:

```
> retarget-anything 的 G1 profile 現在還能用在 2026 SDK 上嗎？
```

It searched only twice:

```
→ web_search("retarget-anything" "G1")
→ web_search(site:github.com/openmotion/retarget-anything "2026 SDK" OR "G1 profile")
```

The answer (excerpted):

```markdown
**無法直接正常使用**。

* G1 Profile 已棄用且不再維護：官方 README 及文檔明確指出，G1 profile 在 v2.0
  已被標示為棄用（deprecated）且不會再進行更新維護。
* 相容性問題原因：原本的 G1 profile 是針對 2024 年的 G1 URDF 設計，
  而 Unitree 在 2026 SDK 中更改了關節順序。
* 替代方案：humanoid-mimic 在 v0.7 已新增支援 2026 SDK 關節順序的 G1 profile。
```

Entirely correct.

Same page, same model: once it says "supports the G1 out of the box", once it
says "deprecated, unusable". The only difference is the query.

The cause is `makeSnippet` in `search/engine.ts`:

```ts
// 挑一段最像「有回答到 query」的文字當 snippet
for (let start = 0; start + SNIPPET_WORDS <= words.length; start += 4) {
  // 數這個視窗裡命中幾個 query 的字，取最高的那個視窗
}
```

Real search engines do the same. Therefore:

```text
query 決定 snippet，snippet 決定模型看到頁面的哪一面。
```

The first question asked "which projects exist", which matched the introductory
paragraph. The second asked "does it still work on the 2026 SDK", and the words
`2026 SDK` matched the deprecation notice.

> Which is why Lesson 21 fetches the whole page. Not because snippets are too
> short, but because a snippet's content depends on what you asked.

---

## Step 4: the query is generated by the model

Look again at those 11 queries in Step 2. Among them:

```
github "dex-retargeting" unitree g1
github Open-TeleVision Unitree G1
github Human2Humanoid unitree
```

`dex-retargeting`, `Open-TeleVision` and `Human2Humanoid` **do not exist
anywhere in this corpus**. They are real project names dredged from training
data, then searched against an index that has never heard of them.

Three things happen at once:

| What you see | Why |
|---|---|
| the model builds queries from remembered names | it thinks it already knows the answer and just needs the link |
| some query syntax means nothing to this engine | `site:`, `OR` and quotes are ordinary words to BM25 |
| 11 searches with heavy repetition | nothing tells it "this angle was already tried" |

None of the three is the model's fault; they are things the harness did not do.
Lesson 24 adds the "what has been searched" state, which is also one of the
cores of Deep Research.

### A Chinese query goes straight to zero

```bash
bun run lesson-20:search "把影片動作轉到人形機器人"
```

```
斷詞:  []
0 筆結果
```

Not "no relevant content found" but **this retrieval method cannot read this
query**. `engine.ts`'s tokeniser only recognises `a-z0-9`:

```ts
// 中文、日文、韓文丟進來會得到空陣列——
// 這是關鍵字檢索的真實限制，不是這份程式偷懶。
export function tokenize(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter(...);
}
```

So why does the agent still find things when asked in Chinese above? Because
three lines of defence help it:

```text
1. tool description：  "The index is keyword-based and English-only,
                        so write the query in English"
2. system prompt 規則 2：把使用者的問題轉成英文關鍵字
3. 空結果的錯誤訊息：   "rewrite the query in English … and search again"
```

The third deserves a look (`tools/search.ts`). When nothing is found, do not
just return `no results`:

```ts
return (
  `No results for "${query}".\n${reason}\n` +
  "Next step: rewrite the query in English using the technical terms that would " +
  "actually appear on the page (project names, model names, file formats), and search again."
);
```

This is the search-flavoured version of Lesson 6 Step 5's principle: every error
message should tell the model what to do next.

The real fix is of course making retrieval itself understand Chinese (dense
retrieval), which is Lesson 22.

---

## Step 5: the tool set decides whether an agent can be honest

One rule in the system prompt is written emphatically:

```text
4. Label every claim you make:
   - CONFIRMED: a snippet you retrieved literally says it. Quote the URL.
   - UNVERIFIED: it looks likely from a title or a partial snippet, but no snippet states it.
   Never present UNVERIFIED as fact.
```

And `web_search`'s own description tells the truth up front:

```text
IMPORTANT: a snippet is not the page. It is the passage that best matches your query,
so it can omit or even contradict what the page actually concludes.
```

The result? In Step 2's answer **every line is tagged `CONFIRMED`**, with not a
single `UNVERIFIED`.

Why? Because from the model's point of view, every sentence it wrote **was**
said by some snippet. It did not lie; it has no way to know what it missed.

> In a world with only `web_search`, "I cannot confirm this" is a state the
> model can never reach. It holds no tool that turns uncertainty into certainty,
> so that label never gets used.

Which is the thing this lesson wants you to feel and the next one fixes:

```text
prompt 可以要求誠實，
但只有工具能讓誠實變得可能。
```

Once Lesson 21 adds `fetch_page`, the same prompt starts to work — because by
then "go open that page and look" is an action that can actually be taken.

---

## Step 6: seeing the failure without a key

```bash
PROVIDER=fake bun run lesson-20
```

This lesson has its own fake provider (`fake-provider.ts`), because
`shared/streaming/fake.ts` was written for the Lesson 1-5 coding agent: it calls
`list_files` and `read_file`, which here earns two `Unknown tool` results
followed by a canned paragraph with nothing to do with search.

The fake provider acts out a **one-search-then-conclude** trajectory:

```
我先搜尋一下有哪些相關專案。
  → web_search(query=unitree g1 video retargeting open source max_results=5)
  ✓ 5 results for "unitree g1 video retargeting open source"

**1. retarget-anything** — 支援 Unitree G1，最主流的選擇。
**2. humanoid-mimic** — snippet 沒有提到 G1，所以不支援 G1。
結論：你要 G1 的話用 retarget-anything。
```

Both conclusions are wrong: the first is deprecated, and the second has
supported the G1 since v0.7.

> That passage is a **hardcoded script**, not a model's judgement, and this
> README never cites it as evidence of "model behaviour". Its purpose is letting
> people without an API key see what the lesson is about. The real model
> trajectories are in Step 2 and Step 3, both of which were actually run.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `找不到語料索引 …/corpus/index.json` | the corpus has not been generated | `bun run lesson-20:corpus` |
| a Chinese query returns 0 results | keyword retrieval cannot read CJK | by design, see Step 4 |
| `Unknown tool "list_files"` | you got `shared`'s fake provider | this lesson has its own: `PROVIDER=fake bun run lesson-20` |
| the model searched a dozen times and is still circling | there is no "what has been searched" state | that is Lesson 24's subject |
| every line of the answer is `CONFIRMED` | no tool can verify anything, see Step 5 | Lesson 21 |
| `400 status code (no body)` (Gemini) | the tool call's `extra_content` was dropped | see Lesson 6 Step 7, fixed |

---

## Exercises

### Exercise 1: raise max_results to 8 ⭐

`tools/search.ts` defaults to 5. Make it 8 and ask Step 2's question again.

The `humanoid-mimic 0.7` release announcement ranks 8th; does the answer change
once it comes into view? The point is to feel that a small change in recall can
matter more than changing model.

### Exercise 2: delete the SEO farm ⭐

Comment out the `top-robotics-tools.example.net` page in `corpus/pages.ts`,
regenerate the corpus, and run again.

Observe: how do the other rankings move? Does answer quality improve? A pure
junk page occupies more than the top slot; it occupies the model's finite
attention.

### Exercise 3: return the ranking score from the tool ⭐⭐

Right now `web_search` returns no `score` to the model. Add it, then explain in
the description what the score means.

Observe: does the model start looking only at the first result? Is that good or
bad? (Hint: it is a BM25 score, not a credibility score. How do you word the
description so the model does not read "lots of keywords" as "more
trustworthy"?)

### Exercise 4: add a `search_site` tool ⭐⭐

Restrict search to one site (for example `site=github.com`).

To think about: should that be a new tool, or a parameter of `web_search`?
(Recall Lesson 6: too many tools dilute attention, and an overweight tool gets
its parameters filled in carelessly.)

### Exercise 5: design `fetch_page` before reading Lesson 21 ⭐⭐⭐

Before writing any code, answer four questions:

1. Return the whole page or part of it? What about a ten-thousand-word page?
2. What should the model use to name the page — a URL, or the number of a search
   result?
3. What should a failure message say (404, timeout, blocked) so the model knows
   what to do next?
4. Should the fetched content keep its HTML structure? What about headings,
   lists, code blocks?

Write your answers down, then read Lesson 21's implementation. The differences
are what you actually learned.

---

## Compared with the sources

Where this lesson's shape sits in several open-source projects:

| Concept in this lesson | Reference |
|---|---|
| the loop of agent plus one search tool | the innermost circle of [dzhng/deep-research](https://github.com/dzhng/deep-research) |
| the whole "search → fetch → clean → return" bundle | the product scope of Tavily and [Firecrawl](https://github.com/firecrawl/firecrawl) (Lesson 23 builds one) |
| multi-source aggregation and result normalisation | [SearXNG](https://github.com/searxng/searxng) (Lesson 23) |
| BM25 and hybrid retrieval | [txtai](https://github.com/neuml/txtai) (Lesson 22) |
| the Tool interface itself | Pi `packages/agent/src/types.ts:380` (`AgentTool`) |

> The source of these projects has not been read line by line, so the table
> above only says which project a concept corresponds to, without line numbers.
> They get added once the code has actually been read (design principle 4).

One thing worth knowing up front: **Tavily and SearXNG are not at the same
layer**. SearXNG aggregates results from several search engines; Tavily
aggregates and then fetches, cleans, ranks, and trims to a size an LLM can
swallow. This lesson builds the minimal version of the latter, deliberately
missing the fetch step.

---

## Next lesson

[Lesson 21: crawling and content extraction](../lesson-21-crawl/): this lesson's
agent cannot see a whole page. The next one gives it `fetch_page`, and then the
real problems begin:

```text
一頁 HTML 有 8 成是導覽列、廣告、訂閱表單
正文在哪裡？
一萬字的頁面怎麼塞進 context？
抓回來的內容要不要保留結構？
```

The corpus's `corpus/pages/*.html` was generated in advance for exactly that.
Open one and count what fraction of it is body text.
