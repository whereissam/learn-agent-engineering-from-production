# Lesson 23: 對照真實原始碼

> 前置：[Lesson 20](../lesson-20-search-agent/)、[21](../lesson-21-crawl/)、[22](../lesson-22-retrieval/)。
>
> 這一課不加新功能。它只做一件事：**把我們自己從零推導出來的東西，
> 跟真的在跑的專案逐項對照。**

## 這課要回答的問題

1. 我們踩的那些坑，真實專案怎麼處理？
2. 哪些地方我們做得跟他們一樣？哪些不一樣、為什麼？
3. 把他們的做法抄回來，agent 會變好嗎？

第 3 題有實測，而且結果比預期複雜：抄完之後**第一次跑就炸了**，
炸出一個潛伏在我們 provider 層三課的 bug。

---

## 為什麼是現在讀，不是一開始就讀

如果 Lesson 20 就叫你去讀 GPT Researcher，你會看到一堆 `if` 和參數，
然後想「嗯，看起來很合理」，然後什麼都學不到。

但你現在不一樣。你已經：

```text
Lesson 20  看過模型自己生出 site: 和 OR，然後在 BM25 上完全失效
Lesson 21  因為抽取器丟掉 <table>，燒掉兩次 16 步上限
Lesson 22  猜錯去重門檻，還被一個「平均分數上升」蓋掉一次崩塌
```

**帶著這些傷去讀，同一行程式碼的意思完全不同。**
你會在 gpt-researcher 的 prompt 裡看到一行「不要用搜尋運算子」，
然後知道那一行是誰用血換來的。

這也是這個系列從 Lesson 1 就在做的事（對照 Pi），只是這次對照的是
四個專案而不是一個。

---

## 先把原始碼弄到本機

```bash
git clone --depth 1 https://github.com/dzhng/deep-research        deep-research
git clone --depth 1 https://github.com/assafelovic/gpt-researcher gpt-researcher
git clone --depth 1 https://github.com/firecrawl/firecrawl        firecrawl
git clone --depth 1 https://github.com/unclecode/crawl4ai         crawl4ai
```

我讀的版本：

| 專案 | commit | 日期 | 規模 |
|---|---|---|---|
| deep-research | `1f8f3e2` | 2026-04-11 | 559 行（整個 `src/`） |
| gpt-researcher | `5d84d2f5` | 2026-07-14 | 大 |
| firecrawl | `ab033afd9` | 2026-07-26 | 很大 |
| crawl4ai | `7e80152` | 2026-07-15 | 大 |

**先讀 deep-research。** 整個 `src/` 只有 559 行，`deep-research.ts` 294 行，
一次讀得完，而且該有的都有。其他三個是產品，讀法是「拿著問題去找那一段」，
不是從頭讀。

### 這幾份不進版控，但也不寫進 `.gitignore`

```bash
# .git/info/exclude
crawl4ai/
firecrawl/
gpt-researcher/
deep-research/
```

`.gitignore` 是給**所有讀者**的檔案，這幾份只是我本機的參考資料，
不該出現在別人 clone 下來的 repo 裡。`.git/info/exclude` 是同樣的語法，
但只作用在你自己的機器上。**這個區別很多人不知道，值得記一下。**

### 行號會過期，所以引用是可執行的

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

設計原則 4 說「對照原始碼的行號要驗證過」。與其寫一份看起來很精確、
其實已經對不上的文件，不如讓文件自己可以被檢查。

> 順帶一提，這個檢查器第一次跑就抓到**我自己**三條 off-by-one。
> 上面那個 `~` 就是它的樣子。

---

## Step 1：query 生成——他們早就有一行在擋

Lesson 20 Step 4 我們觀察到：模型會生出 `site:github.com`、`OR`、引號，
而這些在 BM25 眼裡只是普通的字。當時我寫的結論是「這不是模型的錯，是 harness 沒做」。

GPT Researcher 的 prompt 裡就有那一行：

