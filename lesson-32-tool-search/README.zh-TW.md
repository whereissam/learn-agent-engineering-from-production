# 第 32 課：200 個工具塞不進 context

> [English](README.md)
>
> Mastra 篇第三課。先修：
> [第 12 課](../lesson-12-mcp/)、[第 17 課](../lesson-17-search/)、
> [第 20 課](../lesson-20-search-agent/)、[第 26 課](../lesson-26-cost/)。
>
> 來源：`mastra/packages/core/src/processors/processors/tool-search.ts`（654
> 行）與 `tool-search-stores.ts`（258 行）。

接上十個 MCP server，你就有兩百個工具。前面每一課都把整份工具清單塞進每一次
request，因為工具只有八個的時候，這樣做顯然是對的。

這一課談的是兩百個的時候會發生什麼事。而第一件發生的事，不是成本論述所預測的
那一件。

```bash
bun run lesson-32              # offline: bytes, ranks, phases
PROVIDER=openai bun run lesson-32:agent   # real model, 12 tasks, 4 modes
```

## 這份工具目錄

`catalog.ts` 有 20 個服務 x 10 個操作。它是合成的——沒有人會公開一份 200 個工具
的清單讓你 clone——而它是圍繞著「真實目錄之所以難」的那個性質建出來的：

```text
"send"       19 of 200 tools mention it
"message"    13 of 200 tools mention it
"issue"      27 of 200 tools mention it
"create"     51 of 200 tools mention it
"list"       35 of 200 tools mention it
```

兩百個**互不重複**的工具會是簡單題。你從十家廠商手上實際拿到的，是四種開 bug 的
方法和五種送訊息的方法。那 12 個任務是照人真正會講的話寫的——「把 on-call 的人
叫起來」，而不是「觸發一個 PagerDuty incident」——因為用工具的詞彙寫出來的任務
集什麼都量不到。

## Step 0：先把機制關掉

把全部 200 份 schema 放進同一個 request：

```text
Mode: ceiling — all 200 tools in one request
  rejected  400 Invalid 'tools': array too long. Expected an array with maximum length 128, but got an array with length 200 instead.
```

這一課本來要談 token 成本。它不是，至少不是第一順位。**在 OpenAI 上，一個
200 工具的 request 不是一個合法的 request。** 再怎麼調 prompt 都過不去；工具
清單有長度上限，而 200 超過了。

這件事改寫了整課的框架。工具搜尋通常被當成一種最佳化來賣，而最佳化是你可以拒絕
的東西。這是一道天花板。

## Step 1：塞得下的時候，這份目錄要多少錢

```text
  all 200 tools          45773 bytes
  2 meta-tools            693 bytes
  ratio               66x
```

是 bytes，不是 token——`demo.ts` 沒有 API key，就不會假裝自己會算 token。真正的
數字在 Step 3 由 provider 給出。

## Step 2：對工具描述做 BM25

機制本身很小，而 Mastra 在 `tool-search.ts:12` 把三個狀態命名了出來：

```ts
export type ToolSearchFilterPhase = 'search' | 'load' | 'active';
```

`search`——在索引裡，schema 不在 context 裡。`load`——模型指名要它。
`active`——完整 schema 進了 request，可以被呼叫。模型拿到的是兩個 meta-tool，
`search_tools` 與 `load_tool`，其他什麼都沒有。

索引就是第 17、20 課那個 BM25，只是換了語料：工具的 `name + description`，而不是
session 訊息（`tool-search.ts:354`）。這是便宜的部分，而且值得講明——這個機制不是
一種新的檢索技術。

但 tokenizer 不一樣。Mastra 在 `tool-search.ts:113` 的設定會切底線與連字號，而且
**沒有 stopword 清單**。切底線是關鍵：`github_update_branch_protection` 必須變成
五個詞，否則查「branch protection」永遠碰不到它。

把使用者的原句直接餵給 BM25，結果只是普通：

```text
  task            rank  expected tool
  oncall             1  pagerduty_trigger_incident
  refund             3  stripe_create_refund
  signups            1  snowflake_run_query
  mainpush        none  github_update_branch_protection
  checkout        none  sentry_list_issues
  staging            8  aws_ec2_stop_instance
  meetingnotes    none  notion_create_page
  shipped           13  twilio_send_sms
  designbug          1  linear_create_issue
  launch             5  sendgrid_send_campaign
  noisy              2  datadog_mute_monitor
  backups            1  aws_s3_get_bucket_size

  in top 5: 7/12    ranked at all: 9/12
```

五個沒中，而且每一個都是詞彙不重疊，不是排序有 bug。「又有人直接推 main」跟
「branch protection rules」沒有共同的詞。「傳簡訊跟客人說出貨了」跟「SMS」也
沒有。關鍵字檢索跨不過這個縫，這是第 22 課的結論換一個地方出現。

