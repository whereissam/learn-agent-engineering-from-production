# Lesson 12: MCP client 進產品

> [English](README.md)
>
> 前置：[Lesson 8](../lesson-08-permissions/README.zh-TW.md)（風險分級）、
> [Lesson 2](../lesson-02-tools/README.zh-TW.md)（工具與批准）。
>
> 把別人寫的工具接進你的 agent。協定只有三個方法，
> 難的全部在「別人的進程不受你控制」。
>
> 對照原始碼：`openworker/coworker/mcp/`（5 個檔案 647 行）、
> `mastra/packages/mcp/src/{client,server}`——包含 `oauth.py`，
> 它原本是 Lesson 11 的 token 生命週期那一半，已併入這一課。

## 這課要回答的問題

1. MCP 工具跟自己寫的工具，差別到底在哪？
2. 使用者的設定裡有一台 server 是壞的，agent 該不該起得來？
3. 為什麼 MCP 工具預設要當成最高風險？
4. 工具名字為什麼要加一堆前綴，加了會出什麼事？
5. 一份你不能改的 schema 送給模型會怎樣？

---

## Step 0：先跑起來

不需要 API key：

```bash
bun run lesson-12
```

```
Connecting to MCP servers
  ✓ fleet  3 tools
  ✗ ghost  initialize timed out (5000ms)
  ✗ rubble  MCP server "rubble" exited (code 1)
  (5020ms; the two broken ones did not hold up startup)

Tools loaded
  mcp__fleet__list_robots  [external]  ← fleet/list_robots
  mcp__fleet__get_robot  [external]  ← fleet/get_robot
  mcp__fleet__schedule_maintenance  [external]  ← fleet/schedule_maintenance
```

三台 server 有兩台是壞的，這是刻意的。使用者的 `mcp.json` 裡遲早會有一台
壞掉（套件更新、token 過期、指令改名），那時候 agent 必須照常啟動。

其他玩法：

```bash
PROVIDER=gemini bun run lesson-12   # a real model
MODE=auto bun run lesson-12         # are MCP tools still asked about under AUTO
COLLIDE=1 bun run lesson-12         # collisions caused by name truncation (Step 4)
TODAY=1 PROVIDER=gemini bun run lesson-12  # Step 6's control group
```

---

## Step 1：協定小到你可以自己寫一個

`server.ts` 是一個真的 MCP server，零依賴，不到 200 行。整個協定就三個方法：

```
initialize     handshake; exchange versions and capabilities
tools/list     what tools do you have
tools/call     run one
```

訊息是換行分隔的 JSON-RPC 2.0，走 stdin/stdout。

> 所以 server 絕對不能 `console.log`。
> 那會把非 JSON 的東西寫進協定通道，client 那邊會看到一堆解析失敗。
> 這是自己寫 MCP server 第一個踩的坑，所以這一課所有除錯輸出都走 stderr。

還有一個容易搞混的地方，在 `server.ts` 裡標了出來：

```ts
// A tool error is a normal response with `isError: true`, not a JSON-RPC error.
reply(id, { content: [{ type: "text", text }], isError });
```

協定層的錯誤（方法不存在）跟工具層的錯誤（機器人找不到）是兩件事。
混在一起的話，agent 會分不出「該重試」和「該換做法」。

---

## Step 2：跟自己寫的工具，差在「信任」不在協定

| | 自己寫的工具（Lesson 2） | MCP 工具 |
|---|---|---|
| 跑在哪 | 你的進程 | 別人的進程 |
| 誰寫的 | 你 | 別人 |
| 壞掉的樣子 | throw 一個你認得的錯 | 逾時、沉默、進程消失 |
| 描述是誰寫的 | 你 | 別人，而且你改不了 |
| schema 是誰寫的 | 你 | 別人，而且你改不了 |

所以 `client.ts` 有一半的程式碼在處理「它不乖怎麼辦」：逾時、
進程死掉時叫醒所有等待中的請求、stderr 收集。

### 逾時：跟 Lesson 9 剛好相反

Lesson 9 的 inbox `wait()` 刻意沒有 timeout，這裡卻一定要有。判準是同一條：

