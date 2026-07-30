# Lesson 10: Agent server 與 GUI 通訊

> [English](README.md)
>
> 前置：[Lesson 3](../lesson-03-streaming/README.zh-TW.md)（streaming 與中斷）。
>
> 把 Lesson 3 的 agent 從終端機裡搬出來，讓另一個進程去畫畫面。
> 核心 loop 一行都不用改，但會冒出四個原本不存在的問題。
>
> 對照原始碼：`openworker/coworker/server/app.py`、`server/manager.py`

## 這課要回答的問題

1. 為什麼 agent 不能直接住在 GUI 進程裡？
2. 同一個 session 有兩個視窗在看，事件要送給誰？
3. 終端機有 Ctrl+C，瀏覽器沒有。中斷從哪裡進來？
4. 使用者關掉視窗再打開，斷線那段時間的東西去哪了？

第 4 題是這課的主軸，因為它是一個安靜的失敗（設計原則 7）：
沒有錯誤、沒有例外、沒有警告，只是使用者的畫面少了一段，而且補不回來。

---

## Step 0：先跑起來

不需要 API key：

```bash
bun run lesson-10
```

三個情境會自動跑完（下面是真的跑出來的輸出）：

```
情境 1：NAIVE server ， 事件流從「現在」開始
斷線 → 重連 → 看看畫面上有什麼

  斷線前即時收到 89 個字
  斷線期間 turn 在 server 上跑完了
  重連後畫面上有 0 個字，server 上實際有 599 個字
  ✗ 少了 599 個字，而且永遠補不回來
     沒有錯誤、沒有例外、沒有警告。使用者只會覺得「怪怪的」。

情境 2：修好的 server ， 重連時重送一次狀態
同一段劇本，只差在 openStream() 裡那個 if

  斷線前即時收到 82 個字
  斷線期間 turn 在 server 上跑完了
  重連後畫面上有 599 個字，server 上實際有 599 個字
  ✓ 補回來了（重連時 server 重送了一次狀態）

情境 3：兩個視窗看同一個 session
廣播給所有連線，包含送訊息的那一個

  視窗 A 送出訊息（視窗 B 什麼都沒做）
  視窗 A 看到 480 個字，視窗 B 看到 480 個字
  ✓ 兩個視窗一模一樣（送訊息的那個也是等事件回來才畫）

  現在從視窗 B 按中斷
  中斷後 A=481 B=481
  ✓ 中斷是 session 的事，不是視窗的事

  連按兩次送出：
  第一個請求 202，第二個請求 409
  ✓ 一個 session 一次只跑一輪，第二個被 409 擋掉
```

### 想自己動手

開兩個終端機：

```bash
# 終端機 1
PROVIDER=fake bun run lesson-10:server

# 終端機 2
bun run lesson-10:client
```

隨便問一句。想看第二個視窗的話，再開第三個終端機跑同一行
`bun run lesson-10:client`，兩邊會同步。

要看壞掉的版本：終端機 1 改成 `NAIVE=1 PROVIDER=fake bun run lesson-10:server`。

---

## Step 1：為什麼不能把 agent 塞進 GUI 進程

最直覺的做法是：GUI 啟動的時候把 agent loop 跑在同一個進程裡，
反正 Lesson 3 已經能跑了。這個做法會在三個地方壞掉，而且都不是效能問題。

| 情況 | agent 在 GUI 進程裡 | agent 在 server 裡 |
|---|---|---|
| 使用者關掉視窗 | turn 被殺，工具做到一半 | turn 繼續跑完 |
| 前端熱重載 / 崩潰 | 對話沒了 | 重連就回來了 |
| 開第二個視窗 | 兩份各跑各的 | 同一個 session |
| 排程半夜三點跑（Lesson 9） | 沒有 GUI，就沒有 agent | server 一直在 |

第一列是最關鍵的。「使用者關掉視窗」跟「使用者要停止工作」是兩件事，
但如果 agent 住在 GUI 裡，這兩件事在實作上是同一件事，你沒得選。

程式碼裡對應的地方是這個 cleanup，它故意不 abort：