```python
# gpt-researcher/gpt_researcher/prompts.py:250
Each query must be a plain natural language phrase. Do not use search operator syntax
such as site:, filetype:, inurl:, intitle:, OR, AND, or NOT — these operators are
not universally supported and will return empty results on many search backends.
```

四個專案在 query 這一層的做法，湊起來是一套完整的方法：

| 做法 | 出處 | 我們有沒有 |
|---|---|---|
| 禁止搜尋運算子 | `gpt-researcher/prompts.py:250` | ❌ Lesson 20 沒有，這一課補上 |
| 一次生 N 條，要求彼此不相似 | `deep-research/src/deep-research.ts:54` | ❌ 我們是一條一條讓模型自己想 |
| query 附帶 `researchGoal`（為什麼要搜這條） | `deep-research.ts:66` | ❌ |
| 先搜一次，拿結果當 context 再生子問題 | `gpt-researcher/query_processing.py:108` | ❌ |
| 給模型今天的日期 | `deep-research/src/prompt.ts` | ✅ Lesson 22 有 |

`researchGoal` 那條特別值得看。他們的 query 不是字串，是一個物件：

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

**「說出你為什麼要搜這一條」本身就是一種約束。** 而且那個 `researchGoal`
下一輪會被拿來當輸入（Step 4 會看到）。

### 順便：結構化輸出真的會壞

```python
# gpt-researcher/gpt_researcher/actions/query_processing.py:6
def _normalize_sub_queries(parsed: Any, fallback_query: str) -> List[str]:
    """``json_repair.loads`` may return a list, a dict (e.g. ``{"queries": [...]}``
    or a single ``{"query": "..."}``), a bare string, or ``None`` when the model
    does not return clean JSON. Callers expect a ``list[str]`` and otherwise crash
    on ``.append`` / iteration, so normalize defensively here."""
```

整整一個函式，只為了處理「模型回了四種不同形狀」。而且他們用的是
`json_repair.loads` 而不是 `json.loads`——一個專門修壞掉 JSON 的套件。

再往下看，同一個檔案有**三層 LLM fallback**：strategic LLM →
同一個模型但限制 max_tokens 重試 → 換成 smart LLM。註解裡還附了一個
GitHub issue 連結。這就是產品和 demo 的差別。

---

## Step 2：抽取——我們撞三次才學到的，是他們的預設值

Lesson 21 Step 5 是整個系列最痛的一段：抽取器只取 `<p>`，
表格被安靜地丟掉，模型讀完全部 7 個 chunk、燒掉兩次 16 步上限，
最後才發現要把 `<table>` 抽出來。

crawl4ai 的白名單長這樣：

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

**表格和清單從第一行就在裡面。**

而黑名單這邊，我們自己推導出來的跟他們幾乎一樣：

| | 我們（Lesson 21） | crawl4ai `:101` `:113` |
|---|---|---|
| 整塊丟的標籤 | script, style, noscript, nav, header, footer, aside, form | script, style, noscript, nav, header, footer, aside, form, **iframe** |
| class/id 黑名單 | cookie, banner, newsletter, subscribe, sidebar, related, promo, ad, advert, sponsor, comment, share | nav, footer, header, sidebar, ads, comment, promo, advert, social, share |

**這種「各自推導出同一份清單」的情況，通常代表那份清單反映的是
真實世界的結構，不是誰的個人品味。**

### 但他們還有第二層：文字密度

```python
# crawl4ai/crawl4ai/content_filter_strategy.py:568
threshold: float = 0.48
# 評分權重
"text_density": 0.4, "link_density": 0.2, "tag_weight": 0.2,
"class_id_weight": 0.1, "text_length": 0.1
```

黑名單只能擋掉「你想得到的」東西。文字密度（文字 vs 連結的比例）
可以擋掉你沒想到的：導覽區塊的共同特徵是**連結多、文字少**，
不管它的 class 叫什麼。

我們沒做這一層，因為語料的版型固定。真實網站你需要它。

### firecrawl：同一件事的產業版本