> 這件事逾時之後，有沒有一個安全的預設行為？
>
> - inbox 等的是人的決定，逾時之後放行或拒絕都不安全 → 不設
> - MCP 等的是一個工具結果，逾時就當它失敗 → 要設

---

## Step 3：一台壞掉不能拖垮其他台

```
✗ ghost   initialize timed out (5000ms)   ← accepts the connection and never answers the handshake
✗ rubble  exited (code 1)                 ← dies at startup
(5020ms)
```

`ghost` 那種最難處理：沒有錯誤，只有沉默。沒有逾時的話 agent 永遠起不來。

注意總時間是 5020ms，不是兩個逾時加起來。因為連線是平行的：

```ts
const results = await Promise.allSettled(SERVERS.map(...));
```

序列連的話，啟動時間會變成所有壞掉 server 的逾時總和。
三台壞的就是 15 秒，使用者會以為程式當了。

---

## Step 4：名字要加前綴，而前綴會咬你

模型看到的工具名字是 `mcp__<server>__<tool>`，而且要消毒成
OpenAI 的規則 `[A-Za-z0-9_-]{1,64}`（對照 `tools.py` 的 `tool_name`）。

前綴是必要的：兩台 server 都有 `search` 的時候，模型要分得出來。

但 64 字的上限會造成碰撞：

```bash
COLLIDE=1 bun run lesson-12
```

```
✓ acme-internal-platform-tools-production-cluster  5 tools
  ⚠ name collision mcp__acme-internal-platform-tools-production-cluster__create_inc
    …/create_incident_report would be shadowed by …/create_incident_summary

Tools loaded
  …__list_robot
  …__get_robot
  …__schedule_m
  …__create_inc        ← only 4 of the 5 tools survive
```

server 名字 47 個字元，加上 `mcp__` 和 `__` 就吃掉 54，
工具名字只剩 10 個字元的預算。於是 `create_incident_report` 和
`create_incident_summary` 被截成同一個名字，後者靜靜蓋掉前者。

> 同一台 server 上「前綴相同的兩個工具」是最容易踩到的碰撞形狀，
> 比「兩台 server 有同名工具」常見得多，因為同一台 server 的工具
> 本來就常常共用動詞前綴（`create_`、`list_`、`get_`）。

`openworker` 那份沒有偵測碰撞（`tools.py:33` 直接截斷）。
我們加了一行警告，因為靜靜少一個工具是最難查的那種 bug：
模型會說「我沒有可以產生完整報告的工具」，而你看設定明明有。

---

## Step 5：MCP 工具預設是 EXTERNAL

```
mcp__fleet__list_robots  [external]
```

`list_robots` 聽起來完全無害，為什麼是最高風險？

> 因為那個名字和那句描述都是別人寫的。
> 它說「List robots in the fleet」不代表它只做這件事。

程式碼裡就一行（接回 Lesson 8 的 `risk.ts:128`）：

```ts
const metadata: ToolRiskMetadata = { requiresApproval: true, category: "mcp" };
// classify() sees requiresApproval → RiskClass.EXTERNAL
```

`category: "mcp"` 也有用：Lesson 8 Step 5 講過，
connector 類的工具不能用「這個工具都允許」整個放行。

使用者當然可以個別放寬（`riskOverrides`，「這台我信任」），
但預設必須保守，因為預設值是給還沒讀過那台 server 原始碼的人用的。

---

## Step 6：那份你不能改的 schema

`schedule_maintenance` 的 schema 是故意寫難的，而且它合法：

```json
{
  "window": { "oneOf": [ { "type": "string" }, { "type": "object", ... } ] },
  "notes":  { "type": ["string", "null"] }
}
```

重點不是它難，是它不是你寫的。MCP server 是別人的，你只能照收。
`openworker` 的做法是原封不動傳下去（`tools.py:_openai_schema`，
註解寫 "for fidelity"），我們也是。

### 實測：Gemini 吃得下去

真 Gemini 3.6 Flash，跑 3 次，3 次都正確選了 `oneOf` 的 object 分支、
也正確填了 `notes` 字串：

