# Lesson 5: Context 壓縮

> 前置：[Lesson 4](../lesson-04-sessions/)。最後一課。
>
> 目標：讓 agent 能一直聊下去，不會因為對話太長而爆掉。

## 這課要回答的問題

1. 為什麼對話越長越貴？貴多少？
2. 什麼時候該壓縮？壓縮到什麼程度？
3. 摘要要保留什麼、丟掉什麼？
4. 壓縮之後，原始訊息應該刪掉嗎？（Lesson 4 練習 6 的答案）

---

## Step 0：先跑起來

```bash
bun run lesson-05
```

```
> 把 playground 的 README、docs 底下所有檔案和 src 底下每個檔案都讀過一遍，
  列出每個模組負責什麼
```

真的跑出來的（Gemini 3.6 Flash，預設門檻 8000）：

```
  [壓縮中… 目前約 8417 tokens]
  [已壓縮 43 則訊息：8417 → 406 tokens，省下 95%]

  [壓縮中… 目前約 15638 tokens]
  [已壓縮 46 則訊息：15638 → 7351 tokens，省下 53%]

> /tokens
  55 則訊息，約 16290 tokens
  壓縮門檻 8000（目前 204%）
```

**一次普通的調查就觸發了兩次壓縮**，而且兩次省下的比例差很多
（95% vs 53%）。那個差別本身就是一課，Step 4 會講。

> ⚠️ 這個 playground 刻意做得比 Lesson 1-4 的大很多（14 個檔案、
> 約 26KB），因為**小專案讀不出這一課要講的問題**。
> 前四課的 playground 只有 3 個檔案，全部讀完也才 800 tokens，
> 你得把門檻調到 300 才看得到壓縮——那樣看到的是「參數調很低」，
> 不是「context 真的滿了」。

沒有 API key 也想看的話，用假 provider 配一個很低的門檻：

```bash
COMPACT_AT=300 PROVIDER=fake bun run lesson-05
```

```
  [壓縮中… 目前約 424 tokens]
  [摘要不比原文短，這次跳過壓縮]

  [壓縮中… 目前約 473 tokens]
  [已壓縮 5 則訊息：473 → 203 tokens，省下 57%]
```

「摘要不比原文短就跳過」也是 Step 4 的內容。

用 `/tokens` 隨時看目前狀況：

```
> /tokens
  13 則訊息，約 578 tokens
  壓縮門檻 8000（目前 7%）
```

---

## Step 1：問題有多嚴重

LLM 是**無狀態**的。它不記得上一輪講過什麼，每一輪你都要把完整對話
重送一次。所以 token 用量不是線性成長，是**平方級**的：

| 輪次 | 這一輪送出的 token | 累計送出 |
|---|---|---|
| 1 | 1,000 | 1,000 |
| 2 | 2,000 | 3,000 |
| 5 | 5,000 | 15,000 |
| 10 | 10,000 | 55,000 |
| 20 | 20,000 | 210,000 |

20 輪對話，你送出去的總量是最後那一輪的 **10 倍**。

而且不只是錢：

1. **延遲**，input token 越多，第一個字出來得越慢
2. **上限**，撞到 context window 就直接失敗，整輪報廢
3. **品質**，太長的 context 裡，中間的資訊模型比較容易忽略

> 💡 prompt caching 能大幅降低成本（重複的前綴便宜約 10 倍），
> 但它解決不了 context window 上限的問題。壓縮還是需要。

---

## Step 2：壓縮的形狀

```
壓縮前： [msg1][msg2][msg3]……[msg40][msg41][msg42]
          └────────── 40 則舊訊息 ──────┘ └─ 最近 ─┘

壓縮後： [摘要:msg1-msg36 ][msg37]……[msg42]
          └─ 一段文字 ──┘  └─ 保留原文 ─┘
```

**保留尾巴**是關鍵。最近的訊息通常正是使用者在講的事情，把它們摘要掉，
agent 會立刻忘記「我們剛剛在幹嘛」。

```ts
export const DEFAULT_COMPACTION: CompactionConfig = {
  triggerTokens: Number(process.env.COMPACT_AT ?? 8000),
  keepRecent: 6,
  summaryMaxTokens: 2000,
};
```

### 什麼時候檢查？

```ts
let messages = session.messages();

// 在「送出請求之前」檢查
if (shouldCompact(messages, COMPACTION)) { … }
```

時機很重要：**送出之前**，不是收到回應之後。太晚檢查的話，那個超長的請求
已經送出去（而且已經付錢）了。

### token 估算：故意不準

```ts
return Math.ceil(chars / 4);
```

真要準就得呼叫 provider 的 `count_tokens` API，每家不一樣，而且要多打
一次網路請求。但**壓縮的觸發時機不需要精準**，差 10% 不會怎樣。

`4` 是英文的經驗值。中文大約 1.5–2 個字元一個 token，所以這個函式對中文
會**低估**。這是刻意的：寧可低估而晚一點壓縮，也不要高估而過早壓縮
（過早壓縮 = 白花一次摘要的錢）。

