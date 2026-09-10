# 第 33 課：loop 不是 loop，是可以序列化的狀態機

> [English](README.md)
>
> Mastra 篇第四課。先修：
> [第 09 課](../lesson-09-unattended/)、[第 28 課](../lesson-28-consistency/)、
> [第 32 課](../lesson-32-tool-search/)。
>
> 來源：`mastra/packages/core/src/workflows/`——`state-reader.ts`（118 行）、
> `handlers/control-flow.ts`（1378 行）——以及
> `agent/durable/durable-agent.ts`（2800 行）。

第 09 課教會 agent 停下來等人。它能運作的前提是 process 還活著，因為那個暫停是
一個停在 `while` 裡的 `Promise`。

這一課問那個會把它打破的問題：

> 核准在早上 9 點到。process 在半夜 3 點死了。那個 run 在哪裡？

```bash
bun run lesson-33
```

下面每一個情境都真的 spawn 一個子行程、真的送 `SIGKILL`。用 `throw` 模擬出來的
crash 不是 crash——`finally` 還是會跑、buffer 還是會 flush、你還是有機會善後。
kernel 把 process 收走的時候，那些一樣都沒有，而整堂課就住在這個差別裡。

## 這條 pipeline

```text
charge_card  →  await_approval  →  send_receipt
   money           a human            an email
```

副作用刻意選了一個「做兩次不是小事」的。量測只有一個數字：**這張卡被扣了幾次？**
它從一個 append-only 的 ledger 檔案數出來，而不是從變數，因為被量測的那個 process
正是會死掉的那一個——這是第 29 課「證據要來自宣稱者之外」那條規則，套用在這一課
自己的量測工具上。

## Step 1：為什麼 `while` loop 沒辦法接回來

第 1 到 32 課裡每一個 loop 的狀態都住在 JavaScript 的 stack 上：跑到第幾圈、
區域變數是什麼、`await` 停在哪。**那些東西都沒有位址。** 你沒辦法把一個 stack
frame 序列化、交給另一台機器，或者在 process 消失之後把它找回來。

把它換成一個「run 的位置是一個**值**」的結構：

```json
{
  "runId": "durable",
  "status": "suspended",
  "steps": {
    "charge_card":    { "status": "success",   "output": { "capturedCents": 4999 } },
    "await_approval": { "status": "suspended", "suspendPayload": { "question": "..." } }
  }
}
```

那是 JSON。寫到磁碟上，這個 run 就活得比 `kill -9` 久；在別的地方讀回來，這個 run
就從那裡繼續。

Mastra 的 `state-reader.ts` 是這個想法最純的形式：一組**對序列化狀態做的純函式**
——`getStatus`、`getStepOutput`、`getSuspendedStep`。一個 dashboard、一個核准畫面、
一個接手的 worker，都需要知道一個 run 在哪裡，而**它們沒有一個是啟動那個 run 的
那個 process。**

## Step 2：把機制關掉

```text
Scenario 1: mechanism off — nothing is written down
  attempt 1: charge the card, then the process is killed
  attempt 2: a supervisor restarts the work
  charges: 2   state on disk: none
```

沒有地方可以查已經發生過什麼，所以重啟唯一能做的事就是從頭開始。這不是稻草人：
它正好就是第 09 課那個 inbox 加上 process 被殺掉，而「supervisor 重跑失敗的工作」
是每個 process manager 的預設行為。

## Step 3：把機制打開

```text
Scenario 2: mechanism on — the run's position is a file
  after the kill: status=running completed=[charge_card]
  now suspended at: await_approval
  a human approves, from a third process
  final: status=success  attempts=3  charges: 1  emails: 1
```

三個 process 把同一個 run 往前推，而它們沒有一個共用記憶體。整個機制就是
`advance()` 裡的一行：

```ts
if (previous?.status === "success") continue;
```

journal 說做完了的 step 就**跳過**。不重跑、不重新檢查——跳過。那個 `continue`
就是扣一次款和扣兩次款的差別。

store 裡有兩個細節不是裝飾：

- **寫到暫存檔再 `rename`。** process 在 `writeFileSync` 中途被殺掉會留下一個被
  截斷的檔案，而一份被截斷的 journal 比一份過期的更糟：它讓這個 run 變成讀不了，
  而不只是不夠新。同一個檔案系統內的 rename 是原子的，所以讀的人看到的要嘛是完整
  的舊狀態、要嘛是完整的新狀態。第 28 課對 session 寫入得到過同樣的結論，而值得
  注意的是：這個問題在每一層會持久化東西的地方都會重演。
- **在 step 跑之前就把 step 紀錄寫下去**，不是跑完才寫。它每個 step 多花一次寫入，
  換到的是唯一能讓 crash 可診斷的東西。

## Step 4：第二次寫入買到了什麼、又沒買到什麼

```text
Scenario 3: mechanism on, crash between the effect and the journal
  after the kill: completed=[] in-flight=[charge_card]
  charges: 2
```

durability 沒有幫上忙，而這不是實作的 bug。

