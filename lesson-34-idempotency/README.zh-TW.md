# 第 34 課：exactly-once 是一份協議，不是 runtime 的功能

> [English](README.md)
>
> 先修：[第 33 課](../lesson-33-durable/)——這一課回答的正是那一課結尾的問題。
> 核准的部分見[第 09 課](../lesson-09-unattended/)。
>
> 來源：`restate-ai-examples/typescript-restate-only/tour-of-agents/src/`，
> 特別是 `workflow-sequential.ts`。

第 33 課的結尾，手上是一份 journal：它知道某個 step 被中斷了，卻說不出錢有沒有動。
它提供了兩種出錯的方式——重跑然後扣兩次，或者停下來然後永遠跑不完——並且說還需要
第三種東西。

這就是那第三種東西，而它比聽起來更小、也更奇怪。

```bash
bun run lesson-34
```

## Step 1：另一種形狀的 durability

第 33 課把一次執行模型成一個 **step 清單**，靠跳過標記為 `success` 的來續跑。
Restate 不是這樣做的。它每一次嘗試都把你的 handler **從頭再跑一次**，而每一個
`ctx.run` 都會先查 journal：

```ts
const amountUsd = await ctx.run("Convert currency", async () =>
  convertCurrency(output.amount, output.currency, "USD"),
)
```

第一次嘗試：`convertCurrency` 真的跑，結果被附加進 journal。之後每一次嘗試：
journal 裡的值直接回來，`convertCurrency` 根本沒有被呼叫。**程式碼被重播了；
副作用沒有。**

`worker.ts` 裡的 handler 讀起來就是普通的 async 程式碼——沒有 step 清單、沒有狀態
機。那就是這個取捨：第 33 課為了拿到可續跑而把 loop 重構了，而這個沒有。

## Step 2：把程式碼重播，馬上弄壞什麼

如果 handler 會從頭再跑一次，那它裡面的每一樣東西都必須產生跟上次一樣的值，否則
重播就會跟 journal 分歧。`Date.now()` 和 `Math.random()` 做不到。所以 runtime 得
給你替代品，而 Restate 那一行正是整堂課的樞紐：

```ts
const confirmation = await ctx.run("Process payment", async () =>
  processPayment(ctx.rand.uuidv4(), amountUsd),
)
```

`ctx.rand` 的種子是 invocation id。所以 `uuidv4()` 在**每一次重播都回傳同一個值**
——Restate 自己的指南就是這樣講這個用法的：給 idempotency key 用的穩定 UUID。

那就是第 33 課缺的那一句。它沒辦法決定要不要重跑一個被中斷的付款，因為重跑的付款
會是**第二筆**付款。它只有在帶著不同身分的時候，才會是第二筆。

## Step 3：同一個 crash，三種跑法

每個情境都在完全一樣的位置把 worker 殺掉——扣款之後、journal 寫入之前。改變的只有
key 的穩定性，以及 provider 願不願意配合。

| scenario | billed | requests |
|---|---|---|
| unstable key, provider dedupes | 2 | 2 |
| **stable key, provider dedupes** | **1** | 2 |
| stable key, provider ignores it | 2 | 2 |

先看 `requests` 那一欄，再看 `billed`。**每一列都是 2。** crash 沒有變，付款也真的
發生了兩次；每一次都有兩個 request 抵達 provider。

durable execution 並沒有關掉副作用與 journal 寫入之間那個窗口。沒有東西關得掉——
journal 跟支付商不是同一個系統，而那正是第 33 課的結論。第 2 列真正改變的是：第二
個 request 帶著跟第一個一樣的身分：

```text
  pid 42543  BILLED   key=9c4c6573-5600…  ch_mp4p44j1
  pid 42544  deduped  key=9c4c6573-5600…  ch_mp4p44j1
```

兩個 request、一筆扣款，因為 provider 認得那把 key，於是把原本那筆退回來，而不是
開一筆新的。

## Step 4：第 3 列不是 bug

