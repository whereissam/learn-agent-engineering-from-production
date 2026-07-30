# Lesson 21: Crawl 與內容抽取

> [English](README.md)
>
> 前置：[Lesson 20](../lesson-20-search-agent/README.zh-TW.md)（最小的 search agent）。
>
> 這一課只多一個工具：`fetch_page`。但它會改變 agent 能不能誠實。

## 這課要回答的問題

1. 一頁 HTML 裡，正文到底佔多少？剩下的是什麼？
2. 「把標籤拿掉就是正文」哪裡錯了？錯多少？
3. 抓不到一頁有幾種抓不到？每一種模型該做什麼？
4. 一萬字的頁面怎麼塞進 context？
5. 抽取器沒抽到的東西，模型要怎麼知道自己沒看到？

第 5 題是這一課最貴的一題，Step 5 有完整的實測記錄：
同一個問題跑三次，前兩次都燒光步數上限答不出來。

---

## Step 0：正文只佔一半

抽取器可以單獨量，不需要模型、不需要金鑰：

```bash
bun run lesson-21:measure
```

這一課有一個很少見的好條件：**正確答案是已知的**。
Lesson 20 的 `corpus/index.json` 裡存的就是每一頁的正文，
因為 HTML 本來就是從那份文字產生的。所以可以直接算分：

```
recall = 正文抽到多少   noise = 抽出來的東西有多少不是正文

                                          stripTags        extractMain
                                        recall  noise    recall  noise
github-com-openmotion-retarget-anyth  100.0% 29.5%   100.0%  0.0%
robotblog-example-com-best-retargeti  100.0% 45.8%   100.0%  0.0%
top-robotics-tools-example-net-unitr  100.0% 52.1%   100.0%  0.0%
huggingface-co-datasets-openmotion-h  100.0% 65.8%   100.0%  0.0%
cookingwith-example-com-sous-vide-gu  100.0% 68.3%   100.0%  0.0%
──────────────────────────────────────────────────────────────────────
平均                                    100.0% 51.0%   100.0%  0.0%

正文實際大小        8688 字元
stripTags 抽出來    17403 字元  (2.00x)
extractMain 抽出來  8688 字元  (1.00x)
```

`stripTags` 就是那個大家第一次寫爬蟲都會寫的版本：

```ts
html.replace(/<[^>]+>/g, " ")
```

它的 recall 是 100%（正文一個字都沒漏），所以**看起來完全正確**。
問題在 noise：抽出來的東西有一半不是正文。

看一頁就懂：

```bash
bun run lesson-21:measure --show retarget-anything
```

```
【stripTags】把標籤拿掉就好了吧？

We use cookies to improve your experience. Accept all Reject github.com Home Docs Blog
Pricing Sign in openmotion/retarget-anything: … Never miss an update Join 24,000 engineers
getting our weekly newsletter. Subscribe Sponsored: Ship your robot fleet faster with
RoboOps Cloud. Start free. Related posts 10 things nobody tells you about humanoid robots …
© 2026 github.com. All rights reserved. Terms · Privacy · Contact
```

這些東西會進 context、會被計費、而且**會被模型當成內容引用**。
一個回答裡出現「根據該頁面，可以用 RoboOps Cloud 加速部署」，
來源就是這裡。

> 兩倍的 noise 不只是浪費兩倍的錢。它是在稀釋真正的證據。

`extractMain` 的做法沒有任何魔法，就三步：

```text
1. 整塊丟掉：script / style / nav / header / footer / aside / form
2. class 或 id 命中黑名單的區塊也丟掉（cookie / newsletter / sidebar / ad / related …）
3. 挑正文容器：<article> 優先，其次 <main>，都沒有才退回 <body>
```

> 0% noise 是假的。語料的 HTML 是用同一個模板產生的，
> 抽取器剛好照著那個模板寫。真實網頁不可能這麼乾淨——
> Step 5 會給你看它碰到不同版型時怎麼壞掉。
>
> 真的要做，用 Readability、trafilatura 或 Crawl4AI，
> 它們骨子裡也是同一套啟發式規則，只是黑名單更長、還配上文字密度統計。
> 沒有一個抽取器是「原理上正確」的。

