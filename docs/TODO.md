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
Lesson 20-25  AI Search 篇   crawl / 索引 / 檢索 / research loop  ✅ 完成
Lesson 26     AI Search 續   成本與預算                           ✅ 完成
Lesson 27     AI Search 續   本地文件 + web 混合檢索              ✅ 完成
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

## AI Search 篇（Lesson 20-25）— ✅ 全部完成

- **前置**：Lesson 1-3（loop、工具、streaming）＋ Lesson 7（evaluation）
- ~~⚠️ 下面列的開源專案還沒逐一讀過原始碼~~ → **Lesson 23 讀完了**：
  deep-research `1f8f3e2`、gpt-researcher `5d84d2f5`、firecrawl `ab033afd9`、
  crawl4ai `7e80152`。23 條引用都標了檔案與行號，而且 `bun run lesson-23:check`
  會驗證它們還對不對

### 進度

| 課 | 狀態 | 備註 |
|---|---|---|
| 20 | ✅ [`lesson-20-search-agent/`](../lesson-20-search-agent/) | 語料 14 頁、BM25 檢索、`web_search` 工具、自備 fake provider。Gemini 3.6 Flash 實測過兩段軌跡 |
| 21 | ✅ [`lesson-21-crawl/`](../lesson-21-crawl/) | 正文抽取（含量測）、robots/403/JS 空殼/404、切塊、`fetch_page`。實測四段軌跡 |
| 22 | ✅ [`lesson-22-retrieval/`](../lesson-22-retrieval/) | BM25 + dense + RRF + 去重 + 品質訊號 + rerank，八題評估集（nDCG / recall / novelty）。embedding 快取進版控所以離線可跑 |
| 23 | ✅ [`lesson-23-real-world/`](../lesson-23-real-world/) | 對照四個真實專案的原始碼，把四條 query 規則抄回來實測。可執行的引用檢查器 |
| 24 | ✅ [`lesson-24-research-loop/`](../lesson-24-research-loop/) | 結構性預算、learnings 壓縮、visited/query 去重、失敗隔離。同一個問題 28 秒跑完 |
| 25 | ✅ [`lesson-25-citations/`](../lesson-25-citations/) | 引用嫁接 / 數字漂移 / 裸露斷言的確定性檢查，`--save` / `--compare` 回歸 |

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
| **21** ✅ | Crawl 與內容抽取 | HTML → 正文 → chunk。boilerplate 怎麼去、JS render 的界線、robots.txt、**靜默的抽取失敗** | Crawl4AI、Firecrawl |
| **22** ✅ | 檢索與排序 | BM25 + dense + RRF 融合 + rerank、去重、品質訊號。**vector DB 只是其中一個零件**，而且**平均分數會騙人** | txtai、Qdrant |
| **23** ✅ | ~~Tavily-lite 服務~~ → **對照真實原始碼** | 讀四個專案的原始碼，跟我們自己推導的做法逐項對照，再把做法抄回來實測 | 四個專案都讀了，23 條引用可驗證 |
| **24** ✅ | Deep Research loop | **控制流從模型手上拿回來**：結構性預算、learnings 壓縮、visited/query 去重、失敗隔離 | deep-research、gpt-researcher |
| **25** ✅ | 引用與評估 | claim ↔ evidence 對齊、引用驗證、確定性 rubric、回歸測試。接回 Lesson 7 | 本系列 `lesson-07-evaluation/rubric.ts` |
| **26** ✅ | 成本與預算 | `total ≠ input + output`、thinking 吃掉 maxTokens、錢花在哪一步、每條證據多少錢 | `gpt_researcher/utils/costs.py` |
| **27** ✅ | 本地文件 + web 混合 | 增量索引、來源識別（`path#L12-L48`）、跨來源融合、**相關性門檻** | `gpt_researcher/document/`、`vector_store/` |

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

### Lesson 22：檢索與排序 ✅

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

**Lesson 22 實測記錄**（八題評估集，nDCG@5）：

