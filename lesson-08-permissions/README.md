# Lesson 8: 從 boolean 到風險分級

> **OpenWorker 篇第一課。** 前置：[Lesson 2](../lesson-02-tools/)（批准機制）。
>
> Lesson 2 用一個 `mutating: boolean` 決定要不要問使用者。這一課看真實產品
> 怎麼做，以及為什麼那個 boolean 撐不住。
>
> 對照原始碼：[`openworker/coworker/risk.py`](https://github.com/andrewyng/openworker)
> 和 `coworker/permissions.py`

## 這課要回答的問題

1. 「寫檔案」跟「寄信給客戶」都是 mutating,但危險程度一樣嗎？
2. 使用者按「都允許」之後，到底允許了什麼？
3. `AUTO` 模式該不該能寫到工作區外面？
4. 為什麼「決定」跟「詢問」要拆開？

---

## Step 0：先跑起來

不需要 API key,不用網路，跑不到一秒：

```bash
bun run lesson-08-permissions/table.ts
```

```
情境                      風險            plan          interactive   custom        auto
──────────────────────────────────────────────────────────────────────────────────────
讀工作區的檔案                 read          ALLOW         ALLOW         ALLOW         ALLOW
寫工作區的檔案                 write_local   DENY          ASK           ALLOW         ALLOW
寫到工作區外面                 write_local   DENY          DENY          DENY          DENY
允許清單上的指令                exec          DENY          ALLOW         ALLOW         ALLOW
允許清單 + 元字元              exec          DENY          ASK           ASK           ALLOW
不在清單上的指令                exec          DENY          ASK           ASK           ALLOW
寄信（外部副作用）               external      DENY          ASK           ASK           ALLOW
未知的 MCP 工具              external      DENY          ASK           ASK           ALLOW
```

**盯著第三行看。** 「寫到工作區外面」在**四種模式全部都是 DENY**,
包括 `AUTO`。這是這一課最重要的一個設計，Step 3 會講。

---

## Step 1：四級，不是兩級

Lesson 2 的模型：

```ts
readonly mutating: boolean;   // 要不要問？
```

OpenWorker 的模型（`risk.py`）：

```ts
export enum RiskClass {
  READ = "read",                 // 沒有副作用
  WRITE_LOCAL = "write_local",   // 動到工作區，可以還原
  EXEC = "exec",                 // 執行指令，你不知道它會做什麼
  EXTERNAL = "external",         // 副作用跑到機器外，收不回來
}
```

為什麼要分這麼細？因為這四種的**處理方式不同**：

| 等級 | 特性 | 對應的機制 |
|---|---|---|
| `READ` | 無副作用 | 永遠自動放行 |
| `WRITE_LOCAL` | 可還原，但要限制範圍 | **路徑限制**（連 AUTO 都擋） |
| `EXEC` | 不可預測 | 指令允許清單 + 元字元檢查 |
| `EXTERNAL` | **收不回來** | 綁定目標的持久規則；Lesson 9 的 inbox 判斷依據 |

用一個 boolean 的話，這四種全部走同一條路，你就沒辦法對「寄信」
比對「寫暫存檔」更嚴格。

### 風險是「宣告」的，不是寫死在引擎裡

`risk.py` 開頭那句 docstring 講出了關鍵轉變：

> This replaces the hardcoded `WRITE_TOOLS` / `SHELL_TOOL` name sets the
> permission engine used to carry inline: **risk is now a declared property
> a single `classify` reads.**

差別在哪：

```ts
// ✗ 舊做法：權限引擎認得每一個工具
if (name === "write_file" || name === "edit_file" || name === "apply_patch") { ... }

// ✓ 新做法：工具宣告自己的風險，引擎只讀一個屬性
const risk = classify(toolName, metadata, overrides);
```

新增工具的人不用去改權限引擎，權限引擎也不用認得每一個工具。

`classify` 的優先序：

```
使用者的本地覆寫 → 內建對照表 → metadata 宣告 → requiresApproval → READ
```

**最後那個預設值要小心。** 我們預設 `READ`（不知道就當不危險）。
如果你的工具集包含不受信任的來源（例如任意 MCP server）,
應該改成預設 `EXTERNAL`。OpenWorker 靠 `metadata.requires_approval` 處理這件事。

---

## Step 2：模式跟風險是兩個獨立的維度

```ts
export enum Mode {
  PLAN = "plan",                // 唯讀
  INTERACTIVE = "interactive",  // 預設，有副作用就問
  AUTO = "auto",                // 全部放行
  CUSTOM = "custom",            // interactive + 設定檔白名單
}
```

關鍵：

```
風險 = 這個操作有多危險      （工具的屬性）
模式 = 使用者願意給多少自主權  （session 的屬性）
決策 = 兩者的交集
```

決策表的欄是模式、列是風險，交叉出來的才是結果。這就是為什麼
表格是二維的，用一個 boolean 你只有一維。

> `PLAN` 模式在 OpenWorker 還有第二個作用：它會驅動 agent 走
> 「探索 → 提案 → 執行」的流程。我們這一課只做唯讀那部分。

---

## Step 3：AUTO 模式也擋不住路徑逃逸

這是整個引擎最重要的一行順序決定。看 `evaluate` 的判斷順序：

```ts
// ── 2. 路徑限制 ────────────
if (risk === RiskClass.WRITE_LOCAL) {
  const path = args.path;
  if (typeof path === "string" && !this.underWritableRoot(path)) {
    return { allowed: false, reason: `路徑不在可寫入的目錄內：${path}`, needsUser: false };
  }
}

// ── 4. AUTO 模式 ───────────
if (this.mode === Mode.AUTO) {
  return { allowed: true, reason: "完全存取", needsUser: false };
}
```

**路徑檢查在 AUTO 檢查「之前」。** 順序反過來就會有安全漏洞。

理由：

> `AUTO` 模式的意思是「不要一直問我」，不是「可以動我整台電腦」。
> **沙箱邊界不該被自主程度的設定繞過。**

實測：

```
write_file(report.md         ) → ALLOW  完全存取
write_file(../../.ssh/id_rsa ) → DENY   路徑不在可寫入的目錄內
```

還有一個細節：路徑被擋的時候 `needsUser` 是 **false**,不是 true。
這是硬性邊界，**問使用者也不該放行**。

「拒絕」跟「去問人」是兩種不同的結果，不要混為一談。

---

## Step 4：shell 元字元（Lesson 2 練習 5 的答案）

Lesson 2 我出了一題：怎麼偵測危險指令？黑名單還是白名單？

OpenWorker 的答案是**白名單前綴 + 元字元檢查**：

```ts
const SHELL_OPERATORS = [";", "&", "|", ">", "<", "`", "$(", "(", "\n", "\r"];

private commandAllowed(command: string): boolean {
  if (hasShellOperators(trimmed)) return false;   // ← 有元字元就不自動放行
  return this.allowedCommands.some((p) => trimmed === p || trimmed.startsWith(`${p} `));
}
```

為什麼需要這個？假設你把 `ls` 加進允許清單，模型送來：

```bash
ls; rm -rf ~
```

前綴比對會通過（開頭確實是 `ls`），但實際上跑了兩個指令。

實測：

```
允許清單上的指令      git status              → ALLOW
允許清單 + 元字元    git status; rm -rf ~    → ASK      ← 降級成詢問
```

注意它是**降級成詢問**,不是拒絕。使用者可能真的想跑那個複合指令,
只是不能自動放行。

涵蓋的元字元：串接（`;` `&` `&&` `||`）、管線（`|`）、重導向（`>` `<`）、
指令替換（`` ` `` `$(`）、群組（`(`）、換行。

---

## Step 5：「都允許」到底允許了什麼

Lesson 2 的「都允許」是：

```ts
alwaysAllow.add(request.toolName);   // 這個工具以後都不問
```

對 `write_file` 還好。對 `send_slack_message` 就不行了：
使用者按下去的時候想的是「發到剛剛那個頻道」,
但實際上允許的是「**發到任何頻道**」。

OpenWorker 的處理是兩層：

### 第一層：connector 工具不能用「這個工具都允許」

```ts
if (this.sessionAllowTools.has(toolName) && !isConnector) {
  return { allowed: true, reason: "這一輪已允許此工具", needsUser: false };
}
```

實測：

```
post_slack_message(#random) → ASK     ← 就算已經 allowToolForSession 了
write_file(a.md)            → ALLOW
```

### 第二層：綁定目標的持久規則

那 connector 就只能一直問嗎？不是。它可以綁**特定目標**：

```ts
engine.addTaskRule("send_email", "team@example.com");
```

```
send_email(team@example.com    ) → ALLOW  send_email → team@example.com
send_email(everyone@example.com) → ASK    需要批准
```

同一個工具，換個收件人就要重問。

### exec 風險永遠不能有持久規則

```ts
if (classify(toolName, metadata, overrides) !== RiskClass.EXTERNAL) return undefined;
```

OpenWorker 的註解寫得很直白：**「shell asks forever」**。

理由很實際：shell 指令沒有穩定的「目標」可以綁。
「允許 run_command 執行 deploy.sh」跟「允許 run_command」幾乎一樣危險,
因為 `deploy.sh` 的內容下次可能完全不同。

```
run_command(deploy.sh) → ASK   exec 風險不能有持久規則，問到底
```

---

## Step 6：引擎只「決定」，不「詢問」

這是整個檔案最重要的架構決定，來自 `permissions.py` 的 docstring：

> The engine only *decides*; the turn engine routes `needs_user` decisions to
> a surface for approval and records the outcome.

Lesson 2 把兩件事混在一起：

```ts
// Lesson 2：決定跟詢問綁死了
if (tool.mutating) {
  const approved = await ctx.approve({ ... });   // ← 直接就問了
  if (!approved) throw new Error("...");
}
```

Lesson 8 拆開：

```ts
// 引擎回傳一個「資料」，不做任何事
const decision = engine.evaluate(toolName, args, metadata);

// 由呼叫端決定怎麼處理 needsUser
if (decision.needsUser) { /* 去問，方式由呼叫端決定 */ }
```

拆開之後才能做到：

- **同一套規則，不同的詢問方式**，CLI 問終端機、GUI 跳對話框、
  無人值守時丟進 inbox
- **決策可以單獨測試**，`table.ts` 就是，不用 mock 假的使用者
- **決策可以進 audit log**，為什麼允許、依據哪條規則（`Decision.rule`）

**Lesson 9 完全建立在這個拆分上。** 無人值守模式改的是「去哪裡問」,
一行都不會動到這個引擎。

---

## 跟 Lesson 2 的對照

| Lesson 2 | Lesson 8 | 為什麼 |
|---|---|---|
| `mutating: boolean` | `RiskClass` 四級 | 寄信跟寫暫存檔不該同等對待 |
| 只有「問 / 不問」 | `Mode` 四種 | 使用者的自主權設定是獨立維度 |
| 沙箱 = 一個 `ROOT` | `roots[]` + writable 旗標 | 可以讀某目錄但不能寫 |
| 決定 + 詢問綁一起 | `Decision` 是資料 | 才能換詢問方式（Lesson 9） |
| 「這個工具都允許」 | 加上綁定目標的規則 | connector 不能整個工具放行 |
| （練習 5 留給你） | 元字元檢查 | 真的做了 |

**核心 loop 依然沒變。** 變的是 `registry.execute` 之前那一段判斷。

---

## 練習

### 練習 1：讀懂決策順序 ⭐

`evaluate` 有 9 個步驟。挑三組相鄰的步驟，想想**如果對調會發生什麼事**：

- 步驟 2（路徑）跟步驟 4（AUTO）對調 → ?
- 步驟 3（純讀取）跟步驟 1（唯讀模式）對調 → ?
- 步驟 6（session 工具）跟步驟 7（持久規則）對調 → ?

第一個的答案在 Step 3。另外兩個自己想。

### 練習 2：加一個 `DELETE` 風險級 ⭐⭐

刪除跟寫入不一樣：寫入可以用備份還原，刪除通常不行。

加一個介於 `WRITE_LOCAL` 和 `EXTERNAL` 之間的等級,
決定它在四種模式下的行為，更新決策表。

### 練習 3：把 Lesson 6 的工具接上去 ⭐⭐

Lesson 6 的 `create_incident_report` 目前是 `mutating: true`。
用風險分級重新標註那七個工具。

想一想：`create_incident_report` 寫的是本機檔案，但如果它會
自動發到 Slack 呢？風險等級會變嗎？

### 練習 4：audit log ⭐⭐

`Decision` 有 `reason` 和 `rule` 兩個欄位，但目前沒人用。

把每一次決策寫進 `.audit.jsonl`：時間、工具、參數、決策、理由、依據的規則。

然後回答：「上週這個 agent 到底做了什麼、哪些是自動放行的？」

（OpenWorker 有 `coworker/audit.py`,174 行，做的就是這件事。）

### 練習 5：接回 Lesson 2 的 agent ⭐⭐⭐

把 `lesson-02-tools/agent.ts` 的 registry 改成用 `PermissionEngine`,
但保留原本的終端機詢問介面。

你會發現一件事：**registry 需要知道 decision,但不該知道怎麼問**。
這個重構會逼你把 `ToolContext` 的形狀改掉，那正是 Lesson 9 需要的形狀。

---

## 對照 OpenWorker 原始碼

| 這一課的概念 | OpenWorker 的位置 |
|---|---|
| `RiskClass` 四級 | `coworker/risk.py:18` |
| `classify` 優先序 | `coworker/risk.py:39` |
| `isConsequential` | `coworker/risk.py:56` |
| `Mode` 五種 | `coworker/permissions.py:37`（多一個 `DISCUSS`） |
| `Decision` | `coworker/permissions.py:53` |
| `evaluate` 決策串 | `coworker/permissions.py:120` |
| shell 元字元 | `coworker/permissions.py:21` |
| 綁定目標的持久規則 | `coworker/permissions.py:62` (`standing_rule_candidate`) |
| 多根目錄 | `coworker/permissions.py:108` + `coworker/roots.py` |
| 引擎接進 loop | `coworker/engine.py:526` (`_authorize`,約 110 行) |

`engine.py` 的 `_authorize` 值得單獨讀。它是 Lesson 2 那個
15 行 `approve()` 的完整產品版本，處理了：決策、路由到 UI、
使用者選「都允許」時建立規則、寫 audit、以及無人值守時改丟 inbox
（下一課）。

---

## 下一課

**[Lesson 9: 沒人在場的時候](../lesson-09-unattended/)**：排程半夜三點跑，agent 需要批准,
但你在睡覺。停下來？跳過？還是先做再說？

這是「自動化」跟「玩具」的分界線，也是 OpenWorker 最值得學的設計。
