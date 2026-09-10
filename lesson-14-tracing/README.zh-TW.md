# 第 14 課：上週這個 agent 到底做了什麼？

> [English](README.md)
>
> 先修：[第 08 課](../lesson-08-permissions/)（audit log 是它的練習 4）、
> [第 18 課](../lesson-18-scheduling/)（東西會無人值守地跑）、
> [第 19 課](../lesson-19-delegation/)（東西會委派出去）、
> [第 26 課](../lesson-26-cost/)（成本是量出來的，不是估出來的）。
>
> 來源：`mastra/packages/core/src/observability/types/tracing.ts`——`:35` 的
> `SpanType` enum、`:768` 的 `traceId`、`:810` 的 `parent`。

第 8 課的練習 4 做了一份 audit log：每一個權限決定、它依據的規則，附加進一個檔案。
它把「發生了什麼」回答得很完整。

然後操作者問了那個它答不出來的問題：

> 這個 `stripe_create_refund`——它是誰的請求的一部分，而那個請求總共花了多少？

```bash
bun run lesson-14                              # offline: six questions, two records
RUNS=3 PROVIDER=openai bun run lesson-14:agent # real model: what it says when it cannot know
```

## Step 1：那個早上

四件事，互相重疊：

```text
08:00  a cron run summarises overnight alerts     (Lesson 18)
08:01  Dana asks for a refund      → delegates to a subagent (Lesson 19)
08:01  Sam asks for deploy status  → starts while Dana's is still running
08:02  Dana asks something else in a second tab   → two open requests, one person
```

沒有任何對抗性的東西，也沒有什麼有趣的失敗。一個平凡的早上就已經夠了。

## Step 2：兩份紀錄帶著同樣的資訊

recorder 為每一個事件同時寫一行 log **和**一個 span，屬性完全一樣。這個比較比的是
結構，不是「少給一邊東西」——想證明「log 比較差」，只要把 log 寫爛就好了。

log：

```text
08:00:00  system  cron: summarise overnight alerts   4200tok 3c
08:01:00  dana    dana: process the refund on ch_4471
08:01:14  dana    model: verify                      38400tok 27c
...
```

span 是同樣的事件加一個欄位：`parentSpanId`。差別就只有這樣，而 Mastra 的分類法是
值得抄的形狀——`AGENT_RUN` 與 `WORKFLOW_RUN` 被寫明是**根** span，`TOOL_CALL` 與
`MODEL_GENERATION` 不是。

## Step 3：操作者真的會問的六個問題

一份紀錄能回答一個問題，條件是那個答案可以**從它算出來而不用猜**——跟第 29 課
對證據的標準一樣。

| question | log | spans |
|---|---|---|
| What did the agent do between 08:00 and 08:04? | yes | yes |
| Which actions were auto-allowed, which were asked? | yes | yes |
| That refund call — which request was it part of? | no | yes |
| What did Dana's refund request cost? | no | 30c |
| The subagent burned 38,400 tokens — on whose behalf? | no | yes |
| Three refund calls: three refunds or one retried? | yes | yes |
| | **3/6** | **6/6** |

六個裡有三個對 log 有利或打平，而那不是客套。前兩個正是 log **存在的目的**，而且
log 回答它們比樹更簡單。這個分野不是「細節多寡」：

> log 記錄的是事件。樹記錄的是因果。每一個關於成本、歸屬、委派的問題，都是第二種。

重試那一題是有趣的差一點。log 答得出來——但只因為寫那個工具的人記得記下 `attempt`
欄位。樹是從它的形狀知道的，不管誰記不記得。

## Step 4：那個變通做法，真的試了

「就把 log 按 actor 加總啊」是每個人都會先想到的，所以 demo 真的跑了它，而不是
直接否定：

```text
  sum of Dana's log lines    39c
  Dana's refund, from tree   30c
```

那 9c 是 Dana 的**第二個**請求，她在另一個分頁開的那個。`actor` 是 `request` 的
替身，而它成立的前提是沒有人同時開兩件事——而那正是任何聊天介面的常態。

**這是建這一課的過程中最重要的一次更正。** 初稿那個早上是一人一個請求，所以按
actor 加總會得到 30c：正確答案，但是矇到的。當時那個 demo 在宣稱 log 做不到一件
它自己的資料顯示它做得到的事。一個不包含失敗案例的情境，證明不了那個失敗，而
`tests/tracing.test.ts` 現在把那個 39c 釘住了，讓這個案例不會又安靜地消失。

## Step 5：把每份紀錄交給一個模型

