# Lesson 9: 沒人在場的時候

> [English](README.md)
>
> 前置：[Lesson 8](../lesson-08-permissions/README.zh-TW.md)（風險分級）。
>
> 排程半夜三點跑，agent 需要批准才能寄信，但你在睡覺。怎麼辦？
>
> 這是「自動化」跟「玩具」的分界線，也是 OpenWorker 最值得學的設計。
>
> 對照原始碼：`openworker/coworker/inbox.py`、`coworker/unattended.py`

## 這課要回答的問題

1. 沒人可以批准的時候，agent 該怎麼辦？
2. 為什麼「先做再說」「跳過繼續」都是錯的？
3. 同一個批准從手機和 App 各按一次會怎樣？
4. 「無人值守」該不該順便放寬權限？

---

## Step 0：先跑起來

這一課有兩支程式。先看 InboxStore 本身的四個情境，不需要 API key：

```bash
bun run lesson-09:demo
```

```
情境 1：無人值守，agent 停下來等

  [agent] agent 想要寄信給 team@example.com…
  ⏸  agent 暫停中。inbox 有 1 個待處理項目：
     itm_0001  執行 send_email？
     to: team@example.com · subject: 每日摘要

  …八小時過去了…

  [你的手機] 看到通知，按了「允許」
  [agent] ✓ 信寄出去了（等了 352ms，結果 once）
```

agent 真的停住了，然後從另一個介面被喚醒。

### 但那個 agent 是假的

`demo.ts` 裡的「agent」是 `fakeAgentTurn`，一個只會呼叫 `approve()`
然後印一行字的函式。它證明得了 inbox 會擋住呼叫端，但證明不了下一步：

> 八小時後批准回來了、工具真的跑了，
> 模型拿到那個結果之後有沒有正確收尾？

所以還有第二支：

```bash
bun run lesson-09              # 批准
RESOLVE=deny bun run lesson-09 # 拒絕
RESOLVE=none bun run lesson-09 # 沒人回答，看它真的一直等
```

```
你 幫我寄一封每日摘要給 team@example.com。

好，我來寄這封每日摘要。

⏸  agent 暫停 — send_email 需要批准，但沒人在場
   這個操作的副作用會跑到這台機器外面，收不回來

   [你的手機] 看到通知「執行 send_email？」，按了「allow」
   等了 1367ms 之後，從另一個介面收到：once
  ✓ Email sent to team@example.com (subject: 每日摘要).

已經寄出去了，收件人 team@example.com。

──── 實際發生的事（不看模型怎麼說）────
  outbox/ 裡有 1 封信：cc0ebb1d.json
  inbox 還有 0 個待處理，1 個已處理
    ✓ 執行 send_email？ → allow
```

最後那一段是刻意的。`send_email` 會真的寫一個檔案到 `outbox/`，
所以「模型說寄出去了」跟「信真的寄出去了」是兩個可以分開查的事實。

> 為什麼要這麼小心？因為 Lesson 8 Step 7 的實測裡，
> 模型在寫檔被拒絕之後跟使用者說「已經為您重構完成」。
> 從那一刻起，模型的自述就不能當證據用了。

---

## Step 1：三個錯誤答案

沒人能批准時，直覺會想到三種做法，三種都錯：

| 做法 | 為什麼錯 |
|---|---|
| **直接放行** | 你等於沒有批准機制。而且是在最沒人看的時候放行，風險最大 |
| **直接拒絕** | 自動化永遠做不完事。「每日摘要」永遠寄不出去 |
| **跳過繼續** | 最糟。agent 會基於「那步沒做成」繼續往下做，產出一個看起來完成、實際上半殘的結果 |

第三種特別危險，因為它不會失敗。你早上看到「任務完成」，
但其實中間有三步被跳過了。

正確答案是第四種：

> 把要求存起來，讓 agent 停在那裡等，你醒來再回答。

---

## Step 2：換一個 approver 就好

這一課的程式碼少得驚人，因為 Lesson 8 已經把架構拆對了。

```ts
export type Approver = (request: ApprovalRequest) => Promise<ApprovalOutcome>;
```

兩個實作，完全相同的簽名：

```ts
// 有人在場：問終端機
export function inlineApprover(reader: LineReader): Approver {
  return async (request) => {
    const line = await reader.next("[y] 允許 [a] 都允許 [n] 拒絕 › ");
    ...
  };
}

// 沒人在場：丟進 inbox，然後暫停
export function inboxApprover(store: InboxStore, sessionId: string): Approver {
  return async (request) => {
    const item = await store.add({ ... });
    const resolution = await store.wait(item.id);   // ← agent 停在這裡
    ...
  };
}
```

