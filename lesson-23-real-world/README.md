# Lesson 23: Against the Real Source

> [繁體中文](README.zh-TW.md)
>
> Prerequisites: [Lesson 20](../lesson-20-search-agent/),
> [21](../lesson-21-crawl/), [22](../lesson-22-retrieval/).
>
> This lesson adds no features. It does one thing: **compare what we derived
> from scratch, item by item, against projects that are actually running.**

## Questions this lesson answers

1. How do real projects handle the traps we hit?
2. Where did we do the same thing as them? Where differently, and why?
3. If their approach is copied back, does the agent get better?

The third is measured, and the result is more complicated than expected: after
copying, **the very first run blew up**, exposing a bug that had been latent in
our provider layer for three lessons.

---

## Why read it now instead of at the start

If Lesson 20 had told you to go read GPT Researcher, you would have seen a pile
of `if`s and parameters, thought "hmm, seems reasonable", and learned nothing.

But you are different now. You have already:

```text
Lesson 20  看過模型自己生出 site: 和 OR，然後在 BM25 上完全失效
Lesson 21  因為抽取器丟掉 <table>，燒掉兩次 16 步上限
Lesson 22  猜錯去重門檻，還被一個「平均分數上升」蓋掉一次崩塌
```

Read with those injuries and the same line of code means something completely
different. You will find a line in gpt-researcher's prompt saying "do not use
search operators" and know whose blood paid for it.

This is also what the series has done since Lesson 1 (comparing against Pi), only
this time against four projects instead of one.

---

## Get the source locally first

```bash
git clone --depth 1 https://github.com/dzhng/deep-research        deep-research
git clone --depth 1 https://github.com/assafelovic/gpt-researcher gpt-researcher
git clone --depth 1 https://github.com/firecrawl/firecrawl        firecrawl
git clone --depth 1 https://github.com/unclecode/crawl4ai         crawl4ai
```

The versions this lesson reads:

| Project | commit | Date | Size |
|---|---|---|---|
| deep-research | `1f8f3e2` | 2026-04-11 | 559 lines (all of `src/`) |
| gpt-researcher | `5d84d2f5` | 2026-07-14 | large |
| firecrawl | `ab033afd9` | 2026-07-26 | very large |
| crawl4ai | `7e80152` | 2026-07-15 | large |

Read deep-research first. All of `src/` is 559 lines and `deep-research.ts` is
294, readable in one sitting, and everything that should be there is. The other
three are products; the way to read them is to arrive with a question and find
that passage, not to read front to back.

### These clones stay out of version control, but not via `.gitignore`

```bash
# .git/info/exclude
crawl4ai/
firecrawl/
gpt-researcher/
deep-research/
```

`.gitignore` is a file for **every reader**; these clones are local reference
material and should not appear in a repo somebody else cloned.
`.git/info/exclude` has the same syntax but applies only to your own machine.
Many people do not know the distinction, and it is worth noting.

### Line numbers go stale, so the citations are executable

```bash
bun run lesson-23:check
```

```
✓ L20 query 生成：不要用搜尋運算子
  gpt-researcher/gpt_researcher/prompts.py:250
✓ L21 抽取：整塊丟掉的標籤
  crawl4ai/crawl4ai/content_filter_strategy.py:101
~ L24 下一輪的 query 是上一輪的產物
  deep-research/src/deep-research.ts:251 → 實際在第 252 行

23 條正確  0 條行號漂了  0 條找不到
```

Design principle 4 says citations into other people's source must be verified.
Rather than writing a document that looks precise while having quietly gone out
of date, let the document check itself.

> Incidentally, the checker caught three off-by-ones in this lesson's own
> citations on its first run. The `~` above is what that looks like.

---

## Step 1: query generation — they already had a line blocking it

Lesson 20 Step 4 observed the model producing `site:github.com`, `OR` and
quotes, which are ordinary words to BM25. The conclusion written there was "this
is not the model's fault, the harness did not do its job".

GPT Researcher's prompt has exactly that line:

