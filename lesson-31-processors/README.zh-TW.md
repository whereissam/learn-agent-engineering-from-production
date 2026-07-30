# Lesson 31：把 `runTurn` 裡的 if 搬到外面

> [English](README.md)
>
> Mastra 篇第二課。前置：[Lesson 05](../lesson-05-compaction/README.zh-TW.md)、
> [Lesson 08](../lesson-08-permissions/README.zh-TW.md)、[Lesson 26](../lesson-26-cost/README.zh-TW.md)。
>
> 對照原始碼：`mastra/packages/core/src/processors/`、
> `processors/processors/pii-detector.ts`。

到目前為止，每加一個能力，最直接的寫法都是在 loop 裡多一個 `if`：

```ts
if (contextTooLong) compact()
if (toolIsDangerous) askForApproval()
if (costTooHigh) stop()
if (textContainsSecret) redact()
```

每一個 `if` 都合理，合起來卻讓 loop 同時負責控制流、政策、安全與保存格式。
這一課只做一個轉折：把會變的邊界政策移到 processor pipeline，loop 不動。

## Step 0：先把 processor 關掉

```bash
bun run lesson-31
```

示範用的是假 `.env` tool result：

```text
read_file(.env) → tool result → model context
                            ↘ trace
                            ↘ memory
```

沒有 processor 時，三條路都看得到假 token。這裡不需要真模型，因為要驗的不是
「模型會不會使用 secret」，而是更前面、確定性的問題：secret 有沒有跨過邊界。

## Step 1：最小的 pipeline

`processor.ts` 的介面只有一個方法：

```ts
interface Processor {
  readonly id: string
  process(payload: Readonly<Payload>): ProcessResult | Promise<ProcessResult>
}
```

pipeline 依序把上一個 processor 的輸出交給下一個。截斷、正規化、注入偵測、
成本閘門都可以長在同一個接縫，不必再編譯進 `runTurn`。

兩個不變條件有測試保護：

- 不就地修改輸入。原始 tool result 可能還要送往別的 sink
- processor 不准偷偷改 `boundary`。政策層不能把「送模型」改成「寫 trace」

## Step 2：只保護模型，不夠

第二個情境只在 `model` pipeline 加 `SecretRedactor`：

```text
model   safe
trace   LEAK
memory  LEAK
```

這是本課唯一的主張：

> 進入模型之前、進入 log 之前、進入 memory 之前，是三個不同的邊界。

模型沒看到 secret，只能證明雲端模型沒收到它。trace 可能由 observability hook
直接讀原始 tool result；memory 也可能在 turn 完成後保存原始訊息。兩者都不會
自動繼承 model-input processor 的結果。

memory 那條尤其危險：Lesson 15 已經證明記憶會在未來 session 被 recall 回來。
一次漏掉，會變成持續性的 context 污染。

## Step 3：在每個 sink 的入口處處理

第三個情境替三個 boundary 各自配置 pipeline：

```ts
const pipelines = {
  model:  new ProcessorPipeline([new SecretRedactor()]),
  trace:  new ProcessorPipeline([new SecretRedactor()]),
  memory: new ProcessorPipeline([new SecretRedactor()]),
}
```

三條全部變成 `safe`。重複配置看起來麻煩，但它把資料流寫清楚了：新增一個
持久化 sink 時，型別會逼你決定那個 sink 的 pipeline，而不是默默沿用原文。

`findings` 只記錄類型和數量，不記錄命中的原字串。否則 redactor 自己的 audit
log 反而會成為另一份 secret 資料庫。

## Step 4：重點不是 regex

這份 `SecretRedactor` 只認得幾種環境變數與 provider token，刻意不假裝完整。
真實版本還需要：

- provider-specific token pattern 與 entropy detection
- false positive 的 allowlist 與版本管理
- block / warn / redact 等策略
- streaming 時跨 chunk 的匹配
- 對圖片、檔案附件和 structured tool result 的處理

Mastra 的 `pii-detector.ts` 超過一千行，正是因為它同時處理這些策略、串流與
多種 PII。這一課沒有把那一千行縮成一個神奇 regex；它只抽出更可移植的部分：
processor 應該掛在哪裡。

## Step 5：哪些東西適合變成 processor

| 機制 | 對應舊課 | 適合的邊界 |
|---|---|---|
| context compaction / token limit | Lesson 05 | model input |
| permission / moderation | Lesson 08 | tool execution / model input |
| secret / PII redaction | Lesson 31 | model、trace、memory 各自處理 |
| cost guard | Lesson 26 | model call 前後 |
| output scrubber | — | 回使用者或寫入 sink 前 |

processor 不是「所有 middleware 都塞進來」的理由。會改變 loop 控制流本身的東西
仍然不適合，例如 Lesson 33 的 suspend / resume；那需要可序列化的狀態機，
不是多一個文字轉換 hook。

## 契約測試

```bash
bun test tests/processors.test.ts
```

測試不需要 API key，因為它保護的是這一課自己的不變條件：遮蔽、非敏感內容保留、
不修改輸入、三個邊界互不冒充。

這跟 Lesson 30 的分界一樣：CI 能證明自己的 pipeline 沒壞，不能證明世界上每一種
secret 都會被偵測。後者需要持續更新 fixture 與量測。

## 這課刻意不做的事

| 沒做 | 為什麼 |
|---|---|
| 用 LLM 偵測人名、地址 | 這課驗的是資料流，不是 classifier 品質 |
| 寫真的 trace / memory 檔 | in-memory sink 已足以證明是否跨界，避免示範自己留下 secret |
| 統一所有 sink 的保存政策 | 那是產品政策；這課只教一次呼叫的機制 |
| 修改既有 `runTurn` | processor 的價值正是讓核心 loop 維持原樣 |

## 練習

### 練習 1：加 email 與信用卡偵測 ⭐

先各寫一個 false positive fixture。`4111 1111 1111 1111` 很容易，
「哪些 16 位數字不該被遮」才是實際工作。

### 練習 2：加 block 策略 ⭐⭐

讓 processor 可以選擇 `redact` 或 abort。想清楚三個 boundary 的安全預設值是否
一樣：trace 寫不進去時該不該讓整個 agent turn 失敗？

### 練習 3：測 processor 順序 ⭐⭐

加一個只保留前 40 字的 truncation processor，交換它跟 redactor 的順序。
哪一種順序可能把半截 token 留下？把答案寫成契約測試。