```
BM25 only  Dense only  + RRF   + 去重   + 品質訊號  + 多樣性   + LLM rerank
  0.655      0.689     0.720   0.693     0.845      0.845       0.858
```

- ⚠️ **評估抓到一個我沒看到的迴歸。** 第一版的關鍵字堆砌偵測只看比例，
  平均從 0.720 升到 0.768 看起來很成功，但 q8 從 **1.000 崩到 0.131**。
  原因是比例對短文件有系統性偏誤（25 字的 LICENSE 檔重複 4 次 license
  就被判成農場）。加上「絕對重複次數」門檻後修好，平均變成 0.845。

  > **平均分數上升，不代表沒有東西壞掉。** 沒有逐題表格我會直接把
  > 0.768 寫進 README，然後帶著這個 bug 再寫三課

- **去重讓 nDCG 變差**（0.720 → 0.693），因為評估集把兩個鏡像頁都標成
  相關。我沒有改標註，而是**加了一個 novelty@5 指標**（0.975 → 1.000）
  來衡量 nDCG 看不到的東西。留下去重的理由不在 nDCG 裡：對 agent 來說
  重複頁面等於浪費一次 `fetch_page` 和一塊 context

- **兩個階段誠實標示為沒有效果**：來源多樣性在這份語料上是死碼
  （每個網域最多 3 頁，前五名從來不會擠三個同網域）；
  LLM rerank 只有 +0.013，八題裡只有中文那題變好

- 近似重複的門檻我第一次也猜錯：憑印象設 0.5，實測鏡像對只有 0.174
  （5-gram）。**後果是去重一次都沒生效，而 nDCG 完全不會告訴你**——
  「沒做事」和「做了但沒差」在平均分數上長得一樣

- ⚠️ **檢索變好，agent 沒有變好。** 同一個問題（Lesson 20 那題）跑兩次，
  兩次都是 14 次搜尋 + 2 次抓取然後**撞上 16 步上限、沒有答案**，
  比 Lesson 21（11 搜 + 2 抓，有答出來）更糟。因為模型把步數花在
  搜尋訓練資料裡記得的專案名（HumanPlus、dex-retargeting、Open-TeleVision、
  GMR——語料裡都不存在）。

  > 排序解決「回來的東西好不好」，不解決「要搜幾次、什麼時候停、
  > 已經搜過什麼」。**後者完全在 agent 那一側 → 這是 Lesson 24 的題目。**

### ~~Lesson 23：自己做一個 Tavily-lite~~ → 改成「對照真實原始碼」✅

**原本的規劃被否決了，理由值得記下來。**

原本要把 Lesson 20-22 包成一個帶 `search_depth` 旋鈕的 HTTP 服務。
但拆開來看，「包成服務」裡面真正在學 AI Search 的只有一部分：

| 原本要做的 | 學到東西嗎 |
|---|---|
| `POST /search`、JSON schema、起服務、部署 | ❌ 那是 web 開發 |
| 一次 query 要抓幾頁、延遲預算怎麼分、部分失敗怎麼回 | ✅ 但這些是**呼叫端**的決定，屬於 Lesson 24 |

而**真正缺的是「他們到底怎麼做的」**——那也是這份 TODO 從一開始就掛著的
技術債（「還沒讀過原始碼」）。所以 Lesson 23 改成實際讀四個專案的原始碼，
跟我們自己推導出來的做法逐項對照。

**Lesson 23 實測記錄**：

- 抄了四條 query 規則（禁用搜尋運算子、一次規劃 N 條、附研究目標、
  不要搜記憶中的專案名）進 system prompt，其他完全不動。
  Lesson 22 那個**兩次都撞 16 步上限、沒有答案**的問題，
  變成**兩次都完成、答案有完整引用**；帶運算子的 query 從 3、10 降到 0、1

