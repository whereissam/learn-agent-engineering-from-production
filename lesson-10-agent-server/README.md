# Lesson 10: The Agent Server and the GUI Protocol

> [繁體中文](README.zh-TW.md)
>
> Prerequisites: [Lesson 3](../lesson-03-streaming/) (streaming and
> interruption).
>
> Move Lesson 3's agent out of the terminal and let another process draw the
> screen. The core loop needs no changes at all, and four problems appear that
> did not exist before.
>
> Source: `openworker/coworker/server/app.py`, `server/manager.py`

## Questions this lesson answers

1. Why can the agent not just live inside the GUI process?
2. Two windows are watching the same session; who gets the events?
3. A terminal has Ctrl+C and a browser does not. Where does interruption come
   from?
4. The user closes the window and reopens it. Where did the disconnected
   stretch go?

Question 4 is the spine of the lesson, because it is a silent failure (design
principle 7): no error, no exception, no warning, just a user whose screen is
missing a section that cannot be recovered.

---

## Step 0: run it first

No API key needed:

```bash
bun run lesson-10
```

Three scenarios run end to end. This is the real output:

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

### Driving it yourself

Two terminals:

```bash
# 終端機 1
PROVIDER=fake bun run lesson-10:server

# 終端機 2
bun run lesson-10:client
```

Ask anything. For a second window, open a third terminal and run the same
`bun run lesson-10:client`; the two stay in sync.

To see the broken version, make terminal 1
`NAIVE=1 PROVIDER=fake bun run lesson-10:server`.

---

## Step 1: why the agent cannot live in the GUI process

The obvious approach is to run the agent loop in the same process the GUI
starts, since Lesson 3 already works. It breaks in three places, none of them
about performance.

| Situation | agent inside the GUI | agent in a server |
|---|---|---|
| the user closes the window | the turn is killed mid-tool | the turn finishes |
| frontend hot reload or crash | the conversation is gone | reconnect and it is back |
| a second window opens | two independent runs | one session |
| a 3am scheduled job (Lesson 9) | no GUI means no agent | the server is always there |

The first row is the crucial one. Closing a window and wanting to stop work are
two different things, and an agent living inside the GUI makes them the same
thing in the implementation. You do not get to choose.

The corresponding code is this cleanup, which deliberately does not abort:

```ts
const cleanup = (): void => {
	clearInterval(keepAlive);
	session.clients.delete(send);
	// 注意這裡沒有 abort。UI 關掉不代表要停止工作，
	// 那是使用者的決定，不是視窗的。
};
```

Plus the deliberately un-awaited line in `startTurn`:

```ts
// HTTP 請求要立刻回，turn 在背景跑，進度靠 SSE 推。
void runTurn(session, controller.signal)
```

A turn's lifetime belongs to the session, not to the request that started it.
That sentence is the foundation of the lesson, and the next three steps are its
consequences.

---

## Step 2: who gets the events

The answer is every connection watching this session, including the one that
just sent the message.

The instinct is to let the sending client paint its own message (optimistic
update; it knows what it sent), but then the screen has two sources of truth,
one drawn locally and one pushed by the server. The moment a second window
opens, they diverge.

So after sending, the client draws nothing:

```ts
// 送出去之後什麼都不畫。等 turn_start 事件回來才畫。
await post("message", { text: input });
```

> A screen may have exactly one source of truth. Letting your own message take
> the round trip trades a little latency for an entire class of sync bugs.

OpenWorker's comment says the same thing (`app.py:1721`):

```python
# Broadcast to every socket viewing this session (this socket included — it's a
# registered client), so a second view of the same session stays in sync too.
await manager.broadcast_session(...)
```

### Solved along the way: double-clicking send

A terminal is synchronous; after Enter you wait for the prompt before typing
again. HTTP is not. A user can double-click, and two windows can send at once.
Two turns pushing the same `messages` array corrupts the history.

So there has to be a one-turn-at-a-time gate, and the claim must complete
before the turn opens, with no `await` in between:

```ts
if (!tryMarkRunning(session)) {
	broadcast(session, { type: "input_rejected", error: "…" });
	json(res, 409, { error: "已經在跑了" });
	return;
}
startTurn(session, text);
```