一把穩定的 idempotency key 自己什麼都不做。它是**一個請求，請另一個人幫你把重複
收攏起來**，而對方必須同意。面對一個忽略 key 的 provider，再完美的穩定 key 一樣會
扣兩次。

那是這個機制的邊界，而一堂只跑合作情況的課，教的是一個不存在的保證。Stripe 的
`Idempotency-Key`、PayPal 的 `PayPal-Request-Id`、以及多數支付通道都會遵守它。
很多內部服務不會，而「我們的重試是安全的」是一個關於**他們**的主張，不是關於你的
runtime 的。

所以 durable execution 真正買到的東西，比行銷說的窄，也比聽起來有用：

> 它讓那次重試變得**可定址**。那個位址會不會被認，是別人的決定——而現在那變成一個
> 有人做得了的決定。

## Step 5：這讓三堂課各自落在哪裡

| lesson | question | answer |
|---|---|---|
| 09 | approval at 3am | an in-process inbox |
| 33 | the process died | the run's position is a value, so another process resumes it |
| 34 | the effect happened but was not recorded | the retry carries the same identity, and the other system decides |

沒有任何一堂課單獨達成 exactly-once。第 33 課證明了出錯的方式剛好只有兩種；這一課
沒有加上第三個選項，它改變的是「去問誰」。

## 這一課刻意不做的部分

| 不做 | 為什麼 |
|---|---|
| 真的跑一個 `restate-server` | 要另外裝 binary、註冊 deployment。TODO 的設計原則 1 說自己寫最小的 journal，就像第 12 課自己寫了一個 200 行的 MCP server |
| Restate 的 virtual object 與 durable promise | 都是真的，但它們回答的是併發與訊號，不是這一課的問題 |
| 重試策略與 backoff | `maxRetryAttempts` 在來源裡就有，而且是正交的——它改變你掉進那個窗口的頻率，從來不改變窗口的寬度 |
| 來源範例裡的 LLM step | 來源也把 `generateText` 包在 `ctx.run` 裡。一個模型呼叫會替一個「以扣款次數定勝負」的實驗加上成本與非決定性 |
| 分散式交易、saga | 那是「對方就是不肯去重」時誠實的替代方案，而它是一個題目，不是一個段落 |

## 契約測試

```bash
bun test tests/idempotency.test.ts
```

不需要 API key。它釘住：被 journal 記下的副作用永遠不會跑第二次、journal 是以呼叫
順序為鍵（那正是讓 `ctx.rand` 變成必要的那個約束）、穩定 key 跨 context 仍然穩定
而且跨 invocation 會不同、不穩定的那個不會，以及在後續步驟失敗前就被記下的副作用
會活到下一次嘗試。

## 練習

### 練習 1：把重播弄壞 ⭐

在 handler 裡、任何 `ctx.run` 之外放一個裸的 `Math.random()`，拿它做分支，然後跑
demo。現在 journal 跟程式碼對「發生過什麼」的說法不一致了。先決定一個 runtime
**應該**在發現時做什麼，再去查 Restate 實際上怎麼做。

### 練習 2：替那把 key 換一個鍵 ⭐⭐

`ctx.rand.uuidv4()` 的鍵是 invocation 加呼叫位置。把它改成從**業務**身分導出——
charge id 加金額——然後想清楚這讓哪些重試變安全、哪些變危險。兩個答案都是真的。

### 練習 3：把 crash 移到 journal 之後 ⭐⭐

把 crash 移到 journal 寫入之後，重跑三列。有一列會變，兩列不會。先解釋為什麼，
再去看。

### 練習 4：把 key 給第 33 課 ⭐⭐⭐

拿第 33 課的 step 引擎，給 `charge_card` 加一把穩定的 key。你現在用 `replay` 就能
達到一次扣款，不需要 `halt`——所以請寫下：當 idempotency 存在之後，第 33 課的
`InterruptedPolicy` 還是**為了什麼**而存在。它仍然有工作要做；把它講出來就是這個
練習。
