# Lesson 1: 最小的 Agent Loop

> [English](README.md)
>
> 前置：沒有。這是第一課。
>
> 目標：把「AI agent」從一個模糊的概念，變成你能一行一行指著看的程式碼。
> 讀完這課，你會知道 Claude Code / Cursor 那類工具的核心到底在做什麼。

## 這課要回答的問題

1. 模型明明只會輸出文字，怎麼會「讀我的檔案」？
2. 「工具」是什麼？誰執行它？
3. 為什麼 agent 要跑迴圈，不是問一次就好？
4. 每家 LLM 的 API 都不一樣，怎麼寫才不用綁死一家？

---

## Step 0：先跑起來

先看到東西動，再回頭理解。**不需要 API key**：

```bash
cd agent-lessons
bun install
PROVIDER=fake bun run lesson-01
```

看到提示符號後，隨便打一句話按 Enter：

```
provider: fake  model: scripted
輸入問題，/exit 或 Ctrl+C 離開

> 這個專案有什麼 bug？
  → read_file({"path":"README.md"})
  → read_file({"path":"src/store.ts"})
  → read_file({"path":"src/config.ts"})
  → read_file({"path":"src/does-not-exist.ts"})
  ✗ ENOENT: no such file or directory, open '.../src/does-not-exist.ts'

[fake provider] 我跑完了 3 輪工具呼叫。
真正的模型會在這裡給出答案。想看真的推理，設一把 API key 再跑一次。
```

停下來，看懂這幾行輸出。每一個 `→` 就是迴圈跑了一圈：模型說它想讀某個
檔案，我們的程式真的去讀，把內容送回去，模型再決定下一步。

第二圈一次讀了兩個檔案，這叫**平行工具呼叫**，模型知道這兩個檔案互相獨立，
就一起要。

那個 `✗` 是故意的。模型讀了一個不存在的檔案，我們**沒有讓程式崩潰**，而是
把錯誤訊息當成「工具結果」送回給模型。真正的模型看到這個會說「喔那個檔案不
存在，我換一個」然後繼續。這是 agent 能自我修復的關鍵機制。

### 換成真的模型

