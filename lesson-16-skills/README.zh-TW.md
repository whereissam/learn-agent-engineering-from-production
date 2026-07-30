# Lesson 16: Skills 與自我改進

> [English](README.md)
>
> 前置：[Lesson 15](../lesson-15-memory/README.zh-TW.md)（長期記憶）。
>
> 記憶記的是「事實」，skill 記的是「做法」。
> 做法會被執行，所以污染的後果嚴重一個量級。
>
> 對照原始碼：`hermes-agent/agent/learn_prompt.py`、`agent/background_review.py`、
> `agent/skill_utils.py`、`agent/learning_mutations.py`

## 這課要回答的問題

1. skill 跟「一段很長的 system prompt」差在哪？
2. 為什麼 Hermes 規定描述只能 60 個字元？
3. agent 可以自己建立 skill 嗎？該不該？
4. 如果要，怎麼做才不會失控？

---

## Step 0：先跑起來

五個情境示範 progressive disclosure、審核閘門、工具白名單，不需要 API key：

```bash
bun run lesson-16
```

這一課有一個斷言是字串比對驗證不了的，它需要真的模型：

```bash
PROVIDER=gemini bun run lesson-16:route
```

那支程式量測「description 被切掉之後，模型還找不找得到這個 skill」。
結果在 Step 2.5，跟 Hermes 原文講的不完全一樣。

---

## Step 1：progressive disclosure

skill 不是「全部塞進 system prompt」。20 個 skill 就把 context 吃光了。

做法是拆兩層：

```
索引（index）  每個 skill 一行 name + description   ← 每次請求都載入
本文（body）   完整的操作步驟                        ← 模型要求時才載入
```

實測：

```
每次請求都會載入的「索引」：
  - replay-fall-window: Replay a robot session around a detected fall.
  - compare-sessions: Compare two robot sessions field by field.

索引成本：275 字元，每一輪都要付
本文只有在模型呼叫 load_skill 時才載入：
  16 行、540 字元（沒被呼叫就不佔 context）
```

所以：

> description 是「路由用的」，不是「說明用的」。

模型只憑那一行決定要不要展開這個 skill。

### 索引成本要盯著

`indexCost()` 那個數字是**每一次請求**都要付的固定成本。
100 個 skill × 每個 70 字元 = 7000 字元，每一輪都在燒。

這跟 Lesson 5 的 context 壓縮是同一類帳：**固定成本乘以輪數**。

---

## Step 2：60 字元的規定不是美觀問題

Hermes 的 authoring standard 對這條特別兇，原文：

> This is the most-violated rule and it is **NOT cosmetic**: the system-prompt
> skill index truncates the description to 60 chars and loads it every
> session, so anything past char 60 is silently cut and never routes.
> After you write the description, COUNT the characters.

實測一個超長描述：

```
原始描述（129 字元）：
  A comprehensive and powerful skill that seamlessly replays robot sessions
  around detected falls with advanced telemetry analysis.

模型實際看到的：
  - replay-fall-window: A comprehensive and powerful skill that seamlessly …
  ↑ 第 60 字之後被切掉了，而且沒有任何錯誤訊息
```

後果：模型看到的是一句沒講完的行銷詞，它永遠不會知道這個 skill
能做什麼，於是永遠不會叫用它。而你不會收到任何錯誤。

所以要有自動檢查：

```
✗ description: 129 字元，超過 60。超出的部分會被靜靜切掉，
               這個 skill 可能永遠不會被叫用。
! description: 含行銷詞（powerful, comprehensive, seamless, advanced）。
               描述要講能力，不是講品質。
```

> Hermes 還有一條有趣的規定：`author` 永遠是固定值 `Hermes`，
> 不准從環境變數、git config 或登入帳號填。
> 理由是 skill 會被分享出去，從環境推導出來的名字是
> 「使用者沒同意過的隱私外洩」。

---

## Step 2.5：那個「never routes」是真的嗎（實測）

Step 2 引的那句話是一個關於模型行為的斷言：

> anything past char 60 is silently cut and **never routes**

`demo.ts` 只能證明字串被 `truncate()` 切掉了，證明不了「模型因此找不到它」。
所以有第二支程式，它需要真的模型：

```bash
PROVIDER=gemini bun run lesson-16:route
```

