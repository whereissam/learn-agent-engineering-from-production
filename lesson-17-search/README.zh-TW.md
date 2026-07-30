# Lesson 17: 跨 session 搜尋

> [English](README.md)
>
> 前置：[Lesson 4](../lesson-04-sessions/README.zh-TW.md)（session 持久化）、
> [Lesson 15](../lesson-15-memory/README.zh-TW.md)（長期記憶）。
>
> 記憶記「事實」，skill 記「做法」，這一課處理第三種：
> **「上次我是怎麼做的？」**
>
> 對照原始碼：`hermes-agent/tools/session_search_tool.py`（1120 行）

## 這課要回答的問題

1. 三種查詢模式怎麼用同一個工具表達？
2. 為什麼這裡完全沒有 LLM？（這裡很容易想錯）
3. 排程任務怎麼把使用者的對話「壓掉」？
4. 搜尋怎麼會把 Lesson 5 壓縮掉的東西又搬回來？

---

## Step 0：先跑起來

五個情境示範排序、降權、bookend、來源過濾。**不需要 API key，
而且這一課的排序器裡面永遠不會有 LLM**（Step 1 會講為什麼）：

```bash
bun run lesson-17
```

排序壞掉之後，下游的 agent 會怎樣？那個要真的模型才問得出來。
模型接在排序器**外面**，不違反上面那句話：

```bash
DEMOTE=off PROVIDER=gemini bun run lesson-17:agent
```

實測在 Step 3.5，結果比預期的複雜。

---

## Step 1：原本想錯的地方

`docs/TODO.md` 裡原本這樣寫這一課：

> Hermes 用 SQLite FTS5 + LLM 摘要的兩段式設計，
> 跟 Lesson 6 的 `find_anomalies` 是同一個模式。

讀了原始碼才發現這是錯的。 `session_search_tool.py` 的 docstring：

> All three modes operate on the SQLite session DB via the FTS5 index...
> **No LLM calls anywhere** - every shape returns actual messages from the DB.

而且 History 註記講明那是**後來拿掉的**：

> PR #20238 (JabberELF) seeded a fast/summary dual-mode split; ...
> This module merges all of that into a single calling shape with
> no mode parameter, **no summary LLM path**, and explicit scroll support.

他們試過摘要路線，然後移除了。

### 為什麼不需要 LLM

因為**呼叫這個工具的本來就是模型**。

你不需要另一個 LLM 幫它判斷「這段歷史相不相關」，把原始訊息給它，
它自己會判斷。中間那層摘要只是多花一次錢、多一次延遲、
多一個會出錯的地方，而且還會**丟失細節**。

### 跟 Lesson 6 的差別

這個對比值得想清楚：

| | 誰縮小範圍 | 誰下判斷 | 為什麼 |
|---|---|---|---|
| Lesson 6 `find_anomalies` | 規則 | 模型 | 那個「模型」就是要下判斷的 agent |
| Lesson 17 `session_search` | 規則 | 模型 | 結果本來就是要給 agent 看的 |

其實兩者**是同一個原則**：規則負責 recall，模型負責 precision。
差別只在 Lesson 6 另外做了統計（因為 600 筆樣本模型算不動），
這裡不需要，訊息本來就是文字，直接給就好。

判準是：

> 你是在幫模型縮小範圍，還是在替模型做決定？
>
> 前者值得加一層，後者不值得。

---

## Step 2：三種模式，一個工具

Hermes 的 `session_search` **沒有 mode 參數**，從引數推斷：

```
① DISCOVERY  給 query                          → 找相關的 session
② SCROLL     給 session_id + around_message_id → 在已知位置前後翻
③ BROWSE     什麼都不給                          → 列最近的 session
```

為什麼不做成三個工具？因為它們回傳的是同一種東西（session 裡的訊息），
只是入口不同。三個工具會讓模型的工具清單變長、也讓它更容易選錯。

> 這跟 Lesson 6 的工具設計原則一致：**工具的數量要對應「能力」的數量，
> 不是「參數組合」的數量。**

### SCROLL 的翻頁方式值得學

不是用 offset，而是**重新錨定**：

> To scroll forward / backward, re-anchor on the last / first message id
> of the returned window.

好處是即使中間有新訊息插入，也不會跳過或重複。
（用 offset 的話，插入一則就會讓整個分頁位移。）