- ⚠️ **抄完第一次跑就炸了，炸出一個潛伏三課的 bug。**
  `shared/streaming/openai.ts` 的 tool call 累積器是照 `index` 分組的，
  但 **Gemini 的 OpenAI 相容層完全不送 `index`**。模型一次發多個工具呼叫時，
  四段 arguments JSON 會被串成一個字串 → parse 失敗 → 空參數 →
  下一輪 `400 status code (no body)`。

  > 前三課沒發作，因為模型剛好每輪只叫一個工具。
  > 規則 B（一次規劃 3-4 條 query）讓它開始平行呼叫，bug 才現形。
  > 修法：有 `index` 用 `index`，沒有就用 `id`。已回歸測試 Lesson 21、22

- **規則 A 有效、規則 D 無效**：「不要用 `site:` 這種語法」擋得住，
  「不要去搜你記憶中的專案名」擋不住——它照樣搜 HumanPlus、GMR、
  dex-retargeting。

  > 格式規則可以用 prompt 約束，先驗信念不行。
  > 這正是為什麼 deep-research 不用 prompt 要求模型停止，
  > 而是用 `breadth/2`、`depth-1` 把停止條件寫死。**第三次驗證同一條原則。**

- **一個意外的對照結果**：四個專案**都沒有檢索評估集**。
  我們 Lesson 22 有 nDCG/recall/novelty，他們靠使用者回報和眼睛看。
  這不是他們差，是評估集只有領域內的人做得出來

#### 原始規劃保留在這裡（被否決的那一版，當作決策紀錄）

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

### Lesson 24：Deep Research loop ✅

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

**Lesson 24 實測記錄**：

- 同一個問題（Lesson 22 那題），agent 版跑兩次都撞 16 步上限沒答案；
  research loop 版 **28 秒跑完，13 條證據全部掛著真的抓過的網址**，
  7 次搜尋 / 9 次抓取 / 9 次模型呼叫，都在開跑前算出來的上界之內

- **URL 去重擋掉 22 次重複抓取**。deep-research 沒有做這件事
  （`visitedUrls` 只用來列 Sources），gpt-researcher 有（`_get_new_urls`）。
  我們照後者

- **query 去重要寫進程式**。prompt 裡已經寫了「不要重複」，
  但假 provider 第一次跑就重複兩條。同一條原則第四次出現

- ⚠️ **又踩到兩個靜默失敗，都是自己寫的**：

  | 症狀 | 原因 | 修法 |
  |---|---|---|
  | 抓了四頁、0 條結論、沒有訊息 | 三種原因（JSON 壞 / 沒結論 / 來源被過濾）分不出來 | `Extraction.failure` 強迫講出原因 |
  | 報告在網址中間斷掉 `(https://github.com/kin` | `stopReason === "max_tokens"` 被忽略 | 記錄 `truncatedOutputs` 並顯示 |

  > 這已經是系列裡第四次同一種病（21 Step 5、22 Step 5、23 Step 6、24 Step 5）。
  > **每加一個階段就要問：這一步什麼都沒做的時候，我看得出來嗎？**

- **我們比 deep-research 多做的**：learning 綁 sources，而且用程式檢查
  「只能引用真的抓過的網址」。這是 Lesson 25 做引用驗證的前提。
  但目前只擋得住「引用沒抓過的頁面」，擋不住「那一頁沒說這句話」

### Lesson 25：引用與評估 ✅

Lesson 7 的做法直接搬過來：確定性評分，不用 LLM 當裁判。

```text
引用的句子在來源網頁裡真的存在嗎？
引用的數字有沒有被改寫？
每個 claim 都有對應 evidence 嗎，還是有裸露的斷言？
換 reranker / 換 breadth 之後，有沒有退步？（--compare）
```

**前面幾課已經替它鋪好的路**（寫這課的時候直接接上）：

| 素材 | 在哪 | 用途 |
|---|---|---|
| 每頁的「真正事實」 | `lesson-20-search-agent/corpus/pages.ts` 的 `groundTruth` | 標準答案，agent 看不到 |
| 證據綁來源 | `lesson-24-research-loop/state.ts` 的 `Learning.sources` | 逐句比對的前提 |
| 只能引用抓過的頁面 | `steps.ts` 的來源過濾 | 已經擋掉一半的問題 |
| 確定性 rubric 的寫法 | `lesson-07-evaluation/rubric.ts` | 直接沿用形狀 |