**所以查詢字串是模型寫的，不是你寫的。** 設計裡從來沒有規定 `search_tools`
收到的是使用者的原句。

## Step 3：真模型，四種模式

12 個任務、`gpt-5`、`MAX_TOKENS=8192`：

| mode | correct | input tokens | model calls |
|---|---|---|---|
| ceiling (200 tools) | rejected by the provider | — | — |
| flat (128 tools) | 11/12 | 48950 | 12 |
| search-bare (2 meta-tools) | 10/12 | 14009 | 36 |
| search (+ Mastra's instruction) | 9/12 | 14707 | 35 |

flat 這條基準線是刻意寬厚的：128 是 OpenAI 的上限，而且正確工具**一定**在清單
裡。把目錄截斷、然後祈禱答案還在，才是大家實際上會先做的事；但那樣量出來的準確
率，量的是截斷。

老實讀這張表：

- **token 的差距是真的。** 3.5 倍，而且它會隨目錄變大而變大，meta-tool 那一邊
  則是固定的。
- **準確率的差距不是。** 12 題裡 11、10、9，差的是一到兩題。n=12 的時候那是
  雜訊；拿它去宣稱「工具搜尋讓你掉 17% 準確率」就是在說謊。
- **來回次數是真的，而且那是隱藏的價格。** 36 次模型呼叫對上 12 次。token 比較
  便宜，延遲是三倍，出軌的機會也是三倍。

## Step 4：錯的答案全都是同一種錯

兩種模式下的每一個錯，都是跨廠商的近似重複：

| task | wanted | called |
|---|---|---|
| checkout | `sentry_list_issues` | `datadog_search_logs` |
| meetingnotes | `notion_create_page` | `slack_send_message` |
| launch | `sendgrid_send_campaign` | `hubspot_send_marketing_email` |

三個裡有兩個站得住腳。為了 checkout 的 500 去搜 Datadog 的 log 是合理的；把會議
記錄貼到 Slack 也是合理的。**任務集只有一個正確答案，這件事本身是個判斷**，而
那就是這次量測誠實的極限——目錄裡本來就有真正的平手，所以 12/12 對兩種模式來說
從來就不存在。

它確實顯示的是：難的不是數量。難的是有十五個工具都可以是「通知某人」的合理答案，
而更大的 context window 或更好的索引，都解不開一個由目錄本身造出來的平手。

## Step 5：那個其實是量測程式 bug 的「發現」

這個實驗第一次跑出來，search 模式是 **2/12**，而且多數任務回來是「沒有呼叫工具」
——模型看起來是直接用文字回答而不去搜尋。當下明顯的結論是：Mastra 注入的那句
指示（`tool-search.ts:438`）才是這機制能運作的原因。

不是。`MAX_TOKENS` 當時是 2048，而 `gpt-5` 會先把 output 額度花在推理上才輸出
東西。一個沒有文字也沒有工具呼叫的回應不是拒絕，是被截斷，而它讀起來一模一樣。
把額度拉到 8192，search 模式從 2/12 變成 9/12，而 `search-bare`——**沒有**那句
指示——從 0/12 變成 10/12。

所以關於那句指示，誠實的結果是：在足夠的 output 額度下、在這個模型上、在這 12
個任務上，它沒有造成可量測的差別。這是比第一次跑出來的結論弱得多的主張，而它是
數字支持的那一個。第 26 課從成本那一側量過同一個陷阱；這裡它差一點就變成一個
「發現」。

## Step 6：三個階段是三個各自可以說不的地方

Mastra 把 `filter(toolName, tool, phase)` 穿過三個狀態，而它們之間的差別是對話
的差別：

```text
  refuse at search  searchable=false loadable=true  callable=true
  refuse at load    searchable=true  loadable=false callable=false
  refuse at active  searchable=true  loadable=true  callable=false
```

在 `active` 拒絕，代表模型讀了 schema、繞著這個工具做了規劃，然後在呼叫時失敗。
在 `search` 拒絕，代表它從來不知道這個工具存在。

注意第一行：**把工具藏出搜尋結果，並不會擋住它被 load。** 一個從別處學到名字的
模型——從記憶（第 15 課）、從舊 session（第 17 課）、或是使用者直接打出來——會
直接走過這道 filter。如果答案是「這個使用者不可以做這件事」，那它該放在 `load`
或第 8 課的權限引擎裡，而不是搜尋索引裡。`tests/tool-search.test.ts` 把這點釘成
契約測試，讓 demo 不能悄悄開始宣稱相反的事。

## Step 7：被 load 的那組工具住在哪裡

這一課的 `ToolSearchSession` 把已載入集合放在記憶體裡，只活一次執行。Mastra 讓它
可抽換（`tool-search-stores.ts`）：帶 TTL 的 `LegacyMapLoadedToolStore`、以 thread
為鍵的 `ContextLoadedToolStore`。

那不是細節，而它回答的問題是你第二週就會遇到的：

- 第 3 輪載入的工具——第 40 輪還在嗎，還是 TTL 已經把它丟掉了？
- process 重啟了——模型是不是得把一切重新找一遍？
- 同一個使用者兩條 thread——它們共用同一組已載入工具嗎？

那些是第 33 課的問題提早到場。可變的 agent 狀態住在哪裡，是同一個問題，不管那個
狀態是一組已載入工具還是一個被暫停的 workflow。

## 生產版本長什麼樣

vLLM 的 [Semantic Router](https://github.com/vllm-project/semantic-router) 把這個
機制做到了這一課到不了的規模，而它公布的數字（[blog](https://vllm-sr.ai/blog/semantic-tool-selection/)，
量在 Berkeley Function Calling Leaderboard 上）值得跟上面那些放在一起看：

| tools | baseline accuracy | with selection |
|---|---|---|
| 49 | 94% | 94% |
| 207 | 64% | 94% |
| 417 | 20% | 94% |
| 741 | 13.62% | 43.13% |

以及工具目錄從 127315 個 token 降到 1084 個。

跟這一課有兩個差別要緊。它用 **embedding 與 cosine similarity** 來選，而不是
BM25，那是第 22 課的稀疏對稠密之爭再次出現——而既然 Step 2 裡每一個沒中都是詞彙
不重疊，那個方向是對的。而且它在**模型看到任何東西之前**就先過濾，完全沒有
`search_tools` 那一輪，這拿掉了 Step 3 量到的來回成本，同時也把模型的判斷拿出了
迴圈。

他們那張表也是 Step 3 裡 flat 基準線在準確率上勝出的解答：49 個工具時，選擇機制
什麼都不改變；417 個時，它是 20% 與 94% 的差別。這一課 200 個工具的目錄，坐在
交叉點的近側。在你把這機制加進一個 30 工具的 agent 之前，這件事值得先知道。

## 契約測試

```bash
bun test tests/tool-search.test.ts
```

不需要 API key。它保護的是這個機制的不變量——meta-tool 永遠在、沒有 load 就不可
呼叫、被拒絕的名字要回報而不是吞掉、藏出搜尋不等於存取控制——以及一條寬鬆的檢索
品質下限。它刻意**不**去釘 7/12 或 9/12：那些是量測值，而一個模型一改就會紅的
測試，就是一個會被刪掉的測試。

## 這一課刻意不做的部分

| 不做 | 為什麼 |
|---|---|
| 以 embedding 做選擇 | 第 22 課已經建過稠密檢索；這裡的重點是接縫放在哪，而上面的生產比較已經說了差別 |
| Mastra 的 `autoLoad` 模式 | 它把 search 和 load 併成一步，正好拿掉這一課要談的那個階段 |
| per-thread store 與 TTL | Step 7——狀態問題是第 33 課的，值得留位置給它 |
| 工具**結果**的大小 | 200 個工具的目錄和一份 200KB 的工具結果是兩個問題；第 05 課處理後者 |
| 用模型對搜尋結果重排 | 第 17 課量過，而 Hermes 早就把它刪了：呼叫工具的那個東西本來就是模型 |

## 練習

### 練習 1：把那五個詞彙沒中的補起來 ⭐

在 `CatalogTool` 上加一個 `keywords` 欄位，跟描述一起進索引，把「SMS」「text
message」「branch protection」「direct push」放到它們該在的地方。重跑
`bun run lesson-32` 數一次。然後問更難的問題：一個從別人 MCP server 來的工具，
那些關鍵字由誰寫？

### 練習 2：找出交叉點 ⭐⭐

`FLAT_LIMIT=32 bun run lesson-32:agent`，然後 64、128。把準確率與 input token
對目錄大小畫出來。上面 Semantic Router 那張表說交叉點在 200 之後某處——去量出
**你的** provider 的交叉點在哪，並且記得 n=12 定不了一題之差。

### 練習 3：把權限放在對的階段 ⭐⭐

把第 8 課的風險等級接進 `PhaseFilter`。有理由地決定：哪一類在 `search` 就拒絕、
哪一類在 `load` 拒絕、哪一類走到 `active` 然後改成要求核准。demo 的 Step 5 說明
了這個選擇為什麼不是裝飾。

### 練習 4：把 process 殺掉 ⭐⭐⭐

載入三個工具、把 session 存下來、重啟、再讀回來。第 33 課要談的一切，已經坐在那
個 `loaded` 集合裡了——它是你能弄丟又會被發現的、最小的一塊 agent 狀態。