---

## Step 3：recall blindness（真實 bug #19434）

這是這一課最有價值的部分，因為它是一個**你不做就一定會踩到**的坑。

Hermes 的註解：

> Cron jobs run on a schedule and accumulate large volumes of repetitive
> vocabulary (recurring project names, dates, "session", summaries);
> under bare BM25 they dominate the top-N FTS rows and starve out the
> user's own interactive sessions, producing **"recall blindness"** where
> only cron sessions surface.

### 為什麼會這樣

BM25 的分數 = IDF（詞多罕見）× TF（在這篇出現幾次）。

排程摘要每天跑、每次講一樣的詞（「telemetry」「取樣率」「session」），
所以它的 **TF 很高**。使用者的自然對話只提一兩次。

結果：使用者搜尋自己講過的東西，**排在前面的全是機器人的日報**。

實測（12 個排程 session + 1 個真實對話）：

```
❌ 所有來源同權：
  1. cron         每日 telemetry 摘要 1        score=5.8
  2. cron         每日 telemetry 摘要 2        score=5.8
  3. cron         每日 telemetry 摘要 3        score=5.8
  → 第一名是 cron（recall blindness）✗

✅ cron 降權到 0.25：
  1. interactive  修 telemetry 取樣率的 bug     score=3.9
  2. interactive  很長的除錯對話                 score=3.1
  3. cron         每日 telemetry 摘要 1        score=1.5
  → 第一名是 interactive ✓
```

### 降權，不是排除

```ts
const SOURCE_WEIGHT: Record<SessionSource, number> = {
  interactive: 1.0,
  cron: 0.25,      // ← 降權，不排除
  subagent: 0,
  tool: 0,
};
```

Hermes 的理由：

> **Demoting - not excluding** - keeps cron content reachable when it's the
> only match, while interactive sessions always win when both match.

這個取捨值得記住：

- **排除** → 資訊消失。使用者真的想找那份日報時找不到
- **降權** → 只是排後面。兩者都命中時真人對話一定贏，但日報還在

### 先撈寬，再排序

```ts
const SCAN_LIMIT = 300;
```

Hermes 也是 300，理由是：

> The interactive vs automation split only helps if **enough rows are in
> hand** to find interactive matches buried under a wall of cron hits.

如果你只取前 10 筆再排序，那 10 筆可能全是 cron，降權也救不了，
使用者的對話根本沒進候選集。

---

## Step 3.5：把它接給 agent 用，傷害有多大（實測）

先講清楚，因為它是這一課的立場：排序器裡面沒有 LLM，而且不該有。
下面這個實驗一行排序都沒有動，模型是接在**外面**，
當一個「拿 `search_sessions` 當工具的 agent」。

Step 3 用確定性的分數證明了排序會壞。但排序只是中間產物，
真正該問的是下一步：

> agent 拿到一堆 cron 摘要之後，會怎樣？

```bash
PROVIDER=gemini bun run lesson-17:agent              # 有降權
DEMOTE=off PROVIDER=gemini bun run lesson-17:agent   # 沒降權
```

問題是「我之前有查過 telemetry 取樣率的問題嗎？結論是什麼？」
正確答案只存在於**那唯一一次**互動對話（取樣率寫死了，應該從 metadata 讀）；
12 篇 cron 摘要一律說「取樣率正常、無異常」。
所以模型答什麼，直接反映它撈到了哪一邊。判定是字串比對，不用 LLM 裁判。

### 前三次的結果會導向錯誤的解讀

前三次 `DEMOTE=off`，兩次模型很有自信地回答「取樣率正常、無異常」。
乾淨俐落，正好是 recall blindness 直接造成錯誤答案的證據。

多跑幾次之後，畫面完全不一樣。

| `DEMOTE=off`（9 次） | 次數 |
|---|---|
| 反覆換關鍵字之後**還是找到了** | 4-5 |
| 撞到步數上限，**完全沒給答案** | 2 |
| 照 cron 摘要回答「一切正常」 | 2 |

| `DEMOTE=on`（8 次） | 次數 |
|---|---|
| 找到了 | **8** |

### 所以降權買到的是什麼

不是「對 vs 錯」，是**可靠度和成本**：