```ts
// firecrawl/apps/api/src/scraper/scrapeURL/lib/removeUnwantedElements.ts:9
const excludeNonMainTags = [
  "header", "footer", "nav", "aside", ".header", ".top", ".navbar", "#header",
  ".footer", ".bottom", "#footer", ".sidebar", ".side", ".aside", "#sidebar",
  ".modal", ".popup", "#modal", ".overlay", ".ad", ".ads", ".advert", "#ad",
  ...  // 48 條
];
```

然後是我最喜歡的一段：

```ts
// :53
const forceIncludeMainTags = [
  "#main",
  ".swoogo-cols", ".swoogo-text", ".swoogo-table-div", ".swoogo-space",
  ".swoogo-alert", ".swoogo-sponsors", ".swoogo-title", ...
];
```

`swoogo` 是一個活動網站平台。**一個估值很高的產品裡，
硬編碼著某個特定平台的 CSS class。**

這不是他們懶。這是抽取這件事的真相：啟發式規則永遠有例外，
而例外只能一個一個加。你的抽取器最後也會長出這種東西。

還有一層很值得學的設計：

```ts
// :106
logger.warn("Failed to call html-transformer! Falling back to cheerio...");
```

主要路徑走 Rust（快），失敗才退回 cheerio（慢但可靠）。
**效能和可靠性分兩層，不要用一個實作同時追求兩件事。**

---

## Step 3：檢索——他們做得跟我們不一樣，而且有理由

這一段是最意外的。Lesson 22 我們做了 BM25 + dense + RRF + 去重 + 訊號，
還做了評估集。GPT Researcher 呢？

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

**沒有 BM25、沒有 RRF、沒有 rerank。** 只有一件事：
把抓回來的內容切成 1000 字元的塊，然後**丟掉相似度低於 0.35 的塊**。

為什麼可以這麼簡單？因為**sparse 那一半外包給搜尋引擎了**。
Tavily / Google 已經做完關鍵字匹配，他們拿到的候選已經是相關的，
剩下的工作只是「把整頁裡不相關的段落刪掉」。

這是一個架構選擇，不是偷懶：

```text
我們（Lesson 22）      自己建索引 → 所以 sparse + dense + 融合 + 排序都要自己做
GPT Researcher         用別人的搜尋引擎 → 只需要做「頁內過濾」
```

而且注意他們用的是**門檻**（threshold）不是**排名**（top-k）：

```text
排名：不管多爛，前五名一定會給你五個
門檻：全部都爛的話，就回空的
```

對 agent 來說門檻常常更好，因為「找不到」是一個它應該知道的事實。
我們 Lesson 22 的管線一律回五筆——這其實是個可以改的地方。

### 便宜的路徑優先

```python
# :164
chunk_threshold = int(os.environ.get("COMPRESSION_THRESHOLD", "8000"))
if total_chars < chunk_threshold and len(self.documents) <= max_results:
    # Fast path: no compression needed
```

**內容不到 8000 字元就完全跳過 embedding。** 不需要的時候不要付錢，
也不要付延遲。這跟 Lesson 6「能用程式算的不要給模型算」是同一種節制。

deep-research 更極端，它連過濾都沒有：

```ts
// deep-research/src/deep-research.ts:93
trimPrompt(content, 25_000)
```

每頁硬裁到 25k token，五頁一起丟進去讓模型自己看。
**在 context window 夠大又夠便宜的時候，「不做檢索」是一個合理的選擇。**

---

## Step 4：loop——停止條件是結構性的（Lesson 24 的伏筆）

Lesson 22 Step 8 我們卡在這裡：模型不知道什麼時候該停，兩次都撞上步數上限。

deep-research 的答案是：**根本不問模型。**

```ts
// deep-research/src/deep-research.ts:230-231
const newBreadth = Math.ceil(breadth / 2);
const newDepth = depth - 1;
...
if (newDepth > 0) {
  return deepResearch({ query: nextQuery, breadth: newBreadth, depth: newDepth, ... });
}
```

每深一層，廣度砍半、深度減一。`depth` 歸零就結束。
**模型從頭到尾沒有「要不要繼續」的發言權。**

```text
breadth=4, depth=2   →   4 條 query
                          每條再展開 2 條（4/2）
                          depth 到 0，停
```