```python
# gpt-researcher/gpt_researcher/prompts.py:250
Each query must be a plain natural language phrase. Do not use search operator syntax
such as site:, filetype:, inurl:, intitle:, OR, AND, or NOT — these operators are
not universally supported and will return empty results on many search backends.
```

Put together, the four projects' query-layer practices form a complete method:

| Practice | Source | Do we have it |
|---|---|---|
| forbid search operators | `gpt-researcher/prompts.py:250` | not in Lesson 20; added here |
| generate N at once, required to be dissimilar | `deep-research/src/deep-research.ts:54` | we let the model think of them one at a time |
| a query carries a `researchGoal` (why this search) | `deep-research.ts:66` | |
| search once, use the results as context to generate sub-questions | `gpt-researcher/query_processing.py:108` | |
| give the model today's date | `deep-research/src/prompt.ts` | Lesson 22 has it |

The `researchGoal` line is especially worth a look. Their query is not a string
but an object:

```ts
// deep-research/src/deep-research.ts:61-74
schema: z.object({
  queries: z.array(z.object({
    query: z.string().describe('The SERP query'),
    researchGoal: z.string().describe(
      'First talk about the goal of the research that this query is meant to accomplish, ' +
      'then go deeper into how to advance the research once the results are found, ' +
      'mention additional research directions...'),
  })),
})
```

"Say why you are running this search" is itself a constraint. And that
`researchGoal` becomes input on the next round (Step 4 shows it).

### Also: structured output really does break

```python
# gpt-researcher/gpt_researcher/actions/query_processing.py:6
def _normalize_sub_queries(parsed: Any, fallback_query: str) -> List[str]:
    """``json_repair.loads`` may return a list, a dict (e.g. ``{"queries": [...]}``
    or a single ``{"query": "..."}``), a bare string, or ``None`` when the model
    does not return clean JSON. Callers expect a ``list[str]`` and otherwise crash
    on ``.append`` / iteration, so normalize defensively here."""
```

A whole function, purely to handle the model returning four different shapes. And
they use `json_repair.loads` rather than `json.loads` — a package dedicated to
fixing broken JSON.

Further down, the same file has **three layers of LLM fallback**: strategic LLM →
the same model retried with a max_tokens limit → switch to the smart LLM. The
comment even links a GitHub issue. That is the difference between a product and a
demo.

---

## Step 2: extraction — what took us three collisions is their default

Lesson 21 Step 5 is the most painful section in the series: the extractor took
only `<p>`, the table was silently dropped, and the model read all 7 chunks and
burned the 16-step ceiling twice before it became clear that `<table>` had to be
extracted.

crawl4ai's allowlist looks like this:

```python
# crawl4ai/crawl4ai/content_filter_strategy.py:50
self.included_tags = {
    "article", "main", "section", "div",
    "ul", "ol", "li", "dl", "dt", "dd",          # ← 清單
    "p", "span", "blockquote", "pre", "code",     # ← 程式碼
    "h1"..."h6",
    "table", "thead", "tbody", "tr", "td", "th",  # ← 表格
    ...
}
```

Tables and lists have been in there from the first line.

On the blocklist side, what we derived independently is almost identical to
theirs:

| | Ours (Lesson 21) | crawl4ai `:101` `:113` |
|---|---|---|
| tags dropped whole | script, style, noscript, nav, header, footer, aside, form | script, style, noscript, nav, header, footer, aside, form, **iframe** |
| class/id blocklist | cookie, banner, newsletter, subscribe, sidebar, related, promo, ad, advert, sponsor, comment, share | nav, footer, header, sidebar, ads, comment, promo, advert, social, share |

**When two parties independently derive the same list, the list usually reflects
the structure of the real world rather than anybody's personal taste.**

### But they have a second layer: text density

```python
# crawl4ai/crawl4ai/content_filter_strategy.py:568
threshold: float = 0.48
# 評分權重
"text_density": 0.4, "link_density": 0.2, "tag_weight": 0.2,
"class_id_weight": 0.1, "text_length": 0.1
```

A blocklist can only stop what you thought of. Text density (the ratio of text to
links) stops what you did not: navigation blocks share the property of **many
links and little text**, whatever their class is called.

We do not have this layer, because the corpus has a fixed layout. Real sites need
it.