**要抓的三種錯**（前四課實測都出現過）：

1. **引用嫁接**：句子掛著真實 URL，但那一頁沒說這句話（Lesson 21 Step 6 的 `Pink`）
2. **數字漂移**：來源寫 0.8x，報告寫成 0.5x 之類
3. **裸露斷言**：報告裡有句子完全沒有引用

第 1 種要逐句對回正文，這是這一課的主要工作量。

**還沒併進來的**：長報告怎麼寫又不掉引用
（`gpt-researcher/.../report_generation.py`，309 行）。這一課只做「驗」，
沒做「寫」。如果要補，是 Lesson 25 的第二版。

**Lesson 25 實測記錄**：

- 對 Lesson 24 的**真實輸出**跑檢查，12 條 claim / 68 個原子，
  抓到三個問題，**三個都是真的**：

  | 問題 | 內容 |
  |---|---|
  | 裸露斷言 | 報告的**核心結論**那句一個來源都沒掛（細項倒是都有） |
  | 引用嫁接 | 授權那條掛了三個網址，其中論壇那篇從沒提過授權 |
  | 無來源的補完 | 來源寫「CPU-only… 40x slower」，報告寫成「比 GPU 慢 40 倍」 |

- ⚠️ **這一課我踩的三個坑全部在「評估這一側」**，比系統本身的錯更危險，
  因為它會叫你去修一個沒壞的東西：

  | 坑 | 症狀 | 教訓 |
  |---|---|---|
  | 切句子的佔位符壞了 | **每一條 claim 都變成「沒有引用」**，而程式照樣跑完 | 少一個機制就少一個會壞的地方，最後直接拿掉佔位符 |
  | 評估讀 `index.json`，agent 讀 `fetchPage` 的長文件 | 正確的引用被判成幻覺 | **評估的來源必須跟系統實際看到的是同一份** |
  | 去空白讓「June 2026」變成「62026」 | 正確的數字查不到 | 數字和識別字要用不同的正規化 |

  修完之後真實報告從「14 個查無來源」降到「5 個」，而剩下的全是真問題。

- **四個參考專案都沒有引用驗證**。它們產生引用，但沒有任何一個回頭檢查
  引用是否成立。跟 Lesson 23 發現「都沒有檢索評估集」是同一件事：
  **評估只有領域內的人做得出來。**

### Lesson 26：成本與預算 ✅

**為什麼是讀完原始碼才想到的**：gpt-researcher 把 `cost_callback` 串進
**每一個** LLM 呼叫（`actions/query_processing.py`、`context/compression.py`
都有），而且有 `utils/costs.py:63` 的 `estimate_llm_cost` 和
`agent.py:773` 的 `add_costs`。我們整個系列從來沒量過錢。

Lesson 24 已經證明「深度旋鈕就是成本旋鈕」——`estimateCost()` 算得出
搜尋和抓取的次數，但**算不出錢**，因為我們沒有 token 計價。

會學到：

- 每個 provider 的計價怎麼查、怎麼估（input/output 分開算）
- 把成本累加器串進 loop 而不弄髒每一個函式的簽章
- 「預算剩下 20% 該做什麼」——是停止、是降級到便宜模型，還是縮小 breadth
- 成本和品質的取捨要怎麼呈現給使用者

**可以寫可跑的 code**：✅ 而且可以直接接在 Lesson 24 的 `Budget` 上。

**Lesson 26 實測記錄**：