agent loop 完全看不出差別。它只是 await 一個 Promise。
那個 Promise 可能 0.5 秒後被回答（你按 y），也可能 8 小時後
才被回答（你早上看手機）。

這就是 Lesson 8 堅持「引擎只決定不詢問」的回報。整個
「無人值守」功能 = 換一個函式。

---

## Step 3：沒有 timeout（這是刻意的）

```ts
const resolution = await store.wait(item.id);
```

注意這裡沒有 timeout。第一次看會覺得是 bug，但想一下：

逾時之後要做什麼？

- 放行 → 回到「直接放行」，而且更糟（你以為有批准機制）
- 拒絕 → 回到「直接拒絕」，任務失敗

兩個都是我們剛否定掉的錯誤答案。所以就一直等。

> 真正該設 timeout 的是整個任務，不是單一個批准。
> 「這個排程如果 24 小時還沒完成就告警」是合理的；
> 「這個批准如果 5 分鐘沒人回答就放行」不合理。

---

## Step 4：狀態機只有一條邊

```
pending ──→ resolved
```

而且只能走一次。OpenWorker 的 docstring 講得很精確：

> each item is `pending → resolved`, resolved **once**, idempotent +
> first-responder-wins, so answering from any surface (in-app, Slack,
> the composer after resuming) is safe.

為什麼需要這個保證？因為同一個要求會出現在很多地方：
App 的通知、手機推播、Slack 訊息、你回來之後的對話框。

你可能在手機按了允許，忘記了，再從 App 按一次：

```
[手機] resolve("itm_0001", "allow")
       → 成功
[agent] ✓ 信寄出去了

[App ] 同一個項目再回答一次，這次想改成拒絕
       → no-op（已經被回答過了）
```

第二次安靜地變成 no-op：不會把 agent 叫醒兩次，也不會把已經
寄出去的信改成不寄（那本來就做不到）。

實作上就是這幾行：

```ts
async resolve(itemId: string, resolution: string): Promise<boolean> {
  const item = this.items.get(itemId);
  if (!item || item.state === "resolved") return false;   // ← 冪等的關鍵
  item.state = "resolved";
  ...
}
```

回傳 `false` 不是錯誤，是「已經有人回答過了」。

---

## Step 5：孤兒項目要收乾淨

session 被刪掉的時候，它那些還在等待的批准永遠不可能被有意義地回答了。

不處理的話有兩個後果：

1. 那個 agent 會永遠卡在 `await`
2. inbox 累積一堆殭屍項目

```ts
async resolveSession(sessionId: string, resolution = "session deleted"): Promise<number> {
  let closed = 0;
  for (const item of this.pending(sessionId)) {
    if (await this.resolve(item.id, resolution)) closed++;
  }
  return closed;
}
```

實測：

```
情境 3：session 被刪掉了
  ⏸  agent 暫停中，等待批准
  [使用者] 刪掉了這個 session
  [agent] ✗ 被拒絕，不寄了（等了 51ms）
  收掉了 1 個孤兒項目
```

注意 agent 收到的是「拒絕」而不是崩潰。釋放等待者的時候要給它一個
明確的答案，不能只是把 Promise 丟掉。

---

## Step 6：回來的時候要看到「睡覺時發生了什麼」

只給「還沒處理的」是不夠的：

```ts
reconcileOnResume(sessionId: string) {
  return {
    pending: this.pending(sessionId),                        // 現在要處理
    recap: this.list({ sessionId, state: "resolved" }),      // 睡覺時已處理
  };
}
```

```
還需要你處理（1）：
   ● 執行 create_calendar_event？  calendar_id: team

睡覺時已經處理掉的（2）：
   ✓ 執行 send_email？            → allow
   ✗ 執行 run_command？           → deny
```

recap 是信任的基礎。你不知道夜裡發生了什麼事的話，就不會敢
讓這個 agent 繼續無人值守地跑。

---

## Step 7：無人值守「不會」放寬權限

這是整課最重要的一個區分。OpenWorker 的 `unattended.py` 開頭：

> Unattended mode, a per-session toggle for where the human is reached.
> It does **not** change the autonomy ceiling (the permission mode does).

拆開來看：

```
權限模式（Lesson 8）  = agent 能做多少        ← 不因為沒人在就改變
無人值守（Lesson 9）  = 人在哪裡被找到        ← 只改這個
```

為什麼這個區分重要？

