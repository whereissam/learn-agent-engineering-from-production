# Roadmap / TODO

這個系列還沒寫完的部分，以及為什麼還沒寫。

> 排序原則：**先做「可移植而且大部分人一定會用到」的**。
> 純產品工程（打包、自動更新、GUI）優先度低，因為它們跟 agent 本身無關。

## 全貌

```
Lesson 1-7    Pi 篇          agent engine + 領域工具 + 評估      ✅ 完成
Lesson 8-9    OpenWorker 篇  權限引擎 + 無人值守批准             ✅ 完成
Lesson 10-14  OpenWorker 續  GUI / OAuth / MCP / 排程 / audit    待寫
Lesson 15     Hermes 篇      長期記憶 + 注入防禦                  ✅ 完成
Lesson 16     Hermes 篇      skills + 審核閘門                    ✅ 完成
Lesson 17     Hermes 篇      跨 session 搜尋 + 排序衛生           ✅ 完成
Lesson 18-19  Hermes 篇      排程 / 委派                          需要時再寫
Lesson 20-25  AI Search 篇   crawl / 索引 / 檢索 / research loop  🚧 20-21 完成
```

三個專案的定位（不在同一個抽象層級）：

> **Pi 是 agent runtime；OpenWorker 是桌面 AI coworker 產品；
> Hermes 是長期運行的 personal agent platform。**

AI Search 篇不一樣，它**不跟單一專案**——那條線橫跨 SearXNG、Crawl4AI、
GPT Researcher、txtai 好幾個專案，因為「AI Search」本來就是好幾個問題疊在一起。

對應到四層框架：

| 層 | 主要來源 |
|---|---|
| 1. 單 agent 機制 | Pi（Lesson 1-5） |
| 2. Harness Engineering | OpenWorker（8-14）+ Hermes（15-19） |
| 3. 領域工具 | 你自己（Lesson 6 教方法）+ AI Search（20-25 是一整個領域的示範） |
| 4. Evaluation | 你自己（Lesson 7 教方法）+ Lesson 25 |

---

## 已完成

### Pi 篇（Lesson 1-7）第 1、3、4 層

| 課 | 主題 | 狀態 |
|---|---|---|
| 01 | 最小的 agent loop | ✅ |
| 02 | 更多工具、輸出截斷、批准機制 | ✅ |
| 03 | Streaming 與中斷 | ✅ |
| 04 | Session 持久化與分支 | ✅ |
| 05 | Context 壓縮 | ✅ |
| 06 | 領域工具（第 3 層） | ✅ |
| 07 | Evaluation（第 4 層） | ✅ |

### OpenWorker 篇（Lesson 8-9）第 2 層產品化

| 課 | 主題 | 狀態 |
|---|---|---|
| 08 | 風險分級與權限引擎 | ✅ |
| 09 | 無人值守批准與 inbox | ✅ |

### Hermes 篇

| 課 | 主題 | 狀態 |
|---|---|---|
| 15 | 長期記憶與注入防禦 | ✅ |
| 16 | Skills 與自我改進 | ✅ |
| 17 | 跨 session 搜尋 | ✅ |

---

## 待寫：OpenWorker 續篇

這幾課偏產品工程。**建議需要的時候再寫**，現在就把 27k 行的
connector 讀完對學習沒有幫助。

### Lesson 10：Agent server 與 GUI 通訊

- **來源**：`openworker/coworker/server/`（11.8k 行）、`surfaces/gui/`（151 個 .ts/.tsx）
- **會學到**：事件怎麼推給前端、前端怎麼中斷、為什麼是 local server
  而不是把 agent 塞進 GUI 進程、斷線重連怎麼不掉事件
- **什麼時候需要**：要做桌面或網頁介面時
- **難度**：這課會偏「讀懂架構」而不是「寫可跑的 code」，
  因為涉及 Tauri + React + Python server

### Lesson 11：Connector 與 OAuth