把 API key 放進 `.env`（見[上層 README](../README.zh-TW.md#開始跑)），然後：

```bash
bun run lesson-01
```

下面是**實際跑出來的輸出**（Gemini 3.6 Flash，節錄）：

```
> 為什麼有些短網址會回 404？

  → read_file({"path":"README.md"})
  → read_file({"path":"src/server.ts"})
  → read_file({"path":"src/store.ts"})
  → read_file({"path":"src/config.ts"})

短網址會回傳 404 的原因主要有以下幾個，其中最關鍵的核心 Bug 是「大小寫不一致問題」：

### 1. 核心 Bug：短碼大小寫不匹配（主要原因）

- 產生與儲存：config.ts 的 ALPHABET 包含大寫字母。當 save() 產生一個含有
  大寫字母的短碼（例如 aB3XyZ），會以原大小寫存入 entries Map。
- 查詢：store.ts 的 lookup() 查詢時先將短碼轉為全小寫（變成 ab3xyz）再索取。

結果：Map 的 Key 是 "aB3XyZ"，查詢用的 Key 卻是 "ab3xyz"，找不到而回傳 404。
只要產生的短碼含有任何一個大寫字母，剛建立的短網址就會立刻 404。

### 2. 記憶體數量上限被擠掉（MAX_ENTRIES）
### 3. 服務重啟導致資料遺失
### 4. 短碼碰撞覆蓋（generateCode 沒檢查重複）
### 5. 其它 GET 請求（如 /favicon.ico）也被當成短碼處理
```

這就是 agent。它沒有「看過」這個專案，是自己一步步讀出來的。這一課只埋了
第 1 個 bug，另外四個是它自己額外發現的。

> 這一輪大約 4 次工具呼叫、花了十幾秒。同樣的問題換一個 provider 再問一次，
> 可以比較不同模型挖得多深。

> `playground/` 裡的專案是為這門課寫的，bug 也是故意埋的。
> 你可以改掉 bug、換成自己的專案，agent 一樣能用。

---

## Step 1：核心的 50 行

打開 [`agent.ts`](agent.ts)，找到 `runTurn`。整個 agent 就是這個函式：

```ts
async function runTurn(messages: Message[]): Promise<void> {
  while (true) {
    // 1. 呼叫模型
    const response = await provider.call({
      system: SYSTEM_PROMPT,
      messages,
      tools: TOOLS,
      maxTokens: MAX_TOKENS,
    });

    // 2. 把模型的回覆推回歷史
    messages.push({ role: "assistant", blocks: response.blocks, raw: response.raw });

    // 3. 先看 stopReason，再讀內容
    if (response.stopReason === "refusal") return;
    if (response.stopReason === "max_tokens") return;

    // 4. 印出模型說了什麼
    for (const block of response.blocks) { /* ... */ }

    // 5. 沒有工具呼叫了 → 結束這一輪
    const toolCalls = response.blocks.filter((b) => b.type === "toolCall");
    if (toolCalls.length === 0) return;

    // 6. 執行所有工具，收集結果
    const results: ToolResult[] = [];
    for (const call of toolCalls) {
      try {
        results.push({
          toolCallId: call.id,
          toolName: call.name,
          content: await executeTool(call.name, call.args),
        });
      } catch (error) {
        results.push({
          toolCallId: call.id,
          toolName: call.name,
          content: (error as Error).message,
          isError: true,   // ← 錯誤也要回報給模型
        });
      }
    }
    messages.push({ role: "toolResult", results });

    // 7. 回到步驟 1
  }
}
```

這就是全部了。你現在已經看過一個 AI agent 的完整核心。

Claude Code、Cursor、Devin 的核心迴圈跟這個是同一個形狀。它們多出來的
幾萬行是：更多工具、streaming、UI、權限控制、session 管理、context 壓縮。
重要，但都是外圍。

### 幾個容易看漏的細節

`messages` 陣列只增不減。每一輪都把完整歷史重新送給模型，模型本身
沒有記憶，它每次都是從零讀完整份對話。這也是為什麼對話越長越貴。

步驟 5 判斷的是「有沒有工具呼叫」，不是 `stopReason === "tool_use"`。
`stopReason` 是 provider 宣稱的狀態，`blocks` 是實際內容。以實際內容為準，
不同 provider 的 stop reason 語意有微妙差異。

步驟 6 的 try/catch 不能省。每一個 tool call 都**必須**有一則對應的
結果送回去，就算它失敗了。少一則，下次請求會被 API 直接打回 400
（"tool_use ids were found without tool_result blocks"），這是新手最常
撞到的錯誤。

---

## Step 2：工具是什麼

工具由三個部分組成。

### (1) 給模型看的說明書

```ts
const readFileTool: ToolSpec = {
  name: "read_file",
  description:
    "Read the full contents of a text file in the project. " +
    "Use this before answering any question about what the code does.",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "File path relative to the project root, e.g. 'src/server.ts'",
      },
    },
    required: ["path"],
  },
};
```

`description` 不是註解，是 prompt。這段字會原封不動送進模型的 context，
模型完全靠它決定要不要用這個工具。寫「讀檔案」跟寫「在回答任何關於程式碼的
問題之前，先用這個工具讀檔案」，模型的行為差很多。

`parameters` 是 [JSON Schema](https://json-schema.org/)。模型會照著這個
schema 產生參數。

> 想立刻有感？把 description 改成只剩 `"reads a file"`，
> 重跑一次，看模型是不是變得比較懶、比較愛猜。這是最能體會
> 「prompt engineering 就是工程」的實驗。

### (2) 真正執行的程式碼

```ts
async function executeTool(name: string, args: Record<string, unknown>): Promise<string> {
  if (name !== "read_file") throw new Error(`Unknown tool: ${name}`);

  const path = args.path;
  if (typeof path !== "string") throw new Error("read_file requires a string 'path'");

  const target = resolve(ROOT, path);

  // args 是模型產生的，一律當成不可信輸入
  if (target !== ROOT && !target.startsWith(`${ROOT}/`)) {
    throw new Error(`Path escapes the project root: ${path}`);
  }

  return await readFile(target, "utf8");
}
```

兩件事值得記住：

契約是「失敗就 throw」。不要把錯誤訊息偽裝成正常結果回傳。讓 loop 統一
把 throw 包成 `isError: true` 的結果，這樣模型才知道那是失敗，而不是把錯誤
訊息當成檔案內容。

那三行路徑檢查不是裝飾。 `args.path` 是模型產生的字串。少了檢查，
`"../../../.ssh/id_rsa"` 你就乖乖讀給它了。所有模型輸出都是不可信輸入，就算你相信模型沒惡意，使用者也可能在別的地方注入指令
（prompt injection）。

### (3) sandbox 邊界

```ts
const ROOT = resolve(import.meta.dirname, "playground");
```

一行常數，就是這個 agent 的整個權限模型。它只能讀 `playground/` 底下的東西。

真實的 agent 需要更嚴肅的答案，Docker、micro-VM、或作業系統層的沙箱。
但概念是一樣的：在工具執行的地方畫界線，不是在 prompt 裡拜託模型不要亂來。

---

## Step 3：為什麼要有 provider 那一層

`agent.ts` 裡完全沒有 `import Anthropic` 或 `import OpenAI`。它只認識
[`providers/types.ts`](providers/types.ts) 定義的中立介面。

為什麼要多這一層？因為每家的 tool calling 形狀都不一樣：

| | Anthropic | OpenAI | Gemini |
|---|---|---|---|
| 工具定義 | `{ name, description, input_schema }` | `{ type: "function", function: {...} }` | `functionDeclarations` |
| 參數格式 | 已解析的物件 | **JSON 字串**，要自己 parse | 已解析的物件 |
| 工具結果 | 全部塞進**同一則** user 訊息 | **每個結果各一則** `role: "tool"` 訊息 | `functionResponse` parts |
| System prompt | 獨立的 `system` 欄位 | `messages[0]` | `systemInstruction` |
| 錯誤標記 | 有 `is_error` 欄位 | 沒有，只能寫進文字 | 沒有 |

如果 loop 直接寫死其中一種，換 provider 就要重寫整個 loop。

看一下這個對比就懂了，同一個中立訊息，兩邊翻譯出來的形狀差多少：

```ts
// providers/anthropic.ts ， 1 則中立訊息 → 1 則原生訊息
case "toolResult":
  return {
    role: "user",
    content: message.results.map((r) => ({
      type: "tool_result",
      tool_use_id: r.toolCallId,
      content: r.content,
      is_error: r.isError,
    })),
  };

// providers/openai.ts ， 1 則中立訊息 → N 則原生訊息
case "toolResult":
  return message.results.map((r) => ({
    role: "tool" as const,
    tool_call_id: r.toolCallId,
    content: r.isError ? `Error: ${r.content}` : r.content,
  }));
```

注意 OpenAI 那邊回傳的是**陣列**，Anthropic 那邊是單一物件。上層 loop 完全
不需要知道這件事。

### 那個很醜的 `raw` 欄位

```ts
export interface AssistantMessage {
  role: "assistant";
  blocks: AssistantBlock[];  // 中立表示，你的程式碼讀這個
  raw: unknown;              // provider 原生物件，原封不動保存
}
```

看起來像設計失敗，但它是必要的。

Anthropic 的模型會產生 **thinking block**（模型的思考過程）。這些 block
**必須一字不改地傳回去**，否則下一輪請求會被拒絕。但 thinking block 的
內部結構是 Anthropic 專有的，中立表示不可能涵蓋每家 provider 的所有欄位。

所以兩份都留：`blocks` 給自己讀，`raw` 給 provider 原樣送回去。

真實世界的 agent harness 幾乎都有這一欄。這是「中立抽象」遇到現實時
必然要做的妥協，先知道它存在，之後看別人的 code 就不會困惑。

---

## Step 4：五個你一定會撞到的坑

新手寫第一個 agent 時，這五個幾乎人人中招：

### 1. 忘記把 assistant 訊息推回歷史

```ts
// ✗ 錯：模型永遠不知道自己說過什麼，會無限重複同一個工具呼叫
const response = await provider.call({ messages, ... });
const results = await executeTools(response);
messages.push({ role: "toolResult", results });

// ✓ 對：assistant 訊息一定要先進歷史
messages.push({ role: "assistant", blocks: response.blocks, raw: response.raw });
messages.push({ role: "toolResult", results });
```

症狀：agent 卡在無限迴圈，一直讀同一個檔案。

### 2. 工具失敗時沒回結果

```ts
// ✗ 錯：靜靜吞掉錯誤
try {
  results.push({ ...await run(call) });
} catch { /* 忽略 */ }

// ✓ 對：失敗也是一種結果
catch (error) {
  results.push({ toolCallId: call.id, content: error.message, isError: true });
}
```

症狀：下次請求 400，錯誤訊息大意是「有 tool_use 但找不到對應的 tool_result」。

### 3. 把工具結果拆成多則訊息（Anthropic）

一則 assistant 訊息裡有 3 個 tool call，就要在**同一則** user 訊息裡回 3 個
`tool_result` block。拆成三則不會報錯，但模型會學到「這裡不能平行呼叫」，
之後就變成一次只叫一個工具，速度掉三倍。

### 4. 沒處理被截斷的輸出

模型撞到 `max_tokens` 上限時，輸出會從中間斷掉，包括工具參數的 JSON。
那個 JSON 可能剛好還能 parse，但內容是半截的。

```ts
if (response.stopReason === "max_tokens") {
  // 這一輪的所有 tool call 都不可信，一個都別執行
  return;
}
```

症狀：agent 偶爾用奇怪的參數呼叫工具，例如檔案路徑只有一半。

### 5. 直接讀 `content[0]`

模型可能拒絕回答（`stopReason: "refusal"`），這時內容可能是空陣列。
永遠先看 `stopReason`，再讀內容。

---

## 跑不起來？

這幾個是做這一課時真的撞到的，不是想像出來的：

| 症狀 | 原因 | 解法 |
|---|---|---|
| `process.loadEnvFile is not a function` | Bun 沒有這個 Node API | 已經處理掉了（`typeof` 檢查）。Bun 本來就會自己讀 `.env` |
| `Request timed out.`（等 30 秒） | 網路連不到 API。SDK 會重試 3 次，每次 10 秒 | 先用 `curl -I https://generativelanguage.googleapis.com` 確認連得到。公司網路 / VPN / proxy 常擋 |
| `Top-level await is currently not supported with the "cjs" output format` | 用 `tsx` 跑專案外的檔案，沒有 `type: "module"` | 用 `bun run` 跑，或把檔案放進專案裡 |
| `404 model not found` | 預設 model id 你的帳號沒權限 | `MODEL=gemini-3.5-flash-lite bun run lesson-01` |
| Agent 一直重複讀同一個檔案 | 忘記把 assistant 訊息推回歷史 | 見下面「坑 1」 |
| `tool_use ids were found without tool_result blocks` | 有工具失敗時沒回結果 | 見下面「坑 2」 |

---

## 練習

按順序做，每一題都會讓你撞到一個真實問題。

### 練習 1：加一個 `list_files` 工具 ⭐

讓 agent 能列出資料夾內容，不用先猜檔名。

- 在 `TOOLS` 加一個 `ToolSpec`
- 在 `executeTool` 加一個分支（用 `node:fs/promises` 的 `readdir`）
- **別忘了路徑檢查**

跑跑看：agent 的行為改變了嗎？它會先 list 再 read 嗎？

### 練習 2：把 description 寫爛 ⭐

把 `read_file` 的 description 改成 `"reads a file"`，重跑同一個問題。

觀察：模型變懶了嗎？開始用猜的嗎？工具呼叫次數變少了嗎？

這題的重點是體會「description 是 prompt 不是註解」。

### 練習 3：印出真實的 token 用量 ⭐⭐

在 `ModelResponse` 加一個 `usage: { inputTokens, outputTokens }` 欄位，
兩個 provider 各自填好，每輪印出來。

觀察：**input token 每一輪都在漲**。這就是 agent 貴的原因，也是
Lesson 5（context 壓縮）要解決的問題。

### 練習 4：加一個工具呼叫上限 ⭐⭐

現在的 loop 理論上可以跑到天荒地老。加一個 `maxIterations`（例如 20），
超過就停下來並告訴使用者。

想一想：停下來之後，`messages` 陣列處於什麼狀態？下次還能繼續用嗎？
（提示：最後一則訊息如果是 `toolResult`，直接再叫一次 `runTurn` 就能續跑。）

### 練習 5：讓工具修改檔案 ⭐⭐⭐

加一個 `write_file` 工具。這題會逼你面對第一個真正的設計問題：

要不要在寫入前問使用者？

讀檔是安全的，寫檔不是。試著加一個確認機制：模型要求寫檔時，先在 terminal
問使用者 y/n，拒絕的話就回一個 `isError: true` 的結果說「使用者拒絕了」。

這就是 Claude Code 每次要改你的檔案時跳出來問的那個東西。
（Pi 把這個做成 `beforeToolCall` hook，見下方對照表。）

---

## 對照 Pi 原始碼

寫完自己的版本後，去讀真正的 production 實作會清楚很多。
[Pi](https://github.com/earendil-works/pi) 是一個把 agent runtime 拆得
特別乾淨的開源專案：

| 這一課的概念 | Pi 的對應位置 |
|---|---|
| `runTurn` 的 while 迴圈 | `packages/agent/src/agent-loop.ts:170-272` |
| 唯一呼叫 LLM 的地方 | `agent-loop.ts:281-372` (`streamAssistantResponse`) |
| `ToolSpec` / `executeTool` 契約 | `packages/agent/src/types.ts:380-403` (`AgentTool`) |
| 中立訊息 vs 原生訊息 | `types.ts:319` (`AgentMessage`) + `convertToLlm` |
| Provider 抽象 | `types.ts:28` (`StreamFn`)、`packages/ai/src/providers/` |
| 被截斷輸出的處理 | `agent-loop.ts:381` (`failToolCallsFromTruncatedMessage`) |
| 假 provider（測試用） | `packages/ai/src/providers/faux.ts` |
| `read_file` 的完整版 | `packages/agent/src/harness/tools/read.ts` |
| sandbox 邊界 | `packages/agent/src/harness/types.ts:373` (`ExecutionEnv`) |
| 寫檔前的批准機制 | `types.ts:271` (`beforeToolCall` hook) |

Pi 的 `agent-loop.ts` 全檔 792 行，但核心迴圈就是第 170-272 行那 100 行。
你現在有能力直接讀它了。

---

## 下一課

[Lesson 2 - 更多工具](../lesson-02-tools/README.zh-TW.md)：加上 `write_file`、`edit_file`、`run_command`，
然後撞上第一個真實問題：**工具輸出太長，context 爆掉**。
（`ls -R` 一個大專案，或 `cat` 一個 10MB 的 log，會發生什麼事？）
