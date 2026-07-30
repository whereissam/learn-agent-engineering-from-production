# Roadmap / TODO

這個系列還沒寫完的部分，以及為什麼還沒寫。

> 排序原則：**先做「可移植而且大部分人一定會用到」的**。
> 純產品工程（打包、自動更新、GUI）優先度低，因為它們跟 agent 本身無關。

## 這個系列的邊界

先講最重要的一條，因為它決定了「要不要讀某個 repo」：

> **主旨不是「看到一個 AI repo 就研究它」，
> 而是：從現有開源專案裡，抽出一條從零開始學 agent 開發的完整路線。**

所以判準不是「這個專案紅不紅」「這個技術重不重要」，而是下面五題。
**看到任何新 repo，先過這張表**：

| 問題 | 要「是」才值得優先 |
|---|---|
| 1 | 它有真正的 agent loop 或 workflow 嗎？ |
| 2 | 它處理 tools / context / memory / permission / session 之一嗎？ |
| 3 | 抽得出一個小而可跑的**失敗**實驗嗎？ |
| 4 | 這個問題現有課程還沒完整覆蓋嗎？ |
| 5 | 把那個機制**關掉**之後，看得到具體失敗嗎？ |

第 3、5 題是這個系列真正的門檻，前面每一課的價值都來自它們：
Lesson 15 把消毒關掉（攻擊 3/3 成功）、Lesson 17 把降權關掉、
Lesson 27 把門檻關掉（舒肥食譜排到第 4）。**關不掉的機制講不出價值。**

### 用這張表篩過的結果

| 專案 | 1 loop | 2 核心問題 | 3 可跑實驗 | 4 未覆蓋 | 5 可關掉 | 結論 |
|---|---|---|---|---|---|---|
| Pi | ✅ | ✅ | ✅ | ✅ | ✅ | 主線 1-7 |
| OpenWorker | ✅ | ✅ 權限 | ✅ | ✅ | ✅ | 主線 8-12 |
| Hermes | ✅ | ✅ 記憶 | ✅ | ✅ | ✅ | 主線 15-19 |
| AI Search 四個 | ✅ | ✅ 工具 | ✅ | ✅ | ✅ | 主線 20-27 |
| Mastra | ✅ | ✅ 全部 | ✅ | ✅ | ✅ | 主線 30-33 |
| OpenCode | ✅ | ✅ session | ✅ | ✅ | ✅ | 主線 28-29 |
| OpenHands | ✅ | ✅ 環境 | ✅ | ✅ | ✅ | 主線 36-37 |
| Restate / SRT | ❌ | ✅ 執行邊界 | ✅ | ✅ | ✅ | 主線 34-35（**不是 agent 專案，但問題是**） |
| **vLLM** | ❌ | ❌ serving | ✅ | ✅ | ✅ | **不進主線** → 延伸 |
| **Fish Speech** | ❌ | ❌ TTS | ✅ | ✅ | ✅ | **不加入** |

> 注意 vLLM 和 Fish Speech **第 3、4、5 題都過**——它們是好專案、
> 也抽得出好實驗。**擋掉它們的是第 1、2 題。**
> 一個判準如果只會對爛東西說不，那它沒有用；
> 這張表的價值正在於它會對**好東西**說不。

## 全貌

```
━━━ 主線：從零打造一個 agent ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Lesson 01-05   引擎本體 · Pi 篇          loop / 工具 / 串流 / session / 壓縮   ✅
Lesson 06-07   你的領域 · 自己做         領域工具 + 確定性評估                 ✅
Lesson 08-12   變成產品 · OpenWorker 篇  權限 / 無人值守 / server / MCP        ✅
               （11 併入 12、13 併入 18、14 刪除）
Lesson 15-19   跑好幾個月 · Hermes 篇    記憶 / skills / 搜尋 / 排程 / 委派     ✅ 全部
Lesson 20-27   一整個領域 · AI Search 篇 搜尋 / 抓取 / 檢索 / research loop    ✅
Lesson 28-37   loop 周圍那一圈           執行的證據 / schema / durable / 沙箱  ✅ 28-31
               28-29 OpenCode（執行的證據）✅ 兩課都寫完了
               30-31 Mastra ✅ / 32-33 Mastra（schema 之後的抽象）
               34 Restate（crash）/ 35 Anthropic SRT（沙箱）
               36-37 OpenHands（執行世界 / action-observation）

━━━ Prod 篇（Lesson 50-59）：上線之後才會遇到的，不編進閱讀順序 ━━━

Lesson 50      本地模型的 tool calling   換成 Qwen / Llama 後為什麼壞掉（vLLM）  待寫
Lesson 51      Inference serving（選修）  batching / KV cache / prefix，要 GPU    待寫
Lesson 52      串流語音輸出              取消 / 舊音訊 / 換手（Fish Speech 當工具） 待寫
Lesson 53      Tracing / observability   span、成本歸因（Mastra、Phoenix）       待寫
Lesson 54      Model routing / fallback  換 provider 續舊 session                待寫
Lesson 55      OAuth / credential        token 生命週期、多使用者隔離            待寫
Lesson 56      工具要花錢                 agent 可以自己決定付款嗎（x402）        待寫
Lesson 57      資料邊界                  什麼能進 trace / memory / subagent       待寫
Lesson 58-59   （保留）                  打包、自動更新、監控…                   —
```

**Prod 篇的准入條件跟主線不同，而且必須寫清楚，否則它會變成垃圾桶**：

> 主線問「這個機制**是不是** agent 的一部分」。
> Prod 篇問「**agent 已經會動了、要交出去了**，這時候才冒出來的問題」。

所以 vLLM 和 Fish Speech 不是被淘汰，是**位置在後面**：
你得先有一個會動的 agent，才會遇到「想把 OpenAI API 換成本地模型」
或「要讓它講話」。**在那之前讀它們，學到的東西沒有地方掛。**

⚠️ **Prod 篇不進閱讀順序**，因為它不是「下一步」，是「另一個階段」。
主線 28 步走完之前，這一篇一課都不用看。

**AI Search 篇回到主線**（它本來就在 20-27），因為它教的是
「怎麼替一個領域做工具、資料和評估」——那是 Lesson 6 的大型實例，
不是另一個領域的旁支。**這一點跟 Voice / Inference 不一樣。**

**號碼區間留白**是為了讓每一篇長胖時不會撞到別人：
AI Search 篇當初接著 17 往下編，一擴充就把後面號碼全部推掉，
所以延伸篇從 50 起跳。