```json
{"robot_id":"R-204","window":{"start":"2026-08-01T02:00:00Z","hours":3},"notes":"battery replacement"}
```

所以「provider 吃不下 MCP schema」這個擔心，至少對 Gemini 沒有發生。
但這正是 Lesson 30 的起點：一家能吃不代表每家都能，
而你**沒辦法改那份 schema**，只能在自己這邊加一層相容。

### 但實測抓到另一個東西，而且更嚴重

同樣 3 次，模型填的日期全部是 2024-08-01。今天是 2026-07-28，
使用者說的「8/1」應該是 2026-08-01。

```
┌ approval needed
│ fleet/schedule_maintenance
│ {"robot_id":"R-204","window":{"start":"2024-08-01T02:00:00","hours":3},…}
│ This operation has side effects that leave the machine and cannot be taken back
└
  (ANSWER=y, answered automatically)
  ✓ Maintenance scheduled for R-204. On-site team notified.
```

權限引擎做對了每一件事：分級正確、攔下來了、參數就印在批准框上。
然後被按了 y，一個錯誤的日期進了一個收不回來的外部操作。

> 批准框顯示了它，不代表有人讀了它。
> Lesson 8 解決的是「要不要問」，這一題是「問了之後有沒有人真的看」，
> 而後者不是權限引擎能解決的。

### 原因與修法

模型的 system prompt 裡沒有今天的日期，所以它只能用訓練資料的先驗。

```bash
TODAY=1 PROVIDER=gemini bun run lesson-12
```

```
{"robot_id":"R-204","window":{"start":"2026-08-01T02:00:00Z","hours":3},…}
```

3/3 修好。程式碼裡就一行：