```
DEMOTE=on   搜尋 2-5 次（多數 3 次左右），8/8 都答對
DEMOTE=off  搜尋 4-6 次，而且結果分成三種，其中兩種是壞的
```

沒有降權時，agent 會靠**反覆換關鍵字硬撈**來補救排序的問題。
它撈的詞越來越具體：`telemetry` → `取樣` → `sampling` → `50Hz`
→ `go2-c` → `meta.sample_rate_hz`。大部分時候真的被它撈到了。

> 模型會替你的爛基礎設施擦屁股，但要付錢，而且不保證每次都成功。
>
> 這一課的其他部分（降權、bookend、來源過濾）省下的正是這筆錢。

而且失敗的兩種樣子都不好看：

- **撞到步數上限**：使用者等半天，什麼都沒拿到
- **照 cron 摘要回答**：使用者拿到一句自信的錯話，
  而且他沒有辦法知道那次真正的對話根本沒被搜到

### 方法上的教訓：三次不夠

前三次的結果乾淨、好講、而且剛好支持一個很有戲劇性的結論。
那正是應該多跑幾次的理由，不是少跑的理由。

> 確定性的東西（Step 3 的分數）跑一次就夠。
> 非確定性的東西（模型行為）跑三次會給你一個看起來很確定的假象。

接回 Lesson 7：評估集之所以要有多個案例、之所以要 `--compare`，
就是因為單點觀測在這種地方完全靠不住。

---

## Step 4：壓縮摘要的迴圈（真實 bug #43175）

第二個坑，而且它是**這個系列前面幾課交互作用**產生的。

Lesson 5 的壓縮會產生一段摘要，而那段摘要是以**普通訊息**的形式
存在 session 裡的（我們的 `compact()` 就是 push 一則 user 訊息）。

所以搜尋會搜到它。後果：

```
1. 舊 session 被壓縮，產生一大段摘要
2. 新 session 搜尋歷史，搜到那段摘要
3. 摘要被塞進新 session 的 context
4. 新 session 變大，又被壓縮…
```

搜尋把 Lesson 5 好不容易壓縮掉的東西又搬回來了。

Hermes 的原話：

> They must be excluded from discovery bookends to avoid **re-introducing
> huge compaction payloads into fresh sessions** via session_search.

解法是認出它們並排除：

```ts
const COMPACTION_PREFIXES = [
  "[CONTEXT COMPACTION",
  "[CONTEXT SUMMARY]:",
  "[以下是這次對話較早部分的摘要",   // ← 我們 Lesson 5 用的前綴
];
```

> 這也是為什麼 Lesson 5 的摘要訊息**要有一個固定前綴**。
> 當時看起來只是為了讓模型知道那是摘要，
> 現在它變成了「機器可辨識的標記」。
>
> 加標記的成本很低，沒有標記的代價很高。

---

## Step 5：bookend 提供定位感

只給你「命中的那一句」是不夠的。你不知道那個 session 本來在幹嘛、
最後結論是什麼。

所以每個結果帶三段：

```
session 開頭（這個對話本來在幹嘛）：
  [user] 我們的 telemetry 取樣率設定好像有問題
  [assistant] 我看一下 config。目前 sample_rate_hz 寫死 50Hz。

命中處前後（實際發生了什麼）：
  [user] 對，但 go2-c 那台實際是 100Hz
  [assistant] 找到了。config.ts 把取樣率寫死了…    ← 命中
  [user] 測試過了嗎

session 結尾（最後結論是什麼）：
  [user] 測試過了嗎
  [assistant] 跑了 bun test，5 pass 0 fail。
```

三段合起來，模型不用再翻就知道上次發生了什麼。

**這是「一次工具呼叫要給夠資訊」的原則**（Lesson 6 也講過）：
與其讓模型呼叫三次工具去拼上下文，不如一次給它。

---

## Step 6：哪些來源根本不該出現

```ts
const HIDDEN_SOURCES = new Set(["subagent", "tool"]);
```

Hermes 的理由：subagent 跟第三方整合的 session
「不屬於使用者的對話歷史」。

使用者想找的是「**我**上次怎麼做的」，不是「某個子 agent 內部做了什麼」。

這跟 cron 的降權不同：cron 是使用者知道存在的東西（他自己排的程），
subagent 是實作細節。

> 這個區分值得在你自己的系統裡想一遍：
> 哪些 session 是使用者「認得」的？只有那些該進歷史。