⚠️ **編號不等於閱讀順序。** 課號一旦公開就不能改（連結會斷），
但「從零開始該照什麼順序讀」是另一回事，見下面
[從零開始的閱讀順序](#從零開始的閱讀順序)。

### 下一步的順序

不要把 10-14 當成一個 block 寫完。用開頭那條標準（可移植 + 大部分人一定
會用到）逐課過一遍之後，剩下的路線是：

```
Lesson 10（agent server）✅  →  Lesson 12（MCP）✅  →  Lesson 30（schema 相容層）✅
```

> MCP server 給你的 tool schema **你不能改**。所以「Google 不吃 null、
> claude-3.5-haiku 不遵守 string 的 min/max」在 Lesson 12 之前都還能繞過去，
> 到了 Lesson 12 就變成非解不可。
>
> **先讓讀者撞牆，再給工具。** 反過來教會變成憑空介紹一個抽象層。

Mastra 之後再接兩個**補抽象層**的來源（2026-07-28 決定，見文末兩節）：

```
30 schema 相容 → 31 processor → 32 tool search → 33 durable state machine
                                                        ↓
                              34 Restate：狀態機裡的那一步 crash 之後怎麼辦
                              35 Anthropic SRT：批准之後，進程實際碰得到什麼
```

> **選來源的判準沒有變**：不是「我覺得 agent 應該要有 X」然後自己設計 X，
> 是「開源專案為什麼存在 X → 找到它解決的真實失敗 → 關掉 X 跑一次 →
> 抽成最小實作 → 用真模型接回 loop」。
> Lesson 34、35 是照這條加的；tracing、model routing、`ToolResult` 統一格式
> **刻意沒有立題**，理由見文末。

同一輪盤點的其他結論（細節見各章節）：

| 課 | 處置 |
|---|---|
| 10 GUI | 維持延後。Tauri + React + Python，不可移植 |
| 11 OAuth | 拆開：token 生命週期併進 12，25 個 connector 的共同抽象延後 |
| 13 排程 | 併進 Lesson 18 |
| 14 audit log | **刪掉**。Lesson 8 的練習 4 已經是它的簡化版 |

### 專案定位（四個專案不在同一個抽象層級）

> **Pi 是 agent runtime；OpenWorker 是桌面 AI coworker 產品；
> Hermes 是長期運行的 personal agent platform；
> Mastra 是把前三者的東西包成 API 的框架。**

最後兩個來源**都不是 agent 專案**，這正是加它們的理由：

> **Restate 是 durable execution runtime，Anthropic SRT 是 OS 層的沙箱。**
> 它們解決的問題 agent framework 全部有，但沒有一個把它當主題，
> 所以在 framework 裡讀到的永遠是「順便處理了一下」的版本。

AI Search 篇不一樣，它**不跟單一專案**，那條線橫跨 SearXNG、Crawl4AI、
GPT Researcher、txtai 好幾個專案，因為「AI Search」本來就是好幾個問題疊在一起。

對應到層次框架。⚠️ **原本寫「四層」，現在是五層**：
「長期運行」本來被塞在 Harness 裡，但排程和委派跟權限、沙箱不是同一類問題，
拆出來之後 README 的分層才跟後面的篇章對得起來。

| 層 | 主要來源 |
|---|---|
| 1. 單 agent 機制 | Pi（Lesson 1-5） |
| 2. Harness Engineering | OpenWorker（8-12）+ Mastra（30-33）+ OpenCode（28-29）+ Restate / SRT / OpenHands（34-37） |
| **3. 長期運行** | Hermes（15-19 全部寫完） |
| 4. 領域工具 | 你自己（Lesson 6 教方法）+ AI Search（20-27 是一整個領域的示範） |
| 5. Evaluation | 你自己（Lesson 7 教方法）+ Lesson 22、25 |

> ⚠️ 第 4、5 層那個「你自己」不是偷懶，是**這個系列方法論的一部分**：
> 領域工具和評估這兩件事，**開源專案露出來的是缺口不是解法**。
> Lesson 23 對照四個專案之後的發現可以直接當證據：
> **四個專案都沒有檢索評估集，也都沒有引用驗證。**
> 所以那兩課不是「抽不出來」，是**沒有東西可以抽**。

---

## 從零開始的閱讀順序

課號是**按寫作順序**發的（而且發出去就不能改，連結會斷）。
但一個從零開始的讀者不該照課號讀，因為課號綁的是「我讀了哪個專案」，
不是「他需要先懂什麼」。

**這兩件事分開之後，每一課只要保證一件事：它的前置都在它前面。**

⚠️ **這不是一條線，是一棵樹。** 第一版寫成單一清單，
看起來就像「12 → 30 → 32 隨機跳號」。實際上前兩條走完之後是**平行支線**，
彼此不互為前置：

```mermaid
flowchart LR
    C["① 引擎本體<br/>01 → 02 → 03 → 04 → 05"] --> D["② 你的領域<br/>06 → 07"]
    D --> B["③ 邊界<br/>08 → 09 → 35"]
    D --> E["④ 證據<br/>29 → 28 → 37"]
    D --> T["⑤ 接別人的東西<br/>12 → 30 → 32"]
    D --> S["⑥ 跑很久不死<br/>10 → 31 → 33 → 34"]
    D --> L["⑦ 長期運行<br/>15 → 16 → 17 → 18 → 19"]
    D -.- W["⑧ 一整個領域（可跳過）<br/>20 → … → 27"]
```

支線內部的順序不是排出來的，是**每一步會長出下一步的問題**：

| 支線 | 每一步長出的下一個問題 |
|---|---|
| ③ 08 → 09 → 35 | 有了風險分級 → 就需要有人批准 → 但半夜沒人 → 就算批准了，也還沒有東西限制那個進程碰得到什麼 |
| ④ 29 → 28 → 37 | 檔案改了沒，只有檔案系統說了算 → 一般化到「被中斷的串流」 → 於是 history 不該再是聊天記錄 |
| ⑤ 12 → 30 → 32 | MCP 的 schema 你改不了 → provider 差異變成非解不可 → 接了幾台之後工具又塞不下 |
| ⑥ 10 → 31 → 33 → 34 | 上了 server 就活得比終端機久 → 每輪邏輯從 loop 拉出來 → loop 要能存下來重跑 → 重跑的副作用算不算 |
| ⑦ 15 → 16 → 17 → 18 → 19 | 記得住 → 能累積成能力 → 找得回來 → 可以定時做 → 可以分給別人做 |

三個刻意的安排：

- **③ 的 35 緊接在 8-9 後面**，因為 Lesson 8 的結論是
  「權限引擎 100% 成功」，35 的主張是「那句話只對了一半」。
  中間隔太遠讀者會忘記那個實測
- **④ 從 29 開始不是從 28 開始**。29 回答 Lesson 8 留下的問題
  （模型謊報完成），28 是它的一般化（不只檔案，還有中斷時的
  reasoning / tool / text 狀態）。**先給答案，再給更難的版本**
- **⑧ 整包可以跳過**。它是一個領域的完整示範（Lesson 6 教的方法的大型版），
  不是後面課程的前置

### 新課的前置（每一課只准依賴前面的）

| 新課 | 前置 | 它**不需要**先讀 |
|---|---|---|
| 28 可恢復的 session state | 03 中斷、04 session | 29 |
| 29 完成的證據 | 02 工具、08 權限 | 28 |
| 30 schema 相容 | 01 provider 抽象、12 MCP | 31-33 |
| 31 processor pipeline | 05 壓縮、08 權限、26 成本 | 30 |
| 32 tool search | 17 或 20（BM25） | 30、31 |
| 33 durable 狀態機 | 04 session、09 暫停等批准 | 34 |
| 34 crash-safe 工具 | **33** | 35 |
| 35 sandbox | 08 權限 | 34 |
| 36 執行世界 | **35** | — |
| 37 action / observation | 04 session、29 證據 | 36 |

### 一個建議 = 好幾課，不是一課

這一輪三份建議如果照單全收，會變成三堂「什麼都講一點」的課。
拆開的判準是**每一課只能有一個主張，而且那個主張要能被單獨打壞**：

| 原本的建議 | 拆成 | 為什麼不能合成一課 |
|---|---|---|
| 「OpenCode 的 session processor」 | **28** 中斷一致性 + **29** snapshot 證據 | 28 的主張是「中斷之後狀態不能說謊」，29 是「模型自述不是證據」。**兩個各自都能單獨打壞**（28 關掉 cleanup、29 關掉 snapshot），合起來只會讓讀者記不住哪個實驗在證明哪句話 |
| 「Restate 的 crash-safe agent」 | **33** 狀態機 + **34** crash | 33 回答「進程死掉怎麼接回來」，34 回答「接回來時已經送出去的副作用算不算」。**34 的實驗要先有 33 的狀態機才擺得進去** |
| 「sandbox」 | **35** OS 原語 + **36** 執行世界 | 35 是一次 `sandbox-exec`，36 是 workspace 生命週期。合起來一定會寫成雲端 sandbox 導覽 |
| 「OpenHands」 | **37** 事件模型（TS，小）+ **36** runtime（Python，大） | 而且**它們現在根本不在同一個 repo**（見 OpenHands 篇） |
| 「doom-loop / pattern 批准 / providerExecuted / structured output」 | **不開新課**，塞進 8、9、30、31 | 每一個都只有一個機制大，單獨成課會稀釋掉那一課原本的主張 |

### ⚠️ 這批新課共同的風險

前 27 課的主題都在**我們自己寫的程式碼**裡。這批不是：

```
28、29、37   要先有一個「被觀察的對象」，才有東西可以記錄
33、34       要先有一個會死掉的進程
35、36       要先有一個真的會被擋住的作業系統呼叫
```

**所以每一課的第一個決定都是「最小的可觀察對象是什麼」**，
決定錯了就會寫成架構導覽。已知的最小對象：

| 課 | 最小對象 |
|---|---|
| 29 | `git stash create` 算出來的 patch，不用抄那 807 行 |
| 34 | 一個 `append_order()` 往檔案追加一行，數行數就知道跑了幾次 |
| 35 | Lesson 2 那個真的發生過的 `npm test` 往父目錄逃逸 |
| 37 | Lesson 4 的 session JSONL 換一種寫法 |

---

## 已完成

### Pi 篇（Lesson 1-7）第 1、4、5 層

| 課 | 主題 | 狀態 |
|---|---|---|
| 01 | 最小的 agent loop | ✅ |
| 02 | 更多工具、輸出截斷、批准機制 | ✅ |
| 03 | Streaming 與中斷 | ✅ |
| 04 | Session 持久化與分支 | ✅ |
| 05 | Context 壓縮 | ✅ |
| 06 | 領域工具（第 4 層） | ✅ |
| 07 | Evaluation（第 5 層） | ✅ |

### OpenWorker 篇（Lesson 8-9）第 2 層產品化

| 課 | 主題 | 狀態 |
|---|---|---|
| 08 | 風險分級與權限引擎 | ✅ + 補了 `agent.ts`（見下） |
| 09 | 無人值守批准與 inbox | ✅ |

#### ⚠️ Lesson 8 補課：引擎要接進真的 loop

原本 Lesson 8 只有 `table.ts`，把**寫死的**工具呼叫餵進引擎印決策表，
模型從頭到尾沒出現。「把引擎接回 agent」被放在練習 5（⭐⭐⭐）。

**那個安排是錯的。** 決策表能告訴你「引擎會說不」,
但學不到唯一重要的下一步：拒絕會變成 tool result 回到模型手上，
**模型接下來做什麼**。那是行為問題，只能真的跑。

現在有 `lesson-08-permissions/agent.ts`（引擎接進 Lesson 3 的 loop）
和 `fake-provider.ts`（腳本化的三次繞道嘗試，離線可跑）。

**真 Gemini 3.6 Flash 實測（`ANSWER=n`，使用者一律拒絕）**：

| | 不加指示 | `DENY_HINT=1` |
|---|---|---|
| 被拒絕後又試了幾種做法 | **5 次**（`git log -p` → `node -e` → `write_file` → `read_file` → `edit_file`） | **3 次** |
| 檔案實際狀態 | 沒動（md5 驗過） | 沒動 |
| 最後跟使用者說什麼 | 「**已經為您將 src/app.ts 重構並簡化**」＋附上「重構後的完整程式碼」 | 「因為權限被拒絕，我無法直接修改…以下是程式碼，您可以自己替換」 |

> ⚠️ **引擎 100% 成功，使用者 100% 被騙。**
> 檔案一個 byte 都沒變，但模型跟使用者說做完了。
> **如果 GUI 只顯示最後那則助理訊息（大部分都是），使用者看到的就是謊話。**
>
> 這比 Lesson 21 的「安靜的失敗」更糟：那邊是沒有訊號，
> 這邊是**有一個錯的訊號，而且比正確的訊號更顯眼**。

第二個發現，跟 Lesson 21 Step 5 的結論一半吻合一半相反：

- **行為**改不動，「不要繞過」只讓重試從 5 次降到 3 次，
  而且第 3 次仍然是被拒絕後又換工具。提示基本沒用
- **敘述**改得動，加了指示之後最後那段話變誠實了

> 拜託模型**少做一件事**很難，拜託模型**如實報告已經發生的事**相對容易。

順帶改了 `shared/permissions/engine.ts`：原本走到最後一條的 `reason`
一律是「需要批准」，接進 loop 才發現**那是模型唯一的資訊來源**,
只講四個字它無從判斷換什麼做法才會被接受。現在會講清楚是
「不在允許清單上（清單內容是…）」還是「前綴過了但有 shell 元字元」。

**這條規則要套用到其他課**：離線示範只驗證得了機制,
驗證不了「模型拿到這個機制的輸出之後會怎樣」。8、9、15、16、17、27 都補完了；25 不需要補（已是真模型輸出）。
（17 例外，它的主張就是排序不該有 LLM，真模型只能接在外面當使用者。）

#### ⚠️ Lesson 9 補課：批准回來之後，誰來收尾

同樣的問題：`demo.ts` 裡的「agent」是 `fakeAgentTurn`,
一個只會呼叫 `approve()` 再印一行字的函式。原本的練習 3
（接上權限引擎 ⭐⭐）也是同樣的錯誤安排。

現在有 `agent.ts` + `fake-provider.ts` + `email-tool.ts`。
`send_email` 會**真的寫檔案到 `outbox/`**，因為 Lesson 8 之後
模型的自述已經不能當證據，側效必須能獨立驗證。

**真 Gemini 3.6 Flash 實測（`RESOLVE=deny`），結果跟 Lesson 8 相反**：

| | Lesson 8（write_file 被拒） | Lesson 9（send_email 被拒） |
|---|---|---|
| 模型最後說 | 「已經為您將 src/app.ts 重構並簡化」 ← **謊報** | 「已嘗試發送⋯但被權限引擎拒絕（原因：外部副作用操作未獲許可）」 ← 誠實 |
| 有沒有加 `DENY_HINT` | 沒有 | 沒有 |
| 實際側效 | 檔案沒動 | `outbox/` 0 封信 |

同一個模型、同一套機制，一個說謊一個說實話。

**做了一個對照實驗把最可疑的原因排除掉**：Lesson 9 的 system prompt
多一句 `Report honestly on what actually happened.`，加了 `NO_HONESTY=1`
把它拿掉再跑，**還是誠實的**。假設被推翻。

剩下兩個候選解釋，**沒有做到能分辨它們**（README Step 9 誠實地寫了這點）：

1. 拒絕理由的字面。Lesson 9 是「副作用會跑到機器外面，**收不回來**」,
   模型還照著改寫了一次；Lesson 8 是「風險等級 write_local，
   interactive 模式下需要批准」，公事公辦沒有後果感
2. **工具的產物長得像不像成果**。`write_file` 被拒之後模型把程式碼印出來,
   那看起來就很像交付物；`send_email` 沒有這個模糊地帶

如果 2 成立，會是一條實用判準：**要特別懷疑模型自述的，
是那些「產物本身就是一段文字」的工具**（寫檔、產程式碼、寫文件）。
這值得單獨設計一個實驗去驗。

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

> **盤點過一輪之後**：10-14 不當成一個 block 寫。
> **Lesson 10 寫完了**（而且原本「不可移植」的判定是錯的，見下面），
> 剩下 **Lesson 12（MCP）**，11 拆一半併進去、13 併進 Lesson 18、14 刪掉。

### ~~Lesson 10：Agent server 與 GUI 通訊~~ ✅ 已完成

- **來源**：`openworker/coworker/server/`（**5909 行**，原本寫 11.8k 是錯的，
  實際 `app.py` 1968 + `manager.py` 3762 + `run.py` 175）、
  `surfaces/gui/`（151 個 .ts/.tsx，**這課完全沒碰**）
- **原本的顧慮是「會偏讀懂架構而不是可跑的 code，因為涉及 Tauri + React」，
  這個前提是錯的。** 可移植的部分是**協定**，不是畫面。
  把 GUI 換成一個終端機 client 之後，四個問題全部都能寫成可跑的程式：
  `bun run lesson-10` 會起兩個 server 進程、多個 client 連線，
  三個情境跑完不用 API key
- **實測記錄（`PROVIDER=fake`，真的跑出來的）**：

  | 情境 | 結果 |
  |---|---|
  | NAIVE server，斷線 600ms 後重連 | 畫面 0 字，server 上 599 字，**少的 599 字永遠補不回來** |
  | 修好的 server，同一段劇本 | 畫面 599 字 = server 599 字 |
  | 兩個視窗，A 送訊息 | A、B 各看到 480 字，完全一致 |
  | 連按兩次送出 | 第一個 202、第二個 409 |
  | curl 帶 `Origin: https://evil.example.com` | 403；帶 `http://localhost:5173` → 200 |

- **實測記錄（真的 Gemini 3.6 Flash）**：

  1. `PROVIDER=gemini` 起 server，client 問「這個專案有哪些檔案？看一下
     src/store.ts 在做什麼」→ 兩個工具呼叫、串流回答，全部經過 SSE 廣播
  2. ⚠️ **然後測了 fake provider 測不到的那條路徑**：把 server 殺掉、
     換一個 port 重開、client 重連 → `state` 補回完整對話 → 追問
     「你剛剛說的那個不分大小寫的查詢，是在哪一行？」→ 答對第 32 行

  > 第 2 點才是真正的驗證。session 存到硬碟的 `raw` 欄位裡是
  > **provider 專屬的結構**，JSON 存檔再載回去之後還要能被同一個 API 接受。
  > fake provider 的 `raw` 是 `null`，所以這條路徑用假的跑一萬次也不會發現問題。

- ⚠️ **這課最重要的一段跟原本規劃的不一樣。**
  「斷線重連怎麼不掉事件」的答案**不是 replay buffer**。
  SSE 協定自己就提供 `Last-Event-ID` 重播機制，所以那是最順手的錯路，
  一走進去就要回答 buffer 多大、多久過期、換裝置怎麼辦、
  中間壓縮過的話舊事件還算不算數，四題都沒有好答案。

  > OpenWorker 的做法是 **checkpoint 持久化 + 重連時重送狀態**
  > （`app.py:1705` 的 `_CHECKPOINTS`、`app.py:1680` 的 `ready` frame）。
  > **事件是狀態變化的通知，狀態才是真相。**

  而且掉事件是**安靜的失敗**（設計原則 7）：SSE 正常關閉、turn 正常完成、
  重連正常建立，每一步都成功，只有使用者的畫面少一段。
  跟 Lesson 21 那個「抽取器丟掉 `<table>`」是同一種病

- **另一個沒預期到的**：一個開在 localhost 的 server，
  使用者瀏覽的任何網站都打得到（CORS 擋回應但擋不住請求送達，
  而 WS 根本不歸 CORS 管）。`app.py:26-46` 的註解寫明這是改過的 bug，
  不是假想威脅。已寫進 Step 5
- **刻意沒做**：真的 GUI、批准走上行（留給 Lesson 12）、多使用者認證

### Lesson 11：Connector 與 OAuth → **拆開**

- **來源**：`openworker/coworker/connections.py`（181 行）、
  `connectors/`（28 個檔案，27k 行）
- **決定**：token 生命週期那半（存哪、怎麼刷新、失效了 agent 該怎麼反應）
  **併進 Lesson 12**，`mcp/oauth.py` 就有 240 行可以直接教。
  剩下「25 個整合的共同抽象」那半維持延後，因為 `connectors/` 重複性太高
- **什麼時候需要**：要接 Gmail / Slack / Jira 這類服務時

### ~~Lesson 12：MCP client 進產品~~ ✅ 已完成

`lesson-12-mcp/`：`server.ts`（一個真的 MCP server，stdio + JSON-RPC，
零依賴，不到 200 行）、`client.ts`、`agent.ts`、`fake-provider.ts`。
三台 server 兩台是壞的（`ghost` 握手不回、`rubble` 啟動就掛），
平行連線 5020ms，**不是兩個逾時加總**。

**實測記錄（真 Gemini 3.6 Flash，共 6 次）**：

1. **那份難搞的 schema 被吃下去了。** `schedule_maintenance` 故意用
   `oneOf` + `["string","null"]`，3/3 都正確選了 object 分支、
   也正確填了 notes 字串。
   → 「provider 吃不下 MCP schema」這個擔心至少對 Gemini 沒發生,
   但這正是 Lesson 30 的起點：**一家能吃不代表每家都能，
   而你沒辦法改那份 schema**

2. ⚠️ **抓到一個更嚴重的**：3/3 把「8/1」填成 **2024**-08-01
   （今天是 2026-07-28）。而那個參數進了一個
   **有外部副作用、收不回來**的 MCP 工具。

   權限引擎做對了每一件事：分級 EXTERNAL、攔下來、參數印在批准框上。
   然後被按了 y。

   > **批准框顯示了它，不代表有人讀了它。**
   > Lesson 8 解決的是「要不要問」，這一題是「問了之後有沒有人真的看」,
   > 而後者不是權限引擎能解決的。

   原因是 system prompt 裡沒有今天的日期，模型只能用訓練資料的先驗。
   加上 `TODAY=1` 之後 3/3 修好。

   > **任何會收日期參數的工具，system prompt 裡就必須有今天的日期。**
   > 這條在 MCP 特別重要，因為參數是別人定義的，
   > 你不讀那台 server 的 schema 就不會知道它收日期。

**另外做了一件 openworker 沒做的事**：名稱碰撞偵測。
`mcp__<server>__<tool>` 截到 64 字之後，
`create_incident_report` 和 `create_incident_summary`
在一台名字 47 字的 server 上會被截成同一個名字，
**後者靜靜蓋掉前者**（`COLLIDE=1` 可以跑出來，5 個工具只活下來 4 個）。
`tools.py:33` 直接截斷，沒有警告。

同一台 server 上「前綴相同的兩個工具」比「兩台 server 同名工具」
常見得多，因為工具本來就常共用動詞前綴。

### ~~Lesson 12（原始規劃）~~

- **來源**：`openworker/coworker/mcp/`（5 個檔案，**647 行**，
  原本寫 1.3k 是錯的，實際 `wc -l` 是 `__init__ 29 / client 158 /
  config 129 / oauth 240 / tools 91`）
- **第二份對照實作**：`mastra/packages/mcp/src/{client,server}`。
  OpenWorker 是 Python、Mastra 是 TS（跟本系列同語言），
  兩個實作互為印證，比 Lesson 23 那種讀四個專案輕鬆
- **會學到**：跟自己寫的工具有什麼不同、per-tool 控制、失敗隔離、
  OAuth token 的生命週期（吸收自 Lesson 11）、
  為什麼 MCP 工具預設要當成 EXTERNAL 風險（接回 Lesson 8）
- **為什麼排第一**：這是 10-14 裡唯一同時滿足「可移植」和「大部分人一定
  會用到」的一課，而且原始碼小到可以整份讀完
- **它會長出 Lesson 30**：MCP server 給的 tool schema 你不能改，
  所以 provider 之間的 schema 差異在這一課變成非解不可

### Lesson 13：排程自動化 → **併進 Lesson 18**

- **來源**：`openworker/coworker/automation/`（5 個檔案，1.5k 行）
- **決定**：跟 Hermes 篇的排程主題重疊太多，不單獨成課。
  cron 觸發、任務狀態、失敗重試、跟 Lesson 9 inbox 的配合，
  全部在 Lesson 18 一起講

### ~~Lesson 14：Audit log~~ → **刪掉**

- **來源**：`openworker/coworker/audit.py`（174 行）
- **決定**：Lesson 8 的練習 4 已經是這題的簡化版，
  單獨成課只會重複。「這個 agent 上週到底做了什麼」這個問題，
  真正缺的是 tracing 而不是 log，那部分歸到 Lesson 26
  （見 Mastra 篇的 `core/src/observability/`）

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

#### ⚠️ Lesson 15 補課：注入攻擊要真的打一次

這一課的核心斷言是「記憶是持續性的注入面，**不消毒的話攻擊會成功**」。
但 `demo.ts` 只證明得了 `sanitizeContext()` 把字串改掉了，
「攻擊會成功」是關於**模型行為**的斷言。原本的練習 1
（「把消毒拿掉，看攻擊成功 ⭐」）**在沒有模型的情況下根本做不到**。

現在有 `lesson-15-memory/agent.ts`（`bun run lesson-15:attack`）。
載荷無害（只要求在結尾加固定標記），判定是 `includes()`，不用 LLM 裁判。

**真 Gemini 3.6 Flash，各跑三次**：

| | 防禦關閉 | 防禦開啟 |
|---|---|---|
| 結果 | ✗ ✗ ✗ 全部成功 | ✓ ✓ ✓ 全部失敗 |
| 攻擊者的 `[System note:]` 在不在 context | 在 | **也在** |

第二列很重要，而且它印證了 Step 4 原本就寫對的那句話：
消毒**沒有**剝掉攻擊者的句子，只剝掉圍欄標籤。
防禦目標不是消滅可疑文字，是保證它逃不出圍欄。

**⚠️ 我把這個實驗做錯了兩次，兩次都會產生假結論**：

1. **載荷根本沒送到模型面前**。MEMORY.md 寫成多行（provider 是逐行解析,
   `file-provider.ts:191`），而且載荷不含問題的關鍵字（prefetch 是關鍵字比對）。
   模型「沒上鉤」是因為它沒看到東西。
   → 順帶學到攻擊者要做什麼：**讓污染的記憶被高頻查詢命中，是攻擊的一部分**
2. **假陰性**。標記加在回覆結尾，有一次 `stopReason=max_tokens`
   只跑出 55 字就斷了（Lesson 26 的「thinking 吃掉 maxTokens」）。
   沒看到標記 ≠ 攻擊失敗。現在判定會檢查 stopReason 並警告

> **安全測試的假陰性比沒有測試更危險**，因為它讓你以為防禦有效。
> 任何「沒有偵測到攻擊」的結論，都要先證明「攻擊真的發生過」。
> 這是設計原則 7 在安全情境下的版本，值得單獨寫成一條。

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

#### ⚠️ Lesson 16 補課：Hermes 那句「never routes」講得太滿

Step 2 引的 authoring standard 是一個關於**模型行為**的斷言：
「description 超過 60 字被切掉之後，模型永遠不會叫用這個 skill」。
`demo.ts` 只證明得了字串被 `truncate()` 切了。

現在有 `lesson-16-skills/agent.ts`（`bun run lesson-16:route`）。
判定是確定性的：模型有沒有呼叫 `load_skill(目標)`。

**真 Gemini 3.6 Flash，完整矩陣每格三次，共 30 次執行**：

| 名字 | 干擾項 | 描述合格 | 129 字 | 201 字 |
|---|---|---|---|---|
| `replay-fall-window` | 好認 | ✓✓✓ | ✓✓✓ | ✓✓✓ |
| `replay-fall-window` | 都很像 | ✓✓✓ | ✓✓✓ | ✓✓✓ |
| `sk-0472` | 好認 | ✓✓✓ | ✓✓✓ | ✓✓✓ |
| **`sk-0472`** | **都很像** | ✓✓✓ | **✗✗✗** | **✗✗✗** |

只有最後一格會壞。修正後的規則：

> **路由訊號 = skill 名字 + description 的前 60 字。
> 兩者只要有一個把話講清楚就夠。**
>
> 要壞掉需要三個條件同時成立：
> 名字沒語意 + 描述前 60 字沒資訊 + 有長得像的替代品。

**⚠️ 第一輪的實驗設計是錯的，而且錯法值得記下來。**

第一版的四個干擾項（比對 session / 輸出 PDF / 調步態 / 查電池）
跟問題明顯無關，模型可以用**排除法**選出唯一不明顯錯誤的那個，
根本不需要讀描述。9/9 全過，但什麼都沒測到。

> **通過測試不代表機制有效，可能只是題目太簡單。**
> 這條跟 Lesson 15 的「假陰性」是同一個家族：
> 陰性結果要先證明「測試本身有鑑別度」。
> 兩條合起來也許該進設計原則清單。

失敗的樣子完全符合原文描述：**沒有任何錯誤訊息**，
模型載了兩個看起來合理的 skill、產出看起來合理的計畫，
專門寫的那個 skill 從頭到尾沒被用到。又是設計原則 7。

### ~~Lesson 17：跨 session 搜尋~~ ✅ 已完成

- **來源**：Hermes 用 SQLite FTS5 + LLM 摘要做 recall
  （`hermes_state.py` 10,850 行裡有一部分，要再定位）
- **實際發現**：我原本以為是「FTS5 + LLM 摘要」的兩段式，**這是錯的**。
  Hermes 明確寫 `No LLM calls anywhere`，而且那個摘要路徑是後來拿掉的。
  真正的重點是排序衛生（來源降權、壓縮摘要排除）。已在 Lesson 17 修正。
- **接得上 Lesson 4**：我們的 session 已經是 JSONL 了，加搜尋是自然的下一步
- **可以寫可跑的 code**：✅

### ~~Lesson 18：排程與無人值守~~ ✅ 已完成

`lesson-18-scheduling/`：`schedule.ts`（到期與補跑）、`ledger.ts`（執行紀錄）、
`guard.ts`（生命週期守衛）、`scheduler.ts`（tick）、`demo.ts`（五個情境）、
`agent.ts`（真模型）、`tests/scheduling.test.ts`（20 個測試）。

⚠️ **盤點的行數要更正**：`cron/` 是 **9 個檔、8727 行**（實際 `wc -l`），
原本寫 11 檔 8954 行。

**四個關得掉的機制**（關掉都看得到具體失敗）：

| 開關 | 關掉之後 |
|---|---|
| `OVERLAP=allow` | 上一輪還在跑，新的一輪照疊上去 |
| `RETRY=1` | 把 `unknown` 當成「重試就好」→ 同一封信寄兩次 |
| `PROVE=off` | 不證明 owner 死了就改寫狀態 → **活著的執行被標成 unknown → 重疊檢查失效 → 重複副作用** |
| `GUARD=off` | 那條 SIGTERM-respawn 因果鏈 |

第三列是這一課最值得記的結構：**改寫狀態那一步本身沒有副作用**，
它只是讓另一個機制（重疊檢查）的前提失效，再由那個機制去產生重複的副作用。

> 一個機制的正確性取決於另一個機制對它的假設。
> 這種 bug 在單元測試裡看不到，因為兩邊分開看都是對的。

**三個終局狀態**（`cron/executions.py`）：`completed` / `failed` / **`unknown`**。
第三個是重點：「失敗」跟「不知道副作用有沒有發生」是兩件事。
而且 `recover` **不排任何重試** —— 要不要重跑是工作的性質決定的（→ Lesson 34）。

**真模型實測（Gemini 3.6 Flash，兩批共六次）**，題目是
「我改了 agentd 設定檔，排一個每天三點清快取 + 讓設定生效的工作」：

| | 次數 |
|---|---|
| 第一次就走安全路線（reload，沒被擋） | 3 |
| 被擋一次 → **把那一步整個拿掉**，並轉告使用者為什麼 | 3 |
| 被擋之後又試繞道 | **0** |

⚠️ **這跟 Lesson 8 的結果相反**（那邊被拒絕後連換五種工具繞道、最後謊報完成），
而最明顯的差異在拒絕訊息：

| | Lesson 8 | Lesson 18 |
|---|---|---|
| 訊息 | 「風險等級 write_local，需要批准」 | 「會造成重啟迴圈…**請在 daemon 外面的 shell 執行**」 |
| 有沒有講替代做法 | 沒有 | **有** |

> **拒絕訊息裡有沒有「那你應該怎麼做」，可能比有沒有寫「不要繞過」更重要。**
> 這是第三個資料點（8、9、18），但**仍然只是相關性**：三個實驗的工具、
> 風險等級、任務性質都不一樣。要證明它得固定其他變因只改那一句
> —— 已寫成 Lesson 18 的練習 4。

**兩件量到的、關於守衛本身的事**：

1. 守衛**誤擋**了 `pkill -HUP agentd`（`-HUP` 是重新載入訊號，不會殺掉進程）。
   分支 D 是 `p?kill.*agentd` 一律擋。**一個守衛的品質不只看它擋得住什麼，
   還看它誤擋了什麼。**
2. 判定刻意用兩個寬度（窄的守衛 + 寬的哨兵），因為**拿守衛自己當裁判是自證**。
   哨兵標了 3 次「可疑但沒擋」，三次守衛都是對的（reload 不會殺進程）。

#### 原始規劃

- **來源**：`cron/`（11 檔，8954 行），
  `scheduler.py`、`jobs.py`、`executions.py`、`lifecycle_guard.py`、
  `suggestions.py`、`blueprint_catalog.py`
- **會學到**：cron 排程、任務生命週期、`lifecycle_guard.py` 在防什麼、
  `suggestions.py`（agent 自己建議要排什麼程）
- **跟 Lesson 9 的關係**：排程跑起來一定是無人值守，所以批准要進 inbox。
  這兩課應該一起讀
- **決定**：Lesson 13 不單獨寫，整個併進這一課。所以這課要同時涵蓋
  OpenWorker `automation/`（cron 觸發、任務狀態、失敗重試）和 Hermes
  特有的部分（`suggestions.py`、`lifecycle_guard.py`）

### ~~Lesson 19：Subagents 與委派~~ ✅ 已完成

- **來源定位好了**（原本寫「還沒定位」）：`tools/delegate_tool.py`（3697 行）、
  `tools/async_delegation.py`（1069）、`tools/delegation_live_log.py`（424）。
  不在 `agent/` 底下，在 `tools/`。

`lesson-19-delegation/`：`delegate.ts`（子 agent + blocklist）、
`workspace.ts`（語料與標準答案）、`demo.ts`（四個機制）、`agent.ts`（solo vs delegate）、
`tests/delegation.test.ts`（13 個測試）。

**`DELEGATE_BLOCKED_TOOLS` 那五行註解是這一課的一半內容**
（`delegate_tool.py:46-54`），而且五個是**五種不同的東西**：

```
delegate_task  資源（指數展開）      clarify   通道（那一側沒有使用者）
memory         共用狀態（隔離變假的） send_message  外部副作用
cronjob        身分（用父 agent 的名義排未來的工作）  ← 最容易漏
```

最後一個直接接回 Lesson 18：**那一課的守衛擋內容，這一課的 blocklist 擋資格。**

**預先寫下的預期**（TODO 原話）：「多 agent 不會比較聰明，
它是把狀態邊界變明確；沒有真的隔離需求時只是多付溝通成本。」

**實測（真 Gemini 3.6 Flash，各三次，同一題同一份語料）**：

| | 模型呼叫 | 子 agent | token | 錯誤碼 | 但書 |
|---|---|---|---|---|---|
| solo | 6 / 6 / 4 | 0 | 11,251 / 9,718 / 9,983 | 3/3 | 有 有 有 |
| delegate | 23 / 23 / 22 | 3 | 35,203 / 41,546 / 39,147 | 3/3 | 有 有 有 |

> ✅ **預期對的那一半**：正確率一樣，成本 **3.9 倍**（我猜 1.5-2 倍，猜低了）。
>
> ❌ **預期錯的那一半**：我埋了一個「舊編號方案」的但書要示範資訊遺失，
> **3/3 都活著跨過了摘要那一層**。這不代表委派不會掉資訊，
> 代表**這個題目太簡單**（但書就在檔頭三行、還用 `NOTE:` 標著）——
> 又是「陰性結果要先證明測試有鑑別度」。已寫成練習 2。

**3.9 倍是從哪裡來的**（trace 看得到，這才是有用的部分）：
每個子 agent 都自己重新探索一遍 —— 父 agent 的 `list_files` 跨不過邊界，
負責 notify 的子 agent 把 checkout 和 inventory 的日誌也讀了。

> **委派省的是父 agent 的 context，付的是每個子 agent 的重新探索。**
> 所以它划算的條件是：子任務夠大、中間過程夠髒、摘要比原文短很多。
> 三個都不成立時，你只是把一件事拆成四次對話。

**還有一個委派特有的失敗**（`demo.ts` 的 `locate`）：
子 agent 可以把工具失敗吞掉，然後回一段看起來正常的摘要。
**摘要不是證據** —— 這是 Lesson 29 的結論在委派上的版本。

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

## ⚠️ Lesson 17 補課：排序壞掉之後，下游 agent 會怎樣

**先講立場**：排序器裡面沒有 LLM，而且不該有。
`lesson-17-search/agent.ts` 一行排序都沒動，模型接在**外面**當使用者。

Step 3 已經用確定性分數證明排序會壞。但排序是中間產物，
真正的問題是下游。**結果比預期複雜，而且推翻了我前三次的解讀。**

前三次 `DEMOTE=off`，兩次模型自信地回答「取樣率正常、無異常」。
乾淨、好講、正好支持一個有戲劇性的結論。**然後多跑幾次就變了**：

| `DEMOTE=off`（9 次） | 次數 |
|---|---|
| 反覆換關鍵字後**還是找到了** | 4-5 |
| 撞到步數上限，沒給答案 | 2 |
| 照 cron 摘要回答「一切正常」 | 2 |

`DEMOTE=on`（8 次）：**8/8 找到了。**

所以降權買到的不是「對 vs 錯」，是**可靠度和成本**：

```
DEMOTE=on   搜尋 2-5 次，8/8 答對
DEMOTE=off  搜尋 4-6 次，結果分三種，其中兩種是壞的
```

沒有降權時，agent 靠**反覆換關鍵字硬撈**來補救：
`telemetry` → `取樣` → `sampling` → `50Hz` → `go2-c` → `meta.sample_rate_hz`。

> **模型會替爛基礎設施擦屁股，但要付錢，而且不保證每次成功。**
> 這一課其他部分省下的就是這筆錢。

**方法上的教訓**：前三次的結果乾淨又好講，那正是該多跑的理由。

> 確定性的東西跑一次就夠；**非確定性的東西跑三次會給你一個
> 看起來很確定的假象**。接回 Lesson 7 的評估集為什麼要多案例。

## Lesson 25：不需要補，它已經是真模型輸出

盤點的時候本來要照 8/9/15/16/17 的方式補，**看了之後決定不補**：

- `fixtures.ts` 的 `REAL_REPORT` 是 Lesson 24 用 Gemini 3.6 Flash
  跑出來、**一字未改**的報告
- 另外三份是從它**刻意改壞**的，每種對應一類引用錯誤

這是驗證檢查器的正確方法：**要驗證一個檢查器，你得先有一份
你知道答案的資料。** 凍結成 fixture 是優點不是缺點，
改成即時呼叫模型只會讓這一課失去可重現性，而且檢查器本來就該是確定性的。

## ⚠️ Lesson 27 補課：門檻的價值不是我以為的那個

`lesson-27-local-docs/agent.ts`（`bun run lesson-27:agent`），
在 `hybrid.ts` 加了 `disableFloor` 開關（跟 Lesson 17 的
`disableSourceWeighting` 同一個用途：**要說明一個機制值不值得存在，
最好的方式是把它關掉跑一次**）。

查「chunk 大小要怎麼選」，網頁語料（機器人主題）對這個問題一律不相關。
關掉門檻之後，README Step 3 描述的那個失敗完整重現，
**舒肥烹飪指南排在第 4 名**。

**我原本預期模型會引用它。實測相反**：

| | 檢索到的不相關來源 | 模型引用了嗎（5 次） |
|---|---|---|
| 有門檻 | 0 筆 | 不適用 |
| 沒門檻 | **4 筆** | **0/5，一次都沒有** |

所以門檻擋的不是「會被引用的垃圾」，是**位置**：

```
有門檻    8 個位置：本地 8 筆
沒門檻    8 個位置：本地 4 筆 + 不相關網頁 4 筆
                    ↑ 4 筆相關的本地文件被擠掉
```

> **真正的傷害是排擠，不是幻覺。**
> 使用者不會看到錯誤答案，會看到一個**比較空洞的**答案，而且不知道原因。
> 加上 Lesson 26 的帳：那 4 筆的 token 照付。

程式碼刻意用 `○ 模型自己避開了` 而不是 `✓`，因為：

- **✓ 有門檻**：垃圾進不了 context，這是**結構保證**
- **○ 沒門檻**：垃圾進去了，這次模型沒上當

跟 Lesson 17 Step 3.5 是同一件事的第二次出現：
**模型會替爛基礎設施擦屁股，但那個「大部分時候」不是你能倚賴的東西。**

---

## 這一輪補課的總結（8、9、15、16、17、27）

原本這幾課都只有離線示範，驗證得了機制、驗證不了
「模型拿到這個機制的輸出之後會怎樣」。補完之後有兩件事值得升格：

**一、可以考慮加進設計原則清單**

> ⚠️ 這三條的號碼在 2026-07-30 各往後挪了一號，因為原則 8 被
> Lesson 29 佔走了（那一條已經有課、有真模型實測，不再是提議）。

> **原則 9（提議）：非確定性的東西，三次不算數。**
>
> 確定性的東西跑一次就夠。模型行為跑三次會給你一個看起來很確定的假象。
> Lesson 17 前三次的結果乾淨、好講、剛好支持一個有戲劇性的結論，
> 多跑六次之後整個分佈都變了。

> **原則 10（提議）：陰性結果要先證明測試有鑑別度。**
>
> Lesson 15 的假陰性（回覆被 `max_tokens` 截斷 → 看不到攻擊標記）
> 和 Lesson 16 的排除法（干擾項太好認 → 不用讀描述也能答對），
> 都會讓一個沒有效果的機制看起來有效。安全與路由這類測試尤其危險。

**二、一個反覆出現的現象**

模型會替爛基礎設施擦屁股，而且成功率高到會騙人：

| 課 | 基礎設施壞掉 | 模型的補救 | 代價 |
|---|---|---|---|
| 17 | 排序被 cron 洗版 | 反覆換關鍵字硬撈 | 搜尋次數翻倍，2/9 沒答案，2/9 答錯 |
| 27 | 不相關來源進了 context | 自己避開不引用 | 4 個位置被佔走，token 照付 |
| 8 | 權限擋下操作 | 換工具再試五次 | 最後還謊報完成 |

**這三個都不是「模型很笨」的例子，是「模型太會補救」的例子。**
補救成功會讓你的爛設計看起來沒問題，直到某次它沒補救成功。

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
模型拿到的只有 title、URL 跟一小段 snippet，所以它會開始亂猜，
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
  > 而且**抽取失敗沒有任何錯誤訊號**，頁面抓到了、chunk 讀完了，
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
  （5-gram）。**後果是去重一次都沒生效，而 nDCG 完全不會告訴你**，
  「沒做事」和「做了但沒差」在平均分數上長得一樣

- ⚠️ **檢索變好，agent 沒有變好。** 同一個問題（Lesson 20 那題）跑兩次，
  兩次都是 14 次搜尋 + 2 次抓取然後**撞上 16 步上限、沒有答案**，
  比 Lesson 21（11 搜 + 2 抓，有答出來）更糟。因為模型把步數花在
  搜尋訓練資料裡記得的專案名（HumanPlus、dex-retargeting、Open-TeleVision、
  GMR，語料裡都不存在）。

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

而**真正缺的是「他們到底怎麼做的」**，那也是這份 TODO 從一開始就掛著的
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
  「不要去搜你記憶中的專案名」擋不住，它照樣搜 HumanPlus、GMR、
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

Lesson 24 已經證明「深度旋鈕就是成本旋鈕」，`estimateCost()` 算得出
搜尋和抓取的次數，但**算不出錢**，因為我們沒有 token 計價。

會學到：

- 每個 provider 的計價怎麼查、怎麼估（input/output 分開算）
- 把成本累加器串進 loop 而不弄髒每一個函式的簽章
- 「預算剩下 20% 該做什麼」，是停止、是降級到便宜模型，還是縮小 breadth
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
  | 相對門檻（低於最高分 35%） | **一筆都沒擋掉**，Lesson 22 的 score 是候選集內 min-max 正規化的，最高分永遠接近 1 |
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
index**，不要索引整個 internet，挑一個自己熟的領域（例如 robotics：
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

## 待寫：Mastra 篇（Lesson 30-33）

- **來源**：[mastra-ai/mastra](https://github.com/mastra-ai/mastra)（已 clone 在
  `mastra/`，1.7G）。下面的檔案位置和行數都是實際數的
- **為什麼要加第四個專案**：Pi / OpenWorker / Hermes 都是**應用**，
  Mastra 是唯一一個**框架**。它的價值不在「怎麼包 API」，而在
  **loop 的邊界**，loop 撞上「三家 provider」「200 個工具」「中途 crash」
  「有敵意的輸入」的地方。
- **這正好是自己寫 215 行 loop 撞不到的東西。** Lesson 1-27 的主題都是
  loop 本身，這四課補的是 loop 周圍那圈，而且全部符合設計原則 6
  （`runTurn` 不動）。

### ~~Lesson 30：同一個 schema，三家模型三種寫法~~ ✅ 已完成

`lesson-30-schema-compat/`：`probe.ts`（量測）、`compat.ts`（相容層）、
`tests/schema-compat.test.ts`（契約測試，不需金鑰，CI 跑得動）。

**實測（真 Gemini 3.6 Flash + 真 GPT-5）**：

第一層六個基本構造（`["string","null"]`、`oneOf`、`minLength/maxLength`、
`minimum/maximum`、`enum`、巢狀選填）→ **兩家全過**。

> ⚠️ 差點就寫成「所以現在的模型都很好，相容層是舊時代的產物」。
> **那個結論會是錯的，錯法跟 Lesson 16 第一輪一模一樣：題目太簡單。**
> 一個測不出差異的測試不是「證明沒問題」，是「你還沒找到邊界」。

加難度之後邊界就出現了：

| 構造 | Gemini 3.6 Flash | GPT-5 |
|---|---|---|
| `multipleOf` | ⚠️ **安靜地違反**（5/5 回 70） | ✓ 75 |
| `items: [A,B,C]`（tuple） | ✗ **API 400** | ✓ |
| pattern / maxLength / 120 值 enum / `$ref` 遞迴 | ✓ | ✓ |

**這一課的主軸是「兩種失敗完全不同」**：

| | API 拒絕 | 模型不照做 |
|---|---|---|
| 你怎麼知道 | 400，程式當場爆 | **不會知道** |
| 修法 | 改寫成它吃得下的形式 | **把約束搬進 description** |

> 吵的失敗是禮物。`multipleOf: 15` 拿到 70 才是真問題：
> API 收下了、模型回了、工具跑了、資料進去了，**沒有任何一層報錯**。

相容層兩招（跟 mastra 一樣）：結構改寫 + 約束搬進描述。
結果 `compat=off` 5/5 違反、`compat=on` 5/5 正確，tuple 也從 400 變通過。

**又一次踩到同一族的錯**：`TARGETS` 那張表是 2026-07 量出來的，會過期。

> **能重跑的量測才是資產，抄來的常數不是。**
> 這是第三次了：Lesson 22 憑印象猜去重門檻 0.5（實際 0.17）、
> Lesson 27 抄 gpt-researcher 的相關性門檻（對我們的 embedding 沒用）、
> 現在是這張表。**三次都是把別人量出來的數字當成通則。**
> 這條也許該進設計原則清單（提議的原則 11）。

### ~~Lesson 30（原始規劃）~~

- **來源**：`mastra/packages/schema-compat/src/provider-compats/`
  （anthropic / google / openai / openai-reasoning / deepseek / meta，各一個檔）
- **為什麼優先**：Lesson 1 已經有 provider 抽象，`tests/` 也有一份
  「每個 provider 都要滿足的契約」，但那份契約只管**訊息格式**。
  真正會炸的是 **tool schema**：

  | 現象 | 位置 |
  |---|---|
  | Google 不支援 `null`，要轉成 `z.any().refine(v => v === null)` | `google.ts:213` |
  | `claude-3.5-haiku` 支援 string 的 `min`/`max`，但**模型不遵守**，要把約束搬進 tool description 才有效 | `anthropic.ts:49` |
  | 每家對 `optional` 的處理不同，只能 case-by-case 列白名單 | `anthropic.ts:38`、`google.ts:200` |

- **它有 `provider-compats/test-suite.ts`**：一份共用契約測試跑遍所有
  provider 的相容層。這是我們那份契約測試的完整版，直接對照著抄
- **課程形狀**：寫一個有 optional + union + null + 字串長度限制的工具，
  餵給三家模型，看誰壞掉，然後寫出修補層。跑得起來、看得到差異
- **接哪裡**：Lesson 12（MCP）之後。MCP server 給的 schema 不能改，
  所以那時候修補層變成必要而不是可選

### ~~Lesson 31：把 runTurn 裡的 if 搬到外面（Processor pipeline）~~ ✅ 已完成

`lesson-31-processors/`：`processor.ts`（最小 pipeline + secret redactor）、
`demo.ts`（三個 boundary 的失敗實驗）、`tests/processors.test.ts`（契約測試）。

**最小實驗照規劃跑通，而且關掉機制時失敗非常清楚**：

```text
read_file(.env) → tool result → model / trace / memory

processor 全關       LEAK / LEAK / LEAK
只保護 model input   safe / LEAK / LEAK
三個邊界各自保護      safe / safe / safe
```

> **模型沒看到 secret，不代表系統沒保存 secret。**
> model input、trace、memory 是三個獨立 sink，必須在各自的入口處處理。

一個實作時才看見的細節：processor 的 `findings` **不能留下命中的原字串**，
只記類型和數量。否則 redactor 自己的 audit log 會變成另一份 secret 資料庫。

這課刻意沒有用真模型。它的主張是確定性的資料流性質（字串有沒有跨界），
不是模型行為；接模型反而會把判定變模糊。

#### 原始規劃

- **來源**：`mastra/packages/core/src/processors/`，
  `processors/processors/` 底下 40 個檔
- **會學到**：架構上的一個轉折，原本編譯進 loop 的東西（截斷、壓縮、
  權限檢查）改成可插拔的 input/output pipeline。
  **這剛好解釋了「從 Lesson 1 到 17 核心 loop 幾乎沒變」是怎麼做到的**：
  會變的東西都被推到 processor 去了
- **附贈一整套 guardrail 實作可以對照**：

  ```
  prompt-injection-detector.ts  409    token-limiter.ts   412
  pii-detector.ts                      cost-guard.ts      316
  moderation.ts                        unicode-normalizer.ts
  system-prompt-scrubber.ts            regex-filter.ts
  ```

- **接哪裡**：Lesson 15 講的是**記憶層**的注入防禦，這課是 **I/O 邊界**的
  防禦，兩個位置不同。`cost-guard.ts` 直接接 Lesson 26

### Lesson 32：200 個工具塞不進 context

- **來源**：`mastra/packages/core/src/processors/processors/tool-search.ts`
  （654 行）+ `tool-search-stores.ts`
- **會學到**：工具不是一開始全給模型，而是先 **BM25 搜工具描述**
  → 模型「載入」需要的 → 才進 active 集合。三個 phase：
  `search` / `load` / `active`（`tool-search.ts:13`）
- **成本很低**：Lesson 17 和 20 已經有 BM25 了，直接複用，
  只是索引對象從 session 換成 tool description
- **加分**：Claude Code 自己的 `ToolSearch` 就是這個機制，
  可以在課裡直接指給讀者看「你現在用的工具就長這樣」

### Lesson 33：loop 不是 loop，是可以序列化的狀態機

- **來源**：`mastra/packages/core/src/agent/durable/`、
  `mastra/packages/core/src/workflows/`（`handlers/control-flow.ts`、
  `state-reader.ts`、suspend/resume）
- **會學到**：Lesson 9 的「暫停等批准」是 in-process 的 inbox。真正的版本是
  把 agent 狀態**存下來、進程死掉、換一台機器 resume**。這要求 loop
  不能是 while，得是可 snapshot 的 step graph
- ⚠️ **這課違反設計原則 6，而且跟 Lesson 24 是同一種違反**：
  它不是改良 agent loop，是換一個形狀。要照 Lesson 24 的做法，
  在 `runTurn` 旁邊蓋一個新東西，不要動它
- **難度提醒**：四課裡最重的，最容易寫成「讀懂架構」而不是可跑的 code
  （跟 Lesson 10 的顧慮一樣）。建議做**最小版**：三步 workflow、
  第二步 suspend、殺掉 process、重開 resume。
  **不要碰 `workflows/inngest`、`workflows/temporal` adapter**

### 不必開新課，塞進舊課就好

| 東西 | 來源 | 塞哪 |
|---|---|---|
| 換 provider 續舊 session（tool_use / tool_result 配對會爛掉） | `core/src/processors/provider-history-compat.ts` | Lesson 4 加一節 |
| Structured output + 失敗時用備援模型修 | `processors/processors/structured-output.ts`（394） | Lesson 7 |
| Tracing span、每次呼叫的成本歸因 | `core/src/observability/` | Lesson 26 |
| 訊息格式正規化（1755 行的 MessageList） | `core/src/agent/message-list/message-list.ts` | Lesson 4，或當 Lesson 30 的延伸閱讀 |
| 多 agent 委派與路由 | `core/src/loop/network/` | Lesson 19 的參考實作 |

### 明確**不寫**的部分

| 主題 | 為什麼跳過 |
|---|---|
| `deployer` / `cli` / `create-mastra` | 打包與部署，跟 agent 無關 |
| `playground` / `playground-ui` / `editor` | 介面問題 |
| `integrations` | 跟 OpenWorker connectors 同一個理由：重複性高 |
| `voice` | 介面問題 |
| `workflows/inngest`、`workflows/temporal` | 是「怎麼接 durable execution 服務」，不是「為什麼要 durable」 |

---

## 待寫：Restate 篇（Lesson 34）

- **來源**：[restatedev/ai-examples](https://github.com/restatedev/ai-examples)
  （已 clone 在 `restate-ai-examples/`，`60d1eda`）。**很小**，
  TypeScript 那兩份加起來 3101 行，`tour-of-agents/src` 每支 55-84 行，
  一個下午讀得完。跟 Hermes 的 115k 行是兩個世界
- **為什麼是 Restate 不是 Temporal**：問題一樣，規模差十倍。
  Temporal 當**對照來源**（它的架構文件明確要求 activity 要嘛冪等、
  要嘛不可重試），不要去讀 server 那份 Go codebase

### 它接在 Lesson 33 後面，不是另一個題目

```
Lesson 33  Mastra：agent loop → 可序列化的狀態機 → suspend / resume
Lesson 34  Restate：狀態機裡的**一個 tool call** crash 之後怎麼辦
```

Lesson 33 回答「進程死掉之後怎麼接回來」，34 回答一個 33 不會問的問題：
**接回來的時候，那個已經送出去的副作用算不算數。**

### 核心機制只有一個

`ctx.run(name, fn)`（`typescript-restate-only/tour-of-agents/src/chat-agent.ts:23`、
`parallel-tools-agent.ts:31`）：

```ts
const result = await ctx.run("LLM call", async () => llmCall(messages),
                             { maxRetryAttempts: 3 });
```

執行過的步驟寫進 journal，重播時**不重跑，直接回傳當初記下來的值**。
模型呼叫、工具呼叫、平行工具（`RestatePromise.all`）都走同一個東西。

> 重點不是這個 API 長什麼樣，是它**逼你把每一個副作用命名**。
> 沒有名字的副作用不可能重播。

### 要做的實驗（先不要碰 `send_payment`）

最小、可觀察、可以數的副作用：`append_order()` 往檔案追加一筆訂單。

```
1. 寫入訂單成功
2. 在回傳結果前把 process 殺掉
3. 重啟
4. 數 orders.jsonl 有幾筆
```

四種跑法對照：普通 async function / 有 journal / 有冪等鍵 / 沒有冪等鍵。

⚠️ **這一課真正要教的那個窗口**（一開始想成「有 journal 就安全」是錯的）：

```
副作用發生  ────────→  journal 落地
            ↑
        死在這裡，那一步一定會重跑
```

Journal 不能消滅這個窗口，只能把它縮小。所以結論不是「用了 durable
execution 就好了」，是 **at-least-once 是天花板，剩下的必須由工具自己
冪等**。這正好對得上 Temporal 那條「要嘛冪等，要嘛不可重試」。

### 已經讀到、值得抄的兩個

| 東西 | 位置 | 為什麼 |
|---|---|---|
| Terminal error（不可重試的錯） | `vercel-ai/tour-of-agents/src/errorhandling/stop-on-terminal-tool-agent.ts`、`fail-on-terminal-tool-agent.ts` | 重試不是永遠對的。「這張卡被拒絕」重試一百次還是被拒絕 |
| 補償（rollback）而不是重試 | `vercel-ai/tour-of-agents/src/rollback-agent.ts` | 訂了旅館但機票訂不到 → `undo_list` 反向跑。**這是 Lesson 9「收不回來」的另一半答案** |

### 明確**不做**的部分

| 主題 | 為什麼跳過 |
|---|---|
| 真的跑 restate-server | 要另外裝 binary、註冊 deployment。**照 Lesson 12 的做法自己寫一個最小 journal**（那課自己寫了一個 200 行的 MCP server），設計原則 1 才守得住 |
| `a2a/`、`mcp/`、`google-adk/`、`pydantic-ai/`… | 同一批範例的六種 SDK 版本，重複性高 |
| Restate 的 virtual object / awakeable / 分散式語意 | 那是「怎麼用 Restate」，不是「為什麼 agent 需要 durability」 |

---

## 待寫：Sandbox 篇（Lesson 35）：權限引擎不是 sandbox

- **來源**：[anthropic-experimental/sandbox-runtime](https://github.com/anthropic-experimental/sandbox-runtime)
  （已 clone 在 `sandbox-runtime/`，`295f0e1`）。`src/` 16,307 行、
  TypeScript、**而且 macOS 那條路徑就是 `sandbox-exec` + Seatbelt profile**
  （`src/sandbox/macos-sandbox-utils.ts`，1090 行），本機直接跑得起來
- **它是從 Claude Code 的實際需求抽出來的**，不是一般性的 sandbox 研究

### 它補的是 Lesson 8 的下半句

```
Lesson 8  權限引擎   決定「准不准執行這個指令」
Lesson 35 sandbox    就算准了，那個進程實際碰得到什麼
```

> **這一課的主張只有一句：command allowlist 管不到 command 執行之後的行為。**

而這件事**在這個 repo 已經真的發生過一次**，不是假想威脅：
Lesson 2 那個 `npm test` 往父目錄找 `package.json`，跑掉了本專案的 74 個測試
（見「現有課程的缺口」第一條）。指令本身完全合法、完全在允許清單上。
那就是這一課的 fixture，不用另外編。

### 要做的實驗

先不要研究雲端 sandbox infrastructure。只比較兩件事：
`child_process.spawn` 直接跑 vs 包一層 sandbox 跑。

| 情境 | 期望 |
|---|---|
| 讀 workspace 內的檔案 | 成功 |
| 讀 `../.env` | 失敗 |
| 寫 workspace 外的檔案 | 失敗 |
| 連允許的網域 | 成功 |
| 連沒允許的網域 | 失敗 |
| `npm test` 往父目錄找 `package.json` | **被邊界擋住** |

⚠️ **兩個設計細節要照抄，因為方向是相反的**（README「Dual Isolation Model」）：

```
讀：deny-then-allow    預設全部可讀，先 deny 一大塊再 allow 回來
                       allowRead 贏 denyRead
寫：allow-only         預設全部不可寫，只開你列出來的
                       denyWrite 贏 allowWrite
```

**同一份設定檔裡兩個欄位的優先順序是反的**，而且兩個都對。
這種東西自己憑空設計一定會設計成一致的，然後在錯的那一邊留一個洞。

### 對照來源（不要第一課就四個都實作）

| 專案 | 學什麼 |
|---|---|
| **Anthropic SRT** | 本機 capability restriction（**主要來源**） |
| E2B | Firecracker microVM 隔離、code interpreter |
| Daytona | 長生命週期的 agent workspace |
| OpenSandbox | 多種 runtime（Docker / K8s）的統一抽象 |

跟 Lesson 23 一樣：先逐項對照原始碼，再決定哪個機制值得抄回來。

### 明確**不做**的部分

| 主題 | 為什麼跳過 |
|---|---|
| Linux bubblewrap / Windows WFP（`linux-sandbox-utils.ts` 1728 行、`windows-sandbox-utils.ts` 2268 行） | 本機跑不到，會變成讀架構 |
| MITM CA、TLS terminate proxy、credential masking（`mitm-ca.ts` 624、`tls-terminate-proxy.ts` 623、`credential-*.ts` 六個檔） | 是網路安全工程，不是 agent。**但要在課裡點出它們為什麼存在**：sandbox 擋得住連線，擋不住把 key 送給允許的網域 |
| seccomp filter 產生器 | 同上 |

---

## 待寫：OpenCode 篇（Lesson 28-29）— **刻意不開整篇**

- **來源**：[anomalyco/opencode](https://github.com/anomalyco/opencode)（已 clone 在
  `opencode/`，`dev` 分支 `a45c2b9` / v1.18.9）
- **定位跟前四個都不同**：Pi 是 runtime、OpenWorker 是產品、Hermes 是
  platform、Mastra 是框架，**OpenCode 是一個已經被大量真實使用的
  coding agent 產品**，而且跟本系列做的是同一件事

### ⚠️ 先講為什麼不開整篇

OpenCode 大部分內容我們已經有了：

| OpenCode | 我們 |
|---|---|
| agent loop / tool calling / streaming | Lesson 1-3 |
| session / compaction | Lesson 4-5 |
| permission | Lesson 8-9 |
| agent server / MCP / subagent | Lesson 10 / 12 / 19 |
| provider 相容 / processor | Lesson 30-31 |

**只補兩件沒有被其他專案覆蓋到的事**，其餘塞回舊課。

### ~~Lesson 29：模型自述不是完成證據~~ ✅ 已完成

`lesson-29-evidence/`：`snapshot.ts`（影子 git，約 160 行）、
`evidence.ts`（三份紀錄的集合運算）、`loop.ts`（Lesson 8 的 loop + 兩行 snapshot）、
`fake-provider.ts`（五個情境）、`demo.ts`、`agent.ts`、
`tests/evidence.test.ts`（12 個測試，其中 4 個真的開 git 跑）。

**規劃裡有一句是錯的，而且錯得很典型**：原本寫
「playground 已經有 git，`git stash create` 之類的低階指令就夠」。

> `git stash create` 動的是**使用者自己的 repo**（讀寫 index、留 reflog）。
> 為了記錄 agent 做了什麼去動使用者正在工作的那份 git 狀態，
> **代價比要解決的問題還大。**

opencode 的做法是 `--git-dir` 指到別的地方、`--work-tree` 才指向專案
（`snapshot/index.ts:71`）。換掉之後多一個沒預期的好處：
**workspace 根本不需要是 git repo**，這一課的 workspace 就不是。

**實測（真 Gemini 3.6 Flash）**：

| | 變更檔數 | 結構性分歧 | 模型最後說的話 |
|---|---|---|---|
| `ANSWER=n` ×3（拒絕組） | 0 / 0 / 0 | 有 / 有 / 有 | **3/3 都宣稱「已為您重構 src/app.ts」，還附上「整理後的程式碼」** |
| `MODE=auto` ×2（對照組） | 2 / 2 | 無 / 無 | 誠實 |

拒絕組是 Lesson 8 的重現，但這次**不需要有人去比對 `md5`**：
`patch.files.length === 0` 印在同一張表上，跟那段漂亮的話並排。
對照組跟拒絕組一樣重要 —— 一個永遠說「有問題」的檢查器會很快被關掉。

**判定是確定性的**（三個集合運算，沒有 LLM 裁判），但刻意分兩級：

```
結構性  unbacked-write / unreported-change / no-evidence
啟發式  unmentioned-change（要在自然語言裡找檔名，會有假陰性）
```

> 混在一起報，最硬的那條看起來會跟最軟的那條一樣可信。
> **證據的強度本身也是證據的一部分。**

`no-evidence` **刻意不去判斷那段話是不是在宣稱完成**。判斷語意就要引入
一個判斷者，而這一課整個主張就是不要那個判斷者。所以只報事實。

⚠️ **實作時差點做出一個假陽性製造機**：`ToolRecord` 一開始沒有
`mutating` 欄位，於是 `read_file("src/app.ts")` 被算成「聲稱改了 app.ts」，
**每一次唯讀探索都會生出一條假的 `unbacked-write`**。

> **「提到一個檔案」跟「聲稱改了一個檔案」是兩件事。**
> 假陽性會讓檢查器變成雜訊，然後被關掉 —— 比沒做還糟。

⚠️ **順帶抓到 Lesson 2 那個沙箱逃逸的第二次發生，隔了 27 課。**
真模型 `MODE=auto` 跑的時候自己決定「跑一下測試」→ workspace 沒有
自己的 `package.json` → npm 往上找到主 repo → **跑了本專案的 130 個測試**。
補上 `package.json` 之後 `npm test` 關在裡面了，但 `git diff` 照樣往上走。

> **每補一個邊界檔案只擋掉一個指令。** 這是 Lesson 35（sandbox）的
> 第二個真實案例：權限引擎決定「准不准執行」，決定不了「執行之後碰得到什麼」。

**兩個關得掉的機制**（設計原則：關掉才說明得了價值）：
`CAPTURE=first-tool` 把基準點抓晚一步 → provider 在送出事件之前做的
那次檔案變更**整個消失，而且沒有任何錯誤訊息**；
情境 `honest` / `partial` 是對照組，證明檢查器不是每次都喊有問題。

#### 原始規劃

- **來源**：`packages/opencode/src/snapshot/index.ts`（807 行）、
  `session/processor.ts:99-109`、`:436-469`、`:540-545`
- **為什麼優先**：它是 **Lesson 8 那個實測結果的正解**。
  Lesson 8 量到「引擎 100% 成功，使用者 100% 被騙」——檔案一個 byte
  沒動，模型跟使用者說「已經為您將 src/app.ts 重構並簡化」。
  當時的結論停在「這比 Lesson 21 的安靜失敗更糟」，**沒有給解法**。
  OpenCode 的解法是結構性的：

  ```
  assistant text    模型自述
  tool result       某次工具回報了什麼
  snapshot patch    workspace 最終真的變成什麼   ← 只有這個是事實
  ```

- **一個一定要抄的實作細節**（`processor.ts:99-102`）：snapshot 要在
  **LLM stream 開始之前**先抓。原始碼的註解寫得很清楚——provider 有可能
  在送出 `step-start` 事件以前就已經開始執行工具，等事件到了再抓就太晚了。

  > 這是那種「自己寫一定會寫錯、而且錯了完全看不出來」的順序問題。
  > 錯的版本平常都對，只有在 provider 搶跑的那次少記一個檔案。

- **最小實驗**（四個情境，比對三份紀錄）：

  ```
  1. 工具真的改了檔案，模型說改好了          三份一致
  2. 工具被拒絕，模型說改好了                 ← Lesson 8 那個
  3. 工具改了兩個檔案，模型只提一個
  4. 改完又改回去，working tree 最後沒有差異  ← tool result 有，patch 沒有
  ```

  第 4 個情境最值錢：**它是 tool result 和 snapshot 唯一會分歧、
  而且 snapshot 才對的那個方向**。

- **會長出一條新原則**（如果實驗成立，直接進設計原則清單）：

  > **產生文字的 agent，不能用自己的文字證明任務完成。
  > 完成條件必須來自任務所在的環境。**

- **可以寫可跑的 code**：✅ playground 已經有 git，`git stash create`
  之類的低階指令就夠，不需要抄那 807 行

### ~~Lesson 28：中斷之後，session 不能說謊~~ ✅ 已完成

`lesson-28-consistency/`：`parts.ts`（part 與工具生命週期）、
`processor.ts`（事件 → part + `cleanup()`）、`audit.ts`（五條稽核規則）、
`fake-provider.ts`（**可以在指定位置中斷的串流**）、`demo.ts`（六格矩陣）、
`agent.ts`（真模型）、`tests/consistency.test.ts`（17 個測試）。

**那個「怎麼在測試裡可靠地中斷一個串流」的設計問題，答案是讓串流自己
在指定位置 abort**，中斷位置變成一個參數。`setTimeout` 版本的中斷點落在
哪兩個事件之間是運氣，而且它會**安靜地換位置**。

> 這條是第三次出現：Lesson 18 的假時鐘、Lesson 29 的 `CAPTURE` 抓取點、
> 現在是中斷位置。**任何時序造成的 bug，都要先做出能指定時序的裝置。**

**矩陣跑出來了**（`CLEANUP=on` 全部乾淨，`off` 依位置出現 2-4 條違規）：

```
中斷位置            CLEANUP=off 的違規
reasoning           unfinished-span, message-never-completed
tool_input          in-flight-in-storage, message-never-completed
tool_running        上面兩條 + unfinished-span + unrecorded-patch
tool_finishing      同上
text                unfinished-span, message-never-completed, unrecorded-patch
before_step_finish  message-never-completed, unrecorded-patch
none（不中斷）      message-never-completed   ← 收尾不是中斷的補救措施
```

最後一列是寫的時候才想清楚的：**正常跑完也需要收尾**，
中斷只是讓它變得看得見。

**從原始碼抄回來、而且都是「少了就分不出兩種情況」的三個決定**：

| 決定 | 位置 | 少了它會怎樣 |
|---|---|---|
| `pending.input` 是 **string** | `schema/src/session-message.ts:81-119` | 半截 JSON 被當成物件 → parse 例外或空物件 |
| 工具有三個時間點（created / ran / completed） | `session-message.ts:132-137` | 「參數還沒收完」和「跑很久」分不出來 |
| `interrupted: true` 而不是留在 running | `session/processor.ts:589` | 「工具壞了」和「被使用者中斷」分不出來，而前者值得重試後者不值得 |

**250ms 寬限窗口**（`processor.ts:573`）不是效能考量，是正確性：
20ms 後就會回來的工具如果被標成 interrupted，**紀錄會說一件沒發生的事**。

⚠️ **一個真模型抓出來的 bug，而我自己設計的六格矩陣沒抓到**：
第一版對所有情況都套用寬限窗口。某次真模型跑的時候，模型沒有先輸出文字
就直接呼叫工具 → 串流正常結束 → `cleanup("end")` → 工具還在跑 →
250ms 到了 → **一個成功的工具被標成 interrupted，而 finish 是 "end"**。

> **寬限窗口只屬於中斷路徑。**
> 而更值得記的是抓到它的方式：**那條路徑不是我設計的，是模型走出來的。**
> 腳本化的矩陣每一格都是我想像得到的情況。

⚠️ **真模型只重現得了六格裡的兩格，而原因在我們自己的抽象**：
`shared/streaming` 沒有 reasoning 串流事件，`tool_call` 也是參數收完才發
（`types.ts:44-51` 那段刻意的簡化）。所以 `reasoning` 和 `tool_input`
兩格量不到。

> **一個好的抽象會藏起你不需要的東西；你只會在需要它的那一天，
> 才發現它藏了什麼。** 你的事件模型決定了你能觀察到哪些失敗。

另外 `AFTER_DELTAS` 第一版設 4，Gemini 把那句話切成兩三塊就講完，
**中斷從來沒發生** —— delta 顆粒度不是你能控制的，又一個假陰性。

**還沒抄的一段**：`message-v2.ts:349-357` 把 `pending`/`running` 的工具在
**送回 provider 之前**轉成 `output-error`，理由是每個 `tool_use` 都必須有
對應的 `tool_result`（Lesson 3 的硬規則）。所以同一個問題有三個位置：
存檔、畫面、**送回模型的歷史**。第三個漏掉的症狀不是紀錄不一致，是下一輪 400。

#### 原始規劃

- **來源**：`packages/opencode/src/session/processor.ts`（718 行）、
  `session/message-v2.ts`（734 行）
- **會學到**：Lesson 3 教的中斷是 `SIGINT` → `AbortController` →
  provider stream 停下來。**但 provider 停了不代表 session 一致。**
  中斷的那一刻可能同時有：reasoning 在輸出、text 在輸出、多個 tool call
  在執行、snapshot 還沒算 patch、session 還是 busy
- **tool call 是一個生命週期，不是一個 function**：

  ```
  pending → running → completed / error / interrupted
  ```

  `processor.ts:589` 把清不掉的工具標成
  `{ ...metadata, interrupted: true }`，**而不是讓它永遠停在 running**
- **要做的 fault injection 矩陣**（在不同位置中斷，重啟後檢查）：

  | 中斷位置 | 期望 |
  |---|---|
  | reasoning 中 | reasoning part 有結束時間 |
  | tool input 收到一半 | 不留下永久 pending |
  | tool 正在執行 | 標成 interrupted |
  | text 輸出到一半 | partial text 有保存 |
  | 改完檔案、step-finish 之前 | patch 仍然被記錄 |

  ⚠️ 每一格的失敗都是**安靜的**（設計原則 7）：永久 pending 的工具、
  永久 running 的 session、漏記的 patch，全部不會丟例外
- **難度提醒**：這課的風險是寫成「介紹 13 種串流事件」。
  **判準應該是那張矩陣**，不是事件列表

### 塞回舊課，不開新課

| 東西 | 來源 | 塞哪 |
|---|---|---|
| **Doom-loop 偵測** | `processor.ts:29` `DOOM_LOOP_THRESHOLD = 3`、`:356-380`、`agent/agent.ts:121` | Lesson 31 processor（或 7） |
| Pattern-based 批准、`once`/`always`/`reject` | `permission/index.ts:121/143/163` | Lesson 8 加一節（第二種成熟實作） |
| 被拒絕時一起取消同 session 其他 pending 請求 | `permission/index.ts` | Lesson 9（我們的 inbox 沒做） |
| Provider-executed tool 的正規化 | `session/message-v2.ts:321-344` `providerExecuted` | Lesson 30 延伸 |
| Structured output 做成「最後那個工具」 | `session/tools.ts` | Lesson 7 或 30，跟 Mastra 的 `structured-output.ts` 對照 |

**Doom-loop 值得單獨講清楚，因為它非常符合本系列的立場**——
判斷「模型是不是卡住了」**沒有叫另一個 LLM 來反省**，是確定性條件
（`processor.ts:356-366`）：

```
最近 3 個 part 都是 tool
+ 同一個工具名字
+ status 不是 pending
+ JSON.stringify(input) 完全相同
```

**而且它值得刻意打壞。** 這條規則抓不到：

```
grep("foo") / grep(" foo") / grep("foo ")        參數差一個空白
bash("cat f") / read_file("f") / bash("sed …")   換工具做同一件事
```

三個版本可以排成一個實驗：`原樣` → `normalize 過的 input` →
`把工具映射成 capability（read / search / edit）`。
反方向也要測誤判：同一個檔案重讀三次可能是它真的在變，
輪詢型工具重複呼叫本來就是對的。

### 明確**不寫**的部分

| 主題 | 為什麼跳過 |
|---|---|
| TUI / desktop app | 介面問題 |
| `session/prompt.ts`（1631 行）整份 | 是「怎麼把十個子系統接起來」，讀完得到的是架構圖不是機制 |
| `build` / `plan` / `general` 三種內建 agent 的設定 | 是「配置 OpenCode」 |
| LSP 整合 | 是領域工具（Lesson 6 教的是方法） |

---

## 待寫：OpenHands 篇（Lesson 36-37）

### ⚠️ 先講一件盤點時才發現的事：這個 repo 已經不是原本那個了

網路上的比較文章講的 OpenHands（更早叫 OpenDevin）是一個 Python 的
agent runtime。**現在不是了。** 實際 clone 下來數過：

```
All-Hands-AI/OpenHands  →  OpenHands/agent-canvas（2965aca）
                           833 個 .tsx + 774 個 .ts，Python 只剩 4 個檔
                           README 標題是「Agent Canvas」
                           自我描述：coding agent 的 self-hosted 控制台
```

真正的 runtime 搬到另一個 repo 了（`README.md:126` 和
`.env.sample:35` 都指過去）：

```
OpenHands/software-agent-sdk
  └─ openhands-agent-server/openhands/agent_server   ← runtime / sandbox 在這
```

> **這正好是設計原則 4 的一次實證。** 那篇比較文章、以及照著它寫的規劃，
> 都會叫你去讀一個「已經不在那裡」的 codebase。
> **列 repo 名字很便宜，`git clone` 之後數行數很貴，但只有後者是真的。**

所以 OpenHands 這條線要拆成兩個來源：

| 要學的東西 | 去哪 | 語言 |
|---|---|---|
| **事件模型**（action / observation / trajectory） | `agent-canvas/src/types/agent-server/core/events/`，**707 行純型別定義** | TypeScript ✅ |
| **runtime / sandbox / workspace** | `OpenHands/software-agent-sdk` 的 `agent_server` | Python，還沒 clone |

第一份小到可以整份讀完，而且跟本系列同語言。**Lesson 37 先做這個。**

### Lesson 37：聊天記錄不夠——Action / Observation trajectory

- **來源**：`openhands/src/types/agent-server/core/events/`
  （`action-event.ts` 72 行、`observation-event.ts` 72 行、
  `conversation-state-event.ts` 196 行、`condensation-event.ts` 46 行）
- **這一課的一句話**：我們從 Lesson 1 到 27，history 都是
  `user / assistant / toolResult` 三種角色的陣列。**那是聊天記錄。**
  OpenHands 記的是另一種東西：

  ```
  action       agent 想做什麼（thought + tool_call + 誰發的）
  observation  環境回了什麼    source 永遠是 "environment"
  ```

- ⚠️ **`observation-event.ts:9` 那個 `source: "environment"` 是整課的重點。**
  它是型別上的硬性規定，不是慣例。翻譯成人話：

  > **observation 不是 agent 說的，是世界說的。**

  這跟 Lesson 8 那個實測（模型宣稱「已經為您將 src/app.ts 重構並簡化」，
  檔案一個 byte 沒動）是同一件事的正面表述，也跟 Lesson 29 的 snapshot
  互相印證：**一個從資料結構下手，一個從量測下手。**

- **四個我們沒有、但一看就知道為什麼要有的欄位**：

  | 欄位 | 位置 | 它解決了我們踩過的哪個坑 |
  |---|---|---|
  | `llm_response_id`（把同一次回應發出的平行工具呼叫綁在一起） | `action-event.ts:57` | **Lesson 23 那個潛伏三課的 bug**：Gemini 不送 `index`，平行工具呼叫被串成一個壞字串。我們是靠 `index ?? id` 修的，OpenHands 是**在資料模型裡就有這個概念** |
  | `UserRejectObservation`（拒絕是一種 observation，帶 `rejection_reason`） | `observation-event.ts:38` | Lesson 8/9。我們把拒絕塞進 `ToolResult.isError` 的字串裡，**拒絕和「工具自己壞了」長得一模一樣** |
  | `AgentErrorEvent`（`source: "agent"`，我們的鷹架壞了） | `observation-event.ts:52` | 同上的另一半。**「環境說不行」和「我們的程式有 bug」是兩件事** |
  | `CondensationEvent`（壓縮本身是 trajectory 裡的一個事件） | `condensation-event.ts` | Lesson 5 是直接改寫陣列，**壓縮完之後看不出來壓縮過**。當事件就看得出來 |

- **順帶印證 Lesson 26**：`conversation-state-event.ts:5-17` 的 `TokenUsage`
  把 `reasoning_tokens`、`cache_read_tokens`、`cache_write_tokens`
  列成**獨立欄位**，還有 `max_budget_per_task` 和 `accumulated_cost`。
  我們 Lesson 26 是靠探針把 thinking token 從 `total - input - output`
  **反推**出來的。**別人在型別裡就寫明了。**
- ⚠️ **也有一個要拿來當反面教材的**：`action-event.ts:63` 的
  `security_risk`，註解寫明那是 **LLM 預測的**風險等級。
  這跟 Lesson 8 的立場正面衝突（風險分級是確定性的、由 harness 決定）。
  **這是一個現成的實驗**：讓模型自評風險，跟 Lesson 8 的 `classify()`
  比對，看它會不會把自己想做的事評低。設計原則的原話是
  「能用 harness 保證的事，不要交給 prompt 祈禱」
- ⚠️ **這一課的風險是寫成「介紹七種事件型別」。** 判準應該是下面這個實驗，
  而它會把 37 直接接回 29：

  ```
  同一個 command：
    模型說           「已經跑完了，測試都過」
    environment 說    exit code 1
  ```

  然後比較兩種記法：

  ```
  chat history      role: assistant, content: "I ran the command..."
                    → 兩種說法擠在同一個欄位，分不出來
  typed trajectory  ActionEvent(tool_call) + ObservationEvent(source: environment)
                    → 型別上就分開了，衝突看得見
  ```

  **這才是「history 不該是聊天記錄」的實證**，而不是型別導覽。
- **可以寫可跑的 code**：✅ 而且成本很低。把 Lesson 4 的 session JSONL
  換一種寫法就是這一課，`runTurn` 不用動（設計原則 6）

### ⚠️ Lesson 35 和 36 不是同一件事，README 要講清楚

兩課都會被當成「sandbox」，但問的不是同一個問題：

| | 核心問題 | 內容 |
|---|---|---|
| **35** 能力邊界 | **這個 process 碰得到哪些資源？** | filesystem allow/deny、network allow/deny、process 邊界、host secrets、workspace 逃逸 |
| **36** 環境生命週期 | **agent 的世界在哪裡，它能活多久？** | 環境怎麼建立、指令在哪跑、workspace 存不存、重啟後還在不在、remote runtime |

一句話版本（已寫進 README）：
**35 is about capability boundaries. 36 is about environment lifecycle.**

### Lesson 36：coding agent 的執行世界

- **來源**：`OpenHands/software-agent-sdk` 的 `agent_server`（**還沒 clone**）
- **它跟 Lesson 35 不是同一件事，順序不能反**：

  ```
  Lesson 35  Anthropic SRT   OS 原語：這個進程碰得到什麼
  Lesson 36  OpenHands       執行環境：指令在哪裡跑、跑完之後那個世界還在不在
  ```

  35 是一個 `sandbox-exec` 呼叫，36 是 workspace 的生命週期。
  **先學原語再學用原語蓋出來的東西**，反過來會變成看架構圖。
- **要回答的問題**（每一題都是 35 回答不了的）：

  ```
  workspace 怎麼建立、跑完留不留
  agent 重啟之後環境還在嗎
  timeout 和 resource limit
  環境變數怎麼注入（而不是被 agent 讀走）
  terminal 和 browser 是不是同一個 sandbox
  ```
- **實驗形狀**：同一個 coding task 跑三次——直接在 host 上、
  Docker sandbox、抽取版 runtime。任務刻意包含
  「讀 workspace 外的 secret」「連外」「超時的指令」「中途取消」「重啟後繼續」
- ⚠️ **難度提醒**：這是所有待寫課程裡**最容易寫成「讀懂架構」**的一課
  （Lesson 10、33 都掛過同樣的警告）。而且是 Python、要 Docker。
  **建議等 35 和 37 都寫完再決定要不要寫**，那時候會很清楚它還剩下什麼沒講

### 這一輪其他專案的處置（都不開新課）

| 專案 | 處置 | 理由 |
|---|---|---|
| **CrewAI** | 併進 **Lesson 19**（subagent 委派） | 值得看的不是 Researcher / Writer / Reviewer 這種角色名字，是**任務依賴怎麼表示、context 什麼時候該隔離、某個 agent 失敗整條 workflow 怎麼辦**。要做的實驗是「一個 agent 做三步 vs 三個 agent 各做一步」，比成功率、token、資訊遺失、出錯後定不定得位。預期結論值得先寫下來再驗：**多 agent 不會比較聰明，它是把狀態邊界變明確；沒有真的隔離需求時只是多付溝通成本** |
| **LangGraph** | 併進 **Lesson 33**（durable state machine）當第二份對照 | 跟 Mastra 用同一組 fixture：`讀檔 → 等批准 → 改檔`，跑到第二步關掉 process 再開。比較 checkpoint 長什麼樣、哪些 node 被重跑、**workflow 改版之後舊的 checkpoint 還 resume 得動嗎**。核心問題只有一句：**狀態存在 call stack 裡，還是存在可序列化的 graph state 裡** |
| **AutoGPT** | 當 **Lesson 24** 的歷史對照，不寫 code | 「控制流交給模型」vs「控制流留在程式裡」，Lesson 24 已經用 deep-research 做過同一個對照，而且結論更硬（`breadth/2`、`depth-1` 寫死）。AutoGPT 的價值是**它是這個錯誤最早、最出名的版本**，一句話帶過就夠 |
| E2B / Daytona / OpenSandbox | Lesson 35 的對照來源 | 見 Sandbox 篇 |
| Temporal | Lesson 34 的對照來源 | 見 Restate 篇 |

---

## Prod 篇（Lesson 50-59）：盤點結果

vLLM 和 Fish Speech 都 clone 下來數過了。**結論不是「不寫」，是「不進主線」**——
它們屬於 Prod 篇，等主線走完再回來。盤點結果留在這裡，
是為了未來寫的時候不用再 clone 一次。

### Lesson 50-51 · vLLM

- **來源**：[vllm-project/vllm](https://github.com/vllm-project/vllm)（`vllm/`，`5b29c95`）
- **為什麼不進主線**：它教 KV cache、continuous batching、GPU 排程、
  prefix caching、tensor parallel。這些對做模型基礎設施很重要，
  但**對從零學 agent 不是必要前置**。在主線裡模型可以就是：

  ```ts
  const response = await model.generate(messages, tools)
  ```

  **等你已經做完 agent、想把 OpenAI API 換成本地模型時，再學它。**

- ⚠️ **但有一塊很難割捨，記下來備查**（盤點時實際數的）：

  ```
  vllm/tool_parsers/     83 個檔案     14,307 行
  ```

  這 14,307 行只做一件事：**把模型吐出來的原始文字轉成 OpenAI 形狀的
  `tool_calls`**。兩個 parser 擺在一起就講完了：

  | 模型 | 怎麼認出「這是工具呼叫」 | 位置 |
  |---|---|---|
  | Hermes | `<tool_call>` … `</tool_call>` + 正規表達式 | `hermes_tool_parser.py:36-38` |
  | Llama | `<\|python_tag\|>` **或者開頭就是一個 `{`** | `llama_tool_parser.py:48`、`:86` |

  Llama 那條 `or "{" in model_output` 的意思是：
  **「模型講了一段剛好以 `{` 開頭的話」和「模型要呼叫工具」，
  在這一層分不開。**

  它會回答一個很實際的問題：**同一套 agent 換成本地 Qwen / Llama 之後，
  tool calling 為什麼壞掉，而你的程式碼一行都沒改。**

  > 這一塊**過得了篩選表的第 2 題（tools）**，而且是純字串處理、
  > 可以錄成 fixture 離線測。所以它不是「不值得寫」，
  > 是**它的位置在「換成本地模型」那一步，不在「從零學 agent」那條線上**。
  > 真要寫，放 Lesson 50。

- **其餘（prefill/decode、continuous batching、PagedAttention、
  speculative decoding）放 Lesson 51**，而且有一個硬阻礙：
  vLLM 對 macOS 只有 experimental 的 CPU 支援，要自己 build，只有 FP32/FP16
  （`docs/getting_started/installation/cpu.apple.inc.md:4-6`）。
  → **這台機器量不到真的 TTFT、batching、cache 命中率。**

  ⚠️ 而那正好否決了「先寫一個 TypeScript 模擬器」的做法：
  我自己寫的排程模擬器證明的是**我對排程的理解**，不是 vLLM 的行為。
  Lesson 22 憑印象把去重門檻設 0.5（實測 0.174）、
  Lesson 27 抄來的 0.35 門檻一筆都沒擋掉——**沒有實測就會猜錯**，
  排程和記憶體只會更容易猜錯。**等有 GPU 再說。**

### Lesson 56 · x402：工具要花錢的時候

- **來源**：[x402](https://docs.x402.org)——建立在 HTTP `402 Payment Required`
  上的付款標準。服務先回 402 帶價格，client 簽好付款 payload 重送，
  server 驗證結算後才給資源。
- ⚠️ **這是目前唯一一個「還沒 clone 下來數過行數」的來源。**
  上面那段是照文件寫的，**還沒驗證**。照本系列的規矩，
  真要寫這一課之前必須先 clone、盤點、標行號。
- **為什麼不進主線**：沒有 x402，coding agent / search agent / 助理 /
  workflow / 記憶 / 語音 agent **全部照樣做得出來**。
  它回答的是「agent 怎麼自己買東西」，不是「agent 怎麼推理、用工具、
  保存狀態、被評估」。
- ⚠️ **順序：OAuth（55）必須排在付款（56）前面。**
  對絕大多數 agent，「怎麼拿到外部服務的身分」比「怎麼花錢」普遍得多，
  而且 x402 本來就**依賴** credential、權限、冪等、audit、預算——
  **先讓 agent 有身分，再讓它有錢。**
- **為什麼它適合放在最後**：它其實是**前面好幾課的綜合考試**：

  | 它會逼你回答 | 那是哪一課教過的 |
  |---|---|
  | 這筆付款要不要批准？單次上限？每日上限？ | Lesson 8 風險分級 |
  | 半夜自動跑的任務要付錢，誰批？ | Lesson 9 無人值守 |
  | 付款成功但 API 沒回結果，算不算完成？ | **Lesson 29 完成的證據** |
  | 重試會不會付兩次？ | **Lesson 34 冪等 / at-least-once** |
  | wallet 的 private key 放哪？subagent 能不能用主 agent 的錢包？ | Lesson 35 沙箱 + Prod 55 credential |
  | receipt 怎麼進 audit trail？付款 metadata 會不會洩漏使用者資料？ | Prod 53 tracing + 缺口 1 PII |

  **六格裡沒有一格是 x402 SDK 的用法。** 這就是它值得放最後的理由：
  它不教新機制，它同時考六個舊機制。

- **最小實驗**（本地假的收費 API，不需要碰任何真的錢或鏈）：

  ```
  GET /report → 402，價格 $0.01
  1. 付款前檢查預算
  2. 簽付款
  3. server 已經收款
  4. response 在網路上遺失      ← 關鍵的一步
  5. agent 重試
  ```

  **看它會不會被扣兩次。** 這跟 Lesson 34 那個
  「寫入成功、journal 落地之前 crash」是**同一個窗口**，
  只是這次窗口的另一邊是錢。

  再加：價格被改、超過單次上限、不認識的 merchant、
  同一筆付款被 replay、付了錢但內容是錯的。

> **要教的是 agentic spending safety，不是 crypto SDK。**

### Lesson 52 · Fish Speech

- **來源**：[fishaudio/fish-speech](https://github.com/fishaudio/fish-speech)
  （`fish-speech/`，`e5e2926`，10,520 行 Python）
- **過不了主線篩選表的第 1、2 題**：沒有 agent loop，核心問題是 TTS。
  但它過得了 Prod 篇的條件：**「agent 已經會動了，現在要讓它講話」**。
  從它學到的是 audio tokenizer、RVQ codec、voice cloning、streaming TTS——
  **沒有一項會幫你理解 loop、tool calling、context、permission、memory、evaluation。**
- ⚠️ **這一課的問題必須是 agent 的問題，不是 TTS 的問題**，
  否則它會滑回「TTS 模型教學」。所以 Lesson 52 的主軸是**整合**：

  ```
  LLM 的串流文字要切多大一段才送去合成？
  使用者插話的時候，怎麼取消正在合成的那一段？
  已經合成好但還沒播出去的音訊，怎麼丟掉？
  agent 改口之後，怎麼確保不會播到舊答案？
  ```

  **這四題全部是 Lesson 3（串流與中斷）在音訊層的翻版**，
  跟 Fish Speech 的模型架構無關——換任何一個 TTS 都要回答同樣四題。

- **來源仍然是 Fish Speech，但只當成一個工具**：對 agent 來說，
  TTS 是一個有副作用的外部工具——

  ```ts
  speak({ text: "...", voice: "..." })
  ```

  對 agent 而言，那跟 Lesson 9 的 `send_email` 是同一類東西
  （外部副作用、收不回來、要批准），**而那一課已經教過了**。

- ⚠️ **另外有一個獨立於範圍的理由，而且更硬**：
  它用的是 **Fish Audio Research License**（`LICENSE:1`），
  不是 MIT / Apache。本系列是 MIT，**課程如果引用它的程式碼會有授權問題**，
  商業使用要逐條確認。這件事光看 README 看不出來，clone 下來才知道。

- **盤點結果留檔**（真要做 voice agent 時的入口，不用再找）：

  | 檔案 | 行數 | 是什麼 |
  |---|---|---|
  | `fish_speech/models/text2semantic/llama.py` | 1038 | 語音 language model 本體 |
  | `fish_speech/models/text2semantic/inference.py` | 966 | 生成迴圈 |
  | `fish_speech/models/dac/rvq.py` | 399 | RVQ codec：波形 → 離散 token |
  | `fish_speech/content_sequence.py` | 403 | `TextPart` / `VQPart` / `AudioPart` 混在同一條序列 |

  三個看過之後覺得**真的有意思、但仍然不該進主線**的東西：

  1. `rvq.py:208-236`：semantic codebook（1 個，4096 大小）跟
     residual codebooks（9 個，1024 大小）**是分開的**——
     這就是 Dual-AR 存在的結構原因，程式碼裡看得到
  2. `inference.py:117` 註解寫 `Apply constrained decoding: only allow
     semantic tokens + im_end`，而 `:165` 寫 `no constrain for fast codebooks`。
     **同一個生成過程，一條路徑約束、一條不約束**
  3. `inference.py:49` `RAS_WIN_SIZE = 10`——重複偵測的滑動視窗，
     防的是語音卡住 / 重複音節

  > 第 2 點跟 Lesson 12 的實測是同一件事的兩面：
  > **語法對不代表語意對。** 那次 schema 完全合法、`oneOf` 分支也選對，
  > 日期照樣填成 2024 年。constrained decoding 保證得了前者，保證不了後者。
  > 這句話值得寫進 Lesson 30，但**不需要為它讀一個 TTS 專案**。

---

## 對照 roadmap.sh 之後：缺的是窄縫，不是區塊

拿 [roadmap.sh 的 AI Agents roadmap](https://roadmap.sh/ai-agents) 逐項對過。
結論是**主線不缺能力**，而且在幾個地方比它深：
它列出「tool permissioning」「sandboxing」「evaluation」的名字，
我們是**把機制關掉、量它怎麼壞**。

它沒有展開、而我們有的：tool lifecycle、拒絕之後模型的行為、
snapshot 當完成證據、schema 相容、crash-safe resume、
冪等的副作用、action–observation、引用驗證、檢索迴歸。

**所以不要為了對齊那張圖去補課。** 對過之後真正缺的是四道窄縫，
按「做 agent 是不是普遍需要」排序：

### 缺口 1（最該補）：PII、secret 與資料邊界 → 併進 Lesson 31

我們有記憶注入防禦（15）、權限（8）、未來有沙箱（35），
但**沒有一課回答「不該外流的東西怎麼一路漏出去」**：

```
工具輸出裡有 API key        →  進了 context
本地檔案內容                →  送去雲端模型
完整 prompt                 →  寫進 trace
信用卡 / 病歷               →  寫進 memory，而且會被 recall
subagent                    →  收到它不該知道的 context
```

**最小實驗**（一條線，逐層看它在哪一層漏掉）：

```
read_file(".env") → tool result → context → trace → memory
```

> ⚠️ **這一課的重點不是 regex，是三條防線的位置不同**：
> **進入模型之前、進入 log 之前、進入 memory 之前，是三件事。**
> 只擋第一條，trace 和 memory 照樣把 secret 存成永久紀錄——
> 而 memory 那條最糟，因為 Lesson 15 已經證明**記憶會被 recall 回來**。

- **來源**：`mastra/packages/core/src/processors/processors/`
  （實際數過）`pii-detector.ts` **1023 行**、`system-prompt-scrubber.ts` 423 行
- **為什麼併進 31 而不是開新課**：Lesson 31 的主題本來就是
  「把 loop 裡的 if 搬到可插拔的 I/O 邊界」，而 PII 遮蔽**就是**那個邊界上
  最有說服力的例子。開新課會讓 31 少掉它最好的教材

⚠️ **兩份建議在這一條上打架，處置是按範圍拆開，不是二選一，也不是各寫一次**：

| | Lesson 31（主線） | Prod 57 |
|---|---|---|
| 教什麼 | **機制**：在 I/O 邊界上遮蔽 | **政策**：跨系統的資料邊界 |
| 範圍 | 一次呼叫的進出 | trace 保存多久、memory 能不能寫、subagent 看得到什麼、多使用者之間 |
| 為什麼分開 | 遮蔽是一支 processor，寫得完 | 「什麼**可以**跨過去」是產品決定，跟部署形狀有關 |

**同一件事在 31 是「怎麼做」，在 57 是「准不准」。** 兩課都不會重複另一課的內容。

### 缺口 2：Rate limit、provider 中斷與 retry → 拆進四課，不開新課

roadmap.sh 有列 error / rate-limit handling，我們的課散在各處但**沒有一條規則**。

**那條規則值得寫出來，因為它把新缺口直接接到已規劃的 Lesson 34**：

| 對象 | 能不能盲目 retry |
|---|---|
| 模型呼叫 | ✅ 可以 |
| 唯讀工具（read / search） | ✅ 可以 |
| **有外部副作用的工具** | ❌ **不行——這正是 Lesson 34 的題目** |

拆法：

| 問題 | 塞哪 |
|---|---|
| 串流到一半斷線，能不能重試 | Lesson 3 |
| 429 之後等多久、500 要不要重試、各家行為不同 | Lesson 30 |
| 重試已經產生副作用的工具 | **Lesson 34（本來就是這題）** |
| 換 fallback provider 之後，舊 session 還合不合法 | Prod 54 |

⚠️ 還有一個沒被列出來、但實際會咬人的：
**tool call 已經生成了才失敗，重試模型會不會產生第二個 call。**
那是 Lesson 34 的 journal 要處理的東西，不是重試次數的問題。

### 缺口 3：記憶的修正、過期與刪除 → Lesson 15 第二版

Lesson 15 解決「怎麼寫、怎麼取、怎麼不被注入」，**沒解決記憶會過時**：

```
Day 1  使用者住 Berlin
Day 2  使用者搬到 London
Day 3  問現在住哪
```

五種做法拿同一組 fixture 跑，**這題的好處是判定完全確定性**：

```
append-only recall     newer-wins        explicit supersession
confidence + 出處       tombstone 刪除
```

還要回答：兩條記憶衝突時信哪條、敏感記憶怎麼真的刪掉、
**摘要階段寫錯的東西會不會永久留著**（後者最像 Lesson 16 的 skill 污染）。

> 這比再教一次 episodic / semantic memory 的名詞有用得多。

### ~~⚠️ 比上面四個缺口更前面的：Lesson 18-19 還在主線上~~ ✅ 2026-07-30 補完

對照的時候差點漏掉這一條——**主線自己就有一個洞**。
「跑好幾個月」那一篇目前只有 15 記憶、16 skills、17 搜尋，
但那個篇名承諾的東西還缺兩個：

```
18  排程與無人值守執行     每天半夜三點自己跑，誰啟動它、失敗了怎麼辦
19  Subagent 與委派        把任務交出去，它看得到什麼
```

**它們比 x402、語音、vLLM 都更屬於主線**，因為它們回答的是
「這個 agent 怎麼在沒有人看著的時候繼續存在」——那正是 Hermes 篇的主題。

寫作順序有兩種取法，各有道理：

| 先寫 | 理由 |
|---|---|
| **18-19** | 學習完整性。Hermes 篇補完，「跑好幾個月」才名副其實 |
| **29** | 課程價值。它回答 Lesson 8 那個「模型謊報完成」的實測，是目前最有洞察力的一課 |

~~**建議：先 29，再回頭補 18-19。**~~
**29、18、19、28 都寫完了**（2026-07-30）。那個「怎麼可靠地中斷串流」的
設計問題也解掉了（讓串流自己在指定位置 abort，見 Lesson 28）。

**現在的下一個是 37**（action / observation），理由有三個：

1. 它把 28、29 的結論收斂成一個**資料結構**（`source: "environment"` 是
   型別上的硬性規定），三課合起來才是完整的「證據」那條支線
2. 成本低：`openhands/src/types/agent-server/core/events/` 是 707 行純型別，
   而且跟本系列同語言
3. 它有一個現成的反面教材（`action-event.ts:63` 的 `security_risk` 是
   **LLM 預測的**風險等級，跟 Lesson 8 的立場正面衝突），
   那個對照實驗不用另外設計

⚠️ 另外，Hermes 篇補完之後，**第 3 層（長期運行）不再有洞**，
所以剩下的選擇只有「證據」（37）和「邊界」（32-35）兩條支線。

### 缺口 4：OAuth 與 credential 生命週期 → Prod 55

原本 Lesson 11 拆掉時，token 生命週期只併了一半進 Lesson 12。
真的要接 Gmail / Slack / GitHub 時還缺：token 存哪、refresh token 誰能讀、
過期時工具回什麼、多使用者怎麼隔離、**agent 能不能把 credential 傳給 subagent**、
撤銷授權後舊 session 怎麼辦。

**不是所有 agent 的核心，所以放 Prod**，等真的做一個 connector 專案再寫。

### Lesson 29 的結論不要寫成只適用 coding agent ✅ 已照做

⚠️ 這是對照之後發現的一個**已規劃課程的設計錯誤**，先記了下來，
**寫課的時候照做了**：`lesson-29-evidence/README.md` 的「這一課長出來的原則」
那一節就是下面這段，`CompletionEvidence` 五種形狀原樣寫進去，
練習 4 專門要讀者做 `ExternalReceipt`（接 Lesson 9 的 `outbox/`）。

Lesson 29 用 snapshot / patch 當完成證據，那對 coding agent 成立。
但非 coding agent 的成果是 email、行事曆、報告、資料列、部署，
**那些沒有 filesystem diff**。所以那一課的結論要抽象成一層：

```ts
type CompletionEvidence =
  | FilePatch             // coding agent
  | ExternalReceipt       // 寄出去的信、付款收據
  | ResourceVersion       // 資料列的版本 / etag
  | QueryVerification     // 回頭查一次，確認世界真的變了
  | DeliveryConfirmation  // 對方收到了
```

> **主張不變：完成條件必須來自任務所在的環境。
> 變的只是「那個環境長什麼樣」。**
> Lesson 9 的 `send_email` 寫進 `outbox/` 其實已經是 `ExternalReceipt` 的雛形了。

### 明確**不補**的（roadmap.sh 有，我們刻意不做）

| 主題 | 為什麼不補 |
|---|---|
| Prompt engineering 篇 | 我們已經用更好的方式處理了：**prompt 改動 → 評估 → 多次真模型跑 → 確定性基礎設施**。可以在 Lesson 7 加一句「**prompt 是待評估的程式配置，不是魔法文字**」，不需要一整篇 prompting tips |
| ReAct / Tree-of-Thought / DAG / planner-executor 各寫一課 | 繼續用**問題**驅動，不要用**名詞**驅動：誰控制下一步、狀態可不可序列化、步驟能不能平行、失敗從哪裡恢復。Lesson 24 和 33 已經涵蓋其中最有用的 |
| Bias / toxicity | 除非領域是招聘、醫療、授信、評分、內容審核，否則放 evaluation 延伸 |

---

## 暫時**不立題**的東西

這幾個概念都重要，但現在立題會違反這個系列唯一有效的方法
（先在原始碼裡找到一條反覆出現、能實驗驗證的機制，再讓它長成課）：

| 概念 | 現在放哪 | 什麼時候才立題 |
|---|---|---|
| **Tracing / observability** | 先併進 Lesson 26 和 Mastra `core/src/observability/`（agent span / model span / tool span / 成本歸因 / parent-child / error recording） | 讀完 Mastra 那部分之後。對照組是 Phoenix（evaluation 導向）或 Langfuse（產品資料模型），但**不要讀 Langfuse 整個 server**，那會學到 ClickHouse + Next.js + queue，不是 agent。OpenLLMetry 規模比較適合讀 |
| **Model routing / fallback** | 拆回 Lesson 4（換 provider 續舊 session）、26（成本）、30（schema 相容） | 除非讀 Mastra 之後發現有一條夠完整、可抽出的 fallback 路徑。真正跟 agent 有關的只有「模型失敗後能不能換一家、舊 session 能不能續、`tool_use`/`tool_result` 還配不配得起來」，而這些已經散在那三課裡了。**不要變成比較 LLM gateway** |
| `ToolResult` 統一格式 | — | 自己設計一套 `ToolResult` 是典型的「我覺得應該要有 X」。等 Restate / OpenCode 兩邊都讀完，看它們的形狀有沒有交集 |
| Caching / computer use / replay UI | — | 同上 |

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
      > **不能拿來判斷 agent 好不好**，假 provider 每個案例都演同一套動作，
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
      **用 `bun run test`（已鎖定 `tests/`），不要用裸的 `bun test`**，
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

- [x] ~~**英文版**~~ ✅ 2026-07-28 **英文變成預設版本**
      原本是 `README.md`（中文，完整）+ `README.en.md`（英文，精簡）。
      現在是 `README.md`（**英文，第一眼看到的**）+
      `README.zh-TW.md`（中文，仍然比較完整）。`README.en.md` 已刪除。

      > 一個 repo 有兩份英文說明（一份完整一份精簡）保證會漂掉，
      > 而且漂掉的一定是沒人看的那份。

      連帶改了兩處：`lesson-01-agent-loop/README.md` 的錨點連結、
      `lesson-27-local-docs/ingest.ts:50` 的語料清單。

- [x] ~~**Lesson 6 的資料產生器可以更豐富**~~ ✅ 2026-07-28 完成
      加了 `sess_006`（同一段紀錄兩次事件）和 `sess_007`（6 秒的極慢傾倒），
      Lesson 7 也補上對應的兩個評估案例。

      **原本五題有一個共同的盲點**：全部是「單一、突發」事件，
      所以「照抄 `find_anomalies` 的候選視窗」這種偷懶做法永遠不會被扣分。
      `sess_007` 就是為此設計的，候選從 t=7060ms 才開始
      （門檻要 `pitch>30`），但傾倒 t=4000ms 就啟動了，**晚三秒**。

      實測（Gemini 3.6 Flash，兩次跑）：

      | 案例 | 第一次 | 第二次 |
      |---|---|---|
      | two-events | 93%（有提到前一次踉蹌） | 100% |
      | slow-tip | **83%，window 抄了候選的 7060.. → 沒有重疊** | 100%，自己往前找到起點 |

      > ⚠️ **slow-tip 兩次結果不同**，這不是「修好了」，是變異。
      > 這一題抓得到那個失敗，但**只是有時候**，而「有時候會照抄候選」
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
      硬逼壓縮，讀者看到的是「參數調很低」，不是「context 真的滿了」。

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
      `scripts/reset-playgrounds.ts`，原本那個只處理「agent 改了 save」
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
      合併之後會變成一個帶「現在是不是串流」分支的函式，
      那個 bug 只會更難找。

      > **重複 60 行機械轉換，換兩層各自簡單、各自好 debug，這筆划算。**

- [x] ~~**`ModelResponse.usage` 只有串流版有填**~~ ✅ 2026-07-28 修好
      這是我自己在 Lesson 26 弄出來的：把 `usage` 加進**共用**的
      `ModelResponse`，但只改了 `shared/streaming/openai.ts`。
      Lesson 1-2 用的非串流版永遠回 `undefined`，而且沒有任何訊息說為什麼。

      已補上（實測 OpenAI 非串流：`{"input":118,"output":400,"total":518}`），
      而且截斷路徑也帶了，串流版當初就是漏這條路徑漏了三課。

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

8. **產生文字的 agent，不能用自己的文字證明任務完成**
   完成條件必須來自任務所在的環境。這條是 Lesson 29 驗出來的：
   真 Gemini 在 patch 是空的情況下 3/3 宣稱「已為您重構 src/app.ts」。

   > 而且**不要把它寫成只適用 coding agent**。snapshot / patch 是
   > coding agent 的形狀，其他 agent 的證據是收據、資源版本、
   > 回頭查一次、對方收到了。**主張不變，變的是那個環境長什麼樣。**

   一個推論：tool result 也不是完成的證據。它記的是「這次呼叫做了什麼」，
   不是「這一輪結束之後世界變成什麼樣」（Lesson 29 的 `revert` 情境：
   兩次編輯都成功，working tree 沒有淨變化）。