---

## Step 3：摘要的 prompt 才是重點

壓縮的品質完全取決於這段 prompt。看 [`shared/compaction.ts`](../shared/compaction.ts)：

```
The summary you write REPLACES those messages. Anything you leave out is
gone forever - the agent will not be able to recover it.

Preserve, in this order of priority:
1. What the user asked for, including constraints and preferences they stated.
2. Files that were read or modified, with their paths. Note what was changed.
3. Decisions made and the reasoning behind them.
4. Facts discovered about the codebase (structure, conventions, gotchas).
5. Anything that failed, and why - so the agent does not repeat it.
6. Work that is still outstanding.

Drop: full file contents, verbose command output, exploratory dead ends.
```

三個設計重點：

**1. 講清楚後果**，「你沒寫進去的東西就永遠消失了」。這句話顯著提升
模型保留關鍵細節的傾向。

**2. 明確排序**，不寫優先序的話，模型會寫出一段文情並茂但沒有可執行
資訊的摘要（「我們討論了程式碼品質議題」，完全沒用）。

**3. 明確說要丟什麼**，不然模型傾向什麼都留一點，摘要就壓不小。

第 5 點特別容易被忽略：**失敗的嘗試一定要留**。不然壓縮後 agent 會
興高采烈地重試一次剛剛才失敗過的方法。

### 摘要放成 `user` 而不是 `assistant`

```ts
const summaryMessage: Message = {
  role: "user",
  text: "[以下是這次對話較早部分的摘要。原始訊息已從 context 中移除以節省空間。]\n\n" + summary + …,
};
```

assistant 訊息代表「模型說過的話」，但這段摘要是**我們（harness）產生的**。
放成 assistant 會讓模型以為自己講過這些，可能導致奇怪的自我指涉
（「如我剛才所說……」，但它根本沒說過）。

---

## Step 4：壓縮可能讓事情變糟

這是我實測才發現的。第一次壓縮：

```
  [壓縮中… 目前約 424 tokens]
  [已壓縮 3 則訊息：424 → 455 tokens，省下 -7%]
                                        ↑ 倒賠
```

原因：摘要有**固定成本下限**。那段「[以下是摘要…]」的包裝文字，加上模型
至少會寫幾行，如果被壓縮的訊息本來就短，摘要反而比原文長。

所以算完要檢查：

```ts
if (tokensAfter >= tokensBefore) {
  return {
    messages,              // ← 退回原本的
    tokensAfter: tokensBefore,
    compactedCount: 0,     // 0 代表「算了，沒壓」
  };
}
```

修好之後：

```
  [壓縮中… 目前約 424 tokens]
  [摘要不比原文短，這次跳過壓縮]      ← 認賠一次摘要的錢，但至少沒讓 context 變大

  [壓縮中… 目前約 473 tokens]
  [已壓縮 5 則訊息：473 → 203 tokens，省下 57%]
```

> 注意：跳過壓縮**還是花了一次摘要的錢**。要避免這個，就要把
> `keepRecent` 跟 `triggerTokens` 調成「觸發時一定有夠多東西可壓」。

---

## Step 5：切點不能亂切

```ts
function findCutoff(messages: Message[], keepRecent: number): number {
  let cutoff = Math.max(0, messages.length - keepRecent);

  // 往後推，直到切點「不是」一則 toolResult
  while (cutoff < messages.length && messages[cutoff]?.role === "toolResult") {
    cutoff++;
  }

  return cutoff;
}
```

**切點不能落在 `assistant(有 toolCall)` 跟它的 `toolResult` 中間。**

切在那裡的話，保留下來的訊息會以一則「沒有對應 tool_use 的 tool_result」
開頭，API 直接回 400。這跟 Lesson 3 中斷點 B 是同一條規則的另一面：

> tool call 跟 tool result 必須成對出現。

Lesson 3 是「中斷時要補齊結果」，這裡是「切割時不能拆散它們」。

---

## Step 6：原始訊息不刪（Lesson 4 練習 6 的答案）

```ts
await session.appendMeta("compaction", {
  summary: result.summary,
  tokensBefore: result.tokensBefore,
  tokensAfter: result.tokensAfter,
  compactedCount: result.compactedCount,
});
await session.append(result.messages[0] as Message);
```

注意這裡**只有 append，沒有任何刪除**。

壓縮改變的是「**下一次要送給模型什麼**」，不是「磁碟上留著什麼」。
原始訊息還在 JSONL 檔案裡，你隨時可以：

- 回顧完整對話（`/tree` 看得到全部）
- 檢查摘要有沒有漏掉重要資訊
- 拿真實對話當訓練或評測資料
- 用不同的摘要 prompt 重跑一次

這就是 Lesson 4 那個 append-only 設計的回報。**「模型看到的 context」
跟「你保存的歷史」是兩件不同的事**，不要把它們綁在一起。

---

## 跑不起來？