- **來源**：`openworker/coworker/connections.py`（181 行）、
  `connectors/`（28 個檔案，27k 行）
- **會學到**：token 存哪、怎麼刷新、失效了 agent 該怎麼反應、
  25 個整合的共同抽象長什麼樣
- **什麼時候需要**：要接 Gmail / Slack / Jira 這類服務時
- **注意**：`connectors/` 很大但重複性高，重點在 `connections.py`
  跟其中一兩個 connector 的實作

### Lesson 12：MCP client 進產品

- **來源**：`openworker/coworker/mcp/`（5 個檔案，1.3k 行）
- **會學到**：跟自己寫的工具有什麼不同、per-tool 控制、失敗隔離、
  為什麼 MCP 工具預設要當成 EXTERNAL 風險（接回 Lesson 8）
- **什麼時候需要**：要支援任意 MCP server 時

### Lesson 13：排程自動化

- **來源**：`openworker/coworker/automation/`（5 個檔案，1.5k 行）
- **會學到**：cron 觸發、任務狀態、失敗重試、跟 Lesson 9 的 inbox 怎麼配合
- **注意**：跟 Hermes 篇的排程主題重疊，可能合併

### Lesson 14：Audit log

- **來源**：`openworker/coworker/audit.py`（174 行）
- **會學到**：怎麼回答「這個 agent 上週到底做了什麼」
- **注意**：Lesson 8 的練習 4 已經是這題的簡化版。
  如果那題做完了，這課可能不需要單獨寫

---

## 待寫：Hermes 篇（Lesson 15-19）