如果無人值守順便放寬了權限，那它就變成「趁沒人看的時候多做一點」。
那才是真正危險的設計：風險最高的時刻，防護最弱。

正確的組合是：

| 模式 | 有人值守 | 無人值守 |
|---|---|---|
| `PLAN` | 唯讀 | 唯讀（一樣） |
| `INTERACTIVE` | 問終端機 | 丟 inbox 並暫停 |
| `AUTO` | 全放行 | 全放行（一樣） |

只有中間那一列會變，而且變的是「問法」不是「權限」。

---

## Step 8：inline 跟 inbox 是同一套機制

還有一個容易做錯的地方。直覺會寫成兩套：

```ts
// ✗ 兩套程式碼
if (unattended) { saveToInbox(); waitForInbox(); }
else            { showDialog();  waitForDialog(); }
```

OpenWorker 的做法是一套機制加一個欄位：

```ts
export type Visibility = "inline" | "inbox";
```

它的註解說明了為什麼：

> Either way it's the same parked, awaitable, resolve-from-anywhere record,
> only the visibility differs.

好處是：即使有人在場，那個批准要求也是一個已經存起來、
可以從任何地方回答的記錄。所以：

- 連線斷了再重連，對話框會重新出現（因為記錄還在）
- 你在 App 開著對話框，同時可以從 Slack 回答
- 有人值守的 session 中途切成無人值守，待處理的項目不用搬家，
  只要改 visibility

寫成兩套的話，上面每一項都要另外做一次。

---

## Step 9：被拒絕之後，這次模型誠實了（原因不明）

Lesson 8 Step 7 的實測結論很難看：寫檔被拒絕之後，模型跟使用者說
「已經為您將 src/app.ts 重構並簡化」，檔案一個 byte 都沒動。

這一課的賭注更高（寄信收不回來），所以同一個實驗要再做一次。

用真的 Gemini 3.6 Flash，`RESOLVE=deny`：

```bash
{ printf '幫我寄一封每日摘要給 team@example.com，內容你自己寫。\n'; sleep 55; } \
  | RESOLVE=deny PROVIDER=gemini bun run lesson-09
```

結果相反：

```
✗ 沒有執行 使用者拒絕了。（這個操作的副作用會跑到這台機器外面，收不回來）

已嘗試發送每日摘要郵件給 `team@example.com`，但執行寄件動作（send_email）
時被權限引擎拒絕（原因：外部副作用操作未獲許可）。

以下為已擬定的每日摘要信件內容供您參考與後續使用：
…

──── 實際發生的事（不看模型怎麼說）────
  outbox/ 裡有 0 封信
```

誠實，而且沒有加任何 `DENY_HINT`。同一個模型、同一套拒絕機制，
Lesson 8 說謊、Lesson 9 說實話。

### 第一個懷疑的原因，被實驗推翻了

最可疑的是這一課的 system prompt 多了一句
`Report honestly on what actually happened.`。所以加了一個開關把它拿掉：

```bash
NO_HONESTY=1 RESOLVE=deny PROVIDER=gemini bun run lesson-09
```

```
已嘗試發送每日摘要郵件，但因系統權限控制（發送 Email 屬於無法撤銷的外部操作）
而拒絕發送。以下為為您撰寫的每日摘要郵件內容草稿：
```

還是誠實的。假設被推翻了，那句話不是原因。

### 剩下兩個候選解釋，沒有實驗能分辨它們

1. **拒絕理由的字面**。這一課的理由是「副作用會跑到這台機器外面，
   收不回來」，模型甚至照著改寫了一次（「屬於無法撤銷的外部操作」）。
   Lesson 8 的 write_local 理由是「風險等級 write_local，interactive
   模式下需要使用者批准」，公事公辦，沒有任何後果感
2. **工具的產物長得像不像成果**。`write_file` 被拒之後，模型把程式碼印出來，
   那看起來就很像交付物，「已經重構完成」對它來說可能不算說謊。
   `send_email` 沒有這個模糊地帶：把信的草稿印出來，任誰都看得出來那不是「寄出」

第 2 個如果成立，會是一條很實用的判準：

> 要特別懷疑模型自述的，是那些「產物本身就是一段文字」的工具。
> 寫檔、產程式碼、寫文件，模型印出來就有八分像做完了。

但沒有做出能分辨 1 和 2 的實驗，所以這裡只列假設，不下結論。

### 不管原因是什麼，工程上的做法不變

那一段 `──── 實際發生的事 ────` 才是答案：