step 紀錄上有 `startedAt` 而沒有 `endedAt`，所以接手的 process 知道**這個 step 被
中斷了**。它不知道**錢有沒有動**。那是兩件不同的事實，而 journal 從頭到尾只碰得到
第一件。在「支付商已經 commit」和「我們寫下它已經 commit」之間有一個空窗，而再多
的 journal 也關不掉它，因為 journal 跟支付商不是同一個系統。

如果沒有 Step 3 那個「跑之前先寫」，情況更糟：一個被中斷的 step 跟一個從來沒開始
過的 step 長得一模一樣，重啟連問題都問不出來。

## Step 5：錯的方式剛好只有兩種

```text
Scenario 4: same crash, but the resume refuses to replay
  charges: 1   status: failed
    interrupted mid-step; a human must decide whether charge_card took effect
```

| policy | 遇到被中斷的 step | 你得到什麼 |
|---|---|---|
| `replay` | 再跑一次 | at-least-once。卡可能被扣兩次 |
| `halt` | 停下來問人 | at-most-once。沒有東西跑兩次，也沒有東西跑完 |

情境 4 不是比情境 3 更好的答案。它是相反方向的取捨，而你要哪一個取決於那個 step：
重跑 `send_receipt` 是寄出一封重複的信，重跑 `charge_card` 是拿走不屬於你的錢。

所以這在 `advance()` 裡是一個參數，而不是埋在引擎裡的預設值：

```ts
export type InterruptedPolicy = "replay" | "halt";
```

完整結果：

| scenario | charges | emails |
|---|---|---|
| naive, crash after charge | 2 | 0 |
| durable, crash after charge | 1 | 1 |
| durable, crash before journal | 2 | 0 |
| durable, halt on interrupted | 1 | 0 |

只有一列兩個數字都對，而那一列是 crash 剛好掉在 journal 看得見的地方。

## Step 6：真正能修好它的東西不在這一課裡

兩種 policy 都給不出 exactly-once，也沒有第五種 policy 做得到。那不是設計上的缺口，
而是那個眾所皆知的結論：兩個系統沒辦法靠一次來回就達成一致。能改變答案的是**跟
另一側那個系統換一份不同的合約**：

- 一把支付商會拿去去重的 idempotency key，讓重跑在構造上就是安全的
- 一個 durable execution runtime，在呼叫之前先把**意圖**寫進 journal，事後再對帳

第二個就是第 34 課（Restate），而這一課存在的一部分理由就是讓它變成躲不掉的：
你沒有看過一份好好的 journal 答不出唯一重要的那個問題之前，不會知道 durable
execution 到底買到了什麼。

## 這一課刻意不做的部分

| 不做 | 為什麼 |
|---|---|
| 分支、迴圈、平行與巢狀 step | Mastra 的 `handlers/control-flow.ts` 有 1378 行正是為了這些；線性序列是還能顯示這個性質的最小形狀 |
| `inngest` 與 `temporal` adapter | 那是「怎麼接上一個 durable execution 服務」，不是「為什麼需要 durability」 |
| 重試與 backoff | 正交的問題，而且會把扣款次數這個量測弄糊 |
| 改寫 `runTurn` | 設計原則 6——這一課改變的是 loop 的形狀，所以跟第 24 課一樣建在舊 loop 旁邊，不碰任何既有的東西 |
| 把模型放進 loop 裡 | 論點是一個關於 crash 的確定性性質，而模型只會在一個本來就是二元的判定上加雜訊 |

## 契約測試

```bash
bun test tests/durable.test.ts
```

不需要 API key，也不開子行程——crash 住在 demo 裡，不變量住在這裡：做完的 step
永遠不重跑、suspended 的 step 會擋住它後面的、狀態經過 JSON 來回之後一字不差、
原子寫入不留下 `.tmp`、兩種中斷 policy 各自做它們宣稱的事。

## 練習

### 練習 1：加一把 idempotency key ⭐

給 `charge_card` 一把由 `runId + stepId` 導出來的 key，讓 ledger 拒絕重複。重跑
情境 3。你現在把問題搬走了，不是解掉了——找出它搬到哪裡去，以及那個 ledger 要
變成什麼樣子才算真的解掉。

### 練習 2：在 resume 途中 crash ⭐⭐

核准之後 `CRASH_AT=send_receipt`。那個人要不要再核准一次？應該要嗎？答案在於
`resumeData` 是 journal 的一部分、還是 request 的一部分。

### 練習 3：兩個 worker、一個 run ⭐⭐

同時對同一個 `RUN_ID` 起兩個 worker。store 沒有鎖，所以兩個都會扣款。加上能擋住
它的最小的東西，然後說出你剛剛建了什麼。

### 練習 4：把 agent loop 放進去 ⭐⭐⭐

把每一次模型呼叫變成一個 step，assistant 訊息就是那個 step 的 output。在需要核准
的工具上 suspend。你現在有了第 09 課的 inbox 加上第 33 課的 durability——以及一個
新問題：模型的回應不是確定性的，所以一個被重跑的 step 不會產生 journal 上記著的
那個東西。
