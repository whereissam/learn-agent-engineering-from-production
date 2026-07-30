# Lesson 4: Session 持久化

> [English](README.md)
>
> 前置：[Lesson 3](../lesson-03-streaming/README.zh-TW.md)。
>
> 目標：關掉程式，對話還在。續跑、回顧、退回去重問。
>
> 這一課有一個會改變你直覺的發現：session 不是一個陣列，是一棵樹。

## 這課要回答的問題

1. 對話要怎麼存？存成一個大 JSON 檔可以嗎？
2. 為什麼要記 `parentId`？
3. 「退回去重問」之後，舊的對話跑去哪了？
4. 存檔要在什麼時機做？

---

## Step 0：先跑起來

```bash
PROVIDER=fake bun run lesson-04
```

問一句話，然後 `/exit`。再開一次，這次續跑：

```bash
PROVIDER=fake bun run lesson-04-sessions/agent.ts --resume
```

```
續跑 .../lesson-04-sessions/.sessions/2026-07-27T08-58-59-686Z.jsonl（6 筆記錄）
```

輸入 `/history` 看剛剛的對話：

```
  e0001  user        第一個問題
  e0002  assistant   我先看一下專案結構。
  e0003  toolResult  1 tool result(s)
  e0004  assistant   接著讀 store.ts。
  e0005  toolResult  1 tool result(s)
  e0006  assistant   這是一段刻意寫得很長的回覆…
```

### 內建指令

| 指令 | 作用 |
|---|---|
| `/history` | 印出**目前這條分支**的訊息 |
| `/tree` | 印出**整個檔案**的所有記錄，含被放棄的分支 |
| `/rewind <id>` | 退回某一筆，之後的訊息會長出新分支 |
| `/file` | 顯示 session 檔案路徑 |

---

## Step 1：為什麼是 JSONL

存檔格式是 **JSONL**，一行一個 JSON 物件：

```jsonl
{"id":"e0001","parentId":null,"timestamp":"…","message":{"role":"user","text":"第一個問題"}}
{"id":"e0002","parentId":"e0001","timestamp":"…","message":{"role":"assistant",…}}
{"id":"e0003","parentId":"e0002","timestamp":"…","message":{"role":"toolResult",…}}
```

跟「一個大 JSON 陣列」比，好處有四個：

| | JSONL | 一個大 JSON |
|---|---|---|
| 加一則訊息 | `append`，O(1) | 讀進來、改、整個重寫 |
| 程式當掉 | 最多壞掉最後一行 | 整個檔案可能都毀了 |
| 即時觀察 | `tail -f session.jsonl` | 做不到 |
| 大檔案 | 一行一行處理 | 整份載入記憶體 |

第二點特別重要。agent 可能跑很久，中間當掉的機率不低。JSONL 的損壞是
**局部的**，我們的 loader 遇到壞行就跳過：

```ts
} catch {
  console.warn(`[session] skipping malformed line ${index + 1}`);
}
```

用大 JSON 檔的話，寫到一半當掉 = 整份對話沒了。

### 存檔時機：先寫檔，再回傳

```ts
this.records.push(entry);
this.head = entry.id;

// 先寫檔再回傳
await appendFile(this.path, `${JSON.stringify(entry)}\n`, "utf8");
return entry;
```

順序是刻意的。當機時，「寫進去了但呼叫端不知道」比
「呼叫端以為存了但其實沒有」好處理太多，後者會讓記憶體跟磁碟不一致，
而你完全沒辦法察覺。

---

## Step 2：session 是一棵樹

這是這一課最重要的觀念。

### 為什麼陣列不夠

想像這個很常見的情境：

```
你：「幫我把這個函式改成用 async」
AI：（改了，但改錯方向）
你：「不對，我是說…」
```

比起解釋，你更想做的是**退回去把問題重問一次**。這在 Claude Code 裡對應
按上鍵編輯訊息，在 ChatGPT 裡對應那個「編輯」按鈕。

