# 第 38 課：你自己弄壞的那個 cache

> [English](README.md)
>
> 先修：[第 05 課](../lesson-05-compaction/)、[第 15 課](../lesson-15-memory/)、
> [第 26 課](../lesson-26-cost/)、[第 32 課](../lesson-32-tool-search/)。
>
> 來源：`opencode/packages/llm/src/protocols/utils/cache.ts`（16 行）與
> `protocols/anthropic-messages.ts`（855 行）。

前面每一課都是組出一個 request 然後送出去。這一課問的是**上一個** request 跟它
有什麼關係，而那個答案決定了你帳單的大部分。

```bash
bun run lesson-38                          # offline: where the prefix breaks
PROVIDER=openai bun run lesson-38:probe    # real: what the provider charges
```

這是這個系列的最後一課，也是唯一一堂主要在講前面那些課的。第 05、15、32 課各自
往 request 裡加了東西，而沒有一課提過：把它加在**那個位置**要花多少錢。

## Step 1：一切都從這一個事實長出來

provider 快取的是**前綴**，不是 request。它從第 0 個位元組開始讀，重用它看過的
部分，停在第一個不一樣的地方。

所以 cache 不是你打開的東西。它是你保住的東西，而你是從前面把它弄壞的。系統
提示最上面的一行，比它下游所有的最佳化加起來都重要。

## Step 2：量出來的結果

同一段對話五輪、六種組法、`gpt-5`。數字是 provider 自己的
`usage.prompt_tokens_details.cached_tokens`——絕不由我們算，理由第 26 課講過。

| configuration | cached, turns 2-5 | hit rate | 它是什麼 |
|---|---|---|---|
| stable prefix | 55040 | 98% | 對照組 |
| timestamp first | 0 | 0% | 系統提示裡的一行 |
| memory in system | 0 | 0% | 第 15 課的形狀 |
| tool list grows | 54144 | 96% | 第 32 課的形狀 |
| tool list reordered | 53760 | 96% | 同一批工具，不同順序 |
| volatile last | 55168 | 98% | 同樣的內容，換位置 |

每一列都排除了第 1 輪：它照定義就是冷的，算進去只會讓六列被同一件事同等地扣分。

兩列扛著這一課。**在一個其他部分完全相同的 prompt 前面放一個時間戳，代價是整個
前綴，每一輪，永遠。** 而最後一列是同一個時間戳、同一批召回的記憶，搬到訊息串
的最後面：98%。模型在兩種情況看到的資訊一模一樣。變的只有位置。

## Step 3：這個系列叫你做的事，以及它的代價

`memory in system` 不是稻草人。它就是第 15 課，忠實地：

```ts
manager.buildSystemPrompt()   // recalled memories, at the top, every turn
```

把記憶召回來、放在模型最看重的位置，對一個記憶系統來說是正確的行為。它同時也是
「放任何會變的東西」最貴的那個位置。

| 課 | 它加了什麼 | 放在哪 | 代價 |
|---|---|---|---|
| 15 記憶 | 召回的記憶 | 系統提示 | 整個前綴，每一輪 |
| 05 壓縮 | 一份取代歷史的摘要 | 對話中段 | 改寫點之後的一切，一次 |
| 32 工具搜尋 | 工具，隨著載入 | 工具清單的尾端 | 約 2%，見 Step 4 |
| 31 processor | 在送出的路上改東西 | 看它掛在哪 | 完全取決於位置 |

那些課沒有一課是錯的。錯的是沒有一課提過這件事——而這個系列必須先寫完，這個代價
才看得見。

## Step 4：那個錯掉的預測

這一課的計畫，在任何東西跑起來之前就寫進了 `docs/TODO.md`，說第 32 課那個會長大
的工具清單會把前綴弄壞，「因為工具清單是前綴的一部分」。量出來是 96%。

兩個理由，而且兩個都比原本那個說法值錢：

**它是用附加的方式長大的。** 弄壞前綴的不是「長大」，是「改寫前面已經有的東西」。
一個在尾端增加項目的工具清單，跟一個在尾端增加輪次的訊息串一樣安全——而
`tool list reordered`，一個沒有新增也沒有刪除的東西，才是真正該怕的形狀。在這份
目錄裡它同樣只花 2%，因為工具那一塊很小。

**你 request 物件裡各區塊的順序，不是 provider 拿去雜湊的順序。**
`{ system, tools, messages }` 是你寫的樣子；而那些量測只有在 `tools` 被當成坐在
`messages` **後面**的時候才說得通。所以 `prefix.ts` 兩種順序都帶著，而且明說其中
一種是量出來的、不是文件寫的：

```ts
export const SECTIONS: Section[] = ["system", "tools", "messages"];
export const OPENAI_ORDER: Section[] = ["system", "messages", "tools"];
```

兩個都不是承諾。那是某一家 provider 在某一天的行為，而那正是這一課附上一支探針、
而不是一條規則的原因。

## Step 5：一個可重複的 cache 實驗，量的不是 cache

`probe.ts` 的第一版用了固定的時間戳——`21:0N:00Z`——好讓每次跑的結果可以重現。
第二次跑報出來是這樣：

```text
  stable prefix          99%
  timestamp first        99%
  memory in system       99%
  tool list grows        99%
```

每一種組法都完美，包括那兩個剛剛才量到 0% 的。