```ts
const cleanup = (): void => {
	clearInterval(keepAlive);
	session.clients.delete(send);
	// 注意這裡沒有 abort。UI 關掉不代表要停止工作，
	// 那是使用者的決定，不是視窗的。
};
```

還有 `startTurn` 裡刻意不 await 的那一行：

```ts
// HTTP 請求要立刻回，turn 在背景跑，進度靠 SSE 推。
void runTurn(session, controller.signal)
```

turn 的生命週期屬於 session，不屬於送出它的那個請求。
這一句是整課的地基，後面三個 Step 都是它的推論。

---

## Step 2：事件要送給誰

答案是「所有正在看這個 session 的連線」，包含剛剛送出訊息的那一個。

直覺會想讓送訊息的 client 自己把訊息畫上去（樂觀更新，反正它知道自己送了什麼），
但那樣畫面就有兩個來源：一個是自己畫的，一個是 server 推的。
第二個視窗打開的那一刻，兩邊就開始不一致。

所以 client 送出去之後什麼都不畫：

```ts
// 送出去之後什麼都不畫。等 turn_start 事件回來才畫。
await post("message", { text: input });
```

> 一個畫面只能有一個真相來源。
> 讓自己的訊息也繞一圈回來，是用一點延遲換掉一整類的同步 bug。

OpenWorker 的註解寫的是同一件事（`app.py:1721`）：

```python
# Broadcast to every socket viewing this session (this socket included — it's a
# registered client), so a second view of the same session stays in sync too.
await manager.broadcast_session(...)
```

### 順帶解決的：連按兩次送出

終端機是同步的，你按 enter 之後要等 prompt 回來才能打下一句。HTTP 不是。
使用者可以連點兩下，兩個視窗也可以同時送。兩個 turn 同時 push 同一個
`messages` 陣列，歷史就爛了。

所以要有一個「一次只跑一輪」的閘門，而且 claim 要在開 turn 之前做完，
中間不能有 await：

```ts
if (!tryMarkRunning(session)) {
	broadcast(session, { type: "input_rejected", error: "…" });
	json(res, 409, { error: "已經在跑了" });
	return;
}
startTurn(session, text);
```

OpenWorker 在 `app.py:1744` 做同一件事，註解解釋了為什麼順序不能反：

```python
# The receive loop atomically claims this session before scheduling the task.
# Keeping the claim outside prevents two back-to-back frames from both starting.
```

先開 task 再檢查的話，兩個請求會在檢查之前都通過。

---

## Step 3：中斷從哪裡進來

Lesson 3 的中斷是這樣：

```
Ctrl+C  →  SIGINT  →  handleInterrupt()  →  controller.abort()
```

拆成兩個進程之後，只有中間那段變了：

```
Ctrl+C  →  SIGINT  →  POST /interrupt  →  controller.abort()
      （client 進程）              （server 進程）
```

`controller.abort()` 那一端一個字都沒改。Lesson 3 寫的三個中斷點
（模型講到一半、工具跑到一半、工具跑完才停）在 `server.ts` 的 `runTurn`
裡逐行都在，包含補齊 tool result 那段。

client 這邊的 Ctrl+C 也保留了 Lesson 3 的分岔，有東西在跑就中斷，
閒著才離開：

```ts
const onInterrupt = (): void => {
	if (running) {
		void post("interrupt");   // 中斷 server 上的 turn
		return;
	}
	console.log(dim("\n再見。（server 還活著）"));
	process.exit(0);
};
```

注意最後那句括號。client 離開了，server 上的 session 還在，
下次連回來對話還在。這在終端機版本是做不到的。

### 中斷是 session 的事，不是視窗的事

情境 3 演的就是這個：視窗 A 送訊息、視窗 B 按中斷，兩邊同時停。
因為中斷改的是 session 的 `controller`，不是某個連線的狀態。

---

## Step 4：斷線重連（這課的核心）

現在來看那個安靜的失敗。

### 錯誤的直覺

「事件流」聽起來就該從連上的那一刻開始推。NAIVE 版本就是這樣寫的：

```ts
session.clients.add(send);
send({ type: "ready", ... });
// 然後就等下一個事件
```

看起來很合理，而且跑起來完全正常，只要你不斷線。