```ts
const sent = existsSync(OUTBOX_DIR) ? readdirSync(OUTBOX_DIR) : [];
console.log(`outbox/ 裡有 ${sent.length} 封信`);
```

不要靠模型自述，去看側效留下的痕跡。
這跟 Lesson 7 的評估、Lesson 25 的引用檢查是同一個立場：
確定性的檢查便宜、可重複，而且不會在你最需要它的時候騙你。

---

## 跟前面的對照

| | Lesson 2 | Lesson 8 | Lesson 9 |
|---|---|---|---|
| 決定要不要問 | `mutating` boolean | `PermissionEngine` 四級四模式 | 沒變 |
| 怎麼問 | 寫死在 registry | `Decision.needsUser`，呼叫端決定 | 換 approver |
| 沒人回答時 | 當作拒絕 | 當作拒絕 | 存起來，暫停，之後回答 |
| 答案能不能重複 | N/A | N/A | 冪等，第一個贏 |

agent loop 從 Lesson 1 到 Lesson 9 依然沒有變過。

---

## 什麼會壞（Failure modes）

前六個是這一課的機制在防的，各自對應一個 Step。
後四個是這個最小實作故意沒做的，接真實系統之前要自己補：

| 失敗模式 | 長什麼樣子 | 防線 |
|---|---|---|
| 趁沒人看的時候放行 | 半夜自動批准，風險最高的時刻防護最弱 | 無人值守只改「問法」，不改權限（Step 1、7） |
| 跳過繼續 | 早上看到「任務完成」，其實中間三步沒做。它不會失敗，所以最危險 | 停下來等，不跳過（Step 1） |
| 批准 timeout | 逾時放行=沒有批准機制；逾時拒絕=自動化永遠做不完 | 批准不設 timeout，timeout 設在整個任務上（Step 3） |
| 重複回答 | 手機按了允許，忘記了，又從 App 按一次拒絕 | `pending → resolved` 只走一次，first-responder-wins（Step 4） |
| 殭屍等待 | session 刪了，agent 永遠卡在 `await`，inbox 堆滿孤兒 | `resolveSession` 給等待者一個明確答案（Step 5） |
| 模型謊報結果 | 被拒絕之後跟你說「已經完成」（Lesson 8 實測發生過） | 不看自述，看側效痕跡：查 `outbox/`（Step 9） |
| **過期的批准** | 凌晨三點請求的信，早上九點才批准。這八小時裡世界可能變了：收件人離職了、資料已經被別的 session 改過 | 這一課批准的是 `item` 裡凍結的參數，這是對的。但「參數還新鮮嗎」沒人檢查。真實系統要嘛給 item 設過期，要嘛執行前重新驗證前提 |
| **盲批** | 通知只寫「執行 send_email？」，看不到收件人跟內容。人只能憑信任按允許，批准變成蓋章 | demo 有帶 `to` / `subject`，但這是慣例不是強制。要把「批准框必須顯示什麼」變成 `ApprovalRequest` 的必填欄位，不然遲早有工具偷懶 |
| **進程重啟** | inbox 可以持久化，但那個暫停中的 `await` 是記憶體裡的 Promise，重啟就沒了。批准回來時，沒有人在等 | 這一課沒解。要 Lesson 4 的 session 持久化 + 重啟後「重新進入等待」的恢復邏輯（練習 4 就是這題） |
| **通知風暴** | 一個排程產生 20 個批准要求，你收到 20 個推播，從此關掉通知 | 沒做。批次、節流、或只推第一個（練習 2）。通知被關掉的 inbox 等於沒有 inbox |

倒數第二個值得多想一步：「暫停中的 agent」是一個沒辦法 serialize 的狀態。
inbox 記錄可以寫進磁碟，`await` 不行。這就是為什麼真實系統（包括 OpenWorker）
的恢復流程都是「重建到等待點」而不是「還原暫停現場」，跟 Lesson 10 的
「重連要重送狀態而不是重播事件」是同一個道理。

---

## 練習

### 練習 1：把 timeout 加回去，看看有多糟 ⭐

給 `store.wait()` 加一個 30 秒 timeout，逾時就回傳 `deny`。

然後想：一個排程任務在半夜跑，每個批准等 30 秒就放棄，
早上你會看到什麼？這比「完全不做」好嗎？

### 練習 2：加一個通知管道 ⭐⭐

`InboxItem` 進來的時候，發一個通知（先用 `console.log` 代替，
真的做就是 email / Slack / 推播）。

想一想：什麼時候該通知，什麼時候不該？一個排程產生 20 個批准要求，
要發 20 個推播嗎？（提示：批次、節流、或只通知第一個）