離線那一半談的是紀錄。這一半談的是讀者——因為當紀錄答不出來的時候，一個人翻 log
至少**感覺得到**那份不確定，而一個看起來合理的成本數字，一旦進了 dashboard，就跟
真的沒有分別。

`gpt-5`，三次，問 Dana 那個退款請求的成本，並且明確給了退路（「說 CANNOT
DETERMINE」）。真正的答案是 30c。

| record | correct | declined | wrong |
|---|---|---|---|
| flat log | 0/3 | 3/3 | 0/3 |
| log, names removed | 0/3 | 0/3 | **3/3** |
| span tree | 1/3 | 2/3 | 0/3 |

看中間那一列。把描述性的名字拿掉——`model: verify` 變成 `model`——就讓模型從
**每次都拒答**變成**每次都自信地回答 39c**。同樣的數字、同樣的結構、同樣的問題。
是那些名字在做安全的工作：它們讓讀者看得出這個分組是有歧義的。把它們拿掉，它就
找到一個看起來合理的聚合方式，然後把它當成事實報出來。

那不是原本計畫要找的結果。第一版把 log 那一次答對算成運氣；它不是運氣，它是從
「verify the charge is refundable」這種字串做出來的語意分組——那是真的資訊，只是
剛好在這個情境的命名裡，而只要出現第二筆退款它就又有歧義了。

而最後一列是一個誠實的極限：**span 樹也不保證答案是對的。** 在一份完全支持這個
計算的紀錄上，它三次裡拒答了兩次。一個讓答案**成為可能**的結構，並不會讓讀者真的
把它算出來。

## Step 6：呈現方式不是紀錄本身

上面那個 span 樹的列之所以成立，是因為 `agent.ts` 交出去的是「一個 span 一列、
`parent=` 是一個欄位」。第一版是用縮排把樹漂亮地印出來——就是 `demo.ts` 給人看的
那個輸出——而模型三次裡拒答了兩次，跟它在 flat log 上一模一樣。

那些 parent 關係在資料裡，**卻不在被交出去的那份紀錄裡**。縮排是一種呈現；而呈現
不是合約。那是第 37 課那條規則從另一側出現：在那裡，harness 不該為了知道發生什麼
而去解析散文；在這裡，讀者也不該。

## 這一課刻意不做的部分

| 不做 | 為什麼 |
|---|---|
| OpenTelemetry、OTLP、exporter | 那是這一課談的東西的線路格式。Mastra 的 `observability/` 有真的那一套；parent 指標才是想法本身 |
| 抽樣 | 量大的時候是必要的，而它是成本決定，不是結構決定 |
| 延遲與火焰圖 | 同一棵樹就能回答那些，而成本歸屬才是第 8 課留下的問題 |
| 把 trace 存起來 | 第 33 課已經在問可變的執行狀態住在哪，而答案是同一個形狀 |
| 一個真的 tracing 後端 | 那會學到 ClickHouse 跟一套產品資料模型，而 TODO 正是為了這個理由否決過它 |

## 契約測試

```bash
bun test tests/tracing.test.ts
```

不需要 API key。它釘住：兩份紀錄帶著同樣的屬性（否則這個比較就是作弊）、真的有一個
人同時開著兩個重疊的請求、按 actor 加總得到的是 39 而不是 30、subagent 掛在造成它
的那個請求底下，以及六個問題裡至少有兩個對 log 有利。

它不釘任何模型行為。Step 5 的數字是量測值。

## 練習

### 練習 1：寫出第七個問題 ⭐

寫一個操作者會問、而且**樹也答不出來**的問題。它存在，而找出它就是重點——一個你
講不出極限的機制，就是一個你會過度信任的機制。

### 練習 2：接上第 26 課 ⭐⭐

第 26 課量的是每次呼叫的成本。把那些數字餵進 span 屬性，產出一份逐請求的帳單。
然後看看當一個 subagent 重試的時候，總額會怎麼樣。

### 練習 3：把樹弄壞 ⭐⭐

把中間某一個 span 的 `parentSpanId` 拿掉，然後重跑那六個問題。壞掉幾個？一棵有
孤兒子樹的樹，正是一個 crash 掉的 process 實際會留下的東西（第 33 課），所以請
決定讀者該怎麼描述它。

### 練習 4：重現 Step 5 的中間那一列 ⭐⭐⭐

把名字匿名化，拿到那個自信的 39c。然後試著讓它重新變回拒答，而**不要**把名字放
回去——加一個欄位、一句警告，什麼都行。如果你做不到，你就找到了為什麼答案必須由
結構承載，而不是由散文承載。