- **來源**：[nousresearch/hermes-agent](https://github.com/nousresearch/hermes-agent)
- 已經掃過原始碼結構，下面的檔案位置和行數都是實際數的

### ⚠️ 先講規模問題

Hermes **非常大**：

```
agent/     162 檔   115,000 行
plugins/   188 檔   117,000 行
tools/     118 檔   102,000 行
gateway/    80 檔    92,000 行
cli.py       1 檔     16,818 行   ← 單一檔案
```

這正是原始評估說的「**它的問題是太完整**」。一打開就同時看到 memory、
skills、gateway、cron、TUI、voice、subagents、sandbox backends。

**所以 Hermes 篇的策略跟前面不同：不做全景導覽，只挑學習迴路那條線。**
gateway（92k 行）、plugins（117k 行）、六種 terminal backend 都跳過，
因為那些是「配置 Hermes」而不是「理解 agent」。

### ~~Lesson 15：長期記憶~~ ✅ 已完成

- **來源**：`agent/memory_manager.py`（1241 行）、`agent/memory_provider.py`（315 行）
- **為什麼先做這個**：它的介面非常乾淨，而且**直接對應我們的 loop**。
  `memory_manager.py` 的 docstring 就寫出了三個掛勾點：

  ```python
  prompt_parts.append(self._memory_manager.build_system_prompt())   # loop 之前
  context = self._memory_manager.prefetch_all(user_message)         # 每次 LLM 呼叫之前
  self._memory_manager.sync_all(user_msg, assistant_response)       # 每一輪之後
  ```

  對照我們的 Lesson 5：`prefetch_all` 就長在 `transformContext` 的位置。
- **會學到**：`MEMORY.md` / `USER.md` 當成一等公民的檔案、
  provider 抽象（一次只准一個外部 provider，避免 tool schema 膨脹）、
  記憶什麼時候寫入、怎麼避免記憶把 context 塞爆
- **可以寫可跑的 code**：✅ 這課完全可以接在現有的 `shared/` 上

### ~~Lesson 16：Skills 與自我改進~~ ✅ 已完成

- **來源**：`agent/skill_utils.py`（854）、`skill_commands.py`（808）、
  `skill_bundles.py`（438）、`skill_preprocessing.py`（144）、
  `agent/learn_prompt.py`（150）、`agent/learning_mutations.py`（206）
- **會學到**：agent 怎麼從一次任務裡萃取出可重用的 skill、
  skill 的格式與版本、`learn_prompt.py` 那個「提醒自己記下來」的機制
- **這課的主軸必須是風險，不是功能**：

  > 自動建立或修改 skill 會導致：錯誤經驗被永久保存、skill 污染、
  > prompt injection 持久化、行為逐漸漂移、難以重現與測試。

  比較穩妥的做法：

  ```
  agent 提議 → 人類審核 → 版本化保存 → 測試通過才啟用
  ```

  **注意這條流程跟 Lesson 8-9 是同一個形狀**：agent 提出，人類把關，
  而且把關點要能非同步（Lesson 9 的 inbox）。這是我想在這課點出的連結。
- **可以寫可跑的 code**：✅ 但要把「審核閘門」做進去，不要示範裸的自我改進

### ~~Lesson 17：跨 session 搜尋~~ ✅ 已完成

- **來源**：Hermes 用 SQLite FTS5 + LLM 摘要做 recall
  （`hermes_state.py` 10,850 行裡有一部分，要再定位）
- **實際發現**：我原本以為是「FTS5 + LLM 摘要」的兩段式，**這是錯的**。
  Hermes 明確寫 `No LLM calls anywhere`，而且那個摘要路徑是後來拿掉的。
  真正的重點是排序衛生（來源降權、壓縮摘要排除）。已在 Lesson 17 修正。
- **接得上 Lesson 4**：我們的 session 已經是 JSONL 了，加搜尋是自然的下一步
- **可以寫可跑的 code**：✅

### Lesson 18：排程與無人值守（可能跟 OpenWorker Lesson 13 合併）

- **來源**：`cron/`（11 檔，8954 行），
  `scheduler.py`、`jobs.py`、`executions.py`、`lifecycle_guard.py`、
  `suggestions.py`、`blueprint_catalog.py`
- **會學到**：cron 排程、任務生命週期、`lifecycle_guard.py` 在防什麼、
  `suggestions.py`（agent 自己建議要排什麼程）
- **跟 Lesson 9 的關係**：排程跑起來一定是無人值守，所以批准要進 inbox。
  這兩課應該一起讀
- **決定**：如果 OpenWorker Lesson 13 先寫了，這課就只補 Hermes 特有的部分
  （suggestions、lifecycle guard）

### Lesson 19：Subagents 與委派

- **來源**：`agent/` 裡的 subagent 相關檔案（還沒定位）
- **會學到**：子 agent 的隔離、context 不共用時怎麼傳遞任務、
  平行工作流、結果怎麼收回來
- **可以寫可跑的 code**：✅ 但要先想清楚「隔離」到什麼程度

### 明確**不寫**的部分

| 主題 | 規模 | 為什麼跳過 |
|---|---|---|
| Gateway（Telegram/Discord/Slack…） | 92k 行 | 是「怎麼接 IM 平台」，跟 agent 無關 |
| Plugins | 117k 行 | 同上，而且重複性高 |
| 六種 terminal backend | - | Docker/SSH/Modal/Daytona 是部署問題 |
| TUI / voice | - | 介面問題 |
| Trajectory 生成與壓縮 | 1598 行 | 是訓練模型用的，不是用 agent 用的 |
| Honcho user modeling | - | 外部服務整合 |

**如果你需要這些，直接讀 Hermes 的文件比讀我的課有效率。**

---

## AI Search 篇（Lesson 20-25）— Lesson 20-21 已完成

- **前置**：Lesson 1-3（loop、工具、streaming）＋ Lesson 7（evaluation）
- ⚠️ **下面列的開源專案還沒逐一讀過原始碼**，架構描述目前只是根據公開說明
  的推測。寫課之前要先實際讀（設計原則 4）

### 進度

| 課 | 狀態 | 備註 |
|---|---|---|
| 20 | ✅ [`lesson-20-search-agent/`](../lesson-20-search-agent/) | 語料 14 頁、BM25 檢索、`web_search` 工具、自備 fake provider。Gemini 3.6 Flash 實測過兩段軌跡 |
| 21 | ✅ [`lesson-21-crawl/`](../lesson-21-crawl/) | 正文抽取（含量測）、robots/403/JS 空殼/404、切塊、`fetch_page`。實測四段軌跡 |
| 22-25 | 待寫 | |

**Lesson 20 實測記錄**（寫進課程的兩段都是真的跑出來的）：

- 問「有哪些專案支援 G1」→ 模型搜了 **11 次**（其中三個 query 是從訓練
  資料撈出來的、語料裡根本不存在的專案名），最後把一個**已棄用**的
  G1 profile 講成「開箱即用」，而且標了 `CONFIRMED`
- 問「G1 profile 還能用在 2026 SDK 上嗎」→ **完全正確**，只搜了 2 次

  > 同一頁、同一個模型、相反的結論。差別只有 query。
  > 因為 snippet 是「跟 query 最像的那一段」，所以 **query 決定了模型
  > 看到頁面的哪一面**。這比原本預想的「snippet 太短」尖銳很多，
  > 已經變成 Lesson 20 的主軸。

**還沒做的**：Lesson 20 沒有評估集（要等 Lesson 25），
語料的 `groundTruth` 欄位已經先埋好了。

### 為什麼不從「怎麼呼叫 Tavily API」開始

因為那只會學會「使用搜尋工具」，不會理解 AI Search。這件事其實是好幾個
不同的問題疊在一起：

```text
網頁怎麼被發現與抓取
→ 怎麼清理成 LLM 能用的文字
→ 怎麼建立索引
→ 怎麼檢索與排序
→ Agent 如何反覆搜尋
→ 最後怎麼生成有引用的答案
```

這些層次要分開學。Tavily、Exa、Perplexity 看起來都叫「AI Search」，
但它們站的位置不同：

| 類型 | 代表 | 實際在做什麼 |
|---|---|---|
| **Web context API** | Tavily、Firecrawl | 替 agent 打包好的工具層：搜尋 → 抓頁 → 清理 → 回傳適合 LLM 的內容。開發者不用自己處理搜尋引擎、HTML、JS、內容抽取、結果格式 |
| **AI-native web index** | Exa | 更底層。不是幫你呼叫 Google，而是自己建 web index，用語義、相似內容、連結關係搜尋。這是搜尋基礎設施，不是一個 agent |
| **Search agent / Deep Research** | GPT Researcher、dzhng/deep-research | 自己沒有 index，接別人的搜尋來源，重點在 agent loop：拆子問題 → 產生 query → 搜尋 → 閱讀 → 判斷缺什麼 → 再搜 → 附引用 |

第三層最適合當起點，因為它同時會逼你面對搜尋、工具調用、agent loop、
資料品質與引用。

「Web context API 層」對應的開源組合不是單一 repo，而是：

```text
SearXNG + Crawl4AI / Firecrawl + reranker + API service
```

### 課程規劃

| 課 | 主題 | 會學到 | 對照原始碼 |
|---|---|---|---|
| **20** ✅ | 最小的 search agent | 把一個 `web_search` 工具接進 Lesson 3 的 loop。snippet 不等於網頁、**query 決定你看到頁面的哪一面**、query 是模型生的所以 query 品質就是搜尋品質 | dzhng/deep-research |
| **21** | Crawl 與內容抽取 | HTML → 正文 → chunk。boilerplate / 導航 / 廣告怎麼去、JS render 的界線、robots.txt、逾時與封鎖 | Crawl4AI、Firecrawl |
| **22** | 檢索與排序 | BM25 + dense retrieval + RRF 融合 + cross-encoder rerank、去重、來源多樣性、新鮮度。**vector DB 只是其中一個零件** | txtai、Qdrant |
| **23** | 自己做一個 Tavily-lite | 把 20-22 組成一個 `POST /search` 服務，理解 Tavily 到底解決了哪些工程問題 | SearXNG + Crawl4AI |
| **24** | Deep Research loop | planner、子問題、平行搜尋、evidence store、gap analysis、**什麼時候該停**。第一版自己寫 loop，不用框架 | GPT Researcher、LangChain `open_deep_research` |
| **25** | 引用與評估 | claim ↔ evidence 對齊、引用驗證、確定性 rubric、回歸測試。接回 Lesson 7 | 本系列 `lesson-07-evaluation/rubric.ts` |

### Lesson 20：最小的 search agent ✅

核心迴圈完全不動（設計原則 6），只是多一個工具。要讓讀者親眼看到：
模型拿到的只有 title、URL 跟一小段 snippet，所以它會開始亂猜——
這就是 Lesson 21 存在的理由。

**要能用 `PROVIDER=fake` 跑**（設計原則 1），所以需要一份固定快照的語料：
`lesson-20-search-agent/corpus/` 有 14 頁，`generate.ts` 同時產出
「已清乾淨的純文字索引」和「有雜訊的原始 HTML」，前者這一課用，
後者留給 Lesson 21。跟 Lesson 6 的 telemetry 產生器是同一個做法。

實作上有兩個當初沒想到的決定，寫 21 的時候要沿用：

- **這一課自備 fake provider**（`fake-provider.ts`）。`shared/streaming/fake.ts`
  是寫給 coding agent 的，會去呼叫 `list_files`，在這裡只會拿到 `Unknown tool`。
  順帶一提，Lesson 6 也有同樣的問題，還沒修（見下面「現有課程的缺口」）
- **snippet 的挑法要跟真實搜尋引擎一樣**（取跟 query 最匹配的視窗），
  不能只截開頭。整課最重要的那個現象是這樣才長出來的

### Lesson 21：Crawl 與內容抽取 ✅

搜尋只回傳 URL 和 snippet，agent 要回答問題必須真的打開網頁。而 crawl
不是 `fetch(url)`：

```text
JavaScript rendering    infinite scroll    cookie / session
導航列與廣告雜訊         表格與程式碼        重複文字
robots.txt              逾時                PDF / SPA / 被封鎖
```

三個要親手做過的概念：

- **Content extraction**：HTML 裡哪些是正文，哪些是導航、廣告、推薦內容
- **Chunking**：長網頁怎麼切，才能保持語意又不超過 context window
- ~~**Crawl strategy**：沿 link 做 BFS / DFS~~ → **沒做**，這一課只抓單頁。
  沿連結展開會跟 Lesson 24 的「什麼時候該停」重疊，留在那裡講比較好

**Lesson 21 實測記錄**（四段軌跡，全部是真的跑出來的）：

- 樸素的 `stripTags` 抽取：recall 100% 但 **noise 51%**，抽出來的量是正文的
  2.00 倍。導覽列、廣告、訂閱表單、footer 全部進 context
- 加了 `fetch_page` 之後，Lesson 20 那個「retarget-anything 開箱即用支援 G1」
  的錯誤答案自己消失了，而且模型引用到了論壇裡「把播放速率降到 0.8x」
  這種只有讀完整頁才拿得到的一手經驗

- ⚠️ **最重要的一段：靜默的抽取失敗。** 問「waist_yaw 在 2026 SDK 是第幾號」
  （答案在一個 HTML `<table>` 裡）：

  | 版本 | 結果 |
  |---|---|
  | 抽取器只取 `<p>`（表格被丟掉） | 讀完全部 7 個 chunk + 搜 6 次 → **撞上 16 步上限，沒有答案** |
  | 工具輸出加警告「這頁有表格沒抽到」 | **還是撞上 16 步上限**。它最後在猜號碼：`web_search("waist_yaw" "12" OR "13" OR "14"…)` |
  | 抽取器真的把表格抽出來 | **8 步答對**，引用正確 |

  > 這是 Lesson 6「能用 harness 保證的事，不要交給 prompt 祈禱」最乾淨的
  > 一次實證：在工具輸出裡拜託模型沒有用，改抽取器才有用。
  >
  > 而且**抽取失敗沒有任何錯誤訊號**——頁面抓到了、chunk 讀完了，
  > 模型只是永遠找不到那個數字。抓不到頁面至少還有 404。

- **fetch 修好的是「漏讀」，沒修好「無中生有」。** 模型仍然會把訓練資料裡的
  專案（Pink、DexRetargeting、WHAM）寫進答案。好消息是三級標籤真的開始被使用
  （Lesson 20 是每一條都 CONFIRMED），壞消息是出現了**引用嫁接**：
  一句沒有來源支持的話掛上了一個真實的 URL。
  → 這就是 Lesson 25 要做的事，而且要用確定性的檢查，不是叫模型評分

### Lesson 22：檢索與排序

這一課要打掉「AI Search = 丟進 vector DB 取 top 5」這個誤解。實際 pipeline：

```text
document
→ tokenize / embedding
→ sparse (BM25) + dense index
→ candidate retrieval
→ reciprocal rank fusion
→ cross-encoder rerank
→ final results
```

再加上 metadata filtering、query rewriting、新鮮度、權威度、去重、
來源多樣性。做完這課才會知道「語義搜尋」不只是把文字丟進向量資料庫。

### Lesson 23：自己做一個 Tavily-lite

```http
POST /search
{ "query": "...", "max_results": 10, "search_depth": "advanced" }
```

內部流程：

```text
SearXNG 搜尋候選 URL
→ Crawl4AI 抓正文
→ 去重與 chunking
→ embedding similarity
→ cross-encoder reranker
→ 回傳 JSON（title / url / content / score）
```

不是說做完就有 Tavily 的規模與穩定性，而是會清楚知道**它賣的是哪些工程
問題的答案**。

### Lesson 24：Deep Research loop

```text
分析問題 → 拆子問題 → 產生多個 query → 平行搜尋 → 閱讀網頁
→ 判斷缺少什麼 → 再次搜尋 → 彙整引用 → 生成報告
```

AI Search 的核心通常不是神祕的新模型，而是這個 loop 的品質：

- query 生得好不好
- 搜尋結果有沒有重複
- 什麼時候繼續搜尋、什麼時候停止
- 如何保存已學到的事
- 如何避免被低品質來源帶走

state 大概長這樣。重點是清楚管理**搜過什麼、讀過什麼、哪些證據支持哪個
claim、還缺什麼、該不該停**：

```ts
type ResearchState = {
  originalQuestion: string
  subQuestions: string[]
  visitedUrls: Set<string>
  evidence: Evidence[]
  unresolvedQuestions: string[]
  iteration: number
}
```

第一版**刻意不用 LangGraph**。框架留到讀者已經自己寫過一次、知道自己
為什麼需要它的時候（跟 README「不要為了做 Agent 而做 Agent」同一個立場）。
LangChain 的 `open_deep_research` 放在課末當對照組：planner / researcher
分工、state 設計、子任務平行化、retry 與 termination condition。

### Lesson 25：引用與評估

Lesson 7 的做法直接搬過來：確定性評分，不用 LLM 當裁判。

```text
引用的句子在來源網頁裡真的存在嗎？
引用的數字有沒有被改寫？
每個 claim 都有對應 evidence 嗎，還是有裸露的斷言？
換 reranker / 換 chunk 大小之後，有沒有退步？（--compare）
```

### 延伸專案（不是課程，是練習）

課程只做通用版本。真正值得讀者自己做的是一個**垂直領域的 AI-native
index**——不要索引整個 internet，挑一個自己熟的領域（例如 robotics：
arXiv、GitHub、ROS Discourse、Hugging Face、官方文件）：

```text
URL discovery → crawl scheduler → content extraction
→ canonical URL / dedup → document store
→ BM25 index + dense index + link graph
→ hybrid retrieval → reranker → search API
```

到這一層才開始碰得到 Exa 類的問題：語義相似是否真的比 keyword 好？
哪種 query 該走 keyword、哪種走 dense？link graph 能不能改善可信度？
新鮮度怎麼進 ranking？論文 / GitHub / 新聞要不要不同 ranking？
「跟這個頁面相似的頁面」怎麼搜？怎麼讓結果適合 agent 而不是人？

### 明確不做的三件事

1. **不自己爬整個 web** — distributed crawler、crawl scheduling、
   spam detection、index sharding、recrawl 與 freshness、儲存成本、
   法務與 robots 規則。這是搜尋基礎設施公司的題目，不是學習專案
2. **不把課寫成 vector DB 教學** — `文件 → embedding → vector DB → top 5`
   只是最簡單的 semantic retrieval，會讓讀者誤以為那就是全部
3. **不一開始做複雜 multi-agent** — 五個 agent 互相聊天不代表搜尋品質更高。
   第一版 `planner / research loop / writer` 就夠，甚至可以是同一個模型
   在不同階段換 prompt。真正難的是 evidence management 和 evaluation，
   不是 agent 數量

### 參考專案

| 專案 | 位置 | 為什麼看 |
|---|---|---|
| [dzhng/deep-research](https://github.com/dzhng/deep-research) | Search agent | 刻意做得簡單，agent loop 明顯，可以一次讀完。當「教科書版本」，先讀這個再讀 GPT Researcher 會容易很多 |
| [gpt-researcher](https://github.com/assafelovic/gpt-researcher) | Search agent | 產品級（後來發展成 Tavily 團隊）。不要讀整個 repo，追一條 request：query generation → search provider → scraper → context compression → report |
| [langchain-ai/open_deep_research](https://github.com/langchain-ai/open_deep_research) | Agent orchestration | planner / researcher 分工、LangGraph state 設計、平行化、retry、termination condition |
| [SearXNG](https://github.com/searxng/searxng) | 來源聚合 | metasearch engine。engine adapter、query 參數轉換、結果 normalization 與合併、timeout 處理、去重。**注意它不是 Exa**，沒有自己的 index |
| [Crawl4AI](https://github.com/unclecode/crawl4ai) | Crawler library | 網頁 → LLM-friendly Markdown，支援動態網頁、session、快取、深度爬取。Apache-2.0，適合直接改來做實驗 |
| [Firecrawl](https://github.com/firecrawl/firecrawl) | Web data API | 比 Crawl4AI 更接近「服務化的 web context platform」（`/search` `/scrape` `/crawl` `/extract`）。核心 AGPL-3.0，商用要注意授權 |
| [Perplexica](https://github.com/ItzCrazyKns/Perplexica) | 應用層 | Perplexity-like 完整產品：UI → search endpoint → provider → retrieval → LLM synthesis → streaming + citations。先跑起來，再把它的 SearXNG provider 換成自己的（專案近期改名為 Vane，寫課前確認一下現況） |
| [txtai](https://github.com/neuml/txtai) | Retrieval | embeddings database 可組合 dense + sparse + graph + RDBMS。學 hybrid search 的地方 |
| [Qdrant](https://github.com/qdrant/qdrant) | Vector infra | HNSW、payload filtering、metadata filter、multi-vector。不用讀 Rust，先搞懂它在 pipeline 裡的位置 |

### 建議的閱讀順序

```text
dzhng/deep-research → GPT Researcher → SearXNG → Crawl4AI
→ Perplexica → txtai / Qdrant → LangChain open_deep_research
→ 自己做 vertical web index
```

起點不是「先讀半年 information retrieval 理論」，也不是直接 clone 一個
Perplexity。先把 `search → crawl → rerank → research loop → citation`
完整跑通一次，之後再深入 BM25、embeddings、cross-encoder、query expansion、
learning-to-rank，每個理論都會對應到已經遇過的真實問題。

---

## 待補：現有課程的缺口

### 高優先

- [ ] **Lesson 2-5 沒有用真模型端到端測過**
      目前只有 Lesson 1、2、6、7 跑過真的 Gemini。
      3、4、5 是用 fake provider 驗證的（邏輯共用同一套 provider 層，
      但值得實測確認）

- [ ] **Lesson 8-9 沒有接進真的 agent**
      目前是獨立的 `table.ts` 和 `demo.ts`。
      Lesson 9 練習 3 是「接上去」，但課程本身沒做

- [ ] **Lesson 6-7 其實不能用 `PROVIDER=fake` 跑**（違反設計原則 1）
      `shared/streaming/fake.ts` 的腳本是寫給 Lesson 1-5 的 coding agent 的，
      它會呼叫 `list_files` / `read_file`，在 Lesson 6 只會得到三次
      `Unknown tool`。Lesson 20 的做法是**自備一支 fake provider**
      （`lesson-20-search-agent/fake-provider.ts`），Lesson 6 應該照做。
      「開源前的檢查清單」裡那條「九課都能用 fake 跑」目前是**不成立**的

- [ ] **只測過 Gemini**
      Anthropic 和 OpenAI 的 provider 實作沒有跑過真模型。
      特別是 streaming provider 的 `raw` 保留邏輯
      （Anthropic 的 thinking block、OpenAI 的 tool_calls）

### 中優先

- [ ] **加測試**
      目前沒有任何自動化測試。至少該有：
      路徑逃逸、截斷、壓縮切點、inbox 狀態機、權限決策表

- [ ] **英文版**
      如果要開源給更多人看，README 需要英文版
      （或至少主 README）

- [ ] **Lesson 6 的資料產生器可以更豐富**
      現在 5 個 session。加「兩次事件」「極慢傾倒」這類案例
      會讓 Lesson 7 的評估更有意思（見 Lesson 7 練習 4）

### 低優先

- [ ] Lesson 1-5 的 playground 目前是同一份複製五次，
      可以考慮讓每一課的 playground 有各自的重點
- [ ] `shared/providers` 跟 `shared/streaming` 有一些重複的轉換邏輯，
      但**刻意不合併**，合併之後 Lesson 1-2 的讀者會看到用不到的 streaming 概念

---

## 開源前的檢查清單

- [x] `.env` 在 `.gitignore` 裡
- [x] `.sessions/`、`reports/`、`results/` 在 `.gitignore` 裡
- [x] 沒有硬編碼的 API key
- [x] typecheck 乾淨
- [ ] 每一課都能用 `PROVIDER=fake` 跑（不需要 key）
      ← Lesson 1-5、20 可以；**6、7 不行**，見上面的缺口
- [ ] 加 LICENSE 檔案（README 寫 MIT，但沒有實際的 LICENSE 檔）
- [ ] 加 `CONTRIBUTING.md`（如果要收 PR）
- [ ] 決定要不要收 issue / PR
- [ ] git init + 分批 commit（目前還沒進版控）

---

## 設計原則（寫新課程時參考）

這九課下來累積的幾條原則，之後寫新課時應該遵守：

1. **每一課都要能用 `PROVIDER=fake` 跑**
   沒有 API key 的人也要能看到東西動

2. **實測踩到的坑要寫進去**
   README 的排查表只放「我真的遇到過」的問題，不放想像的。
   例如 Lesson 3 的 SIGINT 雙重註冊、Lesson 6 的 Gemini
   `thought_signature`、Lesson 7 的 off-by-one，都是實測發現的

3. **輸出範例要是真的跑出來的**
   不要編造模型的回應

4. **對照原始碼的行號要驗證過**
   我曾經把 Lesson 5 的摘要 prompt 位置寫錯
   （寫成 `prompt-templates.ts`，實際在 `compaction/compaction.ts`）

5. **不要說「這個你自己想辦法」**
   如果一件事重要到值得提，就該教。這是 Lesson 6-7 存在的原因

6. **核心 loop 不要動**
   從 Lesson 1 到 9，`runTurn` 基本沒變。
   新功能應該加在它周圍，不是改它本身。改到它的時候要問自己
   是不是抽象拆錯了
