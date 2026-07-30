# Lesson 28: 中斷之後，session 不能說謊

> **OpenCode 篇第二課。** 前置：[Lesson 3](../lesson-03-streaming/)（串流與中斷）、
> [Lesson 4](../lesson-04-sessions/)（session 持久化）。
> **建議先讀 [Lesson 29](../lesson-29-evidence/)**（它是同一個問題比較簡單的版本），
> 但這一課不依賴它的程式碼。
>
> 對照原始碼：`opencode/packages/opencode/src/session/processor.ts`（718 行）、
> `packages/schema/src/session-message.ts`

```bash
bun run lesson-28                        # 六個中斷位置 × 有沒有收尾（不用金鑰）
bun run lesson-28 tool_input             # 看一格的細節
CLEANUP=off bun run lesson-28 tool_running

PROVIDER=gemini bun run lesson-28:agent                 # 中斷一個真的串流
INTERRUPT=tool PROVIDER=gemini bun run lesson-28:agent
```

## 這課要回答的問題

1. Lesson 3 的中斷已經能停下串流了，還缺什麼？
2. 中斷的那一刻，同時有幾件事沒做完？
3. 一個「還在跑」的工具，存到硬碟裡之後會變成什麼？
4. 怎麼**可靠地**在指定位置中斷一次串流？

---

## Step 0：Lesson 3 停下來的是串流，不是 session

Lesson 3 教的中斷是：`SIGINT` → `AbortController` → provider 停止讀取 →
發出 `{ type: "error", aborted: true }`。那一課的結論是
「錯誤是事件，不是 throw，因為你需要一個機會把已經拿到的部分保存下來」。

**那個結論是對的，但那一課只用了它的一半。** provider 停了不代表 session
一致，因為中斷的那一刻可能同時有：

```
reasoning 在輸出          一個沒有結束時間的 part
text 在輸出               使用者已經看到半句話
一個或多個工具在執行       沒有人會把它們推進下一個狀態
工具參數收到一半           一段 parse 不了的 JSON
檔案已經改了、patch 還沒算  一個沒有紀錄的變更
session 還是 busy         下次載回來會被當成還在跑
```

**每一格都不會丟例外。** 這是設計原則 7 的最集中的一次出現。

---

## Step 1：怎麼可靠地中斷一次串流 ★

這一課要先解決的不是收尾邏輯，是**實驗裝置**。兩個直覺的做法都不行：

| 做法 | 為什麼不行 |
|---|---|
| `setTimeout(() => abort(), 30)` | 那 30ms 落在哪兩個事件之間是**運氣**。同一支測試今天中斷在 reasoning、明天中斷在 tool，而你不會知道它換過 |
| 真的按 Ctrl-C | 位置更不可控，而且沒辦法寫成測試 |

`fake-provider.ts` 的做法是**讓串流自己在指定位置 abort**：

```ts
const stop = (at: InterruptPoint) => {
  if (point !== at) return false
  controller.abort()
  return true
}

yield { type: "reasoning_delta", ... }
if (stop("reasoning")) return      // ← 中斷位置變成一個參數
yield { type: "reasoning_end", ... }
```

`return` 而不是繼續 yield，因為真實的 provider 就是這樣：
**`text_end`、`step_finish` 這些「結束事件」永遠不會來了。**
收尾之所以必須存在，就是因為沒有人會替你發結束事件。

> **任何「時序造成的 bug」，都要先做出一個能指定時序的裝置，再開始修。**
> 這條在這個系列出現第三次了：Lesson 18 的假時鐘、
> Lesson 29 的 `CAPTURE` 抓取點、現在是中斷位置。

---

## Step 2：一個工具呼叫是生命週期，不是一次函式呼叫

opencode 的 `ToolState` 是四個各自帶不同欄位的型別
（`schema/src/session-message.ts:81-119`）：

```ts
pending    { status: "pending";   input: string }              // ⚠️ string
running    { status: "running";   input: Record<...> }
completed  { status: "completed"; input; output }
error      { status: "error";     input; error; interrupted? }
```

**`pending.input` 是字串而不是物件，這是整個型別最值得抄的一格。**
它在型別上就講清楚了一件事：工具參數是逐字送來的，
中途中斷會留下**半截 JSON**：