---

## Step 1：只多了一個工具

```diff
- const registry = new ToolRegistry([webSearchTool]);
+ const registry = new ToolRegistry([webSearchTool, fetchPageTool]);
```

`web_search` 是直接 `import` Lesson 20 的那一個，沒有複製。
`runTurn` 從 Lesson 3 到現在還是一行都沒改。

這一課要證明的就是「加一個工具能改變什麼」，所以其他東西必須完全一樣。

system prompt 改了一條規則。Lesson 20 是兩級標籤，這裡變三級：

```diff
- CONFIRMED: a snippet you retrieved literally says it.
+ CONFIRMED:     you fetched the page and its text states this.
+ SNIPPET-ONLY:  a search snippet says it but you did not open the page.
+ UNVERIFIED:    neither.
```

Lesson 20 的結尾說過：prompt 可以要求誠實，但只有工具能讓誠實變得可能。
現在工具有了，來看看有沒有變。

---

## Step 2：同一個問題，答案翻過來

Lesson 20 問「retarget-anything 還能用嗎」時模型答對了，
但那是因為 query 剛好命中棄用段落。這次問一個更難的：

```bash
bun run lesson-21
```

```
> retarget-anything 現在還能用在 2026 SDK 的 G1 上嗎？如果不行，替代方案是什麼？
```

實際軌跡（Gemini 3.6 Flash，7 個工具呼叫）：

```
→ web_search(retarget-anything Unitree G1)
→ web_search("retarget-anything" "G1" "SDK" OR "humanoid-mimic" OR "unitree_sdk2" …)
→ fetch_page(https://discourse.ros.org/t/g1-retargeting-foot-sliding/45211)
→ web_search("humanoid-mimic" Unitree G1 SDK 2026)
→ fetch_page(https://github.com/openmotion/retarget-anything)
→ fetch_page(https://github.com/kinelabs/humanoid-mimic)
→ web_search(Unitree G1 retargeting tools alternative 2026 …)
```

答案（節錄）：

```markdown
**直接回答：無法直接開箱使用（預設 G1 Profile 已失效/官方已棄用）。**

1. 關節順序不匹配：retarget-anything 內建的 G1 Profile 是基於 2024 年舊版的 G1 URDF…
   機器人會立刻觸發保護性停機 [CONFIRMED: https://discourse.ros.org/t/…/45211]
2. 官方公告放棄維護 G1：v2.0 公告明確指出 G1 Profile 已被棄用且不再維護
   [CONFIRMED: https://github.com/openmotion/retarget-anything]

#### 方案 1：改用 humanoid-mimic（主要推薦）
* v0.7（2026-06）已建立支援 2026 SDK 關節順序的 G1 Profile，且在實體機器人上驗證
  [CONFIRMED: https://github.com/kinelabs/humanoid-mimic]
* 專案 MIT 授權，但預設下載的姿態估計模型權重帶有非商業條款
  [CONFIRMED: https://github.com/kinelabs/humanoid-mimic]
* 快速步態下可能出現腳步滑行，社群暫時做法是把播放速率調到 0.8x
  [CONFIRMED: https://discourse.ros.org/t/…/45211]
```

每一條 `CONFIRMED` 現在都真的有讀過那一頁。最後那條「0.8x」尤其值得看：
那是論壇裡一個工程師的臨場做法，**只有把整頁讀完才拿得到**，
snippet 永遠不會截到它。

對照 Lesson 20 那個「開箱即用支援 G1」的答案，差別不是模型變聰明了，
是它終於有辦法把頁面打開。

---

## Step 3：抓不到有四種樣子

`fetcher.ts` 把真實 web 最常見的四種失敗做成規則。
每一種的**下一步都不一樣**，所以錯誤訊息必須說得出差別：

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

三個設計決定值得說：

robots.txt 檢查在最前面。先問「我可不可以抓」，再問「抓不抓得到」。
而且要記住：**robots.txt 沒有強制力**，它是一份請求，你的爬蟲自己要遵守。
會擋你的是法務和 IP 封鎖，不是這個檔案。