### firecrawl: the industrial version of the same thing

```ts
// firecrawl/apps/api/src/scraper/scrapeURL/lib/removeUnwantedElements.ts:9
const excludeNonMainTags = [
  "header", "footer", "nav", "aside", ".header", ".top", ".navbar", "#header",
  ".footer", ".bottom", "#footer", ".sidebar", ".side", ".aside", "#sidebar",
  ".modal", ".popup", "#modal", ".overlay", ".ad", ".ads", ".advert", "#ad",
  ...  // 48 條
];
```

And then the best part:

```ts
// :53
const forceIncludeMainTags = [
  "#main",
  ".swoogo-cols", ".swoogo-text", ".swoogo-table-div", ".swoogo-space",
  ".swoogo-alert", ".swoogo-sponsors", ".swoogo-title", ...
];
```

`swoogo` is an event-website platform. **A highly valued product has one specific
platform's CSS classes hardcoded into it.**

They are not being lazy. This is the truth about extraction: heuristics always
have exceptions, and exceptions can only be added one at a time. Your extractor
will grow the same thing eventually.

One more design worth learning:

```ts
// :106
logger.warn("Failed to call html-transformer! Falling back to cheerio...");
```

The main path goes through Rust (fast) and falls back to cheerio (slow but
reliable) on failure. Performance and reliability in two layers, rather than one
implementation chasing both.

---

## Step 3: retrieval — they do it differently, and they have a reason

This is the most surprising section. Lesson 22 built BM25 plus dense plus RRF
plus dedup plus signals, along with an evaluation set. GPT Researcher?

```python
# gpt-researcher/gpt_researcher/context/compression.py:134
splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=100)
relevance_filter = EmbeddingsFilter(embeddings=self.embeddings,
                                    similarity_threshold=self.similarity_threshold)
```

```python
# :123
similarity_threshold = float(os.environ.get("SIMILARITY_THRESHOLD", 0.35))
```

No BM25, no RRF, no rerank. Just one thing: cut the fetched content into
1000-character chunks and **drop any chunk below 0.35 similarity**.

Why can it be this simple? Because **the sparse half is outsourced to the search
engine**. Tavily or Google already did the keyword matching, so their candidates
are already relevant, and the remaining job is only "delete the irrelevant
passages within a page".

This is an architectural choice, not laziness:

```text
我們（Lesson 22）      自己建索引 → 所以 sparse + dense + 融合 + 排序都要自己做
GPT Researcher         用別人的搜尋引擎 → 只需要做「頁內過濾」
```

And note that they use a **threshold**, not a **rank** (top-k):

```text
排名：不管多爛，前五名一定會給你五個
門檻：全部都爛的話，就回空的
```

For an agent a threshold is often better, because "nothing found" is a fact it
ought to know. Lesson 22's pipeline always returns five — which is in fact
something that could be changed.

### The cheap path first

```python
# :164
chunk_threshold = int(os.environ.get("COMPRESSION_THRESHOLD", "8000"))
if total_chars < chunk_threshold and len(self.documents) <= max_results:
    # Fast path: no compression needed
```

Under 8000 characters, skip embedding entirely. Do not pay money, and do not pay
latency, when you do not have to. Same restraint as Lesson 6's "do not give the
model arithmetic a program can do".

deep-research is more extreme; it has no filtering at all:

```ts
// deep-research/src/deep-research.ts:93
trimPrompt(content, 25_000)
```

Hard-trim each page to 25k tokens and throw five pages in for the model to read.
When the context window is big and cheap enough, "no retrieval" is a legitimate
choice.

---

## Step 4: the loop — the stopping condition is structural (Lesson 24's setup)

Lesson 22 Step 8 got stuck here: the model does not know when to stop, and hit
the step ceiling both times.

deep-research's answer is not to ask the model at all.

```ts
// deep-research/src/deep-research.ts:230-231
const newBreadth = Math.ceil(breadth / 2);
const newDepth = depth - 1;
...
if (newDepth > 0) {
  return deepResearch({ query: nextQuery, breadth: newBreadth, depth: newDepth, ... });
}
```