```
{"path":"src/a.ts","content        ← parse 不了
```

用一個 `input?: Record` 表示四種狀態的話，這個事實就不見了 ——
而它不見的那天你會拿到一個 `JSON.parse` 例外，或者更糟：一個空物件。

還有兩個小細節同樣是「少了就分不出兩種情況」：

- **三個時間點**（`created` / `ran` / `completed`，`session-message.ts:132-137`）。
  少了中間那個，「參數還沒收完」和「跑很久」就分不出來 —— 兩種完全不同的卡住
- **`interrupted: true`**（`processor.ts:589`）。被中斷跟工具自己壞了都是
  `error`，但下游要分得出來：**工具壞了值得重試，被使用者中斷不值得**

---

## Step 3：矩陣 ★★

```bash
bun run lesson-28
```

```
中斷位置              CLEANUP=on   CLEANUP=off
reasoning             乾淨         unfinished-span, message-never-completed
tool_input            乾淨         in-flight-in-storage, message-never-completed
tool_running          乾淨         in-flight-in-storage, unfinished-span,
                                   message-never-completed, unrecorded-patch
tool_finishing        乾淨         （同上）
text                  乾淨         unfinished-span, message-never-completed,
                                   unrecorded-patch
before_step_finish    乾淨         message-never-completed, unrecorded-patch
none（不中斷）        乾淨         message-never-completed
```

判定是 `audit.ts` 的五條規則，跑在**存檔上**（存檔 → 重新載入 → 稽核），
因為中斷的重點就是「進程沒了之後，留下來的東西還能不能相信」。

| 規則 | 它在防什麼 |
|---|---|
| `in-flight-in-storage` | 存檔裡有 pending / running → 畫面上那個 spinner 會轉到宇宙盡頭 |
| `unfinished-span` | 有 created 沒有 completed → 算不出耗時，也不知道它是不是還活著 |
| `message-never-completed` | 載回來的 session 被當成還在跑 |
| `terminal-without-result` | 「改成 error 就算處理完了」，但沒有內容等於沒有訊息 |
| `unrecorded-patch` | 檔案系統說變了，session 說沒有（→ Lesson 29） |

### 最後一列的 `none` 值得看

**不中斷、正常跑完，CLEANUP=off 一樣是壞的。** 因為「把訊息標成結束」
本來就是收尾的工作之一。收尾不是「中斷的補救措施」，
它是**每一輪都要做的事**，只是中斷讓它變得看得見。

### `tool_finishing` 那一格：為什麼要有寬限窗口

opencode 在放棄一個工具之前給它 250ms（`processor.ts:573`）：

```ts
Deferred.await(call.done).pipe(Effect.timeout("250 millis"), Effect.ignore)
```

那一格的工具 20ms 後就會回來，所以它被記成 **completed，不是 interrupted**。

> 這個窗口不是為了效能，是為了**正確性**。
> 沒有它，一個其實成功了的工具會被記成中斷 —— **紀錄會說一件沒發生的事。**

---

## Step 4：收尾的五件事，順序有意義

```ts
async cleanup(reason) {
  1. 還在跑的工具 → 等（正常結束等到底 / 中斷等寬限窗口）
  2. 沒趕上的 → error + interrupted，不是留在 running
  3. 沒結束的 reasoning / text → 補上結束時間，內容留著
  4. patch 照算 —— 被中斷的那一輪也可能改過檔案
  5. 訊息收尾（completed + finish）
}
```

第 3 步的「內容留著」不是節省，是一致性：
**半截的回答是使用者已經看過的東西**，丟掉就等於畫面跟紀錄不一致。

第 4 步對照 `processor.ts:539-552`：opencode 的 cleanup 也算 patch。
這是那一課（29）和這一課的接縫 —— **中斷不能變成一個讓紀錄消失的洞。**

### ⚠️ 這裡我寫錯過一次，而且是真模型抓出來的

第一版的第 1 步對所有情況都套用 250ms 寬限窗口。然後某一次真模型跑的時候，
**模型沒有先輸出文字就直接呼叫工具**，於是串流正常結束、走進
`cleanup("end")`，而那個工具還在跑 → 250ms 到了 → 它被標成 `interrupted`，
**而 `finish` 是 `"end"`**。