**JS 空殼的錯誤訊息寫得最長**，因為它最危險。模型很容易把
「抽不到內容」理解成「這一頁沒有這個資訊」，然後寫出
「該頁面並未提到 G1」——那是一個**憑空生出來的否定結論**。
所以錯誤訊息要直接把這條路堵死：`this means the content is unknown, NOT that the page is empty`。

404 順便講「不要自己編網址」。模型很愛把記憶裡的 repo 名字拼成一個
看起來很合理的 URL 然後去抓。

> 真實爬蟲還要處理逾時、重試與退避、redirect 鏈、PDF、
> robots 的 crawl-delay、ETag 條件式請求。這裡沒做，練習 5 是逾時那題。

---

## Step 4：長頁面要切塊

`https://www.unitree.com/g1/developer` 這一頁是一份 SDK 遷移文件，
抽出來 13,514 字元，一次塞不進去。

為什麼不像 Lesson 2 那樣截斷就好？因為你要的東西通常在後面。
截斷等於永遠拿不到第 18 節。

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

三個設計決定（`extract/chunk.ts`）：

| 決定 | 為什麼 |
|---|---|
| 只在**段落邊界**切 | 切在句子中間會產生半句話，模型會自己補完後半句——幻覺最好的溫床 |
| 相鄰的塊**重疊**一段 | 一段話剛好跨在邊界上時，沒有重疊兩邊都讀不完整 |
| 每一塊都標**第幾塊、共幾塊** | 不標的話，模型會拿第 1 塊的內容回答整份文件的問題 |

---

## Step 5：最貴的一課——靜默的抽取失敗

這一段是實測踩出來的，三次跑同一個問題。

```
> G1 的 waist_yaw 關節在 2026 SDK 裡是第幾號？
```

答案在那份遷移文件的一個 HTML `<table>` 裡：`waist_yaw | 1 | 13`。

### 第一次：16 步上限，沒有答案

當時的 `extractMain` 只取 `<p>`，表格被丟掉了。模型的軌跡：

```
web_search × 6
fetch_page(unitree.com/g1/developer) chunk 1,2,3,4,5,6,7   ← 整份文件讀完
fetch_page(blog.kinelabs.dev) / (openmotion.dev) / (humanoid-mimic)
web_search × 2
[已達 16 步上限]
```

16 個工具呼叫，沒有答案，也沒有一句「我找不到」。
它把整份文件七塊全部讀完，因為它相信答案就在裡面——
而答案確實在那一頁上，只是不在**抽出來的文字**裡。

> 這比抓不到頁面危險得多。抓不到至少有錯誤訊息。
> 抽錯內容什麼訊號都沒有，模型和你都不會發現。

好消息是它沒有編一個數字出來。壞消息是它也沒能說「找不到」，
是被步數上限打斷的——如果上限再高一點，它會繼續燒錢。

### 第二次：加了警告，還是 16 步上限

第一個修法是讓工具講實話（Lesson 6「工具要主動報告資料品質」）：

```ts
NOTE: this extractor keeps paragraphs only. This page also contains 1 table(s) and
24 list(s) whose contents are NOT included above. If the fact you need looks tabular
(indices, versions, limits), report that it could not be extracted from this page.
Do NOT conclude that the page does not contain it, and do not guess the value.
```

工具老老實實在每一塊都印了這段警告。結果：

```
[已達 16 步上限]
```

它還是沒停。它讀完七塊、又搜了六次，包括最後這個很絕望的 query：

```
web_search("waist_yaw" "G1" "12" OR "13" OR "14" OR "11" OR "0" OR "15")
```

它在猜號碼然後試著搜出來。

### 第三次：真的把表格抽出來，8 步答對

止血不是修法。真正的修法是讓抽取器**把表格抽出來**：

```ts
const pattern = options.includeStructures
  ? /<(p|ul|ol|table)\b[^>]*>([\s\S]*?)<\/\1>/gi
  : /<(p)\b[^>]*>([\s\S]*?)<\/\1>/gi;
```

表格轉成 pipe 分隔的純文字（保留的是「哪些值在同一列」，不是標記語言），
清單轉成 `- item`，而且**依照原始順序**放回去——
表格要是被搬到全文最後面，「上面那段講的就是下面這張表」的關係就斷了。