問題來了：舊的對話要怎麼辦？

- 刪掉 → 你弄丟了資料。萬一新的問法更糟，回不去了。
- 留著 → 那它跟新的對話是什麼關係？陣列表達不了。

答案是：它們是同一棵樹的兩條分支。

### `parentId` 就是全部

每一筆記錄都指向它的前一筆：

```ts
export interface SessionEntry {
  id: string;
  parentId: string | null;   // ← 這一個欄位讓陣列變成樹
  timestamp: string;
  message: Message;
}
```

平常這會形成一條直線：

```
e0001 ← e0002 ← e0003 ← e0004
```

但 `/rewind e0002` 之後再講話，新訊息的 `parentId` 是 `e0002`：

```
e0001 ← e0002 ← e0003 ← e0004     （舊分支，被放棄）
            ↖
              e0007 ← e0008        （新分支，目前在這）
```

### 實際看一次

```
> /rewind e0002
  已退回 e0002。接下來的訊息會長出一條新分支，舊的分支還在檔案裡。

> 新的問法
（AI 回答…）

> /tree
  檔案裡共 12 筆記錄，目前分支上有 8 筆
  ● e0001 ← root   user
  ● e0002 ← e0001  assistant
  ○ e0003 ← e0002  toolResult      ← 舊分支
  ○ e0004 ← e0003  assistant
  ○ e0005 ← e0004  toolResult
  ○ e0006 ← e0005  assistant
  ● e0007 ← e0002  user            ← 新分支從 e0002 長出來
  ● e0008 ← e0007  assistant
  ● e0009 ← e0008  toolResult
  ● e0010 ← e0009  assistant
  ● e0011 ← e0010  toolResult
  ● e0012 ← e0011  assistant
  ● = 目前分支   ○ = 已放棄的分支（還在檔案裡，沒有刪除）
```

看 `e0007 ← e0002`，它跳過了 `e0003`~`e0006`，直接接在 `e0002` 後面。
那就是分叉點。

舊分支一筆都沒刪。append-only 的意義就在這裡：你永遠不會弄丟東西，
只會不再走那條路。

### 送給模型的是哪些？

```ts
messages(): Message[] {
  const chain: Message[] = [];
  let cursor = this.head;
  while (cursor) {
    const record = byId.get(cursor);
    if (!record) break;
    if (!("type" in record)) chain.push(record.message);
    cursor = record.parentId;   // ← 往回走
  }
  return chain.reverse();
}
```

從 `head` 沿著 `parentId` 一路往回走到 root，然後反轉。

只有目前這條分支會送給模型。被放棄的分支存在檔案裡，但模型看不到，
不然它會被自己講過又被否決的話搞混。

---

## Step 3：loop 幾乎沒變（again）

跟 Lesson 3 對照，`runTurn` 的差別是：

```diff
- messages.push({ role: "assistant", blocks: response.blocks, raw: response.raw });
+ await session.append({ role: "assistant", blocks: response.blocks, raw: response.raw });
```

`push` 換成 `await session.append`。就這樣。

還有一個小改動，但它讓 `/rewind` 能運作：

```ts
for (let step = 0; step < MAX_STEPS; step++) {
  // 每一輪都從 session 重新讀出訊息
  const messages = session.messages();
```

訊息不再是一個長期存在的陣列，而是**每次都從樹重新算出來**。
這樣 `/rewind` 改掉 `head` 之後，下一輪自然就用新分支的內容。

---

## Step 4：一個不明顯的坑

`--resume` 載入時，`head` 是**檔案的最後一筆記錄**：

```ts
for (const [index, line] of raw.split("\n").entries()) {
  const record = JSON.parse(line) as SessionRecord;
  session.records.push(record);
  session.head = record.id;    // ← 每一行都覆蓋，最後留下最後一筆
}
```