### 實際發生的事

```
t=0    使用者送出訊息，模型開始講
t=0.6  使用者切到別的 app / 筆電闔上 / 前端熱重載
       → SSE 連線斷了，server 上的 turn 繼續跑
t=3.0  turn 跑完，模型講了 599 個字
t=5.0  使用者切回來，前端重連
       → 收到 ready，然後……什麼都沒有
```

使用者看到的是一個講到一半就停住的回覆。沒有錯誤訊息，
沒有「連線中斷」的提示，因為從程式的角度看，什麼都沒有失敗。
SSE 正常關閉、turn 正常完成、重連正常建立。

> 這是 Lesson 21 那個「抽取器丟掉 `<table>`」的同一種病：
> 每一步都成功了，只有結果是錯的。

### 為什麼「重播事件」是錯的方向

SSE 協定本身就提供了重播機制（`Last-Event-ID`），所以第一個念頭通常是
在 server 上放一個環狀 buffer，重連時把漏掉的事件補送。

這條路會立刻遇到四個沒有好答案的問題：

1. buffer 要多大？一個 turn 可能吐幾萬個 `text_delta`
2. 多久過期？使用者可能三天後才打開
3. 使用者換了一台裝置，`Last-Event-ID` 從哪來？
4. 兩次斷線之間發生了壓縮（Lesson 5），舊事件還有意義嗎？

這四題都很難，但它們難是因為問錯了問題。

### 正確的做法：重連 = 重新拿一次狀態

```ts
if (!NAIVE) {
	send({ type: "state", messages: session.messages, running: session.running });
}
```

整個修法就是這一個 `if`。

> 事件是狀態變化的通知，狀態才是真相。
>
> `text_delta` 是過程，不是狀態。存過程沒有意義，存結果才有。
> 一旦接受這件事，上面四個問題全部消失，不需要 buffer、不需要過期策略、
> 不需要游標，因為 client 從來不需要知道自己漏了什麼。

client 那邊也因此變得很笨，收到 `state` 就整個重畫：

```ts
case "state":
	for (const line of transcript(event.messages)) console.log(line);
	running = event.running;
```

### 但狀態要先存得住

重送狀態的前提是 server 手上有正確的狀態。如果 turn 跑到一半 server 掛了，
記憶體裡那半截也一起沒了。

所以要在 turn 進行中存檔，而不是等 turn 結束。哪些時刻該存？

```ts
const CHECKPOINTS: ReadonlySet<ServerEvent["type"]> = new Set([
	"turn_start",
	"iteration_end",
	"turn_done",
]);
```

不是每個事件都存：`text_delta` 一秒鐘幾十個，而且它們不是狀態。
選 checkpoint 的規則是：要嘛是一段完成了，要嘛是停下來等人。

OpenWorker 的清單（`app.py:1705`）比我們多兩個，但形狀一樣：

```python
_CHECKPOINTS = {
    "turn_start",
    "permission_required",      # ← 停下來等人（Lesson 8）
    "directory_requested",      # ← 停下來等人
    "plan_proposed",            # ← 停下來等人
    "iteration_end",
}
```

它上面那行註解直接寫了原因：

```python
# Checkpoint events: persist mid-turn so a crash/quit can't eat the conversation.
```

`permission_required` 特別值得注意：批准是無限期的等待（Lesson 9），
不存檔的話，使用者去睡覺、server 重開，那個 turn 就永遠卡在那裡了。

---

## Step 5：一個開在 localhost 的 server 是公開的

這件事是讀 `app.py` 開頭那段註解才發現的。

使用者瀏覽的任何一個網站，都可以用一段 JavaScript
`fetch("http://127.0.0.1:7010/session/x/message", {method:"POST", ...})`。
而這個 server 手上有 `run_command`。

CORS 擋得住「讀回應」，但擋不住「請求送達」，而送達就足夠讓 agent 開始跑東西了。
（WebSocket 更徹底，CORS 根本不管 WS。）

所以 origin 要當白名單來檢查，不是當 CORS 標頭來設定：

```ts
const ALLOWED_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

function originAllowed(origin: string | undefined): boolean {
	return origin === undefined || ALLOWED_ORIGIN.test(origin);
}
```

