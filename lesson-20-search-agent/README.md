# Lesson 20: 最小的 search agent

> 前置：[Lesson 3](../lesson-03-streaming/)（streaming）。看過 [Lesson 6](../lesson-06-domain-tools/) 會更有感。
>
> 這是 **AI Search 篇**的第一課。

## 這課要回答的問題

1. 為什麼不從「怎麼呼叫 Tavily API」開始？
2. 搜尋引擎回給 agent 的到底是什麼東西？
3. query 是誰生的？為什麼 query 的品質就是搜尋的品質？
4. 一個只有搜尋、不能開網頁的 agent，會錯成什麼樣子？

---

## 先講這一課的結論

```text
搜尋回來的不是網頁，是 snippet。
snippet 是「跟你的 query 最像的那一段」，不是「這一頁的結論」。
所以：換一個 query，同一個頁面可以給你相反的答案。
```

這句話等一下會有兩次實測佐證，**同一個模型、同一份語料、相反的結論**。

---

## 為什麼不直接教 Tavily

因為那只會學到「怎麼使用一個搜尋工具」，學不到 AI Search。

Tavily 這類產品把六件事包成一個 API：發現網頁、抓取、清理、索引、
檢索排序、回傳給 LLM。你如果從 API 開始學，這六件事會永遠是一個黑盒子，
之後遇到「為什麼它找不到我要的東西」就只能換一家試試看。

所以這一篇反過來做：**先把每一層拆開自己寫一次**，最後才組回去
（Lesson 23 會把 20-22 組成一個 Tavily-lite 服務）。

這一課只做最上面那一層：**一個 agent + 一個搜尋工具**，
而且刻意不給它開網頁的能力。你要先看到「缺什麼」。

---

## 這一課的「網際網路」

真的去打 Google 有三個問題：要金鑰、排序天天在變、你不知道正確答案。
所以這裡自己造了一個 14 頁的假 web，跟 Lesson 6 自己產 telemetry 是同一個理由。

```bash
bun run lesson-20:corpus
```

```
已產生 14 個頁面到 lesson-20-search-agent/corpus/pages
索引：lesson-20-search-agent/corpus/index.json（正文共 8688 字元）
```

產生出來的東西有兩份，這個分法就是 Lesson 20 和 21 的分界：

| 產出 | 是什麼 | 誰用 |
|---|---|---|
| `corpus/index.json` | 已經清乾淨的純文字 | **這一課**（假裝有人幫你清好了） |
| `corpus/pages/*.html` | 有導覽列、廣告、cookie 橫幅、footer 的原始 HTML | Lesson 21（自己抽正文） |

語料是**刻意有病**的，真實 web 有的毛病它都有：

```text
snippet 講的跟正文不一樣（而且兩個方向都有）
同一份內容有兩個網址（GitHub README 和 docs 站）
關鍵字塞滿但沒有內容的 SEO 農場
兩年前的懶人包還在到處被引用
已經封存的 repo，頁面上看不太出來
提到關鍵字很多次但其實無關的新聞
```

**一份乾淨的語料學不到排序。** Lesson 22 就是要處理這些。

> 每一頁的「真正的事實」寫在 `corpus/pages.ts` 的 `groundTruth` 欄位。
> 跟 Lesson 6 一樣，它**不會**寫進產生出來的資料，agent 看不到答案。

---

## Step 0：先玩排序，不需要模型

搜尋引擎本身可以單獨跑，不用 API key、不用網路：

```bash
bun run lesson-20:search "unitree g1 retargeting"
```

真的跑出來的前四名：

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

三件事值得停下來看：

| 名次 | 是什麼 | 問題 |
|---|---|---|
| **1** | SEO 農場 | 關鍵字密度最高，所以 BM25 給它最高分。整頁沒有任何資訊 |
| **2** | 2025 年的懶人包 | 內容已經過時（它說 humanoid-mimic 不支援 G1，錯的） |
| **8** | `humanoid-mimic 0.7` 發佈公告 | **這才是正確答案**，排在第八 |

而 `github.com/kinelabs/humanoid-mimic` 這個真正該給使用者的 repo，
**前八名裡根本沒有。**

> 這不是我把排序寫壞了，這就是純關鍵字檢索的樣子。
> BM25 只知道「哪些字出現幾次」，它不知道誰可信、誰是新的、誰是廣告。
> **Lesson 22 要補的就是這些。**

排序的程式碼在 `search/engine.ts`，含註解 229 行，BM25 的核心大概 20 行。

---

## Step 1：loop 一行都沒改

跟 Lesson 6 一樣，先講最重要的一件事：`agent.ts` 的 `runTurn`
跟 Lesson 3、Lesson 6 **完全相同**。