- ⚠️ **`total_tokens` 遠大於 `prompt + completion`**（Gemini 3.6 Flash）：

  ```
  案例               input  output   total    差額   低估倍數  stopReason
  極短 (100)            13       1     107      93     7.6x   end
  一句話 (400)           16      13     412     383    14.2x   max_tokens
  一句話 (4000)          16      47     686     623    10.9x   end
  長篇 (2000)           26     643    2022    1353     3.0x   max_tokens
  ```

  差額是 thinking token：不在 output 裡、要付錢、而且**吃掉 maxTokens 額度**。
  「一句話」那兩列是同一個問題：額度 400 被截斷，額度 4000 正常。

  > **對推理型模型，`maxTokens` 不是輸出長度上限，是「想 + 寫」的總額度。**
  > 這也修正了 Lesson 24 Step 5 的因果解釋：報告被截斷不是因為證據太多，
  > 是 thinking 先吃掉了額度。當時的修法碰巧對，但理由是錯的

- **錢花在哪跟直覺不一樣**：`extractLearnings` 佔 47-56%，
  `writeReport` 只佔 28-37%。想省錢要先裁短餵進萃取的正文，
  不是叫報告寫短一點

- **每條證據的單價幾乎不隨深度變化**（$0.0029 vs $0.0031），
  所以「要不要多跑一層」可以用算術回答。thinking 佔比倒是從 47% 升到 60%

- ⚠️ **第五次「沒出錯、只是沒資料」**：`shared/streaming/openai.ts` 的
  `max_tokens` 提早 return 路徑沒帶 usage，漏了三課。
  諷刺的是被截斷的呼叫通常最貴

- **價目表刻意留空**。價格會過期，而過期的精確數字比沒有數字更危險。
  token 是量測到的事實，錢是需要外部資訊的推算，兩者分開

### Lesson 27：本地文件 + web 混合檢索 ✅

**來源**：`gpt_researcher/document/`（5 個檔案，本地檔案載入器）、
`gpt_researcher/vector_store/`。

**為什麼值得單獨一課**：「研究我的文件 + 網路上的資料」是最常見的真實需求，
而我們整個 AI Search 篇只做過 web。這一課會逼出幾個 web-only 遇不到的問題：

- 本地文件沒有 URL，那「來源」是什麼？（檔名 + 第幾頁 + 第幾段）
- 本地文件沒有新鮮度和權威度訊號，Lesson 22 的排序公式要怎麼改？
- 同一件事本地和網路說得不一樣時，該相信誰？
- PDF、docx、投影片怎麼變成 chunk（Lesson 21 只處理 HTML）

**可以寫可跑的 code**：✅ 語料就是這個 repo 自己的 markdown（22 檔、214 chunk）。

**Lesson 27 實測記錄**：

- **增量索引是本地 RAG 的分水嶺**。第二次 ingest：「沿用 22、重切 0」。
  沒有這一步，你做出的是一個「第二次跑就開始給過期答案」的系統

- **融合幾乎不用寫程式**，因為 Lesson 22 選了 RRF（只看名次）。
  本地 BM25 分數和網頁融合分數完全不可比，但名次永遠可比。
  **好的抽象會在你沒預期的地方付利息**

- ⚠️ **但一邊完全不相關的時候會出事，而且我改了三次才對**：

  | 版本 | 結果 |
  |---|---|
  | 沒有門檻 | 查「chunk 大小要怎麼選」，**一篇 sous vide 烹飪指南排到第 4 名** |
  | 相對門檻（低於最高分 35%） | **一筆都沒擋掉**——Lesson 22 的 score 是候選集內 min-max 正規化的，最高分永遠接近 1 |
  | 抄 gpt-researcher 的 `SIMILARITY_THRESHOLD = 0.35` | **還是一筆都沒擋掉** |
  | 量自己的分佈後取 0.60 | 網頁 6 筆全擋掉，正確 |

  實測 `gemini-embedding-001` 的分佈：相關 query 0.70-0.79，
  完全不相關的 query 也有 **0.45-0.52**。gpt-researcher 那個 0.35 是配
  OpenAI embedding 的。

  > **門檻是模型的性質，不是通則。** 這跟 Lesson 22 猜錯去重門檻是同一種錯，
  > 但這次更容易中招：抄的是「權威來源的正式常數」，讓人更放心地不去驗證。

  順帶一提，這也讓 Lesson 23 Step 3「gpt-researcher 用門檻不用 top-k」
  那個觀察從「記下來」變成「必要」：**跨來源融合時 top-k 是有害的**