OpenWorker does the same at `app.py:1744`, and its comment explains why the
order cannot be reversed:

```python
# The receive loop atomically claims this session before scheduling the task.
# Keeping the claim outside prevents two back-to-back frames from both starting.
```

Open the task first and check after, and both requests pass the check.

---

## Step 3: where interruption comes from

Lesson 3's interruption:

```
Ctrl+C  →  SIGINT  →  handleInterrupt()  →  controller.abort()
```

Split into two processes, only the middle changes:

```
Ctrl+C  →  SIGINT  →  POST /interrupt  →  controller.abort()
      （client 進程）              （server 進程）
```

The `controller.abort()` end is unchanged. Lesson 3's three interruption points
(mid-sentence, mid-tool, tools finished) are all in `server.ts`'s `runTurn`
line for line, including filling in the tool results.

The client's Ctrl+C keeps Lesson 3's fork too: interrupt if something is
running, exit if idle:

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

Note the parenthetical. The client left and the session on the server is still
there, so the conversation is waiting next time you connect. The terminal
version cannot do that.

### Interruption belongs to the session, not the window

Scenario 3 demonstrates it: window A sends, window B interrupts, and both stop.
Because interruption changes the session's `controller`, not any connection's
state.

---

## Step 4: disconnect and reconnect, the core of this lesson

Now for the silent failure.

### The wrong intuition

An "event stream" sounds like it should start pushing from the moment you
connect. The NAIVE version does exactly that:

```ts
session.clients.add(send);
send({ type: "ready", ... });
// 然後就等下一個事件
```

It looks reasonable, and it works perfectly as long as you never disconnect.

### What actually happens

```
t=0    使用者送出訊息，模型開始講
t=0.6  使用者切到別的 app / 筆電闔上 / 前端熱重載
       → SSE 連線斷了，server 上的 turn 繼續跑
t=3.0  turn 跑完，模型講了 599 個字
t=5.0  使用者切回來，前端重連
       → 收到 ready，然後……什麼都沒有
```

The user sees a reply that stopped mid-sentence. No error message, no
"connection lost" notice, because from the program's point of view nothing
failed. The SSE closed cleanly, the turn completed, the reconnect succeeded.

> This is the same disease as Lesson 21's extractor dropping a `<table>`: every
> step succeeded and only the result is wrong.

### Why replaying events is the wrong direction

SSE offers a replay mechanism itself (`Last-Event-ID`), so the first thought is
usually a ring buffer on the server, resending missed events on reconnect.

That road hits four questions with no good answers:

1. how big is the buffer? One turn can emit tens of thousands of `text_delta`s
2. how long until it expires? The user might come back in three days
3. the user switched devices; where does `Last-Event-ID` come from?
4. a compaction happened between the two disconnects (Lesson 5); do the old
   events still mean anything?

All four are hard, and they are hard because the question is wrong.

### The right approach: reconnecting means fetching state again

```ts
if (!NAIVE) {
	send({ type: "state", messages: session.messages, running: session.running });
}
```

The entire fix is that one `if`.

> An event is a notification that state changed. The state is the truth.
>
> A `text_delta` is process, not state. Storing process is pointless; storing
> the result is not. Accept that and all four questions above disappear: no
> buffer, no expiry policy, no cursor, because the client never needs to know
> what it missed.

The client gets correspondingly dumber, repainting on `state`:

```ts
case "state":
	for (const line of transcript(event.messages)) console.log(line);
	running = event.running;
```

### But the state has to survive first

Resending state assumes the server holds correct state. If the server dies
mid-turn, the half in memory dies with it.

So it saves during the turn rather than at the end. Which moments?

```ts
const CHECKPOINTS: ReadonlySet<ServerEvent["type"]> = new Set([
	"turn_start",
	"iteration_end",
	"turn_done",
]);
```

Not every event. `text_delta` arrives dozens of times a second and is not
state. The rule for choosing a checkpoint: either a stage completed, or it
stopped to wait for a human.

OpenWorker's list (`app.py:1705`) has two more and the same shape:

