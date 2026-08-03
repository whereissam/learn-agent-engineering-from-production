# Lesson 3: Streaming 與中斷

> [English](README.md)
>
> 前置：[Lesson 2](../lesson-02-tools/README.zh-TW.md)。
>
> 目標：讓 agent 邊想邊講，而且你可以隨時喊停，**停完之後對話還能繼續**。
> 最後這半句才是這一課真正的難點。

## 這課要回答的問題

1. 打字機效果是怎麼做的？
2. 按下 Ctrl+C 的那一刻，程式裡發生了什麼事？
3. 中斷發生在「模型講到一半」跟「工具跑到一半」，處理方式一樣嗎？
4. 為什麼中斷之後對話可能會壞掉？

---

## Step 0：先跑起來

```bash
PROVIDER=fake bun run lesson-03
```

隨便問一句。前兩輪會呼叫工具，然後開始講一段很長的話。
**在它講到一半的時候按 Ctrl+C**：

```
This reply is deliberately long, to give you enough time to press Ctrl+C and
try interrupting it.

When you do, watch for three things:
First, the text stops immediately, mid-wo
                                         ← Ctrl+C landed right here

[interrupted]

>                                        ← the prompt is back; keep talking
```

注意三件事都發生了：

1. **停在字的中間** ，不是等整段講完才停
2. **已印出的文字沒有消失** ，它是有效資料
3. **程式沒有崩潰** ，你回到提示符號，還能繼續

閒置時再按一次 Ctrl+C 才會真的離開。

> 想要更慢、更容易手動測？`FAKE_DELAY_MS=100 PROVIDER=fake bun run lesson-03`

---

## Step 1：打字機效果就是一行 code

provider 從「回傳一個結果」變成「吐出一串事件」：

```ts
export type StreamEvent =
  | { type: "text_start" }
  | { type: "text_delta"; delta: string }   // ← 下一小塊文字
  | { type: "text_end" }
  | { type: "tool_call"; id: string; name: string; args: Record<string, unknown> }
  | { type: "done"; response: ModelResponse }
  | { type: "error"; message: string; aborted: boolean };
```

loop 這樣消費它：

```ts
case "text_delta":
  partialText += event.delta;
  process.stdout.write(event.delta);   // ← 打字機效果的全部
  break;
```

就這樣。**沒有動畫、沒有計時器**，資料本來就是一塊一塊到的，你只是即時印出來。
之前之所以要等，是因為我們硬是等它全部到齊才印。

### Streaming 才是原始能力

```ts
async call(request, signal) {
  return await drain(provider.stream(request, signal));
}
```

非串流版是「把串流收乾」得到的。反過來做不到，你沒辦法從一個
「等全部好了才回傳」的 API 生出 streaming。所以 provider 只要實作
`stream()`，`call()` 可以自動生出來。

Lesson 5 的壓縮功能會用 `call()`，因為那個過程不需要給人看。

### OpenAI 的坑：工具參數是逐字串流的

Anthropic 的 SDK 會幫你把工具參數組好。OpenAI 不會：

```
delta.tool_calls[0].function.arguments = '{"pa'
delta.tool_calls[0].function.arguments = 'th":"RE'
delta.tool_calls[0].function.arguments = 'ADME.md"}'
```

你必須依 `index` 自己拼回去，全部收完才能 `JSON.parse`：

```ts
if (call.function?.arguments) existing.args += call.function.arguments;
//                                            ↑ 是 += 不是 =
```

寫成 `=` 的話你只會拿到最後一塊碎片，然後 parse 失敗。
這是 streaming 最常見的踩雷點。

---

## Step 2：中斷的機制

```ts
let currentRun: AbortController | undefined;

// 每一輪對話建立一個新的 controller
currentRun = new AbortController();
await runTurn(provider, messages, ctx, currentRun.signal);
```

`AbortSignal` 一路傳下去：傳給 HTTP 請求（SDK 會中止連線）、
傳給工具執行。按 Ctrl+C 就 `abort()`。

### 訊號要從兩個地方接（實測踩到的）

```ts
function installSigintHandler(rl: Interface): void {
  rl.on("SIGINT", handleInterrupt);
  process.on("SIGINT", handleInterrupt);
}
```

第一版只裝了 `rl.on("SIGINT")`，結果串流中按 Ctrl+C 完全沒反應。原因：