| 症狀 | 原因 | 解法 |
|---|---|---|
| 一直沒看到壓縮 | 門檻太高 | `COMPACT_AT=300 bun run lesson-05` |
| 每次都「跳過壓縮」 | 觸發太早，沒東西可壓 | 調高 `COMPACT_AT` 或調低 `keepRecent` |
| 壓縮後 agent 忘記剛剛在幹嘛 | `keepRecent` 太小 | 調大，或改進摘要 prompt |
| 壓縮後 API 回 400 | 切點拆散了 tool call/result | 見 Step 5 |
| 壓縮很慢 | 它是一次額外的 LLM 呼叫 | 正常。用便宜的 model 做摘要（見練習 3） |

---

## 練習

### 練習 1：把摘要印出來看 ⭐

加一個 `/summary` 指令，顯示最近一次壓縮的摘要（已經用 `appendMeta`
存進 session 了）。

讀讀看它保留了什麼、丟了什麼。**這是評估壓縮品質最直接的方法。**

### 練習 2：故意把摘要 prompt 寫爛 ⭐

把 `SUMMARY_SYSTEM_PROMPT` 換成 `"Summarize the conversation."`，
然後跑一段長對話。

觀察 agent 壓縮後的行為：它會忘記使用者的要求嗎？會重試已經失敗過的方法嗎？

### 練習 3：用便宜的 model 做摘要 ⭐⭐

摘要不需要最強的模型。讓 `compact()` 收一個不同的 provider：

```ts
compact(cheapProvider, messages, config, signal)
```

主對話用 Opus / GPT-5，摘要用 Haiku / Flash-Lite。

### 練習 4：實測平方級成長 ⭐⭐

記錄每一輪送出的 input token 數，畫成表格。
把壓縮關掉跑一次、開啟跑一次，比較累計用量。

### 練習 5：分層壓縮 ⭐⭐⭐

現在壓縮兩次之後，是「摘要 + 摘要 + 最近訊息」。改成把舊摘要也一起
壓進新摘要，變成單一的滾動摘要。

想一想：這樣做，資訊會不會在反覆摘要中越失越多？（會。這叫
summarization drift。真實系統怎麼緩解？）

### 練習 6：Context editing，不摘要，直接刪 ⭐⭐⭐

另一種省 token 的做法是**直接刪掉舊的工具輸出**，保留訊息結構。
讀一個 10000 行檔案的結果，隔了 20 輪之後幾乎一定沒用了。

實作一個 `clearOldToolResults(messages, keepRecent)`，把舊的 tool result
內容換成 `"[output cleared to save context]"`。

比較它跟摘要式壓縮：哪個省得多？哪個保留的資訊比較有用？
（真實系統兩個都用。Claude API 兩個都有內建。）

---

## 對照 Pi 原始碼

| 這一課的概念 | Pi 的對應位置 |
|---|---|
| 壓縮主流程 | `packages/agent/src/harness/compaction/compaction.ts`（880 行） |
| 分支摘要 | `harness/compaction/branch-summarization.ts` |
| 壓縮記錄進 session | `harness/types.ts:403` (`CompactionEntry`) |
| 壓縮觸發時機 | `packages/agent/src/types.ts:217` (`shouldStopAfterTurn`) |
| context 轉換 hook | `types.ts:195` (`transformContext`) |
| 摘要 prompt | `harness/compaction/compaction.ts`（跟壓縮邏輯放在一起） |

`CompactionEntry` 有個欄位很值得看：

```ts
export interface CompactionEntry<T = unknown> extends SessionTreeEntryBase {
  type: "compaction";
  summary: string;
  firstKeptEntryId?: string;   // ← 從哪一筆開始保留原文
  tokensBefore: number;
  retainedTail?: AgentMessage[];
  …
}
```

`firstKeptEntryId` 讓 Pi 能精確重建「壓縮當下的 context 長什麼樣」，
因為原始訊息全都還在樹裡。跟我們 Step 6 講的是同一個道理，只是做得更完整。

---

## 恭喜，你跑完了

五課下來，你的 agent 有：

| | 能力 | 核心檔案 |
|---|---|---|
| 1 | tool calling、agent loop、provider 抽象 | `lesson-01-agent-loop/agent.ts` |
| 2 | 多工具、輸出截斷、批准機制 | `shared/tools/` |
| 3 | streaming、中斷、狀態修復 | `shared/streaming/` |
| 4 | session 持久化、分支 | `shared/session/` |
| 5 | context 壓縮 | `shared/compaction.ts` |

而那個核心迴圈，從 Lesson 1 到 Lesson 5 **基本上沒有變過**。這是整個系列
最想讓你記住的一件事：

> **Agent 的本質很小。周圍的工程很大。**

### 接下來

**讀 Pi 的原始碼。** 你現在有能力了：

```bash
git clone https://github.com/earendil-works/pi
```

從 `packages/agent/src/agent-loop.ts:170-272` 開始，那 100 行你已經
寫過五次了，只是它處理了更多邊界情況。

**或者，把它接到你自己的東西上。** 這五課的 `shared/` 是可以直接拿去用的：
換掉工具、換掉 system prompt，你就有一個屬於你自己領域的 agent。