```python
_CHECKPOINTS = {
    "turn_start",
    "permission_required",      # ← 停下來等人（Lesson 8）
    "directory_requested",      # ← 停下來等人
    "plan_proposed",            # ← 停下來等人
    "iteration_end",
}
```

The comment above it states the reason:

```python
# Checkpoint events: persist mid-turn so a crash/quit can't eat the conversation.
```

`permission_required` deserves attention: approval is an unbounded wait
(Lesson 9), so without persisting it, the user goes to sleep, the server
restarts, and that turn is stuck forever.

---

## Step 5: a server on localhost is a public server

This one was not anticipated; it came out of reading the comment at the top of
`app.py`.

Any website the user visits can run
`fetch("http://127.0.0.1:7010/session/x/message", {method:"POST", ...})`. And
this server holds `run_command`.

CORS stops the site reading the response; it does not stop the request
arriving, and arriving is enough to make the agent start doing things.
(WebSockets are worse: CORS does not cover WS at all.)

So origin must be checked as an allowlist, not configured as a CORS header:

```ts
const ALLOWED_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

function originAllowed(origin: string | undefined): boolean {
	return origin === undefined || ALLOWED_ORIGIN.test(origin);
}
```

A missing `Origin` header passes (curl, native clients, tests). This gate is
aimed at browsers, and a browser always sends `Origin` and cannot forge it.

Verify:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -H "Origin: https://evil.example.com" \
  http://127.0.0.1:7010/session/x     # → 403

curl -s -o /dev/null -w "%{http_code}\n" -H "Origin: http://localhost:5173" \
  http://127.0.0.1:7010/session/x     # → 200