```diff
- const registry = new ToolRegistry([listSessionsTool, queryTelemetryTool, ...]);
+ const registry = new ToolRegistry([webSearchTool]);

- const SYSTEM_PROMPT = "You are an incident analyst for a quadruped robot fleet...";
+ const SYSTEM_PROMPT = "You are a research assistant. You answer questions using web search...";
```

從 Lesson 1 到現在第 20 課，那個 while 迴圈還是沒變。
換工具 + 換 prompt = 換領域，搜尋也不例外。

---

## Step 2：搜尋回來的不是網頁

```bash
bun run lesson-20
```

```
> 有哪些 open source 專案可以把影片動作 retarget 到 Unitree G1？
```

實際跑出來的（Gemini 3.6 Flash）。它搜了 **11 次**：

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

然後給出答案（節錄）：

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

看起來非常專業。有分類、有連結、每一條都標了 `CONFIRMED`。

**但第一條是錯的。**

`retarget-anything` 那一頁的第四段寫著：

```text
Deprecation notice, v2.0, March 2026: the G1 profile is deprecated and no longer
maintained. … trajectories produced by the G1 profile will not load on current firmware.
We are not planning to fix it.
```

模型沒有看到這一段，因為 **snippet 只截到第一段**。

更糟的是最後那條：ROS 論壇那篇的標題是
「G1 retargeting: foot sliding with retarget-anything, **switched to** humanoid-mimic」，
內容是「我們花兩週試不出來，最後放棄」。模型把它引用成
「記得檢查關節順序」——一則「這東西不能用」的證據，
被轉述成一個溫和的操作提醒。

> **`CONFIRMED` 這個標籤的真正意思是「snippet 這樣說」，不是「這是真的」。**
> 這兩件事在只有 snippet 的時候沒辦法區分。

---

## Step 3：同一頁，換個 query，相反的結論

這是這一課最值得記住的一段。同一個模型、同一份語料，換一個問法：

```
> retarget-anything 的 G1 profile 現在還能用在 2026 SDK 上嗎？
```

它只搜了兩次：

```
→ web_search("retarget-anything" "G1")
→ web_search(site:github.com/openmotion/retarget-anything "2026 SDK" OR "G1 profile")
```

答案（節錄）：

```markdown
**無法直接正常使用**。

* G1 Profile 已棄用且不再維護：官方 README 及文檔明確指出，G1 profile 在 v2.0
  已被標示為棄用（deprecated）且不會再進行更新維護。
* 相容性問題原因：原本的 G1 profile 是針對 2024 年的 G1 URDF 設計，
  而 Unitree 在 2026 SDK 中更改了關節順序。
* 替代方案：humanoid-mimic 在 v0.7 已新增支援 2026 SDK 關節順序的 G1 profile。
```

**完全正確。**

同一頁、同一個模型，一次說「開箱即用支援 G1」，一次說「已棄用不能用」。
差別只有 query。

原因在 `search/engine.ts` 的 `makeSnippet`：

```ts
// 挑一段最像「有回答到 query」的文字當 snippet
for (let start = 0; start + SNIPPET_WORDS <= words.length; start += 4) {
  // 數這個視窗裡命中幾個 query 的字，取最高的那個視窗
}
```

真的搜尋引擎也是這樣做的。所以：

```text
query 決定 snippet，snippet 決定模型看到頁面的哪一面。
```

第一個問題問的是「有哪些專案」，命中的是介紹段落；
第二個問題問的是「2026 SDK 還能用嗎」，`2026 SDK` 這幾個字命中了棄用公告那一段。

> 這就是為什麼 Lesson 21 要把整頁抓下來。
> **不是因為 snippet 太短，是因為 snippet 的內容取決於你問了什麼。**

---

## Step 4：query 是模型生的

回頭看 Step 2 那 11 個 query，裡面有這些：

```
github "dex-retargeting" unitree g1
github Open-TeleVision Unitree G1
github Human2Humanoid unitree
```

`dex-retargeting`、`Open-TeleVision`、`Human2Humanoid` **在這份語料裡完全不存在**。
它們是模型從訓練資料裡撈出來的真實專案名，然後拿去搜一個根本沒有它們的索引。

三件事同時發生：

| 現象 | 為什麼 |
|---|---|
| 模型用記憶裡的名字生 query | 它以為自己知道答案，只是要找連結 |
| 有些 query 語法對這個引擎沒意義 | `site:`、`OR`、引號在 BM25 裡只是普通的字 |
| 11 次搜尋，重複性很高 | 沒有東西告訴它「這個角度已經試過了」 |