- **來源分佈本身就是訊號**：只回本地代表外部索引沒涵蓋，
  只回網頁代表你的文件還沒寫到

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

- [x] ~~**Lesson 2-5 沒有用真模型端到端測過**~~ ✅ 2026-07-27 完成
      Lesson 1-7 全部跑過真的 Gemini 3.6 Flash。實測結果：
      - Lesson 3：streaming 正常
      - Lesson 4：session 落地 12 筆、`--resume` 正常、`/tree` 正常
      - Lesson 5：連續三次壓縮，省下 49% / 47% / 53%，
        而且摘要確實照 prompt 的優先序寫（需求 → 檔案 → 發現 → 失敗）

      **順帶抓到一個真的沙箱逃逸**：agent 下 `npm test`，因為
      `playground/` 沒有自己的 `package.json`，npm 往上找到了本專案的
      package.json，跑了這裡的 74 個測試。已修（每個 playground 都補上
      `package.json`），並寫進 Lesson 2 的 README 當實例。

- [ ] **Lesson 8-9 沒有接進真的 agent**
      目前是獨立的 `table.ts` 和 `demo.ts`。
      Lesson 9 練習 3 是「接上去」，但課程本身沒做

- [x] ~~**Lesson 6-7 其實不能用 `PROVIDER=fake` 跑**~~ ✅ 2026-07-27 修好
      新增 `lesson-06-domain-tools/fake-provider.ts`，演一次完整的
      get_session → find_anomalies → query_telemetry → get_video_frame
      → create_incident_report，Lesson 7 也接上同一支。

      > ⚠️ 但要注意：`PROVIDER=fake bun run lesson-07` **只驗證評估管線本身**
      > （案例讀得到、rubric 算得出來、`--save`/`--compare` 正常），
      > **不能拿來判斷 agent 好不好**——假 provider 每個案例都演同一套動作，
      > 分數沒有意義。這一點已寫進 `eval.ts` 的註解

- [x] ~~**只測過 Gemini**~~ → **OpenAI 已實測**（2026-07-27）
      `gpt-5` 跑過 Lesson 21（web_search + fetch_page，五次工具呼叫）
      和 Lesson 26 的 token probe，`raw` 保留與 tool_calls 都正常。

      **順帶量到一個跨 provider 的差異，已寫進 Lesson 26**：

      ```
                 差額（total - input - output）
      Gemini     93 ~ 1353     ← thinking 不在 completion_tokens 裡
      OpenAI     全部是 0      ← reasoning 已含在 completion_tokens 裡
      ```

      同一個欄位名、兩家語意不同。這也驗證了「計價一律用 `total`」
      這個選擇：一個公式對兩家都成立。

- [ ] **Anthropic 仍未實測**
      沒有 key。`shared/streaming/anthropic.ts` 的 thinking block 保留邏輯
      和 usage 回報都還沒跑過真模型（usage 根本還沒接，見 Lesson 26 練習 1）

### 中優先

- [x] ~~**加測試**~~ ✅ 2026-07-27 完成
      `tests/` 下 74 個測試，不需要 API key。涵蓋路徑逃逸（含字首碰撞）、
      截斷方向、壓縮切點與不划算保護、inbox 冪等與孤兒回收、
      權限決策順序、記憶圍欄偽造、skill 閘門、搜尋排序衛生。
      **用 `bun run test`（已鎖定 `tests/`），不要用裸的 `bun test`**——
      Lesson 23 之後本機會有 clone 下來的參考專案，裸的 `bun test`
      會把它們的測試也跑進去（實測 firecrawl 有 204 個在我們這裡會失敗）。