搭配另外三個設計，整個 loop 就閉合了：

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

「流動的是 learnings 不是網頁」這點很關鍵：五頁內容壓成最多 3 條 learning，
下一輪只帶 learning 進去。**這是 context 壓縮（Lesson 5）長在 research loop 裡的樣子。**

### 一個他們沒做、另一個做了的事

deep-research 的 `visitedUrls` **只用來在報告最後列 Sources**
（`:229`、`:239`、`:292`），它從來沒有拿來避免重複抓取。

GPT Researcher 有：

```python
# gpt-researcher/gpt_researcher/skills/researcher.py:801
async def _get_new_urls(self, url_set_input):
    for url in url_set_input:
        if url not in self.researcher.visited_urls:
            self.researcher.visited_urls.add(url)
            new_urls.append(url)
```

而且那個集合是**跨子研究共用**的：

```python
# :108
# Note: visited_urls is deliberately NOT cleared here. It may be
# shared with a parent researcher (e.g. detailed reports pass their
# accumulated URLs into each subtopic researcher) so that already
# scraped URLs are not fetched again.
```

**這正是我們 Lesson 22 Step 8 缺的東西**，也是 Lesson 24 要做的第一件事。

---

## Step 5：抄回來，然後實測

`lesson-23-real-world/agent.ts` 跟 Lesson 22 的 agent
**只差 SYSTEM_PROMPT 裡多的四條規則**：

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

工具沒改、loop 沒改、檢索管線沒改。然後跑 Lesson 22 那個一直失敗的問題：

```
> 有哪些 open source 專案可以把影片動作 retarget 到 Unitree G1？
```

| | Lesson 22（各跑兩次） | Lesson 23（各跑兩次） |
|---|---|---|
| 搜尋次數 | 12、14 | 28、27 |
| 抓取次數 | 4、2 | 7、4 |
| 帶運算子的 query | 3、10 | **0、1** |
| 結果 | **兩次都撞 16 步上限，沒有答案** | **兩次都完成，答案有完整引用** |

搜尋次數變多了但**輪數變少了**，因為規則 B 讓模型改成一次發 3-4 條
平行查詢。這正是 deep-research 的形狀：**橫向展開，然後被結構限制住。**

答案本身也對了：humanoid-mimic 排第一並標明 G1 支援與 MIT 授權，
retarget-anything 標明 v2.0 已棄用及原因，還引用了論壇那條腳步滑移的一手經驗。

---

## Step 6：抄完第一次跑就炸了 ★

上面那張表是**修好一個 bug 之後**的結果。第一次跑是這樣：

```
>   → web_search()
  ✗ query is empty. Pass what you are looking for.

[串流失敗] 400 status code (no body)
```

跑兩次，兩次都一樣。而 Lesson 20-22 從來沒發生過。

### 除錯過程

**第一個假設（錯的）**：我們把模型送來的空 `arguments` 補成 `"{}"`，
破壞了 Gemini 的 thought_signature（Lesson 6 Step 7 那個坑）。
改成原樣送回——**還是 400**。

**拿到真正的錯誤訊息。** SDK 只說 `400 status code (no body)`，
所以我把整個請求 dump 出來，用原生 `fetch` 重放：

```json
{ "error": { "code": 400, "message": "Request contains an invalid argument." } }
```

然後逐項改 payload 二分：

```
✗ 原封不動（基準）                    400
✗ 拿掉 thought_signature              400
✓ arguments 改成有內容的 JSON         200   ← 找到了
✗ arguments 改成空字串                400
✗ 同時：拿掉簽章 + 填 arguments       400   "Function call is missing a thought signature"
```

問題在 `arguments`。把它印出來：

```json
"{\"query\":\"...github video\"}{\"query\":\"...github\"}{\"query\":\"...repo\"}"
```

**三段 JSON 黏在一起。**

### 根因

把 Gemini 的原始串流碎片印出來：

