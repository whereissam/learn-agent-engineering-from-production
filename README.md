# 從零打造一個 AI Agent

> 給「會寫程式，但完全不知道 AI agent 怎麼運作」的人。
> 每一課都是一個能跑的小程式，不用框架，看得完、改得動。
>
> **本系列邊讀 [Pi](https://github.com/earendil-works/pi) 的原始碼邊寫。**

## 這是什麼

現在到處都在講 AI agent、Claude Code、Cursor、Devin。但你去看它們的原始碼，
動輒幾萬行，翻兩頁就放棄了。

其實 agent 的核心非常小。**小到大概 50 行**。剩下的幾萬行都是工程問題：
UI、session 管理、權限、錯誤處理、context 壓縮，重要，但那不是 agent 本身。

這系列課程把那 50 行單獨拿出來，讓你先看懂它，再一層一層加東西上去。

## 為什麼要學這個？大廠不是都做好了嗎

先講一個容易搞混的區別：

> **「會用 Claude Code / Codex」** 和 **「會開發 Agent 系統」** 是兩個不同層次。

Claude Code、Codex 已經把最底層、最通用的能力做好了：理解需求、讀寫檔案、
呼叫 terminal、修改程式碼、跑測試。你通常不需要自己重造一個 coding agent，
也不需要從零實作 tool calling、ReAct loop 或聊天介面。

**但大廠做好的是一個「通用型執行者」。** 它不知道你的公司怎麼運作、
不知道你的產品有哪些特殊規則，也不知道什麼時候該停、什麼操作風險太高、
產出怎樣才算真的正確。

舉例：你讓 Claude Code 幫你開發一個機器人 observability 產品。
它可以寫程式，但下面這些還是要由**你**設計：

- 它如何知道 telemetry 每個欄位的含義？
- 它怎麼判斷一次跌倒偵測是真事故，還是 sensor noise？
- 哪些程式碼可以自動改，哪些涉及機器人控制與安全設定，必須人工批准？
- 改完要跑哪些模擬、測試、replay 才算成功？
- 測試失敗時，是重試、換方案，還是停下來升級給人？
- 長任務 context 被壓縮之後，怎麼不忘記前面做過什麼？
- 怎麼衡量 agent 真的幫你省時間，而不是製造更多 review 工作？

這些模型都替你決定不了。

### 一個類比

> Claude Code 是一個很聰明的新工程師。
> Agent 開發是設計公司的 SOP、權限制度、CI、測試環境和審查流程。

就算新工程師很強，你也不會直接給他 production root access，
然後只說一句「把產品做好」。

真正難的往往不是 agent 本身，而是它周圍的 **Harness**：
guides、sensors、測試、權限、沙箱、回饋迴路與退出條件。
模型負責提出和執行行動，Harness 負責讓它不容易走錯、做完能被驗證、
失敗時能修正。

### 什麼情況下「不需要」特別學

如果你的目標只是：幫自己寫程式、重構幾個檔案、解釋 codebase、
寫單元測試、修一般 CI 錯誤、一次性的資料整理，

那學好 Claude Code / Codex 的使用方式，加上 `AGENTS.md`、Skills、MCP
和基本 CI，可能就夠了。沒必要一開始就學 LangGraph、multi-agent
orchestration 或自己寫 agent runtime。

很多人所謂的「Agent 開發」，其實只是把一個 LLM 包進 while loop 再加幾個
tools。這種東西學習價值有限，因為基礎平台確實做得比大多數個人開發者更好。

### 什麼時候「真的需要」學

**當你要把 agent 放進自己的產品，而不只是拿它來寫產品的時候。**

例如一個 Incident Agent：

```text
接收 session telemetry
→ 找出異常時間段
→ 讀取事件前後影片
→ 比較 joint、IMU、command 資料
→ 推測跌倒或碰撞原因
→ 產生 investigation report
→ 建議下一個檢查步驟
```

這裡模型只負責部分推理。真正的產品價值來自：

```text
資料契約        事件時間對齊      可靠的工具
領域上下文      權限邊界          評估資料集
回放驗證        人工審批          可觀測性
```

這就是 Agent Engineering。

### 該學的四層，以及這個系列涵蓋哪些

| 層 | 內容 | 這系列 |
|---|---|---|
| **1. 單 agent 機制** | model → tool call → tool result → 下一步 → stop。context、tool schema、structured output、memory、retry 的基本原理 | ✅ Lesson 1-5 |
| **2. Harness Engineering** | Guides（`AGENTS.md`、架構文件、Skills、任務規格）+ Sensors（typecheck、lint、tests、simulation、AI review、production telemetry） | ✅ Lesson 2、5、7 |
| **3. Domain tools** | agent 的能力上限取決於它能操作什麼，而不是 prompt 多漂亮 | ✅ Lesson 6 |
| **4. Evaluation** | 固定測試案例 + 評分標準。不會 evaluation，就不知道換模型、改 prompt 之後到底有沒有變好 | ✅ Lesson 7 |

第 1 層你**理解即可，不必重造**，但出錯時你要知道問題在哪。

第 3、4 層才是護城河，所以這系列**不會只叫你「自己想辦法」**，
而是帶你完整做一遍：Lesson 6 從零設計一組領域工具，
Lesson 7 建立評估集並跑完「量測 → 發現問題 → 修 → 確認沒退步」的閉環。

領域工具長這樣，不是 `read_file` / `write_file`：

```text
get_session()         query_telemetry()      find_anomalies()
compare_sessions()    get_video_frame()      create_incident_report()
```

工具如果輸出混亂、錯誤不可理解、沒有 deterministic ID，
再好的模型也會很不穩定。**Lesson 6 會讓你親手把好工具改成爛工具，
看差別有多大。**

第 4 層最容易被忽略，也最能區分 demo 和產品。Lesson 7 的五個案例：

```text
Case 1：真正跌倒                    測「抓得到嗎」
Case 2：快速蹲下但沒有跌倒          測「會不會假警報」
Case 3：外力碰撞                    測「分得出成因嗎」
Case 4：telemetry 缺失              測「知不知道自己不知道」
Case 5：影片和 telemetry 時鐘偏移   測「有沒有察覺陷阱」
```

評分是**確定性的**（不是用 LLM 當裁判）：是否找到正確時間段？
分類正確嗎？引用的數字在真實資料裡存在嗎？有沒有做出危險的誤判？

> Lesson 7 有一段實測記錄：第一次跑是 3/5 通過（91%），評估抓到
> 「agent 沒有回報影片時鐘偏移」這個我自己沒注意到的漏洞。
> 修完 prompt 之後 5/5（98%），而且 `--compare` 確認其他案例沒被改壞。

### 所以結論是

不是「大廠都做好了所以不用學」，而是：

> **大廠已經做好通用 agent，所以你更不需要學著重造底層；
> 但你仍然需要學如何設計領域工具、Harness、評估和安全邊界。**

未來稀缺的能力，很可能不是「誰能寫出一個 tool-calling loop」，
而是「誰能把不可靠的通用 agent，放進一個可靠的真實系統」。

### 建議的實際做法

你可以繼續把 Claude Code / Codex 當成現成的 agent runtime，
不需要急著選 Mastra、LangGraph、Hermes 或 OpenWorker。

先在自己的 repo 建立這些：

```text
AGENTS.md
docs/architecture/
docs/runbooks/
scripts/verify
scripts/replay-session
tests/fixtures/incidents/
```

然後要求 coding agent 完成任務時，必須自己走完：

```text
讀規格 → 寫 plan → 修改 → 跑 verify → 根據錯誤修正 → 輸出證據
```

**這一層現在就能練，不需要先做一個獨立的 agent app。**

等你開始遇到現有 coding agent 處理不了的需求（定時執行、事件觸發、
多使用者隔離、長期任務狀態、人工審批、跨系統工具編排），
再去學 framework。那時你會非常清楚自己為什麼需要它，
而不是為了「做 Agent」而做 Agent。

### 那這個系列的定位是什麼

Lesson 1-5 讓你**看懂第 1 層**，Lesson 6-7 讓你**真的做過第 3、4 層**。

理解 loop 的內部之後，你在用 Claude Code 時就不再是在拜託一個黑盒子。
你會知道：為什麼它突然忘記前面講過的事（context 被壓縮了）、
為什麼它一直重試同一個失敗的操作（錯誤訊息沒寫清楚）、
為什麼它讀了一半的檔案就開始亂猜（輸出被截斷了）。

**這些都是這個系列會親手做過一次的東西。**

## 為什麼是跟 Pi 學

[Pi](https://github.com/earendil-works/pi)（by [badlogic](https://github.com/badlogic)）
是一個把 agent runtime 拆得特別乾淨的開源專案。它刻意分成幾個獨立的層：

```
packages/ai            provider 抽象（統一 OpenAI / Anthropic / Google）
packages/agent         agent loop + harness（session、壓縮、工具）
packages/coding-agent  真正可用的 coding agent CLI
packages/tui           終端 UI
```

這種拆法對學習非常好，你可以清楚看到「agent 本身」跟「周圍的工程」
在哪裡分界。整個核心迴圈就在 `packages/agent/src/agent-loop.ts` 的
第 170–272 行，大約 100 行。

**每一課的結尾都有一張「對照 Pi 原始碼」表**，標出這一課的概念對應到
Pi 的哪個檔案、哪一行。讀完之後，你有能力直接去讀那份 production code，
那才是這系列真正的目標。

## 先講結論：agent 到底是什麼

一句話：

> **Agent = 一個 while 迴圈。裡面反覆做「問模型 → 模型說它想用某個工具 → 你執行那個工具 → 把結果餵回去」，直到模型不再要求用工具為止。**

就這樣。沒有魔法。

畫成圖：

```
使用者：「這個專案為什麼會有 bug？」
        ↓
   ┌──────────────────────────────────┐
   │  呼叫 LLM（附上可用工具清單）      │
   └──────────────────────────────────┘
        ↓
   模型回：「我想呼叫 read_file('README.md')」
        ↓
   ┌──────────────────────────────────┐
   │  你的程式碼真的去讀那個檔案        │  ← 模型不能碰檔案，只能「請你幫忙」
   └──────────────────────────────────┘
        ↓
   把檔案內容當成「工具結果」加進對話
        ↓
   ┌──────────────────────────────────┐
   │  再次呼叫 LLM（帶著完整對話歷史）  │
   └──────────────────────────────────┘
        ↓
   模型回：「我想呼叫 read_file('src/store.ts')」
        ↓
        ... 重複 ...
        ↓
   模型回：「找到了，bug 在 store.ts 第 24 行，因為……」← 沒有工具呼叫了
        ↓
      迴圈結束
```

最違反直覺、也最關鍵的一點：

**模型本身什麼都不能做。** 它不能讀檔、不能上網、不能執行指令。
它唯一能做的事情是「輸出文字」。所謂的「呼叫工具」，只是模型輸出一段
結構化的文字說「我想要呼叫 read_file，參數是這個」，然後**你的程式**
去執行它，再把結果當成新的對話內容送回去。

Agent 之所以看起來很強，是因為這個迴圈可以跑很多輪，而模型每一輪都能
根據新拿到的資訊決定下一步。

## 課程規劃

| 課 | 主題 | 你會學到 |
|---|------|---------|
| **[01](lesson-01-agent-loop/)** | 最小的 agent loop | tool calling、對話歷史、provider 抽象 |
| **[02](lesson-02-tools/)** | 更多工具 | write / edit / bash、輸出截斷、危險操作的批准機制 |
| **[03](lesson-03-streaming/)** | Streaming 與中斷 | 逐字輸出、Ctrl+C 中斷、中斷後的狀態修復 |
| **[04](lesson-04-sessions/)** | Session 持久化 | 存檔、續跑、為什麼 session 是「樹」不是陣列 |
| **[05](lesson-05-compaction/)** | Context 壓縮 | 對話太長怎麼辦、compaction 的取捨 |
| **[06](lesson-06-domain-tools/)** | 領域工具 | 第 3 層。把通用 agent 變成你領域的專用系統 |
| **[07](lesson-07-evaluation/)** | Evaluation | 第 4 層。量測 → 發現問題 → 修 → 確認沒退步 |

**OpenWorker 篇**（第 2 層的產品化）

| 課 | 主題 | 你會學到 |
|---|------|---------|
| **[08](lesson-08-permissions/)** | 風險分級與權限引擎 | 從 boolean 到四級風險、模式、為什麼 AUTO 也擋不住路徑逃逸 |
| **[09](lesson-09-unattended/)** | 沒人在場的時候 | 無人值守批准、inbox 佇列、agent 暫停與喚醒 |

每一課的 `agent.ts` 都是完整、可獨立閱讀的。共用的基礎設施放在 `shared/`：

```
shared/
  providers/     LLM provider 抽象（Lesson 1-2）
  streaming/     加上串流的版本（Lesson 3-5）
  tools/         工具：read/write/edit/bash/list + 截斷 + 註冊表
  session/       JSONL 持久化與 session 樹
  compaction.ts  context 壓縮
  repl.ts        能正確處理管線輸入的行讀取器

lesson-06-domain-tools/
  data/          合成的機器人 telemetry（固定 seed，可重現）
  tools/         領域工具：telemetry 查詢、異常掃描、事故報告

lesson-07-evaluation/
  cases.ts       五個評估案例與各自的期望
  rubric.ts      確定性的評分標準
  eval.ts        執行器（支援 --save / --compare 做回歸測試）

shared/permissions/  風險分級與權限引擎（Lesson 8）
shared/inbox/        無人值守批准佇列（Lesson 9）
```

Lesson 1-5 是「怎麼造引擎」，Lesson 6-7 是「怎麼讓引擎在你的領域裡真的有用」。
**如果你已經懂 agent loop，可以直接跳到 Lesson 6**，那才是大部分人真正缺的部分。

**其他情況建議照順序讀**，因為每一課都建立在前一課上。
每一課的 README 都會標出前置。

### 一件值得注意的事

從 Lesson 1 到 Lesson 9，那個核心 while 迴圈**基本上沒有變過**。
Lesson 6 換了一整組領域工具，`runTurn` 依然一行都沒改。
變的都是它周圍的東西。這是整個系列最想讓你記住的：

> **Agent 的本質很小。周圍的工程很大。**

## 環境需求

擇一即可：

- **[Bun](https://bun.sh) 1.3 以上**（推薦，可以直接跑 `.ts`，也會自動讀 `.env`）
- 或 **Node.js 22 以上**

再加上一把 API key，或者**完全不用 key**（見下面的 fake provider）。

## 安裝

```bash
git clone <這個 repo>
cd agent-lessons

bun install      # 或 npm install
```

## API key 放哪裡

**建議放 `.env`**（已在 `.gitignore` 裡，不會被 commit）：

```bash
cp .env.example .env
```

然後編輯 `.env`，填入你有的那一把：

```bash
GEMINI_API_KEY=AIza...
# ANTHROPIC_API_KEY=sk-ant-...
# OPENAI_API_KEY=sk-...
```

三家只需要填**一家**。都填的話會照 `anthropic → openai → gemini` 的順序
自動選，或用 `PROVIDER` 明確指定。

> 讀取原理：Bun 會自己讀 `.env`；Node 走 `process.loadEnvFile()`（Node 20.12+
> 內建，不需要 `dotenv` 套件）。程式碼在 `lesson-01-agent-loop/providers/index.ts` 開頭。

也可以不用 `.env`，直接 export 環境變數，已經設在環境裡的值優先，
`.env` 不會覆蓋它：

```bash
export GEMINI_API_KEY=AIza...
```

### 去哪裡申請

| Provider | 申請網址 | 備註 |
|---|---|---|
| **Gemini** | <https://aistudio.google.com/apikey> | 有免費額度，最好上手 |
| **Anthropic (Claude)** | <https://console.anthropic.com/> | |
| **OpenAI** | <https://platform.openai.com/> | |

### 完全不用 key：fake provider

還沒申請 key，或者不想花錢，也能跑：

```bash
PROVIDER=fake bun run lesson-01
```

`fake` 是一個照腳本回應的假模型。它不會真的思考，但**整個 agent loop
是完全真實的**，真的呼叫工具、真的讀檔案、真的處理錯誤。用它配 debugger
單步走一遍，是理解 loop 最快的方法。

（順帶一提：真正的 agent 專案都需要這種假 provider 來寫測試，否則每跑一次
測試就要付錢，而且結果不可重現。）

### 換 model

預設的 model id 如果你的帳號沒權限（會看到 404 / model not found），
用 `MODEL` 覆寫：

```bash
MODEL=gemini-3.5-flash-lite bun run lesson-01   # 最便宜最快
MODEL=claude-sonnet-5 bun run lesson-01
MODEL=gpt-5-mini bun run lesson-01
```

也可以強制指定 provider：

```bash
PROVIDER=gemini bun run lesson-01
```

## 開始

```bash
bun run lesson-01     # 或 lesson-02 … lesson-09
```

用 Node 的話：`npm run lesson-01-agent-loop:node`（走 tsx）。

然後讀 [lesson-01-agent-loop/README.md](lesson-01-agent-loop/)。

### playground 被改壞了？

Lesson 2 之後 agent 會真的改 `playground/` 裡的檔案。恢復成原本的
（有 bug 的）狀態：

```bash
bun run reset
```

## 花費提醒

Lesson 1 的每次對話大概讀 3-5 個小檔案，成本很低（通常不到 US$0.05）。
但要注意：**agent 的 token 用量會隨對話變長而快速增加**，因為每一輪都要
把完整的對話歷史重新送給模型。這一課的 Lesson 5 會處理這個問題。

想省錢就用便宜的 model，或直接用 `PROVIDER=fake`。

## 後續系列（規劃中）

這七課學的是 **怎麼造一顆 agent engine，並且讓它在你自己的領域裡可靠**。
但還有兩個方向沒碰到。這三個專案不在同一個抽象層級：

> **Pi 是 agent runtime／harness；OpenWorker 是桌面 AI coworker 產品；
> Hermes 是長期運行的 personal agent platform。**

| 系列 | 專案 | 學什麼 | 狀態 |
|---|---|---|---|
| **Lesson 1-7** | [earendil-works/pi](https://github.com/earendil-works/pi) | 怎麼造一顆 agent engine，並用在你自己的領域 | ✅ 完成 |
| **Lesson 8-9** | [andrewyng/openworker](https://github.com/andrewyng/openworker) | 權限引擎、無人值守批准 | ✅ 完成 |
| Lesson 10-14 | 同上 | GUI 通訊、OAuth/connector、MCP client、排程、audit | 待寫 |
| Lesson 15-19 | [nousresearch/hermes-agent](https://github.com/nousresearch/hermes-agent) | 長期記憶、skills 與自我改進、跨 session 搜尋、委派 | 待寫 |

完整規劃（含每一課要讀哪些檔案、以及明確**不寫**哪些部分）在
[docs/TODO.md](docs/TODO.md)。
| **Hermes 篇** | [nousresearch/hermes-agent](https://github.com/nousresearch/hermes-agent) | 怎麼讓 engine 長期存活、記憶、學習 | 規劃中 |

對照上面「該學的四層」：本系列涵蓋第 1 層（Lesson 1-5）到第 3、4 層
（Lesson 6-7）。OpenWorker 篇偏第 2 層加產品工程，
Hermes 篇則是第 2 層的長期運行版本。

### OpenWorker 篇會學

把 agent 接進真實世界的產品工程：

- OAuth 與 connector token 管理（Gmail、Calendar、Slack、Notion…）
- MCP client 怎麼進產品
- GUI 與 agent server 之間怎麼通訊
- approval gate 的產品化（本系列 Lesson 2 是它的最小版本）
- 無人值守的自動化遇到「需要批准」時怎麼暫停
- 產出使用者能直接打開的 artifact（文件、試算表、報告）
- macOS / Windows 打包、自動更新

### Hermes 篇會學

把 agent 從「單次回答問題」變成常駐系統：

- long-term memory 與 user modeling
- procedural skills（agent 自己累積能力）
- cross-session 搜尋
- cron 排程
- messaging gateway（Telegram / Slack / Discord…）
- isolated subagents
- 遠端執行 backend（Docker / SSH / Modal…）

> ⚠️ Hermes 那套「自我改進」（agent 自動建立或修改 skill）要特別小心：
> 錯誤經驗會被永久保存、skill 會污染、prompt injection 會持久化、
> 行為會逐漸漂移，而且很難重現與測試。比較穩妥的起點是
> 「agent 提議 → 人類審核 → 版本化保存 → 測試通過才啟用」。

### 為什麼是這個順序

先 Pi，因為你需要先掌握最小核心：`Message` / `Tool` / `ToolCall` /
`ToolResult` / `AgentLoop` / `Session` / `Context` / `Approval` /
`ExecutionEnvironment`。

Hermes 放最後，不是因為它比較難，而是因為它**太完整**，一打開就同時看到
memory、skills、gateway、cron、TUI、voice、subagents、sandbox backends。
很容易學成「怎麼配置 Hermes」，而沒真正理解為什麼需要 agent loop、
tool result 怎麼重新進入 context、狀態機怎麼設計。

**它適合當第二或第三個 agent codebase，不適合當第一個。**

## 還沒寫完的部分

規劃中的課程、現有課程的缺口、以及開源前的檢查清單，
都在 **[docs/TODO.md](docs/TODO.md)**。

想貢獻的話那份文件是最好的起點，它也記錄了寫新課程時該遵守的設計原則。

## 致謝

架構、命名和很多設計取捨都是從 [Pi](https://github.com/earendil-works/pi)
（by [badlogic](https://github.com/badlogic)）學來的。

授權：MIT