```
finish=end
tool write_file [error (interrupted)] Tool execution interrupted
```

一份自相矛盾的紀錄，沒有任何錯誤。

> **寬限窗口只屬於中斷路徑。** 正常結束時「工具還沒回來」不是異常，
> 只是還沒好 —— 那就等它。
>
> 而抓到它的原因值得記下來：**我沒有設計那條路徑，是模型走出來的。**
> 腳本化的六格矩陣每一格都是我想像得到的情況，
> 真模型走的是我沒想到的那一格。`tests/consistency.test.ts` 現在有一條守它。

---

## Step 5：真模型只能重現六格裡的兩格 ★

```bash
PROVIDER=gemini bun run lesson-28:agent                 # 中斷在 text
INTERRUPT=tool PROVIDER=gemini bun run lesson-28:agent  # 中斷在工具執行中
```

**而漏掉的四格的原因在我們自己的抽象**：

| 中斷位置 | 真模型 | 為什麼 |
|---|---|---|
| `text` | ✅ | 有 `text_delta` 事件 |
| `tool_running` | ✅ | 工具是我們自己執行的 |
| `reasoning` | ❌ | `shared/streaming` 沒有 reasoning 的串流事件 |
| `tool_input` | ❌ | `tool_call` 是**參數收完才發**的 |

最後一列直接引用 `shared/streaming/types.ts:44-51` 那段刻意的簡化：

> 注意：這是在參數「完整收到之後」才發出。
> 有些 provider 會逐字串流工具參數，但半截的 JSON 對 UI 沒用，
> 所以我們等它完整了再發。

那個決定對 Lesson 3-27 都是對的。但它讓「參數收到一半被中斷」
**在型別上不可表示**。

> **一個好的抽象會藏起你不需要的東西；
> 你只會在需要它的那一天，才發現它藏了什麼。**
>
> 這不是要你把所有 provider 事件都攤開。是要記住：
> **你的事件模型決定了你能觀察到哪些失敗。**

### 真模型實測（Gemini 3.6 Flash）

**中斷在工具執行中**：

```
→ write_file {"path":"a.ts","content":"export const A = 2;\n"}
中斷 工具開始執行之後

CLEANUP=on                                    CLEANUP=off
tool write_file [error (interrupted)]         tool write_file [running]
finish=interrupted                            finish=（沒有）
檔案系統：a.ts 變了                            檔案系統：a.ts 變了
稽核：沒有違規                                 稽核：4 條違規
```

`CLEANUP=off` 那一欄的四條：`in-flight-in-storage`、`unfinished-span`、
`message-never-completed`、**`unrecorded-patch`** ——
最後一條最值錢：**檔案真的改了，而紀錄裡沒有。**

**中斷在文字輸出中**（第 2 個 delta 之後）：

```
CLEANUP=on   text "我打算使用 `write_file` 工具重新寫入 `a.ts` 檔案，"  finish=interrupted  稽核乾淨
CLEANUP=off  text "我將會讀取並更新 `a.ts` 檔案的內容，將其中的常數值從 1 修改為"…  finish=（沒有）  2 條違規
```

半截的字**保留下來了**，那正是使用者在畫面上看到的東西。

⚠️ 順帶一個沒預期的細節：`AFTER_DELTAS` 第一版設 4，
結果 Gemini 把那一句話切成兩三塊就講完了，**中斷從來沒發生**。
delta 的顆粒度不是你能控制的 —— 又一個「陰性結果要先證明測試有鑑別度」。

---

## 這課刻意不做的事

| 沒做 | 為什麼 |
|---|---|
| 介紹 13 種串流事件 | 這一課的判準是那張矩陣，不是事件列表。**這是這一課最大的風險**，`docs/TODO.md` 事先寫下來了 |
| 真的算 git diff | `diff()` 是一個參數。「怎麼知道檔案真的變了」是 [Lesson 29](../lesson-29-evidence/) 的題目，那一課的 `snapshot.patch()` 就是它的真實版本 |
| 中斷之後怎麼**續跑** | 那是 Lesson 33（可序列化的狀態機）。這一課只管「留下來的紀錄誠不誠實」 |
| 多輪 / 多訊息的 session | 一輪就足以呈現全部六格。加上 session 樹只會讓矩陣變模糊 |
| 重試被中斷的工具 | **刻意不做**：`interrupted` 的工具值不值得重試是工作的性質決定的（Lesson 18 的 `unknown`、Lesson 34 的冪等） |