| 情境 | 誰收得到 |
|---|---|
| stdin 是終端機，且 readline 正在等你輸入 | `rl.on("SIGINT")`（readline 攔截了，process 層收不到） |
| `runTurn` 執行中（readline 沒在等輸入） | `process.on("SIGINT")` |
| stdin 不是 TTY（管線、CI） | `process.on("SIGINT")` |

只裝其中一個，都會有 Ctrl+C 沒反應的情境。

### 錯誤是「事件」，不是 throw

```ts
| { type: "error"; message: string; aborted: boolean };
```

這是刻意的設計。串流到一半失敗時，**前面已經吐出去的文字仍然有效**，
使用者已經看到它了。如果 provider 直接 throw，那些文字就沒地方接。

用事件的話，loop 可以先把累積的部分留下來，再處理錯誤。

---

## Step 3：三個中斷點（這課的核心）

「中斷」不是一件事，是三件事。每一個都讓對話歷史處於不同的半殘狀態。

```
call the model ────────► tool calls arrive ────► run the tools ────► next turn
      ▲                                          ▲                 ▲
      │                                          │                 │
     [A]                                        [B]               [C]
 mid-sentence                                mid-tool        tools done, stopping
```

### 中斷點 A：模型講到一半

```ts
if (partialText.trim()) {
  messages.push({
    role: "assistant",
    blocks: [{ type: "text", text: partialText }],
    raw: { role: "assistant", content: partialText },
  });
  messages.push({
    role: "user",
    text: "[I interrupted your last reply. Wait for my next instruction; do not resume on your own.]",
  });
}
```

為什麼要留下半截的文字？

因為使用者看過它了。如果丟掉，對話歷史就跟使用者眼前的畫面對不上，
使用者記得 agent 說過某件事，模型卻不知道自己說過。之後就會出現
前後矛盾的對話。

為什麼要多加一則 user 訊息？

不加的話，模型看到自己上一則講到一半，會**自動接續講完**。但使用者
按 Ctrl+C 就是不想聽了。這則訊息明確告訴它「停下來等指示」。

沒講出任何東西就被中斷呢？什麼都不用做，歷史沒被弄髒。

### 中斷點 B：工具跑到一半

這裡有一條硬性規則：

> 每一個 tool call 都必須有一則對應的 tool result。

少一則，下一次請求會被 API 直接打回 400
（`tool_use ids were found without tool_result blocks`）。

所以中斷之後，**剩下沒跑的工具也要補上「已取消」的結果**：

```ts
for (const call of toolCalls) {
  if (abortedDuringTools || signal.aborted) {
    abortedDuringTools = true;
    results.push({
      toolCallId: call.id,
      toolName: call.name,
      content: "Cancelled: the user interrupted before this tool ran.",
      isError: true,
    });
    continue;   // ← 不要真的執行
  }
  // ... 正常執行
}

// 補完「所有」結果之後才 push
messages.push({ role: "toolResult", results });
```

注意 `push` 的位置在迴圈**外面**。歷史要嘛完整、要嘛還沒寫進去，
不能停在中間狀態。

### 中斷點 C：工具跑完了但要停

歷史已經合法了（所有結果都補齊），只需要加一則說明：

```ts
messages.push({
  role: "user",
  text: "[I interrupted your tool execution. Wait for my next instruction.]",
});
```

---

## Step 4：中斷「不能」做的事

有一件事這個設計刻意沒做：已經執行完的工具不會回滾。

如果模型呼叫了 `write_file`，檔案寫下去了，你這時候按 Ctrl+C，
檔案還是被改了。中斷只能停止「還沒發生的事」。

這不是偷懶，是取捨。要能回滾就得做交易機制（每個工具都要有 undo、
或整個沙箱要能 snapshot），複雜度會爆炸。

真實的 agent 也是這樣。這也是為什麼 Lesson 2 的批准機制比中斷更重要：
事前擋下來，比事後想收拾容易太多了。

---

## Step 5：驗證中斷真的沒弄壞對話

按 Ctrl+C 之後，**繼續講話**：

```
> hello
This reply is deliberately long...
First, the text stops immediately, mid-wo
[interrupted]

> still there?          ← the conversation continues
This reply is deliberately long...
```

第二輪正常運作，就證明了對話歷史還是合法的。