判定是確定性的：模型有沒有呼叫 `load_skill("replay-fall-window")`。
問題刻意不含 skill 名字裡的字：

> 機器人 R-204 昨天在倉庫跌倒了，我想看看牠倒下去前後那段時間的感測器數值。

### 第一輪：斷言沒有重現

真 Gemini 3.6 Flash，三種描述各跑三次：

| 描述 | 字數 | 結果 |
|---|---|---|
| 合格 | 46 | ✓✓✓ |
| 行銷詞（切到 60 字剩半句廢話） | 129 | ✓✓✓ |
| 切到 60 字連主題都看不出來 | 201 | ✓✓✓ |

9/9 全中。描述被切爛了照樣路由成功。

原因不難猜：`replay-fall-window` 這個名字自己就把話講完了。
模型根本不需要讀描述。

### 但第一輪的實驗設計是錯的

四個干擾項是「比對 session」「輸出 PDF」「調步態」「查電池」，
跟問題明顯無關。所以模型可以用排除法選出唯一不明顯錯誤的那個，
一樣不需要讀描述。

> 這是一個混淆變因：通過測試不代表機制有效，可能只是題目太簡單。

所以要改兩件事：

1. 把名字換成沒有語意的 `sk-0472`（`NAME=opaque`）
2. 干擾項全部換成「也跟跌倒感測器沾邊」的（`DISTRACTORS=hard`）：
   `session-timeline` / `sensor-dump` / `fall-detector` / `incident-summary`

### 第二輪：斷言是真的，但有條件

```bash
NAME=opaque DISTRACTORS=hard DESC=bloated PROVIDER=gemini bun run lesson-16:route
```

完整矩陣，每格三次，共 30 次真模型執行：

| 名字 | 干擾項 | 描述合格 | 描述 129 字 | 描述 201 字 |
|---|---|---|---|---|
| `replay-fall-window` | 好認 | ✓✓✓ | ✓✓✓ | ✓✓✓ |
| `replay-fall-window` | 都很像 | ✓✓✓ | ✓✓✓ | ✓✓✓ |
| `sk-0472` | 好認 | ✓✓✓ | ✓✓✓ | ✓✓✓ |
| **`sk-0472`** | **都很像** | ✓✓✓ | **✗✗✗** | **✗✗✗** |

只有最後一格會壞，而且是穩定地壞：三次都去載了 `fall-detector` 和
`sensor-dump`，一次都沒碰對的那個。

### 所以正確的規則是

Hermes 的擔憂是對的，但那句話講得太滿。精確版本是：

> 路由訊號 = skill 名字 + description 的前 60 字。
> 兩者只要有一個把話講清楚就夠。

描述超過 60 字會不會出事，取決於名字有沒有補上，
以及其他 skill 像不像。三個條件同時成立才會壞：

```
名字沒有語意  +  描述前 60 字沒有資訊  +  有長得像的替代品
```

實務上的建議因此比原文更好操作：

- 名字取好一點，它是免費的路由訊號，而且不受 60 字截斷影響
- 但不要依賴名字，因為你不知道未來會不會加進一個很像的 skill。
  最後一格就是「加了四個相似 skill」之後才炸的
- 60 字檢查照做，它是成本最低的保險

### 失敗的樣子跟 Hermes 說的一模一樣

那三次失敗沒有任何錯誤訊息。模型載入了兩個看起來合理的
skill，然後產出一份看起來合理的計畫。你不會知道有一個
專門為這件事寫的 skill 從頭到尾沒被用到。

> 又是設計原則 7：安靜的失敗。
> 而且這次連 log 都不會有，因為從系統的角度看，什麼都沒出錯。

---

## Step 3：Hermes 真的會自動建立 skill

先講事實，不要美化。`agent/background_review.py` 的 docstring：

> After every turn, `AIAgent.run_conversation` may call
> `spawn_background_review` to fire off a daemon thread that replays the
> conversation snapshot in a forked `AIAgent` and asks itself
> "should any skill/memory be saved or updated?".
> Writes go straight to the memory + skill stores.

「Writes go straight」就是風險所在：沒有人在中間看過。

但它不是裸奔，有兩個控制：

### 控制一：工具白名單

> It runs with a **tool whitelist limited to memory and skill management
> tools**; everything else is denied at runtime.