沒有 `Origin` 標頭的放行（curl、原生 client、測試），這個閘門針對的是瀏覽器，
而瀏覽器一定會帶 `Origin` 且無法偽造。

驗證一下：

```bash
curl -s -o /dev/null -w "%{http_code}\n" -H "Origin: https://evil.example.com" \
  http://127.0.0.1:7010/session/x     # → 403

curl -s -o /dev/null -w "%{http_code}\n" -H "Origin: http://localhost:5173" \
  http://127.0.0.1:7010/session/x     # → 200
```

OpenWorker 的原文（`app.py:26-46`）解釋得更完整，值得整段讀：

```python
# user's own browser can still reach loopback — so without an origin gate, any website they
# visit could read `GET /v1/sessions` (CORS was `*`) and drive a session over the WS (which
# CORS never covers) into shell/file tools.
```

括號裡的 `(CORS was *)` 是說這是一個改過的 bug，不是假想的威脅。

另外還有一層：loopback 是不認證的，任何本機程式都打得到，
所以上行請求要有上限（`app.py:43-52` 那組常數）。我們這裡放了最粗暴的版本：

```ts
const RATE_LIMIT_COUNT = 30;
const RATE_LIMIT_WINDOW_MS = 10_000;
const MAX_TEXT_CHARS = 200_000;
```

---

## 為什麼這課用 SSE，OpenWorker 用 WebSocket

這課的上行只有兩種：送訊息、中斷。兩個 POST 就夠了，所以下行用 SSE，
純文字、`curl` 看得到、零依賴。

OpenWorker 的上行不只兩種（`app.py:1767` 之後那一串）：

```python
if   kind == "approval":            # Lesson 8 的批准
elif kind == "directory_response":  # 目錄授權
elif kind == "plan_response":       # 計畫確認
elif kind == "question_response":   # agent 反問使用者
elif kind == "interrupt":
```

> 上行一旦從「幾個動作」變成「一個協定」，就該用雙向通道。

判斷點不是「要不要即時」（SSE 也很即時），是「上行的訊息種類會不會長」。
接 Lesson 8-9 之後這裡一定會長，所以 OpenWorker 選 WS 是對的。

---

## 這課刻意不做的事

| 沒做 | 為什麼 |
|---|---|
| 真的 GUI（Tauri / React） | 那是前端工程。這課的可移植部分是協定，不是畫面 |
| 批准流程走上行 | 那是 Lesson 8-9 的主題。這裡的 `approve` 直接回 `false` |
| 多使用者 / 認證 | 這是本機單人 server。加認證會蓋掉 Step 5 想講的事 |
| 事件重播 buffer | Step 4 說明了為什麼那是錯的方向 |
| session 列表、刪除、改名 | CRUD，沒有 agent 特有的東西 |

---

## 跑不起來？

| 症狀 | 原因 |
|---|---|
| `[事件流斷了] fetch failed` | server 沒開。先跑 `bun run lesson-10:server` |
| `EADDRINUSE` | 7010 被佔了。`PORT=7020 bun run lesson-10:server`，client 也要帶同一個 `PORT` |
| demo 卡在 `turn 沒有結束` | 上一次的 server 進程沒死乾淨。`pkill -f lesson-10-agent-server` |
| client 什麼都收不到但沒報錯 | 檢查 server 是不是 `NAIVE=1`，那是刻意的 |
| 重連後畫面重複 | 你的 client 在收到 `state` 之前就先畫了東西。`state` 應該覆蓋畫面，不是附加 |

---

## 練習

### 練習 1：讓 client 顯示「有另一個視窗正在看」⭐

`session.clients.size` 已經在 server 手上了。連線數變化時廣播一個事件，
client 顯示「2 個視窗」。

做完會發現一件事：這個數字要在 `add` 和 `delete` 兩邊都廣播，
少一邊就會有殭屍計數。

### 練習 2：`turn_done` 之後 client 沒有回到提示符號 ⭐

現在 client 的 prompt 跟事件輸出會互相蓋掉（Step 0 的輸出裡看得到，
`> ` 出現在文字中間）。修好它。