- [x] ~~**AI Search 篇沒有納入 `tests/`**~~ ✅ 2026-07-27 完成
      `tests/ai-search.test.ts` 加了 23 個測試（總數 74 → 97），
      **每一個都對應到一個實測踩過的坑**，不是為了覆蓋率：
      短文件不該被判成關鍵字農場（Lesson 22 那個崩塌）、
      報告解析要抓得到引用（Lesson 25 坑 1）、引用嫁接要抓得到、
      英文月份要對得上中文月份數字（坑 3）、表格丟掉要回報（Lesson 21）。

      寫測試的時候又發現兩件事：
      - **停用詞表是手寫的、不完整**（`of` 不在裡面）
      - **RRF 的「第 1 + 第 3」會贏過「第 2 + 第 2」**（因為 1/x 是凸函數）。
        我第一次的斷言寫反了。實務上這是好性質：
        它獎勵「至少有一個來源非常確定」，而不是「大家都覺得還好」

- [x] ~~**英文版**~~ ✅ 2026-07-27 完成
      `README.en.md`（精簡版），中文仍是主要版本。

- [x] ~~**Lesson 6 的資料產生器可以更豐富**~~ ✅ 2026-07-28 完成
      加了 `sess_006`（同一段紀錄兩次事件）和 `sess_007`（6 秒的極慢傾倒），
      Lesson 7 也補上對應的兩個評估案例。

      **原本五題有一個共同的盲點**：全部是「單一、突發」事件，
      所以「照抄 `find_anomalies` 的候選視窗」這種偷懶做法永遠不會被扣分。
      `sess_007` 就是為此設計的——候選從 t=7060ms 才開始
      （門檻要 `pitch>30`），但傾倒 t=4000ms 就啟動了，**晚三秒**。

      實測（Gemini 3.6 Flash，兩次跑）：

      | 案例 | 第一次 | 第二次 |
      |---|---|---|
      | two-events | 93%（有提到前一次踉蹌） | 100% |
      | slow-tip | **83%，window 抄了候選的 7060.. → 沒有重疊** | 100%，自己往前找到起點 |

      > ⚠️ **slow-tip 兩次結果不同**，這不是「修好了」，是變異。
      > 這一題抓得到那個失敗，但**只是有時候**——而「有時候會照抄候選」
      > 本身就是值得知道的事實。

- [x] ~~**rubric 把 `mustMention` 當成「有資料品質問題」的代理**~~ ✅ 2026-07-28
      加 `two-events` 時炸出來的：那一題用 `mustMention` 檢查
      「有沒有提到前一次踉蹌」，結果 agent 因為「資料很乾淨卻回報
      high confidence」被扣分。已拆成獨立的 `dataQualityIssue` 欄位。

      > **用一個欄位的存在與否當成另一件事的代理，遲早會爆。**

### 低優先

- [x] ~~**Lesson 1-5 的 playground 是同一份複製五次**~~ ✅ 2026-07-28（部分）
      **只改了 Lesson 5，而且是有理由的**：那一課的 playground 太小
      （3 個檔案、全部讀完 800 tokens），只能靠 `COMPACT_AT=300`
      硬逼壓縮——讀者看到的是「參數調很低」，不是「context 真的滿了」。

      現在 Lesson 5 有 14 個檔案、約 26KB（router / routes / analytics /
      rate-limit / validate / logger / metrics / migrations / 兩份 docs），
      而且**第二個 bug 埋在 `analytics.ts`**，要跨檔案才找得到。

      實測（預設門檻 8000，一次普通調查）：

      ```
      [壓縮中… 目前約 8417 tokens]   [已壓縮 43 則訊息：8417 → 406，省下 95%]
      [壓縮中… 目前約 15638 tokens]  [已壓縮 46 則訊息：15638 → 7351，省下 53%]
      ```

      **一次調查觸發兩次壓縮**，兩次省下的比例差很多，那個差別本身就是教材。

      **Lesson 1-4 刻意維持原樣**：它們要的是「小到一眼看完」的專案，
      換成大的只會讓 tool calling、streaming、session 這些主題被雜訊蓋住。
      差異化要有理由，不是為了不一樣而不一樣。

      順帶把 `reset` 從 package.json 裡的一長串 sed 改成
      `scripts/reset-playgrounds.ts`——原本那個只處理「agent 改了 save」
      一種修法，agent 改 `lookup`（一樣正確）就漏掉了