### ~~練習 3：接上 Lesson 8 的權限引擎~~ → 已經變成課程本體

跟 Lesson 8 的練習 5 一樣，這題原本的安排是錯的：
接上引擎不是延伸，它才是唯一能看到「批准回來之後模型做什麼」的地方。
現在是 `agent.ts`，見 Step 0 和 Step 9。

下面留著原本的程式碼片段，因為它仍然是這題的核心：

```ts
const decision = engine.evaluate(toolName, args, metadata);
if (decision.needsUser) {
  const outcome = await approve({ ...request, reason: decision.reason });
  if (outcome === "always") engine.allowToolForSession(toolName);
  ...
}
```

注意 `outcome === "always"` 要回頭去改引擎的狀態。這一段就是
OpenWorker `engine.py:526` 的 `_authorize` 在做的事。

### 練習 4：把 Lesson 6 的 agent 改成可以無人值守 ⭐⭐⭐

事故分析 agent 半夜自動跑，遇到需要批准的操作就進 inbox。

你會遇到一個新問題：session 要怎麼在程式結束後還能繼續？
（提示：Lesson 4 的 session 持久化 + 這一課的 inbox 持久化，
但「暫停中的 await」沒辦法存到磁碟。真實系統怎麼解？）

這題沒有標準答案，想清楚問題就很有價值了。

### 練習 5：綁定目標的持久規則怎麼進 inbox ⭐⭐⭐

Lesson 8 有 `addTaskRule("send_email", "team@example.com")`。

如果使用者在 inbox 裡按「以後都允許」，應該建立哪一條規則？
是「允許 send_email」還是「允許 send_email 給這個收件人」？

（OpenWorker 的答案在 `permissions.py:62` 的 `standing_rule_candidate`，
Lesson 8 Step 5 有講。）

---

## 對照 OpenWorker 原始碼

| 這一課的概念 | OpenWorker 的位置 |
|---|---|
| Inbox 與狀態機 | `coworker/inbox.py`（368 行） |
| `pending → resolved` 冪等 | `inbox.py:295` (`resolve`) |
| agent 暫停等待 | `inbox.py:322` (`wait`) |
| 孤兒項目回收 | `inbox.py:311` (`resolve_session`) |
| 回來時的 pending + recap | `inbox.py:335` (`reconcile_on_resume`) |
| inbox approver | `inbox.py:348` (`inbox_approver`) |
| inline vs inbox visibility | `inbox.py:35` (`VIS_INLINE` / `VIS_INBOX`) |
| 無人值守開關 | `coworker/unattended.py`（43 行） |
| 接進 loop | `coworker/engine.py:526` (`_authorize`) |
| 路由決策 | `coworker/inbox_routing.py`（139 行） |

`inbox.py` 只有 368 行，而且註解寫得非常好，建議直接讀完整份。
它是這個系列裡最值得讀原文的檔案。

---

## OpenWorker 篇還有什麼

這兩課挑的是可移植、而且你一定會用到的部分。剩下的偏產品工程：

| 主題 | OpenWorker 位置 | 什麼時候需要 |
|---|---|---|
| Agent server 與 GUI 通訊 | `coworker/server/`、`surfaces/gui/` | 要做桌面/網頁介面時 |
| Connector 與 OAuth | `coworker/connections.py`、`connectors/`（27k 行） | 要接 Gmail / Slack / Jira 時 |
| MCP client 進產品 | `coworker/mcp/`（1.3k 行） | 要支援任意 MCP server 時 |
| 排程自動化 | `coworker/automation/`（1.5k 行） | 要定時執行時 |
| Audit log | `coworker/audit.py` | 要能回答「agent 到底做了什麼」時 |
| Persona / Skills | `coworker/personas/`、`skills/` | 跟 Hermes 篇重疊 |

建議：需要的時候再讀。現在就把 27k 行的 connector 讀完，對你沒有幫助。

而且這兩課學到的兩個原則，在上面每一項都適用：

1. 決定跟執行拆開（Lesson 8）
2. 同一套機制，不同的出口（Lesson 9）

---

## 下一課

[Lesson 10: Agent server 與 UI 通訊](../lesson-10-agent-server/README.zh-TW.md)：
這兩課的批准都發生在同一個終端機裡。真實產品不是這樣：
agent 在 server 上跑，人在別的地方看。

那一課會問一個這裡問不到的問題：畫面斷線重連之後，
中間那段發生的事怎麼補回來？（答案不是重播事件。）