如果你把 Step 3 的補救邏輯拿掉再測一次，第二輪就會失敗，
用真的 provider 會直接收到 API 400。這是驗證這一課有沒有做對的最快方法。

---

## 跑不起來？

| 症狀 | 原因 | 解法 |
|---|---|---|
| Ctrl+C 沒反應 | 只裝了 `rl.on("SIGINT")` | 兩個都要裝，見 Step 2 |
| Ctrl+C 直接把程式殺掉 | 沒有攔截 SIGINT | 同上 |
| 中斷後下一輪 API 回 400 | tool result 沒補齊 | 見 Step 3 中斷點 B |
| 模型自己接續講完被中斷的話 | 沒加「不要自己接續」那則訊息 | 見 Step 3 中斷點 A |
| 工具參數 `JSON.parse` 失敗（OpenAI/Gemini） | 碎片用 `=` 而不是 `+=` | 見 Step 1 |
| 文字一次全部出現，沒有打字機效果 | 用了 `call()` 而不是 `stream()` | 檢查 loop 是不是在消費事件 |

---

## 練習

### 練習 1：顯示「思考中」指示器 ⭐

從送出請求到第一個 `text_delta` 之間可能有好幾秒空白。加一個轉圈動畫，
收到 `text_start` 就清掉。

提示：注意不要讓動畫的字元跟模型的輸出打架。

### 練習 2：中斷時顯示已用掉多少 token ⭐⭐

在 `StreamEvent` 加一個 `{ type: "usage"; inputTokens: number; outputTokens: number }`，
兩個 provider 各自填好。中斷時印出來。

你會發現一件事：**中斷不會退錢**。已經生成的 token 照算。

### 練習 3：把「繼續」做成內建指令 ⭐⭐

中斷之後輸入 `/continue`，讓模型接續剛剛被打斷的地方（而不是等新指示）。

想一想：這需要改 Step 3 中斷點 A 加的那則訊息嗎？

### 練習 4：中斷正在跑的 shell 指令 ⭐⭐⭐

現在 `run_command` 收不到 `signal`，按 Ctrl+C 的時候，
子行程還在背景跑到自己結束。

改 `ToolContext` 讓它帶 `signal`，並在 `shell-tool.ts` 裡接上：

```ts
signal.addEventListener("abort", () => child.kill("SIGTERM"));
```

然後想一個更難的問題：SIGTERM 殺不掉的行程怎麼辦？
（提示：先 SIGTERM，等一下再 SIGKILL。）

### 練習 5：串流中即時顯示工具參數 ⭐⭐⭐

現在工具呼叫是「參數收完才顯示」。改成邊收邊顯示：

```
→ write_file(path: "src/store.ts", content: "import { ALPH...
```

這需要新的事件型別（`tool_call_start` / `tool_call_delta`）。
做完你會理解這一課為什麼刻意不做它：半截的 JSON 對 UI 幾乎沒用，
但複雜度增加很多。Pi 做了（`toolcall_delta`），因為它要顯示即時的檔案 diff。

---

## 對照 Pi 原始碼

| 這一課的概念 | Pi 的對應位置 |
|---|---|
| 串流事件型別 | `packages/ai/src/types.ts` (`AssistantMessageEvent`) |
| `StreamFn` 介面 | `packages/agent/src/types.ts:28` |
| 消費串流事件的迴圈 | `packages/agent/src/agent-loop.ts:317-361` |
| 中斷處理 | `agent-loop.ts:196-200`（`stopReason === "aborted"` 直接收尾） |
| 中斷後的狀態修復 | `packages/agent/src/agent.ts:496` (`handleRunFailure`) |
| 事件與 UI 解耦 | `packages/agent/src/agent.ts:243` (`subscribe`) |
| 截斷輸出的工具處理 | `agent-loop.ts:381` (`failToolCallsFromTruncatedMessage`) |

Pi 的 `AssistantMessageEvent` 有十幾種事件（thinking 開始/結束、
工具參數逐字串流、usage 更新……），我們只留了六種。
先理解六種版本，再去看為什麼需要十幾種。

---

## 下一課

[Lesson 4 - Session 持久化](../lesson-04-sessions/README.zh-TW.md)：現在關掉程式，所有對話就沒了。
存到磁碟之後會撞到一個有趣的問題：**session 其實不是一個陣列，是一棵樹**。