```
index=undefined  id=Z6v57hon  name=web_search  args="{\"query\":\"...\"}"
index=undefined  id=KgCOTqoT  name=web_search  args="{\"query\":\"...\"}"
index=undefined  id=OfPQHMnm  name=web_search  args="{\"query\":\"...\"}"
index=undefined  id=VHylBMuP  name=web_search  args="{\"query\":\"...\"}"
```

**Gemini 的 OpenAI 相容層完全不送 `index`。** 每個 delta 是一個完整的
tool call，各自帶不同的 `id`。

而我們的累積器是照 `index` 分組的（`shared/streaming/openai.ts`）：

```ts
const existing = pending.get(call.index) ?? { id: "", name: "", args: "" };
if (call.function?.arguments) existing.args += call.function.arguments;
```

四個 call 的 `index` 都是 `undefined` → 全部落進同一格 →
`args` 變成四段 JSON 相接 → `JSON.parse` 失敗 → 參數變成 `{}` →
工具收到空 query → 而那個壞掉的字串被送回下一輪 → 400。

### 為什麼前三課沒事

因為模型剛好**每輪只叫一個工具**。一個的時候，「全部黏在一起」等於「沒黏」。

規則 B（「一次規劃 3-4 條 query」）讓模型開始發平行呼叫，
這個潛伏了三課的 bug 才第一次現形。

### 修法

```ts
const key =
  typeof call.index === "number" ? `index:${call.index}`
  : call.id ? `id:${call.id}`
  : (lastKey ?? "index:0");
```

有 `index` 用 `index`（OpenAI），沒有就用 `id`（Gemini），
兩個都沒有就接到上一個（保險）。

修完之後回頭跑 Lesson 21 和 22：沒有退步，而且 Lesson 21 那題從
4 個工具呼叫就答完了（平行呼叫現在真的能用了）。

### 這一段的教訓

> **「相容層」只是說協議一樣，不代表行為一樣。**

這是 Lesson 6 Step 7（thought_signature）的同一種病，同一個檔案，
不同的欄位。中立抽象總會在某個地方漏，而漏的地方通常要靠一個
**新的使用方式**才會被發現——這次是「抄了別人的 prompt」。

---

## Step 7：抄 prompt 有用，但只有一半

規則 A（不要用運算子）**有效**：帶運算子的 query 從 3、10 降到 0、1。

規則 D（不要搜你記得的專案名）**無效**：

```
→ web_search(query=HumanPlus Unitree G1 github)
→ web_search(query=General Motion Retargeting GMR humanoid github)
→ web_search(query=dex-retargeting github robot)
```

它照樣去搜訓練資料裡記得的名字。而且其中一次跑，
`Pink` / `Pinocchio` 這些語料裡不存在的東西，還是溜進了答案的建議段落，
而且沒有標 `UNVERIFIED`。

```text
「不要用某種語法」    → 可以用 prompt 約束，因為那是一個明確的格式規則
「不要想你記得的事」  → prompt 約束不了，因為那是模型的先驗
```

**這正是為什麼 deep-research 不用 prompt 去要求模型停止，
而是用 `breadth/2`、`depth-1` 把停止條件寫進程式碼。**

回到這個系列講過很多次的那句話：

> 能用 harness 保證的事，不要交給 prompt 祈禱。

Lesson 21 Step 5（警告沒用、改抽取器才有用）是一次，
Lesson 22 Step 5（訊號有偏誤）是一次，這是第三次。

---

## 跑不起來？

| 症狀 | 原因 | 解法 |
|---|---|---|
| `bun run lesson-23:check` 印出 clone 指令 | 參考專案還沒抓下來 | 照著它給的指令 clone |
| 一堆 `~ 行號漂了` | 上游改版了 | 正常。去看他們為什麼改，通常比原本那行更有價值 |
| `✗ 找不到` | 那段程式碼被刪或大改 | 同上。這一課的內容以我讀的 commit 為準 |
| `400 status code (no body)` | 平行工具呼叫的累積 bug | 見 Step 6，已修 |
| clone 出現在 `git status` | `.git/info/exclude` 沒設 | 見上面「不進版控」那段 |

---

## 練習

### 練習 1：讀完 deep-research 的 294 行 ⭐