再跑一次：

```
→ web_search × 3
→ fetch_page(unitree.com/g1/developer) chunk 1,2,3,4
→ fetch_page(blog.kinelabs.dev/humanoid-mimic-0-7)

根據 Unitree G1 官方 SDK 遷移指南文件，waist_yaw 關節在 2026 SDK 裡的編號是 13。
* 2026 SDK 關節索引：13 [CONFIRMED: https://www.unitree.com/g1/developer]
* 2024 SDK 舊版索引：1  [CONFIRMED: https://www.unitree.com/g1/developer]
```

8 步，答對，引用正確。

### 這一段真正的教訓

```text
16 步（沒答案）→ 加警告 → 16 步（還是沒答案）→ 改抽取器 → 8 步（答對）
```

Lesson 6 有一條原則：能用 harness 保證的事，不要交給 prompt 祈禱。
這次的實測是它的反面教材加正面教材各一次：

| 做法 | 層次 | 結果 |
|---|---|---|
| 在工具輸出裡警告模型 | prompt 層的拜託 | 沒用 |
| 讓抽取器真的抽到表格 | harness 層的修正 | 有用 |

警告不是沒有價值——它在「真的抽不到」的時候仍然是最後一道防線
（程式碼還留著，`includeStructures: false` 時會出現）。
但**能修的東西不要只加警告**。

---

## Step 6：修好了漏讀，沒修好無中生有

不要以為加了 `fetch_page` 就沒事了。另一次跑「有哪些專案支援 G1」時，
模型除了正確的兩個 repo 之外，還多寫了一整節：

```markdown
### 二、社群常用的「兩階段自訂重定向工具鏈」
* WHAM / GVHMR / HMR 2.0 [SNIPPET-ONLY: https://arxiv.org/abs/2603.04417]
* MediaPipe / OpenPose / MMPose [SNIPPET-ONLY: https://robotblog.example.com/…]
* Pink (Python IK based on Pinocchio) [UNVERIFIED]，可以直接載入 Unitree G1 的
  URDF 檔案（23 DoF 配置）[CONFIRMED: https://www.unitree.com/g1/developer]
* DexRetargeting [UNVERIFIED]
```

這些專案**在語料裡完全不存在**，它們來自訓練資料。

好消息：三級標籤真的被用起來了。Lesson 20 那次是**每一條都 CONFIRMED**，
這次出現了 `SNIPPET-ONLY` 和 `UNVERIFIED`——工具讓誠實變得可能之後，
prompt 的要求才開始有效。

壞消息：看那條 Pink。「可以直接載入 G1 的 URDF」被標成 `CONFIRMED` 並掛上
unitree.com——但那一頁只說了 G1 是 23 DoF，從來沒提過 Pink。
引用被嫁接了。

```text
fetch_page 解決的是「模型漏讀」。
它不解決「模型多寫」，也不保證引用真的支持那句話。
```

要抓這種錯，只能回頭去驗證每一條引用：那個 URL 的正文裡，
真的有支持這句話的文字嗎？**這是 Lesson 25 的題目**，
而且做法會跟 Lesson 7 一樣是確定性的檢查，不是再叫一個模型來評分。

---

## 跑不起來？

| 症狀 | 原因 | 解法 |
|---|---|---|
| `找不到 Lesson 20 的語料` | 語料還沒產生 | `bun run lesson-20:corpus` |
| `robots.txt disallows` | 這是設計 | 見 Step 3，那一頁本來就不該被爬 |
| `found no readable text` | JS 渲染的頁面 | 見 Step 3。**不代表那一頁沒內容** |
| 模型只讀 chunk 1 就下結論 | 沒有強調「還有幾塊」 | 見 `tools/fetch.ts` 的 footer |
| 模型一直找不到表格裡的數字 | 抽取器把 `<table>` 丟了 | 見 Step 5，`includeStructures` |
| 抽出來混著「Subscribe」「Sponsored」 | 用到 `stripTags` | 那是反例，用 `extractMain` |

---

## 練習

### 練習 1：把 includeStructures 關掉 ⭐