**這三件事都不是模型的錯，是 harness 沒做。** 到 Lesson 24 會補上
「已經搜過什麼」的狀態，這也是 Deep Research 的核心之一。

### 中文 query 會直接歸零

```bash
bun run lesson-20:search "把影片動作轉到人形機器人"
```

```
斷詞:  []
0 筆結果
```

不是「找不到相關內容」，是**這個檢索方式看不懂這個 query**。
`engine.ts` 的斷詞只認得 `a-z0-9`：

```ts
// 中文、日文、韓文丟進來會得到空陣列——
// 這是關鍵字檢索的真實限制，不是這份程式偷懶。
export function tokenize(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter(...);
}
```

那為什麼上面用中文問，agent 還是查得到？因為有三層防線在幫它：

```text
1. tool description：  "The index is keyword-based and English-only,
                        so write the query in English"
2. system prompt 規則 2：把使用者的問題轉成英文關鍵字
3. 空結果的錯誤訊息：   "rewrite the query in English … and search again"
```

第 3 層值得特別看（`tools/search.ts`）。查不到東西的時候不要只回 `no results`：

```ts
return (
  `No results for "${query}".\n${reason}\n` +
  "Next step: rewrite the query in English using the technical terms that would " +
  "actually appear on the page (project names, model names, file formats), and search again."
);
```

這是 Lesson 6 Step 5 那條原則的搜尋版：**每一個錯誤訊息都該告訴模型下一步該做什麼。**

真正的解法當然是讓檢索本身聽得懂中文（dense retrieval），那是 Lesson 22。

---

## Step 5：工具集決定 agent 能不能誠實

system prompt 裡有一條規則寫得很用力：

```text
4. Label every claim you make:
   - CONFIRMED: a snippet you retrieved literally says it. Quote the URL.
   - UNVERIFIED: it looks likely from a title or a partial snippet, but no snippet states it.
   Never present UNVERIFIED as fact.
```

而且 `web_search` 的 description 自己就先說了實話：

```text
IMPORTANT: a snippet is not the page. It is the passage that best matches your query,
so it can omit or even contradict what the page actually concludes.
```

結果呢？Step 2 那個答案裡，**每一條都標了 `CONFIRMED`**，沒有半條 `UNVERIFIED`。

為什麼？因為從模型的角度看，它說的每一句話**確實**都是某個 snippet 講的。
它沒有說謊，它只是沒有辦法知道自己漏掉了什麼。

> **在只有 `web_search` 的世界裡，「我沒辦法確認」是一個模型永遠到不了的狀態。**
> 它手上沒有任何工具可以把不確定變成確定，所以那個標籤永遠不會被用到。

這就是這一課想讓你先體驗、下一課才解決的事：

```text
prompt 可以要求誠實，
但只有工具能讓誠實變得可能。
```

Lesson 21 加上 `fetch_page` 之後，同樣的 prompt 才會開始有效——
因為到那時候，「去把那一頁打開來看」變成了一個真的可以做的動作。

---

## Step 6：不用金鑰也能看到這個失敗

```bash
PROVIDER=fake bun run lesson-20
```

這一課有自己的假 provider（`fake-provider.ts`），
因為 `shared/streaming/fake.ts` 那支是寫給 Lesson 1-5 的 coding agent 的，
它會去呼叫 `list_files` / `read_file`，在這裡只會換來兩次 `Unknown tool`，
然後吐一段跟搜尋完全無關的罐頭文字。

假 provider 演的是**一次搜尋 + 直接下結論**的軌跡：

```
我先搜尋一下有哪些相關專案。
  → web_search(query=unitree g1 video retargeting open source max_results=5)
  ✓ 5 results for "unitree g1 video retargeting open source"

**1. retarget-anything** — 支援 Unitree G1，最主流的選擇。
**2. humanoid-mimic** — snippet 沒有提到 G1，所以不支援 G1。
結論：你要 G1 的話用 retarget-anything。
```

兩條結論都錯：第一個已經棄用，第二個從 v0.7 開始就支援 G1 了。

> 這段是**寫死的腳本**，不是模型的判斷，README 裡不會拿它當「模型的行為」的證據。
> 它的用途是讓沒有 API key 的人也能看到這一課在講什麼。
> 真模型的實際軌跡在 Step 2 和 Step 3，那兩段都是真的跑出來的。

---

## 跑不起來？