`deep-research/src/deep-research.ts` 一次讀完，然後回答：

1. `learnings` 是在哪一行從「網頁內容」變成「文字結論」的？
2. 如果某一條 query 逾時了，整個研究會怎麼樣？
3. `visitedUrls` 有沒有被用來避免重複抓取？

第 3 題的答案會讓你意外。**這是這一課最重要的一題。**

### 練習 2：把 threshold 換成 top-k 的相反 ⭐⭐

我們 Lesson 22 的檢索一律回五筆。照 GPT Researcher 的做法改成門檻制：
相似度低於某個值就不回。

然後跑 Lesson 22 的評估集。nDCG 會變嗎？**recall 會變嗎？**
（提示：門檻制在「語料裡真的沒有答案」的時候才顯出價值，
而我們的評估集每一題都有答案——這代表評估集少了一種案例。）

### 練習 3：加上文字密度 ⭐⭐

照 crawl4ai `content_filter_strategy.py:568` 的形狀，
給 Lesson 21 的抽取器加一層「連結密度太高就丟掉」。

然後跑 `bun run lesson-21:measure`。在我們這份乾淨的語料上大概沒有差別——
**那就誠實記下來**，並想想要什麼樣的頁面才測得出差別。

### 練習 4：把 researchGoal 抄進來 ⭐⭐

現在的規則 C 只是叫模型「心裡想清楚」。改成真的讓它輸出：
每次 `web_search` 都要附一個 `goal` 參數說明想學到什麼。

觀察：查詢會不會變少、變好？還是它只是多寫一句廢話？
（這題沒有標準答案，我自己跑的結果是**兩者都有**。）

### 練習 5：找一個他們也還沒解決的問題 ⭐⭐⭐

四個專案都讀一點之後，找一個**大家都做得不好**的地方。

提示：試著回答「這份報告裡的每一句話，分別來自哪一個 URL 的哪一段？」
然後去看四個專案分別怎麼處理引用與正文的對應。

你會發現這件事普遍做得很粗糙。**這是 Lesson 25 的題目。**

---

## 這一課的對照總表

| 我們的做法 | 真實專案 | 誰比較好 |
|---|---|---|
| query 一條一條讓模型自己想 | 一次規劃 N 條、禁用運算子、附研究目標 | **他們**，已抄回來 |
| 抽取只取 `<p>`（後來才修） | 表格清單從一開始就在白名單 | **他們**，我們撞了三次 |
| 黑名單（12 條 pattern） | 幾乎一樣的黑名單 + 文字密度 | 平手，但他們多一層 |
| 自建 BM25 + dense + RRF + 訊號 | 只做 dense 門檻過濾 | **看架構**：他們的 sparse 外包給搜尋引擎 |
| top-k 一律回五筆 | 相似度門檻，可以回空 | **他們**（對 agent 更好） |
| 停止條件靠模型自己判斷 | `breadth/2`、`depth-1` 寫死 | **他們**，這是 Lesson 24 |
| 沒有「已讀過的 URL」 | `visited_urls` 且跨子研究共用 | **他們**，這是 Lesson 24 |
| 有評估集（nDCG/recall/novelty） | 四個專案都**沒有**檢索評估 | **我們** |

最後一行不是在自誇。這四個專案都是很好的產品，但它們的品質保證主要靠
使用者回報和眼睛看。**如果你要在自己的領域做這件事，
評估集是你少數能贏過現成產品的地方**——因為只有你知道你的使用者
真正在問什麼。

---

## 下一課

**[Lesson 24: Deep Research loop](../lesson-24-research-loop/)**：Step 4 讀到的四個機制，
自己實作一次。

```text
breadth / depth 的結構性預算      ← 不問模型「要不要繼續」
learnings 而不是網頁在 loop 裡流動  ← context 不會爆
visited_urls 跨層共用              ← 不重複抓
單一分支失敗不弄垮整輪
```

Lesson 22 Step 8 那個「兩次都撞上步數上限」的問題，到那一課才會真的解決——
而且解法不是更好的 prompt。