```ts
(TODAY ? `\n\nToday's date is ${new Date().toISOString().slice(0, 10)}.` : "")
```

> 任何會收日期參數的工具，system prompt 裡就必須有今天的日期。
>
> 這條放在 MCP 這一課特別重要，因為 MCP 工具的參數是別人定義的，
> 你不會知道那台 server 收不收日期，除非你去讀它的 schema。

---

## 這課刻意不做的事

| 沒做 | 為什麼 |
|---|---|
| HTTP / SSE transport | stdio 已經把協定講完了，換 transport 是傳輸問題 |
| OAuth（`oauth.py` 240 行） | 見下面「OAuth 那半課」 |
| resources / prompts | MCP 還有這兩類，但 agent 最常用的是 tools |
| 動態工具重載 | server 可以通知工具變了。加了會讓這一課變兩倍長 |

### OAuth 那半課

`openworker/coworker/mcp/oauth.py`（240 行）處理遠端 MCP server 的
OAuth 2.1 + PKCE + 動態註冊（DCR）。這課沒做，但有三個結論值得直接抄：

1. token 不進設定檔。`mcp.json` 是純文字，而且使用者會互相貼來貼去。
   token 存在權限 0600 的 SecretStore，profile 是 `mcp-oauth:<server>`
2. 背景情境不准開瀏覽器。它有一個 `InteractiveAuthRequired` 例外，
   註解裡寫了一次真實事故：

   > owner-hit 2026-07-20: an authorize page opened at app launch

   原因是某家廠商把 refresh token 作廢，於是任何碰到那台 server 的
   程式碼路徑都會去開授權頁，包括開機時的工具列舉。
   所以只有「使用者明確點連線」才准互動，其他情境一律丟例外、跳過那台
3. 例外會被包在 ExceptionGroup 裡。SDK 的 transport 跑在 anyio
   task group，所以判斷要遞迴找（`is_auth_required`），
   直接 `isinstance` 會漏掉

---

## 跑不起來？

| 症狀 | 原因 |
|---|---|
| 每台 server 都逾時 | `process.execPath` 不是 bun？這課用它來 spawn 自己 |
| `bad JSON` 一直出現 | 你的 server 裡有 `console.log`。改成 `process.stderr.write` |
| 啟動要 15 秒 | 連線變成序列的了。要 `Promise.allSettled` |
| 工具比預期少一個 | 看 Step 4 的名稱碰撞 |
| 模型說找不到工具 | 名字截斷之後跟你設定裡寫的不一樣 |

---

## 練習

### 練習 1：把 `ghost` 的逾時調到 500ms ⭐

`MCP_CONNECT_TIMEOUT_MS=500 bun run lesson-12`。

啟動變快了，但問自己：一台真的很慢的 server 跟一台壞掉的 server，
你分得出來嗎？這個逾時該設多少？

### 練習 2：修好名稱碰撞 ⭐⭐

現在只有警告。改成真的解決：碰撞時退回一個雜湊後綴
（`mcp__acme__create_inc_a1b2`），並且維持一份「模型看到的名字 → 真實工具」
的對照表。

做完會發現一件事：那個對照表必須跟 session 一起存（Lesson 4），
不然重開之後舊對話裡的工具呼叫就對不上了。

### 練習 3：讓 `FAIL_MODE=slow` 跑起來 ⭐⭐

`tools/call` 會卡 30 秒，而呼叫逾時是 10 秒。

觀察逾時之後 agent 做了什麼，然後想：那個 server 其實還在跑那個工具。
如果它是 `schedule_maintenance`，你剛剛可能真的排了一個維修時段，
卻告訴模型「失敗了」。這題沒有好答案，想清楚問題本身就有價值。

### 練習 4：加上 include/exclude ⭐

`client.ts` 已經支援了，但 `agent.ts` 沒有用。
給 `fleet` 加 `includeTools: ["list_robots", "get_robot"]`，
看 `schedule_maintenance` 消失。

然後算一下：一台 server 給你 40 個工具、你只要 2 個的話，
另外 38 個的索引成本是每一輪都在付的（Lesson 16 Step 1）。

### 練習 5：把 MCP 工具接上 Lesson 9 的 inbox ⭐⭐⭐

現在批准是問終端機。改成無人值守：MCP 工具需要批准時丟進 inbox。

這題會逼你面對一個新問題：MCP 連線是活的進程。
等八小時的話，那個 server 還活著嗎？該不該重連？
重連之後 tool call id 還有效嗎？

---

## 對照原始碼

`openworker/coworker/mcp/`，共 647 行（`__init__` 29、`client` 158、
`config` 129、`oauth` 240、`tools` 91）。行數驗證過。

| 這課的概念 | OpenWorker | Mastra |
|---|---|---|
| 連線與生命週期 | `client.py` `MCPManager._serve` | `packages/mcp/src/client/client.ts` |
| 一台一個 task，enter/exit 同一個 task | `client.py:87`（anyio cancel scope 的限制） | |
| 工具結果壓平 | `client.py` `_result_payload` | |
| `mcp__<server>__<tool>` 與 64 字上限 | `tools.py:33` `tool_name` | |
| schema 原封不動傳下去 | `tools.py` `_openai_schema`（"for fidelity"） | `packages/schema-compat/`（這裡才修） |
| include / exclude | `tools.py` `_filtered` | |
| MCP 工具 = 需要批准 | `tools.py` `ToolMetadata(requires_approval=…)` | |
| 設定檔（貼得動 Claude Desktop 的） | `config.py` `load_mcp_servers` | `client/configuration.ts` |
| OAuth + PKCE + DCR | `oauth.py` | `client/oauth-provider.ts` |
| 背景情境不准開瀏覽器 | `oauth.py` `InteractiveAuthRequired` | |

> 兩份實作互為印證很有用：OpenWorker 是 Python、Mastra 是 TypeScript，
> 形狀卻幾乎一樣。那個形狀就是 MCP 本身，不是某個人的品味。

---

## 下一課

[Lesson 30: 同一個 schema，不同模型不同下場](../lesson-30-schema-compat/README.zh-TW.md)

Step 6 已經把問題擺出來了：MCP server 給你的 schema 你不能改。
Gemini 這次吃下去了，但 `oneOf` 和 `["string","null"]` 在別家不一定過。
那一課會做一層相容，並且用一份跑遍所有 provider 的契約測試把它釘住。