| 症狀 | 原因 | 解法 |
|---|---|---|
| `找不到語料索引 …/corpus/index.json` | 語料還沒產生 | `bun run lesson-20:corpus` |
| 中文 query 回 0 筆 | 關鍵字檢索看不懂 CJK | 這是設計，見 Step 4 |
| `Unknown tool "list_files"` | 用到了 `shared` 的 fake provider | 這一課用自己的：`PROVIDER=fake bun run lesson-20` |
| 模型搜了十幾次還在繞 | 沒有「已經搜過什麼」的狀態 | 這是 Lesson 24 的題目 |
| 答案每一條都是 `CONFIRMED` | 沒有工具能驗證，見 Step 5 | Lesson 21 |
| `400 status code (no body)`（Gemini） | tool call 的 `extra_content` 被丟掉 | 見 Lesson 6 Step 7，已修 |

---

## 練習

### 練習 1：把 max_results 調到 8 ⭐

`tools/search.ts` 的預設是 5。改成 8 再問一次 Step 2 的問題。

`humanoid-mimic 0.7` 的發佈公告排第 8，進了視野之後答案會不會變？
**這題想讓你體會：召回率的一個小改動，可能比換模型影響更大。**

### 練習 2：把 SEO 農場拿掉 ⭐

在 `corpus/pages.ts` 把 `top-robotics-tools.example.net` 那一頁註解掉，
重新產生語料，再跑一次。

觀察：其他頁面的名次怎麼變？答案品質有沒有變好？
**一個純粹的垃圾頁面，佔掉的不只是第一名，是模型有限的注意力。**

### 練習 3：讓工具回傳排序分數 ⭐⭐

現在 `web_search` 回給模型的結果沒有 `score`。加上去，
然後在 description 裡說明分數的意義。

觀察：模型會不會開始「只看第一名」？這是好事還是壞事？
（提示：分數是 BM25 分數，不是可信度分數。你要怎麼在 description 裡講清楚，
才不會讓模型把「關鍵字很多」誤解成「比較可信」？）

### 練習 4：加一個 `search_site` 工具 ⭐⭐

限定只搜某個網站（例如 `site=github.com`）。

思考題：這該是一個新工具，還是 `web_search` 的一個參數？
（回想 Lesson 6：工具太多會稀釋模型的注意力，工具太胖參數會被亂填。）

### 練習 5：先別看 Lesson 21，自己設計 `fetch_page` ⭐⭐⭐

在寫任何程式碼之前，先回答四個問題：

1. 回傳整頁還是一部分？一頁一萬字怎麼辦？
2. 模型該用什麼指定要抓哪一頁？URL 還是搜尋結果的編號？
3. 抓失敗（404、逾時、被擋）的錯誤訊息要寫什麼，模型才知道下一步？
4. 抓回來的內容要不要保留 HTML 結構？標題、清單、程式碼區塊怎麼辦？

寫下你的答案，再去看 Lesson 21 的實作。**不一樣的地方才是你真正學到的東西。**

---

## 對照原始碼

這一課的形狀對應到幾個開源專案的哪一塊：

| 這一課的概念 | 對照 |
|---|---|
| agent + 一個 search 工具的 loop | [dzhng/deep-research](https://github.com/dzhng/deep-research) 的最內圈 |
| 「搜尋 → 抓頁 → 清理 → 回傳」整包 | Tavily / [Firecrawl](https://github.com/firecrawl/firecrawl) 的產品範圍（Lesson 23 會自己做一個） |
| 多來源聚合、結果 normalization | [SearXNG](https://github.com/searxng/searxng)（Lesson 23） |
| BM25 / hybrid retrieval | [txtai](https://github.com/neuml/txtai)（Lesson 22） |
| Tool 介面本身 | Pi `packages/agent/src/types.ts:380`（`AgentTool`） |

> ⚠️ 這幾個專案我還沒逐一讀過原始碼，上面只標「概念對應到哪個專案」，
> 沒有標行號。等實際讀過再補（設計原則 4）。

值得先記住的一件事：**Tavily 和 SearXNG 不在同一層**。
SearXNG 是把多個搜尋引擎的結果聚合起來，Tavily 是聚合完之後還幫你抓頁、
清理、排序、裁成 LLM 吃得下的大小。這一課做的是後者的最小版本，
而且刻意少了「抓頁」那一步。

---

## 下一課

**Lesson 21: Crawl 與內容抽取**（還沒寫）：這一課的 agent 看不到整頁。
下一課給它 `fetch_page`，然後你會發現真正的問題才開始：

```text
一頁 HTML 有 8 成是導覽列、廣告、訂閱表單
正文在哪裡？
一萬字的頁面怎麼塞進 context？
抓回來的內容要不要保留結構？
```

語料的 `corpus/pages/*.html` 已經先產生好了，就是為了下一課。
先打開一個看看，數數看正文佔多少比例。