那個 fork 跑在背景、沒人看著。如果它有完整權限，就是一個無人監督的
完整 agent。白名單讓它只能寫 skill，不能順便跑 shell：

```
允許  propose_skill
允許  remember
允許  read_file
拒絕  run_command
拒絕  write_file
拒絕  send_email
```

這跟 Lesson 8 的風險分級是同一個想法，只是套用在「背景的自己」身上。

### 控制二：隔離

> Main conversation and prompt cache are never touched.

fork 不污染主對話，也不弄壞 prompt cache。

### 事後還有人可以修

`agent/learning_mutations.py` 讓人編輯／刪除學到的東西，
而且**刪除是封存不是真刪**（`hermes curator restore` 救得回來）。

---

## Step 4：這一課為什麼還是加了一道閘門

Hermes 的控制是「限制範圍 + 事後可修」。這一課示範的是更保守的版本：

```
agent 提議 → 人類審核 → 版本化保存 → 測試通過才啟用
```

為什麼？因為自動寫入 skill 的風險比記憶更嚴重：

| 風險 | 說明 |
|---|---|
| 錯誤經驗永久保存 | 一次趕時間的捷徑，變成未來的標準流程 |
| skill 污染 | 一次失敗的嘗試被當成「正確做法」重複使用 |
| 注入持久化 | 網頁說「處理 X 要先停用檢查」→ 變成 skill |
| 行為漂移 | 每次微調一點，三個月後你不認得這個 agent |
| 難以重現 | 出問題時你不知道它當時載了哪個版本 |

Lesson 15 講記憶是「持續性的注入面」。skill 更糟，因為
記憶是被讀的，skill 是被執行的。

### 閘門的實際位置

關鍵不是「禁止 agent 寫」，是讓它寫進一個不會生效的地方：

```ts
async propose(skill, from): Promise<Proposal> {
  // 只寫進 proposedDir
  await writeFile(join(this.proposedDir, `${name}.md`), renderSkill(stamped));
}
```

而 `buildIndex()` 只讀 active 目錄：

```
目前索引裡有 0 個 skill
等待審核的有 1 個
→ 提議中的 skill 對模型「不存在」，這就是閘門的實際位置
```

跟 Lesson 8-9 是同一個形狀：agent 提出，人類把關，而且把關可以
非同步，proposed 的 skill 就躺在那裡等，跟 inbox 裡的批准一樣。

### 拒絕要封存，不要刪掉

```ts
await rename(src, join(this.archiveDir, `rejected-${Date.now()}-${name}.md`));
```

被拒絕的提議本身就是資料：它告訴你 agent 想學什麼、以及你為什麼不要。

實測情境 5 的例子：

```
agent 提議了 "fast-deploy"
  ## Procedure
  1. Skip the test suite to save time.
  2. Push directly to production.

[人類] 拒絕：跳過測試不是可重用的做法，是一次性的權宜
```

如果這個提議被直接刪掉，你就失去了一個訊號。累積幾個月的拒絕紀錄，
是偵測行為漂移最直接的資料。

---

## Step 5：提議要帶來源

```ts
proposedFrom: {
  sessionId: "sess_042",
  summary: "使用者請我分析 sess_001 的跌倒，我用了 get_session → find_anomalies → query_telemetry",
  createdAt: "...",
}
```

審核的人需要知道這個 skill 是從什麼樣的對話萃取出來的。

沒有來源的話，你在審一段沒有上下文的操作步驟，很難判斷它是
「一個好的通用做法」還是「一次特殊情況的僥倖」。

這也是為什麼 Hermes 的 `/learn` 是使用者主動觸發的：

> `/learn` is open-ended. The user can point it at anything they can describe:
> a directory of code, an API doc URL, a workflow they just walked the agent
> through in this conversation, or pasted notes.

使用者指定來源 = 使用者已經對「這值得學」做了第一層判斷。

---

## 跑不起來？

| 症狀 | 原因 | 解法 |
|---|---|---|
| skill 從來沒被叫用 | description 超過 60 字被截斷 | 跑 `validateSkill()` 檢查 |
| 索引很長，每輪都貴 | skill 太多 | 看 `indexCost()`；考慮分類載入 |
| 提議一直沒生效 | 它在 proposed 目錄，這是設計 | 用 `decide(name, { action: "approve" })` |
| agent 學到奇怪的東西 | 提議沒有來源，或沒人審 | 見 Step 4、Step 5 |