什麼都沒有被修好。一個確定性的「易變」欄位並不易變：第 2 次跑送出的 request 跟
第 1 次逐位元組相同，於是打中了第 1 次自己填進去的 cache。這個實驗量的是它自己
上一次的執行。

修法是一個 per-run 的 nonce，而它**放在哪**，正好就是整堂課在問的那個問題。它必須
放在**每一個 builder 裡的穩定位置**——系統提示的第一行，在這個 process 的一生中
都不變。只把它放進那些易變的 builder 是第一次的嘗試，而那也是錯的：沒被動到的那
幾種組法會繼續打中上一次跑留下來的 cache。

```ts
export const RUN_ID = Math.random().toString(36).slice(2, 10);
export const SYSTEM_BASE = `Session ${RUN_ID}\n${SYSTEM_RULES}`;
```

`tests/prompt-cache.test.ts` 把這件事釘住，因為它不是細節——它是「一個結果」與
「一個巧合」之間的差別。第 32 課的 `MAX_TOKENS` 假象是前一課同一類的錯誤，而這個
模式值得取個名字：**當一個量測結果完全同意你的時候，先懷疑量測程式，再相信它。**

## Step 6：看區塊，不要看百分比

`bun run lesson-38` 在離線狀態數字元，而它自己的輸出就在反駁它自己的頭條數字：

```text
  configuration           reusable     lost  first change in
  stable prefix               100%      181         messages
  timestamp first               0%    64118           system
  memory in system              0%    64180           system
  tool list grows              98%     1029            tools
  tool list reordered          97%     1853            tools
  volatile last                99%      576         messages
```

`tool list reordered` 把整份工具清單重寫了一次，卻還是顯示 97% 可重用，因為那個
40k 字元的系統提示把其他東西都壓過去了。百分比由最大的那一塊主導；**區塊才是
訊號。**

## Step 7：Anthropic 逼你選，選四次

OpenAI 隱式地快取前綴。Anthropic 不是——你要標出要在哪裡快取，而每個 request 在
`tools`、`system`、`messages` 加起來只有四個標記。OpenCode 在
`anthropic-messages.ts:234` 的註解說了超過會怎樣：

> Beyond the cap the API returns a 400 — so the lowering layer counts emitted
> markers and silently drops any that exceed it.

所以 `Breakpoints` 有兩個欄位，而有意思的是第二個：

```ts
export interface Breakpoints {
  remaining: number
  dropped: number
}
```

`dropped` 存在，是因為「被丟掉」這件事是看不見的。什麼都不會丟出例外，什麼都不會
警告。你安排了一個折扣、你沒有拿到、而唯一的證據是帳單。那跟第 32 課那個被安靜
截斷的回應、第 33 課那個被安靜重跑的 step 是同一個形狀：**活最久的失敗，是那些
沒有錯誤訊息附在上面的。**

## 這一課刻意不做的部分

| 不做 | 為什麼 |
|---|---|
| Anthropic 的量測 | 這裡沒有 key。breakpoint 的邏輯有重建也有測試；Step 2 的數字是 OpenAI 的，而且有標明 |
| 把省下來的錢換算成金額 | 錢歸第 26 課管，而且 cache 折扣每家、每個等級都不一樣 |
| 一個懂 cache 的 `runTurn` | 設計原則 6。這一課的發現是「東西該放哪」，不是再包一層 |
| semantic / response cache | 那是另一個機制：重用的是**答案**，不是前綴。它回答另一個問題，也用另一種方式壞掉 |
| 去修第 15 與 32 課 | 就它們各自要教的東西而言，它們寫得是對的。要不要換這個取捨，在練習 2 |

## 契約測試

```bash
bun test tests/prompt-cache.test.ts
```

不需要 API key。它釘住的是結構性的主張——前面改一個字就什麼都重用不到、同樣的
內容搬到後面幾乎全部重用得到、附加比改寫便宜一個數量級、四個 breakpoint 之後是
沉默——以及 Step 5 那個方法論修正。它不釘任何 hit rate：那些是量測值，而一個
provider 改了 cache 就會紅的測試，是一個會被刪掉的測試。

## 練習

### 練習 1：在你自己的 agent 裡找出那個時間戳 ⭐

把連續兩輪的系統提示印出來 diff。多數 agent 剛好有一行不一樣，而它通常是日期、
session id，或者一份從 `Set` 渲染出來的「可用工具」清單。

### 練習 2：把第 15 課的記憶搬走 ⭐⭐

把召回的記憶放進最後一則使用者訊息，而不是系統提示，然後重跑第 15 課的注入實驗。
便宜是一定的——但模型還會用同樣的權重看待它們嗎？第 15 課的整個重點是記憶是一個
持久的注入面，而搬動它會改變它相對於使用者發言的位置。兩個性質都量過再決定。

### 練習 3：放四個 breakpoint ⭐⭐

給定工具、系統提示、一段長歷史、以及當前這一輪，選出那四個標記。然後寫下：當第
五個東西也想要一個標記時，你會先放棄哪一個，以及為什麼。

### 練習 4：把它變得看得見 ⭐⭐⭐

把 cache 命中率加進第 26 課的成本帳裡，並且在命中率在兩輪之間下降時發出警告。然後
去查出：你自己的 agent 有多少比例的 request 正在付全額，而沒有人注意到。