- [x] ~~`shared/providers` 跟 `shared/streaming` 有重複的轉換邏輯~~
      **實際比對過了（2026-07-28），結論比原本那句話清楚：**

      重複的只有五個機械式轉換函式（`toOpenAiTool`、`toStopReason`、
      `toAnthropicTool`、`autoDetect`、`requireKey`），加起來約 60 行，
      而且**邏輯完全相同，差異只在註解和一行錯誤訊息文字**。

      維持不合併，理由現在比「讀者會看到用不到的概念」更硬：
      **兩層的 bug 面完全不同。** Lesson 23 那個「平行工具呼叫被合併成一個
      壞字串」只存在於串流版（它要自己拼 delta 碎片）；非串流版直接讀
      完整的 `tool_calls` 陣列，結構上不可能有那個 bug。
      合併之後會變成一個帶「現在是不是串流」分支的函式——
      那個 bug 只會更難找。

      > **重複 60 行機械轉換，換兩層各自簡單、各自好 debug，這筆划算。**

- [x] ~~**`ModelResponse.usage` 只有串流版有填**~~ ✅ 2026-07-28 修好
      這是我自己在 Lesson 26 弄出來的：把 `usage` 加進**共用**的
      `ModelResponse`，但只改了 `shared/streaming/openai.ts`。
      Lesson 1-2 用的非串流版永遠回 `undefined`，而且沒有任何訊息說為什麼。

      已補上（實測 OpenAI 非串流：`{"input":118,"output":400,"total":518}`），
      而且截斷路徑也帶了——串流版當初就是漏這條路徑漏了三課。

      > **共用型別是一種承諾。加欄位的時候要檢查所有實作，
      > 不是只改你正在看的那一支。**

---

## 開源前的檢查清單

- [x] `.env` 在 `.gitignore` 裡
- [x] `.sessions/`、`reports/`、`results/` 在 `.gitignore` 裡
- [x] 沒有硬編碼的 API key
- [x] typecheck 乾淨
- [x] 每一課都能用 `PROVIDER=fake` 跑（不需要 key）
      Lesson 6-7 的 fake provider 已補（2026-07-27）
- [x] 加 LICENSE 檔案
- [ ] 加 `CONTRIBUTING.md`（如果要收 PR）
- [ ] 決定要不要收 issue / PR
- [x] git init + 分批 commit

---

## 設計原則（寫新課程時參考）

這些原則是一課一課踩出來的，之後寫新課時應該遵守：

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
   從 Lesson 1 到 23，`runTurn` 基本沒變。新功能應該加在它周圍，
   不是改它本身。改到它的時候要問自己是不是抽象拆錯了。

   > Lesson 24 是**唯一的例外，而且是刻意的**：research loop 不是
   > agent loop 的改良版，是另一個形狀（控制流在程式手上）。
   > 那一課沒有動 `runTurn`，是在它旁邊蓋了一個新的東西。
   > **換形狀跟改 loop 是兩件事。**

7. **每加一個階段，就問「它什麼都沒做的時候，我看得出來嗎」**
   這條是被同一種病咬了四次之後補上的：

   | 課 | 靜默失敗 | 後果 |
   |---|---|---|
   | 21 Step 5 | 抽取器丟掉 `<table>`，沒有任何訊號 | 燒掉兩次 16 步上限 |
   | 22 Step 5 | 品質訊號對短文件有偏誤，被平均分數蓋住 | 一題從 1.000 崩到 0.131 |
   | 23 Step 6 | 平行工具呼叫被合併成一個壞字串 | 潛伏三課，`400 no body` |
   | 24 Step 5 | 萃取 0 條、報告被 token 上限截斷 | 看起來像做完了 |

   **會爆的失敗不可怕，安靜的失敗才可怕。**
   新階段一定要能講出「我這次沒有產出，原因是 X」。