Each level deeper halves the breadth and decrements the depth. At zero it ends.
The model never gets a say in whether to continue.

```text
breadth=4, depth=2   →   4 條 query
                          每條再展開 2 條（4/2）
                          depth 到 0，停
```

Together with three other decisions, the loop closes:

```ts
// :252  下一輪的 query 是上一輪的產物，不是原始問題
const nextQuery = `
  Previous research goal: ${serpQuery.researchGoal}
  Follow-up research directions: ${newLearnings.followUpQuestions.map(...)}
`;

// :102  流動的是 learnings，不是網頁
`generate a list of learnings from the contents ... max of ${numLearnings}`

// :30   並行度是一個寫死的小數字
const ConcurrencyLimit = Number(process.env.FIRECRAWL_CONCURRENCY) || 2;

// :282  單一分支失敗不能弄垮整輪
catch (e) { return { learnings: [], visitedUrls: [] }; }
```

"What flows is learnings, not pages" is the crucial one: five pages of content
compress into at most 3 learnings, and only the learnings go into the next round.
This is context compaction (Lesson 5) growing inside a research loop.

### One thing they did not do, and another that did

deep-research's `visitedUrls` is **only used to list Sources at the end of the
report** (`:229`, `:239`, `:292`); it is never used to avoid re-fetching.

GPT Researcher does:

```python
# gpt-researcher/gpt_researcher/skills/researcher.py:801
async def _get_new_urls(self, url_set_input):
    for url in url_set_input:
        if url not in self.researcher.visited_urls:
            self.researcher.visited_urls.add(url)
            new_urls.append(url)
```

And that set is **shared across sub-researches**:

```python
# :108
# Note: visited_urls is deliberately NOT cleared here. It may be
# shared with a parent researcher (e.g. detailed reports pass their
# accumulated URLs into each subtopic researcher) so that already
# scraped URLs are not fetched again.
```

Which is exactly what Lesson 22 Step 8 was missing, and the first thing Lesson 24
builds.

---

## Step 5: copy it back, then measure

`lesson-23-real-world/agent.ts` differs from Lesson 22's agent **only by four
extra rules in SYSTEM_PROMPT**:

```diff
+ ## How to search (borrowed from production research agents)
+ A. Write each query as a plain natural language phrase. Do NOT use search operator
+    syntax such as site:, filetype:, inurl:, intitle:, OR, AND, or NOT.
+    [gpt-researcher/gpt_researcher/prompts.py:250]
+ B. Plan 3-4 distinct queries up front and make sure each one is unique and not
+    similar to the others.
+    [deep-research/src/deep-research.ts:54]
+ C. For each query, know what you are trying to learn from it before you run it.
+    [deep-research/src/deep-research.ts:66, the researchGoal field]
+ D. Do not search for project or product names you remember from training.
```

Tools unchanged, loop unchanged, retrieval pipeline unchanged. Then run the
question Lesson 22 kept failing:

```
> 有哪些 open source 專案可以把影片動作 retarget 到 Unitree G1？
```

| | Lesson 22 (two runs each) | Lesson 23 (two runs each) |
|---|---|---|
| searches | 12, 14 | 28, 27 |
| fetches | 4, 2 | 7, 4 |
| queries with operators | 3, 10 | **0, 1** |
| result | **both hit the 16-step ceiling, no answer** | **both completed, fully cited answers** |

There are more searches but **fewer rounds**, because rule B made the model issue
3-4 parallel queries at once. That is deep-research's shape: fan out sideways,
then be constrained structurally.

The answer itself is right too: humanoid-mimic first with its G1 support and MIT
licence noted, retarget-anything marked as deprecated since v2.0 with the reason,
plus the forum's first-hand foot-sliding experience cited.

---

## Step 6: the first run after copying blew up

That table above is the result **after fixing a bug**. The first run went like
this:

```
>   → web_search()
  ✗ query is empty. Pass what you are looking for.

[串流失敗] 400 status code (no body)
```

Twice, identically. And Lessons 20-22 never did this.

### The debugging