這題比看起來難，因為 readline 的游標跟 `process.stdout.write` 是兩套東西。
這正是「終端機當 UI」的極限，也是真的 GUI 存在的理由之一。

### 練習 3：加一個 `GET /sessions` 列出所有 session ⭐⭐

然後讓 client 用 `/switch <id>` 換 session。

注意：換 session 要把舊的 SSE 連線關掉，不然你會同時收到兩個 session 的事件，
而畫面上分不出來。

### 練習 4：把 checkpoint 存檔改成 append-only ⭐⭐

現在的 `save()` 每次都覆寫整個 JSON。turn 很長的時候這會變慢，
而且寫到一半斷電會得到一個壞掉的檔案。

改成 JSONL append（Lesson 4 已經做過這件事）。做完之後問自己：
壓縮（Lesson 5）發生的時候，append-only 要怎麼處理？

### 練習 5：讓重連能區分「turn 還在跑」跟「turn 已經結束」⭐⭐

`state` 事件已經帶了 `running`，但 client 現在只印一行提示。

真的 GUI 要用它決定：輸入框要不要變灰、要不要顯示「停止」按鈕、
要不要顯示打字游標。重連之後這三個狀態都必須正確，
否則使用者會看到一個「可以輸入但送不出去」的框。

### 練習 6：模擬 server 在 turn 中途 crash ⭐⭐⭐

在 `iteration_end` 之後隨機 `process.exit(1)`，然後重開 server、重連 client。

會發現三件事：

1. checkpoint 之前的東西活下來了
2. checkpoint 之後、crash 之前的 `text_delta` 沒了（這是可以接受的，
   因為那段文字沒有進 `messages`）
3. 但如果 crash 發生在「模型講完、tool result 還沒補齊」的中間，
   存下來的歷史是不合法的，下次請求會被 API 打回 400

第 3 點是真正的練習：要怎麼讓 checkpoint 只發生在合法狀態上？
（提示：看 Lesson 3 為什麼要「補完所有 tool result 之後才 push」。）

---

## 對照 OpenWorker 原始碼

行號對應 `openworker/coworker/server/`，全部驗證過。

| 這課的概念 | OpenWorker |
|---|---|
| 每個 session 一條事件通道 | `app.py:1459` `@app.websocket("/ws/session/{session_id}")` |
| 跨 session 的全域事件 | `app.py:1913` `@app.websocket("/ws/events")` |
| 連上時先送狀態，不是重播事件 | `app.py:1680` 的 `ready` frame |
| checkpoint 清單 | `app.py:1705` `_CHECKPOINTS` |
| 廣播給所有視窗（含送出者） | `app.py:1721`、`manager.py:2428` `broadcast_session` |
| 註冊 / 註銷一個視窗 | `app.py:1735`、`manager.py:2418` `register_session_client` |
| 一次只跑一輪的 claim | `app.py:1744`、`manager.py:2721` `try_mark_running` |
| turn 結束後放開 | `manager.py:2728` `mark_idle` |
| 中斷是上行訊息 | `app.py:1802` `elif kind == "interrupt"` |
| 存檔 | `manager.py:3231` `save` |
| Origin 白名單 | `app.py:26-46` `_ALLOWED_ORIGIN_RE` |
| 上行流量上限 | `app.py:43-52` `_WS_*` 常數 |

規模參考：`server/` 共 5909 行（`app.py` 1968、`manager.py` 3762、`run.py` 175），
GUI 那邊 151 個 `.ts`/`.tsx`。這課大約是前者的 5%，而且沒有碰 GUI。

---

## 下一課

[Lesson 12: MCP client 進產品](../lesson-12-mcp/README.zh-TW.md)：把別人寫的工具接進來。

那一課會用到這一課的兩個東西：MCP server 的連線狀態要能推給 UI，
而 MCP 工具預設是 EXTERNAL 風險（Lesson 8），批准要走上行，
也就是本課「刻意不做的事」裡那一列。

> Lesson 11（Connector 與 OAuth）的 token 生命週期併進 Lesson 12 了，
> 剩下的部分見 [docs/TODO.md](../docs/TODO.md)。