---

## 跑不起來？

| 症狀 | 原因 |
|---|---|
| 稽核每一格都乾淨 | 檢查 `CLEANUP` 有沒有真的關掉。`bun run lesson-28` 兩欄一起跑就看得出來 |
| `INTERRUPT=text` 沒有中斷 | 模型沒有先輸出文字（或 delta 太少）。程式會警告；調 `AFTER_DELTAS=1` 或改用 `INTERRUPT=tool` |
| 工具被標成 interrupted 但它其實成功了 | 寬限窗口太短，或者你在正常結束的路徑上套用了它（Step 4 的那個 bug） |
| 半截 JSON 讓程式爆掉 | 不要 parse `pending.input`。它是字串，而且**故意**是字串 |

---

## 練習

### 練習 1：加第六條規則 ⭐

`finish === "interrupted"` 但所有工具都是 `completed` —— 這合法嗎？
（提示：寬限窗口。）先想清楚它是不是違規，再決定要不要寫成規則。

**這一題的重點是：不是每一種「看起來怪」都是錯的。**

### 練習 2：把 reasoning 串流接進 provider ⭐⭐

`shared/streaming/anthropic.ts` 已經處理了 thinking block。
加一組 `reasoning_*` 事件，然後就能量到第三格了。

做完會遇到一個決定：**reasoning 要不要存進 session？**
存了會膨脹、而且下一輪送回 provider 可能被拒絕；不存的話，
被中斷的那一輪就少了一段使用者看過的東西。

### 練習 3：多輪的 session ⭐⭐

現在稽核的是一個訊息。改成整個 session 檔案，然後加一條規則：
**同一時間只能有一個訊息是「還沒完成」的。**

一份有兩個未完成訊息的 session 幾乎一定是 bug —— 想清楚為什麼。

### 練習 4：接上真的 patch ⭐⭐

把 `diff()` 換成 Lesson 29 的 `Snapshot`。做完之後
`unrecorded-patch` 就從「示範」變成「真的量測」。

順便你會發現一件事：**snapshot 要在串流開始之前抓**（Lesson 29 Step 4），
所以這兩課的收尾其實是同一段程式碼的兩半。

---

## 對照原始碼

| 這課的概念 | OpenCode |
|---|---|
| 四個 tool state，`pending.input` 是字串 | `packages/schema/src/session-message.ts:81-119` |
| 工具的三個時間點 | `session-message.ts:132-137` |
| reasoning 的 `completed` 是選填 | `session-message.ts:153-156` |
| 訊息的 `time.completed` 是選填 | `session-message.ts:185-188` |
| `cleanup()` 的五件事 | `session/processor.ts:539-595` |
| 給還在跑的工具 250ms 寬限 | `session/processor.ts:573` |
| 清不掉的工具標成 `interrupted: true` | `session/processor.ts:589` |
| 被中斷時也要算 patch | `session/processor.ts:540-552` |
| 訊息收尾 | `session/processor.ts:595` |

> opencode 還有一段我們沒抄的：`message-v2.ts:349-357` 把 `pending`/`running`
> 的工具在**送回 provider 之前**轉成 `output-error`，註解寫的理由是
> 「Anthropic/Claude APIs require every tool_use to have a corresponding
> tool_result」—— 那正是 Lesson 3 學到的硬規則。
>
> 所以同一個問題有三個位置：**存檔不能說謊、畫面不能說謊、
> 送回模型的歷史也不能說謊。** 而第三個位置如果漏掉，
> 症狀不是紀錄不一致，是下一輪直接 400。

---

## 下一課

**照閱讀順序，證據這條支線接下來是 [Lesson 37](../docs/TODO.md)**
（action / observation trajectory，還沒寫）。這一課把 part 變成有生命週期的
東西，37 再往前一步：**把「誰說的」寫進型別**（observation 的 source
永遠是 `"environment"`）。

29 從量測下手、28 從生命週期下手、37 從資料結構下手，
**三課講的是同一件事：紀錄不能比事實更樂觀。**