**First hypothesis (wrong)**: padding the model's empty `arguments` to `"{}"`
destroyed Gemini's thought_signature (the trap from Lesson 6 Step 7). Passing it
back verbatim — **still 400**.

Getting the real error message. The SDK only says `400 status code (no body)`, so
the whole request got dumped and replayed with native `fetch`:

```json
{ "error": { "code": 400, "message": "Request contains an invalid argument." } }
```

Then a bisect over the payload, one field at a time:

```
✗ 原封不動（基準）                    400
✗ 拿掉 thought_signature              400
✓ arguments 改成有內容的 JSON         200   ← 找到了
✗ arguments 改成空字串                400
✗ 同時：拿掉簽章 + 填 arguments       400   "Function call is missing a thought signature"
```

The problem is `arguments`. Printing it:

```json
"{\"query\":\"...github video\"}{\"query\":\"...github\"}{\"query\":\"...repo\"}"
```

Three pieces of JSON glued together.

### Root cause

Printing Gemini's raw stream fragments:

```
index=undefined  id=Z6v57hon  name=web_search  args="{\"query\":\"...\"}"
index=undefined  id=KgCOTqoT  name=web_search  args="{\"query\":\"...\"}"
index=undefined  id=OfPQHMnm  name=web_search  args="{\"query\":\"...\"}"
index=undefined  id=VHylBMuP  name=web_search  args="{\"query\":\"...\"}"
```

Gemini's OpenAI-compatible layer never sends `index`. Each delta is a complete
tool call carrying its own distinct `id`.

And our accumulator groups by `index` (`shared/streaming/openai.ts`):

```ts
const existing = pending.get(call.index) ?? { id: "", name: "", args: "" };
if (call.function?.arguments) existing.args += call.function.arguments;
```

All four calls have `index` of `undefined` → they all land in one slot → `args`
becomes four concatenated JSON documents → `JSON.parse` fails → the parameters
become `{}` → the tool receives an empty query → and that broken string is sent
back on the next round → 400.

### Why the previous three lessons were fine

Because the model happened to **call one tool per round**. With one, "everything
glued together" is the same as "nothing glued".

Rule B ("plan 3-4 queries at once") made the model start issuing parallel calls,
and a bug latent for three lessons surfaced for the first time.

### The fix

```ts
const key =
  typeof call.index === "number" ? `index:${call.index}`
  : call.id ? `id:${call.id}`
  : (lastKey ?? "index:0");
```

Use `index` when present (OpenAI), otherwise `id` (Gemini), and otherwise attach
to the previous one (a safety net).

Re-running Lessons 21 and 22 afterwards: no regressions, and Lesson 21's question
now finishes in 4 tool calls (parallel calls actually work now).

### What this section teaches

> A "compatibility layer" says the protocol is the same, not that the behaviour
> is.

Same disease as Lesson 6 Step 7 (thought_signature), same file, different field.
A neutral abstraction always leaks somewhere, and the leak usually takes a **new
way of using it** to surface — this time, copying somebody else's prompt.

---

## Step 7: copying a prompt works, but only halfway

Rule A (no operators) **worked**: queries with operators fell from 3, 10 to 0, 1.

Rule D (do not search for project names you remember) **did not**:

```
→ web_search(query=HumanPlus Unitree G1 github)
→ web_search(query=General Motion Retargeting GMR humanoid github)
→ web_search(query=dex-retargeting github robot)
```

It searched for remembered names anyway. And in one run, `Pink` and `Pinocchio`
— things that do not exist in the corpus — still slipped into the answer's
recommendations, without an `UNVERIFIED` tag.

```text
「不要用某種語法」    → 可以用 prompt 約束，因為那是一個明確的格式規則
「不要想你記得的事」  → prompt 約束不了，因為那是模型的先驗
```

**Which is exactly why deep-research does not use a prompt to ask the model to
stop, but writes the stopping condition into code as `breadth/2` and `depth-1`.**

Back to the sentence this series has repeated many times:

> What the harness can guarantee should not be left to prayer in a prompt.