```

OpenWorker's original text (`app.py:26-46`) explains it more fully and is worth
reading whole:

```python
# user's own browser can still reach loopback — so without an origin gate, any website they
# visit could read `GET /v1/sessions` (CORS was `*`) and drive a session over the WS (which
# CORS never covers) into shell/file tools.
```

That parenthetical `(CORS was *)` says this was a fixed bug, not a hypothetical
threat.

There is another layer: loopback is unauthenticated, so any local process can
reach it, which means upstream requests need limits (the constants at
`app.py:43-52`). This lesson has the crudest version:

```ts
const RATE_LIMIT_COUNT = 30;
const RATE_LIMIT_WINDOW_MS = 10_000;
const MAX_TEXT_CHARS = 200_000;
```

---

## Why this lesson uses SSE and OpenWorker uses WebSockets

Upstream traffic here is two kinds: send a message, interrupt. Two POSTs
suffice, so downstream is SSE: plain text, visible to `curl`, zero
dependencies.

OpenWorker's upstream is more than two (the chain after `app.py:1767`):

```python
if   kind == "approval":            # Lesson 8 的批准
elif kind == "directory_response":  # 目錄授權
elif kind == "plan_response":       # 計畫確認
elif kind == "question_response":   # agent 反問使用者
elif kind == "interrupt":
```

> Once upstream stops being a few actions and becomes a protocol, it deserves a
> bidirectional channel.

The deciding factor is not whether you need real time, since SSE is real time
too, but whether the kinds of upstream message will grow. Wire in Lessons 8-9
and they certainly will, so OpenWorker's choice of WS is right.

---

## What this lesson deliberately skips

| Skipped | Why |
|---|---|
| a real GUI (Tauri, React) | that is frontend work. The portable part here is the protocol, not the screen |
| approval over the upstream channel | that is Lessons 8-9's subject. `approve` here returns `false` |
| multi-user or authentication | this is a local single-user server. Adding auth would bury Step 5's point |
| an event replay buffer | Step 4 explains why that is the wrong direction |
| session list, delete, rename | CRUD, with nothing agent-specific in it |

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| `[事件流斷了] fetch failed` | the server is not running. Start `bun run lesson-10:server` |
| `EADDRINUSE` | 7010 is taken. `PORT=7020 bun run lesson-10:server`, and give the client the same `PORT` |
| the demo hangs at `turn 沒有結束` | a previous server process did not die. `pkill -f lesson-10-agent-server` |
| the client receives nothing and reports no error | check whether the server is `NAIVE=1`, which is deliberate |
| the screen duplicates after reconnecting | your client drew something before receiving `state`. `state` should replace the screen, not append to it |

---

## Exercises

### Exercise 1: show "another window is watching" ⭐

`session.clients.size` is already on the server. Broadcast an event when the
count changes and have the client display "2 windows".

Doing it reveals something: the number has to be broadcast on both `add` and
`delete`, and missing one gives you a zombie count.

### Exercise 2: the client does not return to the prompt after `turn_done` ⭐

Right now the client's prompt and the event output overwrite each other; you
can see it in Step 0's output, where `> ` appears in the middle of the text.
Fix it.

This is harder than it looks, because readline's cursor and
`process.stdout.write` are two different systems. That is the limit of using a
terminal as a UI, and one of the reasons real GUIs exist.

### Exercise 3: add `GET /sessions` ⭐⭐

Then let the client switch with `/switch <id>`.

Note: switching sessions has to close the old SSE connection, or you receive
events from two sessions at once and the screen cannot distinguish them.

### Exercise 4: make checkpoint saving append-only ⭐⭐

`save()` currently rewrites the whole JSON. That gets slow on long turns, and
losing power mid-write leaves a corrupt file.

Switch to JSONL append, which Lesson 4 already did. Then ask yourself: what
should append-only do when compaction (Lesson 5) happens?

### Exercise 5: let a reconnect distinguish running from finished ⭐⭐

The `state` event already carries `running`, and the client only prints one
line with it.

A real GUI uses it to decide whether the input box greys out, whether a stop
button shows, whether a typing cursor blinks. All three have to be right after
a reconnect, or the user gets a box they can type into and cannot send from.

### Exercise 6: simulate the server crashing mid-turn ⭐⭐⭐

`process.exit(1)` at random after `iteration_end`, then restart the server and
reconnect the client.

Three things become apparent:

1. everything before the checkpoint survived
2. the `text_delta`s between the checkpoint and the crash are gone, which is
   acceptable, because that text never entered `messages`
3. but if the crash lands between the model finishing and the tool results
   being filled in, the stored history is illegal and the next request gets a
   400 from the API

Point 3 is the real exercise: how do you make checkpoints happen only on legal
states? (Hint: look at why Lesson 3 pushes only after filling in every tool
result.)

---

## Compared with OpenWorker's source

Line numbers refer to `openworker/coworker/server/` and were all verified.

| Concept in this lesson | OpenWorker |
|---|---|
| one event channel per session | `app.py:1459` `@app.websocket("/ws/session/{session_id}")` |
| global cross-session events | `app.py:1913` `@app.websocket("/ws/events")` |
| send state on connect, do not replay events | the `ready` frame at `app.py:1680` |
| the checkpoint list | `app.py:1705` `_CHECKPOINTS` |
| broadcast to every window, sender included | `app.py:1721`, `manager.py:2428` `broadcast_session` |
| registering and deregistering a window | `app.py:1735`, `manager.py:2418` `register_session_client` |
| the one-turn-at-a-time claim | `app.py:1744`, `manager.py:2721` `try_mark_running` |
| releasing after a turn | `manager.py:2728` `mark_idle` |
| interruption as an upstream message | `app.py:1802` `elif kind == "interrupt"` |
| persistence | `manager.py:3231` `save` |
| the origin allowlist | `app.py:26-46` `_ALLOWED_ORIGIN_RE` |
| upstream rate limits | `app.py:43-52`, the `_WS_*` constants |

For scale: `server/` totals 5909 lines (`app.py` 1968, `manager.py` 3762,
`run.py` 175), and the GUI side has 151 `.ts`/`.tsx` files. This lesson is
about 5% of the former and does not touch the GUI at all.

---

## Next lesson

[Lesson 12: an MCP client in a product](../lesson-12-mcp/): connecting tools
somebody else wrote.

That lesson uses two things from this one: an MCP server's connection state has
to be pushed to the UI, and MCP tools default to EXTERNAL risk (Lesson 8), so
approval travels over the upstream channel, which is one of the rows in this
lesson's deliberately-skipped table.

> Lesson 11 (connectors and OAuth) had its token lifetime folded into Lesson
> 12; the rest is in [docs/TODO.md](../docs/TODO.md).