`tools/fetch.ts` 裡改成 `{ includeStructures: false }`，
然後問「waist_yaw 在 2026 SDK 是第幾號」。

親眼看一次 Step 5 的第一版：模型讀完整份文件，然後撞上步數上限。
這題只要兩分鐘，但會讓你記得「靜默失敗」長什麼樣子。

### 練習 2：讓 measure 也量長文件 ⭐⭐

`extract/measure.ts` 現在只量 Lesson 20 那 14 頁（同一個模板，所以 0% noise）。
把 `fetcher.ts` 產生的那份長文件也加進去量。

觀察：換一個版型之後，`extractMain` 還有 0% noise 嗎？
（提示：那份文件沒有 `<article>`，會退回 `<body>`。）

### 練習 3：加上程式碼區塊 ⭐⭐

`<pre>` / `<code>` 現在會被丟掉。對技術文件來說這是致命傷。

思考：程式碼要不要保留縮排？要不要標註語言？
一大段程式碼要不要算進 chunk 的字數上限？

### 練習 4：句子級的切分 ⭐⭐

`chunkText` 遇到「單一段落就超過上限」時是整段放進去，
所以那一塊會超過 `maxChars`。改成在句子邊界切。

難點：`"see Fig. 3"`、`"v2.0"`、`"e.g."` 裡的句點不是句尾。
你會發現這題比想像中麻煩——這也是為什麼很多人直接用現成的 splitter。

### 練習 5：逾時與重試 ⭐⭐⭐

在 `fetcher.ts` 加一個「這個網域第一次一定逾時，第二次才成功」的規則。

然後回答三個問題：

1. 重試要退避多久？固定間隔還是指數退避？
2. 重試該由**工具**做，還是回錯誤讓**模型**決定要不要重試？
3. 如果模型自己重試，你怎麼避免它把步數上限全部花在同一個網址上？

第 2 題沒有標準答案，但值得想清楚：交給工具，模型看不到延遲；
交給模型，它可能重試五次。這就是 harness 設計。

### 練習 6：把 fetch_page 換成真的網路 ⭐⭐⭐

把 `fetcher.ts` 的 `readFileSync` 換成真的 `fetch()`，
搭配一個真的搜尋來源（SearXNG 或任何 search API）。

你會立刻遇到這一課提到、但語料裡沒有的東西：redirect、
gzip、字元編碼、cookie 牆、Cloudflare、PDF、無限捲動。

做完這題，你就知道 Firecrawl 和 Crawl4AI 到底在賣什麼了。

---

## 對照原始碼

| 這一課的概念 | 對照 |
|---|---|
| HTML → LLM 友善的文字 | [Crawl4AI](https://github.com/unclecode/crawl4ai)（Apache-2.0，適合改） |
| 服務化的 scrape / crawl / extract | [Firecrawl](https://github.com/firecrawl/firecrawl)（核心 AGPL-3.0） |
| 正文抽取的啟發式規則 | Readability、trafilatura |
| 輸出截斷 vs 切塊 | 本系列 `shared/tools/truncate.ts`（Lesson 2） |
| 工具要主動報告資料品質 | 本系列 Lesson 6 Step 4 |

> 這幾個專案的原始碼還沒逐一讀過，只標概念對應，沒有標行號（設計原則 4）。

一個值得先知道的分界：Crawl4AI 偏 library，Firecrawl 偏平台。
你要嵌進自己的 pipeline 就看前者，你要理解怎麼把它做成服務就看後者。
Lesson 23 會把這一課和 Lesson 22 組成一個服務，那時會再回到這個對照。

---

## 下一課

[Lesson 22: 檢索與排序](../lesson-22-retrieval/README.zh-TW.md)：Lesson 20 的 BM25 把 SEO 農場排第一、
正確答案排第八。這一課讓 agent 能讀完整頁面之後，那個問題反而更明顯了——
它讀的每一頁都是排序決定的。

```text
BM25 + dense retrieval + RRF 融合 + cross-encoder rerank
去重（同一份內容兩個網址）
新鮮度（2025 年的懶人包）
權威度（官方 repo vs 內容農場）
來源多樣性
```

語料裡那對近似重複的頁面（GitHub README 和 docs 站）就是為那一課準備的。