如果你上次結束前做過 `/rewind`，最後一筆**不一定在最長的那條分支上**。
續跑會接在你上次實際待的那條分支，通常這正是你要的，但值得知道。

真實的 agent 會把 `head` 也存進檔案（或存一個 `session.meta.json`），
而不是用「最後一行」來推斷。

---

## 跑不起來？

| 症狀 | 原因 | 解法 |
|---|---|---|
| `Session file not found` | `.sessions/` 是空的 | 先跑一次不加 `--resume` |
| `/rewind` 說 `No such entry` | id 打錯了 | 先 `/history` 看 id |
| 續跑之後對話怪怪的 | 接在被放棄的分支上 | `/tree` 看目前在哪，再 `/rewind` |
| `.sessions/` 越來越大 | 沒有清理機制 | 這是刻意的，見練習 4 |

`.sessions/` 已經加進 `.gitignore` 了。

---

## 練習

### 練習 1：加上 `/sessions` 列出所有 session ⭐

列出 `.sessions/` 裡所有檔案，顯示時間、訊息數、第一則使用者訊息（當標題）。

### 練習 2：`--resume <檔名>` 續跑指定的 session ⭐

現在只能續跑最近一次。加上指定檔名的能力。

### 練習 3：把 head 存進檔案 ⭐⭐

解掉 Step 4 那個坑。在檔案結尾寫一筆 meta 記錄 head 是誰，
載入時優先用它。

想一想：如果那筆 meta 也寫壞了呢？要有 fallback 嗎？

### 練習 4：token 用量統計 ⭐⭐

`appendMeta()` 已經寫好了但沒人用。每一輪結束後記一筆 usage，
然後加一個 `/cost` 指令算出這個 session 總共花了多少。

（`shared/session/session.ts` 的 `SessionMeta` 就是為了這個準備的。）

### 練習 5：session 分岔視覺化 ⭐⭐⭐

現在 `/tree` 是平的清單。改成真正的樹狀圖：

```
e0001 user
└─ e0002 assistant
   ├─ e0003 toolResult        ← 舊分支
   │  └─ e0004 assistant
   └─ e0007 user  ●           ← 目前分支
      └─ e0008 assistant
```

你需要先從 `parentId` 反向建出 children map。

### 練習 6：想清楚壓縮要存什麼 ⭐⭐⭐

Lesson 5 會做 context 壓縮：把一長串舊訊息換成一段摘要。

**先想一想**：壓縮之後，原始訊息應該從檔案裡刪掉嗎？

（提示：想想 append-only 的意義。答案在下一課。）

---

## 對照 Pi 原始碼

| 這一課的概念 | Pi 的對應位置 |
|---|---|
| JSONL 儲存 | `packages/agent/src/harness/session/jsonl-storage.ts`（376 行） |
| session 樹與 `parentId` | `packages/agent/src/harness/types.ts:375` (`SessionTreeEntryBase`) |
| 從樹算出訊息串 | `packages/agent/src/harness/session/session.ts` |
| meta 記錄（換 model 等） | `harness/types.ts:387-401`（`ThinkingLevelChangeEntry`、`ModelChangeEntry`…） |
| 壓縮記錄 | `harness/types.ts:403` (`CompactionEntry`) |
| 續跑 | `packages/agent/src/agent.ts:350` (`continue()`) |

Pi 的 `SessionTreeEntryBase` 跟我們的 `SessionEntry` 幾乎一樣，
`type` / `id` / `parentId` / `timestamp`。它多的是「訊息以外」的節點型別：
換 model、改 thinking level、壓縮……全部都進同一棵樹。

這樣做的好處是：整個 session 的歷史（包含設定變更）是完整可重播的。

---

## 下一課

[Lesson 5 - Context 壓縮](../lesson-05-compaction/README.zh-TW.md)：對話變長之後，每一輪都要把
完整歷史重送給模型，又慢又貴，最後還會撞到 context window 上限。
下一課處理這個，並且回答練習 6 的問題。