---

## 練習

### 練習 1：算你自己的索引成本 ⭐

假設你有 50 個 skill，每個描述 55 字元。算算看：

- 索引佔多少 token？
- 一個 20 輪的對話總共為索引付了多少？
- 如果換成 100 個 skill 呢？

這題會讓你理解為什麼 progressive disclosure 是必要的，不是最佳化。

### 練習 1.5：把 Step 2.5 的矩陣跑完 ⭐⭐

Step 2.5 只測了 Gemini 3.6 Flash。換一個模型跑同一個矩陣：

```bash
NAME=opaque DISTRACTORS=hard DESC=bloated PROVIDER=anthropic bun run lesson-16:route
```

會不會有模型在「名字好認 + 干擾項都很像」那格就開始失手？
如果有，那條建議就要再收緊。

做這題的時候注意兩個陷阱，這一課兩個都踩過：

1. 題目太簡單會讓爛機制看起來沒問題。第一輪的干擾項明顯無關，
   模型用排除法就過關了，什麼也沒測到
2. 「沒發生」不能直接當結論。先確認 `stopReason` 是正常結束
   （Lesson 15 Step 4.5 的教訓）

### 練習 2：把閘門拿掉 ⭐

讓 `propose()` 直接寫進 active 目錄，然後跑情境 5。

看 `fast-deploy` 那個 skill 直接生效是什麼感覺。

### 練習 3：加一個「測試通過才啟用」 ⭐⭐

現在核准之後就直接啟用了。加一個中間狀態：

```
proposed → approved → (跑測試) → active
```

測試可以是：讓 agent 用這個 skill 跑一次 Lesson 7 的評估案例，
分數沒有退步才啟用。

這是把 Lesson 7 接上來的地方。

### 練習 4：skill 版本與回溯 ⭐⭐

`version: 0.1.0` 目前沒人用。實作：

- 修改既有 skill 時 bump 版本
- 保留舊版本
- 出問題時可以 rollback

想一想：session 記錄要不要記「當時載了哪個版本的 skill」？
（提示：Lesson 4 的 `appendMeta` 就是為這種事準備的。）

### 練習 5：偵測行為漂移 ⭐⭐⭐

寫一個工具，分析 archive 目錄裡累積的提議：

- agent 最常想學什麼類型的東西？
- 被拒絕的提議有沒有共同模式？
- 有沒有同一個想法被反覆提出？（那可能代表你的 system prompt 有問題）

### 練習 6：白名單的邊界 ⭐⭐⭐

`PROPOSAL_TOOL_ALLOWLIST` 包含 `read_file`。想一想：

背景 fork 能讀任意檔案，這安全嗎？它可能讀到 `.env` 然後寫進 skill 裡嗎？

如果要限制，該怎麼限制？（提示：Lesson 8 的 roots + writable 旗標）

---

## 對照 Hermes 原始碼

| 這一課的概念 | Hermes 的位置 |
|---|---|
| `/learn` 提示詞與 authoring standard | `agent/learn_prompt.py`（150 行，建議整份讀） |
| 60 字元規則的理由 | `learn_prompt.py:40` 附近 |
| 背景自動建立 skill | `agent/background_review.py`（docstring 講清楚了設計） |
| 工具白名單 | 同上，`background_review.py` docstring |
| skill 檔案解析與條件載入 | `agent/skill_utils.py`（854 行） |
| 人工編輯／刪除（封存） | `agent/learning_mutations.py`（206 行） |
| 學習視覺化 | `agent/learning_graph.py`（328 行） |

`learn_prompt.py` 的 `_AUTHORING_STANDARDS` 那段值得整份讀：
它是一份寫給模型看的 code review 標準，示範了怎麼用 prompt
強制產出的格式一致。這本身就是一種 harness engineering。

---

## 下一課

[Lesson 17: 跨 session 搜尋](../lesson-17-search/README.zh-TW.md)

現在 agent 有記憶（事實）跟 skill（做法）。還缺一個：
「上次我是怎麼做的？」，從過去的對話裡找答案。

Hermes 用 SQLite FTS5，跟 Lesson 6 的 `find_anomalies`
（規則負責 recall，模型負責 precision）是同一個模式。