Lesson 21 Step 5 (the warning did nothing, fixing the extractor did) was once,
Lesson 22 Step 5 (the biased signal) was twice, and this is the third.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `bun run lesson-23:check` prints clone commands | the reference projects are not checked out | clone with the commands it gives |
| lots of `~ 行號漂了` | upstream changed | normal. Go see why they changed it; that is usually more valuable than the original line |
| `✗ 找不到` | that code was deleted or heavily rewritten | as above. This lesson's content is anchored to the commits listed |
| `400 status code (no body)` | the parallel tool-call accumulation bug | see Step 6, fixed |
| the clones show up in `git status` | `.git/info/exclude` is not set | see the "stays out of version control" section above |

---

## Exercises

### Exercise 1: read all 294 lines of deep-research ⭐

Read `deep-research/src/deep-research.ts` in one sitting, then answer:

1. Which line is where `learnings` turns from "page content" into "text
   conclusions"?
2. If one query times out, what happens to the whole research?
3. Is `visitedUrls` used to avoid re-fetching?

The answer to the third will surprise you. It is the most important question in
this lesson.

### Exercise 2: swap top-k for a threshold ⭐⭐

Lesson 22's retrieval always returns five. Follow GPT Researcher and make it a
threshold: below a similarity value, return nothing.

Then run Lesson 22's evaluation set. Does nDCG change? Does recall? (Hint: a
threshold only shows its value when the corpus genuinely has no answer, and every
query in our evaluation set has one — meaning the evaluation set is missing a
category of case.)

### Exercise 3: add text density ⭐⭐

Following the shape of crawl4ai's `content_filter_strategy.py:568`, add a "drop
it when link density is too high" layer to Lesson 21's extractor.

Then run `bun run lesson-21:measure`. On this clean corpus there will probably be
no difference — **record that honestly**, and think about what kind of page would
show one.

### Exercise 4: copy researchGoal in ⭐⭐

Rule C currently just tells the model to be clear in its own head. Make it output
it for real: every `web_search` must carry a `goal` argument stating what it hopes
to learn.

Observe: do the queries get fewer and better, or does it just write one more
throwaway sentence? (No standard answer; the runs behind this lesson produced
**both**.)

### Exercise 5: find a problem they have not solved either ⭐⭐⭐

After reading a little of all four projects, find something **everybody does
badly**.

Hint: try answering "for every sentence in this report, which passage of which
URL does it come from?", then look at how each of the four handles the
correspondence between citations and body text.

You will find this is generally done very crudely. That is Lesson 25's subject.

---

## The comparison table

| Our approach | The real projects | Who is better |
|---|---|---|
| queries thought up one at a time by the model | plan N at once, ban operators, attach a research goal | **them**, now copied back |
| extraction took only `<p>` (fixed later) | tables and lists in the allowlist from the start | **them**; we collided three times |
| a blocklist (12 patterns) | almost the same blocklist plus text density | tie, but they have an extra layer |
| self-built BM25 + dense + RRF + signals | dense threshold filtering only | **depends on architecture**: their sparse half is outsourced to the search engine |
| top-k always returns five | a similarity threshold that can return nothing | **them** (better for an agent) |
| the stopping condition is the model's judgement | `breadth/2` and `depth-1` hardcoded | **them**, and that is Lesson 24 |
| no "URLs already read" | `visited_urls`, shared across sub-researches | **them**, and that is Lesson 24 |
| an evaluation set (nDCG/recall/novelty) | none of the four has retrieval evaluation | **us** |

That last row is not a boast. All four are good products, but their quality
assurance rests mainly on user reports and eyeballs. **If you are doing this in
your own domain, an evaluation set is one of the few places you can beat an
off-the-shelf product** — because only you know what your users are actually
asking.

---

## Next lesson

[Lesson 24: the Deep Research loop](../lesson-24-research-loop/): implement the
four mechanisms read in Step 4.

```text
breadth / depth 的結構性預算      ← 不問模型「要不要繼續」
learnings 而不是網頁在 loop 裡流動  ← context 不會爆
visited_urls 跨層共用              ← 不重複抓
單一分支失敗不弄垮整輪
```

Lesson 22 Step 8's "hit the step ceiling both times" is only genuinely solved
there — and the solution is not a better prompt.