---

## 跑不起來？

| 症狀 | 原因 | 解法 |
|---|---|---|
| 搜不到中文 | 斷詞問題 | 這一課逐字切；Hermes 載入 FTS5 CJK extension |
| 結果全是自動任務 | 沒有來源降權 | 見 Step 3 |
| 結果裡出現壓縮摘要 | 沒有排除前綴 | 見 Step 4 |
| 只給了一句，看不懂上下文 | 沒有 bookend | 見 Step 5 |

---

## 練習

### 練習 1：把降權關掉 ⭐

demo 已經內建 `disableSourceWeighting` 開關了。
改變 cron session 的數量（12 → 3 → 50），看排名怎麼變。

多少個 cron session 才會蓋掉一個真實對話？這個數字比你想的小。

### 練習 2：接上 Lesson 4 的真實 session ⭐⭐

現在資料是寫死的。改成從 `lesson-04-sessions/.sessions/*.jsonl` 讀。

你會遇到一個問題：JSONL 裡沒有 source 欄位。要怎麼補？
（提示：Lesson 4 的 `appendMeta` 就是為這種事準備的。）

### 練習 3：加上時間衰減 ⭐⭐

現在只看相關性，不看新舊。加一個時間權重：
三個月前的對話應該排在上週的後面嗎？

想一想：什麼情況下舊的反而更重要？（提示：「我們當初為什麼這樣設計」）

### ~~練習 4：把它做成工具給 agent 用~~ → 已經變成課程本體

見 Step 3.5 的 `agent.ts`。

留下來值得做的是**工具描述怎麼寫**：現在的描述是
「Search the user's past conversation sessions by keyword」。
試試看寫爛一點、或乾脆不寫，模型還會不會主動用它？
（這題跟 Lesson 16 Step 2.5 是同一個問題的另一面：
**工具描述也是路由訊號**。）

### 練習 5：找出你自己的 recall blindness ⭐⭐⭐

如果你已經有一堆 agent session，跑跑看：

- 有沒有哪一類 session 佔據了所有搜尋結果？
- 那類 session 是使用者「認得」的嗎？該降權還是該隱藏？

### 練習 6：兩段式到底值不值得 ⭐⭐⭐

Hermes 拿掉了 LLM 摘要路徑。但在什麼情況下它**會**值得？

想想：如果 session 有 100,000 則訊息、搜尋回傳 50 個候選，
每個都帶 ±5 則上下文，那就是 500 則訊息塞進 context。

那時候需要的是摘要，還是更好的排序？為什麼？

---

## 對照 Hermes 原始碼

| 這一課的概念 | Hermes 的位置 |
|---|---|
| 三種模式的完整說明 | `tools/session_search_tool.py` 開頭 docstring |
| 隱藏來源 | `session_search_tool.py:38` (`_HIDDEN_SESSION_SOURCES`) |
| 降權來源與 recall blindness | `session_search_tool.py:50` (`_DEMOTED_SESSION_SOURCES`) |
| 掃描上限的理由 | `session_search_tool.py:52` (`_DISCOVER_SCAN_LIMIT`) |
| 壓縮摘要排除 | `session_search_tool.py:58` (`_COMPACTION_PREFIXES`) |
| FTS5 schema 與 CJK | `hermes_state.py`（10850 行，搜 `fts5`） |
| 查詢長度上限 | `hermes_state.py:280` (`MAX_FTS5_QUERY_CHARS`) |
| FTS5 損壞偵測 | `hermes_state.py:837` 附近 |

`session_search_tool.py` 開頭那 30 行 docstring **建議整份讀**。
它把三種模式、設計取捨、以及演進過程（哪個 PR 加了什麼、後來為什麼移除）
都寫清楚了，是很好的技術寫作範例。

---

## 下一課

[Lesson 18: 排程與無人值守](../lesson-18-scheduling/README.zh-TW.md)

記憶、skill、跨 session 搜尋解決的都是「agent 自己產生過的東西怎麼找回來」。
Hermes 篇還有兩課，它們回答「跑好幾個月」的另一半：
沒人在看的時候，它怎麼繼續存在。

Lesson 18 講排程，而這一課已經先鋪好了：
那 12 個把使用者對話壓下去的 cron session 是從哪來的？
答案就在 Lesson 18。
