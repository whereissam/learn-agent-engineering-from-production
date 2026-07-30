# Lesson 19: 把任務交出去，它看得到什麼

> [English](README.md)
>
> Hermes 篇最後一課。前置：[Lesson 5](../lesson-05-compaction/README.zh-TW.md)（context 壓縮）、
> [Lesson 9](../lesson-09-unattended/README.zh-TW.md)（批准）、
> [Lesson 18](../lesson-18-scheduling/README.zh-TW.md)（無人值守）。
>
> 對照原始碼：`hermes-agent/tools/delegate_tool.py`（3697 行）、
> `tools/async_delegation.py`（1069 行）。CrewAI 當第二個對照（見文末）。

```bash
bun run lesson-19                      # 四個機制，不用金鑰
BLOCK=off bun run lesson-19 blocklist  # 遞迴委派
APPROVE=auto bun run lesson-19 approval

PROVIDER=gemini bun run lesson-19:agent                # 一個 agent 做三件事
MODE=delegate PROVIDER=gemini bun run lesson-19:agent  # 三個 agent 各做一件
```

## 這課要回答的問題

1. 子 agent 看得到什麼？看不到什麼？
2. 有哪些事是子 agent **絕對不准**做的，為什麼？
3. 子 agent 要批准的時候找誰？
4. 多幾個 agent 會比較聰明嗎？

---

## Step 0：先把預期寫下來

這一課有一個現成的陷阱：多 agent 的示範**看起來**都很厲害
（三個角色互相對話、分工、彙整），而「看起來厲害」跟「比較好」是兩件事。

所以照 Lesson 7 的做法，**先寫下預期再跑**（`docs/TODO.md` 的原話）：

> 多 agent 不會比較聰明，它是把狀態邊界變明確；
> 沒有真的隔離需求時只是多付溝通成本。

實測結果在 Step 5。**其中一半錯了**，而錯的那一半比對的那一半有用。

---

## Step 1：委派是一條資訊邊界

Hermes 的 `delegate_tool.py` 開頭把契約寫完了：

> Each child gets:
> - A fresh conversation (no parent history)
> - Its own task_id (own terminal session, file ops cache)
> - The parent's toolsets, with child-only blocked tools stripped
> - A focused system prompt built from the delegated goal + context
>
> **The parent's context only sees the delegation call and the summary
> result, never the child's intermediate tool calls or reasoning.**

```bash
bun run lesson-19 isolation
```

```
父 agent 的對話：
  │ 使用者：我們的 staging 環境從上週開始就一直噴 E-118。
  │ 使用者：喔對了，**staging 的資料是假的，不要拿去做結論**。
  │ 助理：了解，我看一下 logs/。

子 agent 的整個 context：
  │ 統計 logs/inventory.log 裡最常出現的錯誤碼
  │ Context: 檔案在 workspace 底下。

「staging 的資料是假的」有沒有跨過去：沒有
```

> 同一個機制既是功能也是 bug，取決於那句話重不重要。
> 父 agent 的 context 不會被子 agent 的十次工具呼叫塞爆（功能），
> 但子 agent 也不知道那份資料是假的（bug）。
>
> 決定哪些東西要放進 `context` 參數的是父 agent，而它常常會忘。

這就是為什麼委派不是「多幾個腦袋」。它是一條邊界，兩邊都要付代價。

---

## Step 2：五個不准，五個不同的理由

`delegate_tool.py:46-54` 的 blocklist，連註解一起抄下來：

```python
DELEGATE_BLOCKED_TOOLS = frozenset([
    "delegate_task",  # no recursive delegation
    "clarify",        # no user interaction
    "memory",         # no writes to shared MEMORY.md
    "send_message",   # no cross-platform side effects
    "cronjob",        # no scheduling more work in the parent's name
])
```

五行看起來是同一條規則的五個例子。不是。

| 工具 | 擋的是什麼 |
|---|---|
| `delegate_task` | **資源**：會指數展開 |
| `clarify` | **通道**：子 agent 那一側根本沒有使用者 |
| `memory` | **共用狀態**：誰都能寫的話，隔離就是假的 |
| `send_message` | **外部副作用**：收不回來，而且父 agent 不知情 |
| `cronjob` | **身分**：用父 agent 的名義排未來的工作 |

最後一個最容易漏，因為它不是「現在會發生什麼」，而是
**「以後會用誰的名義發生什麼」**。

> 它也直接接回 [Lesson 18](../lesson-18-scheduling/README.zh-TW.md)：那一課的守衛擋的是
> **工作的內容**（會不會殺掉 daemon），這裡的 blocklist 擋的是
> **誰有資格排工作**。兩個都不夠，缺一個就有洞。

### 關掉之後

```bash
bun run lesson-19 blocklist              # 1 個子 agent
BLOCK=off bun run lesson-19 blocklist    # 15 個
```

每層 2 個、深度上限 4 就是 15 個。**真實情況沒有深度上限**，
是 API quota 或錢包當上限，而且父 agent 只看得到最上面那一層的摘要 ——
它不知道底下發生了什麼，也不知道花了多少錢。

### 而且清單裡沒有不等於不會被叫

blocklist 是在**工具清單**就拿掉的，所以正常情況模型不會叫到。
但 `runChild` 還是留了第二道檢查，因為**模型會叫一個沒給它的工具** ——
Lesson 20 那次它搜了語料裡根本不存在的專案名，是同一種行為。
`tests/delegation.test.ts` 有一條守這個。

---

## Step 3：子 agent 要批准的時候找誰

```bash
bun run lesson-19 approval                 # 預設：拒絕
APPROVE=auto bun run lesson-19 approval    # 寫出去了
```

Hermes 的預設是**自動拒絕**，而理由有兩層（`delegate_tool.py:60-76`）：

```
安全  子 agent 的動作沒有人看得到，不該有收不回來的副作用
活性  子 agent 跑在 worker thread 裡，拿不到互動式的批准 callback，
      掉回 input() 會跟父進程的 TUI 搶 stdin —— 死鎖
```

> 第二層才是這段註解值得抄的原因。
> 「子 agent 不該有副作用」是一句可以爭論的政策；
> 「不這樣做會死鎖」是一個事實。
>
> 一個安全預設如果同時解掉一個活性問題，它就不會在趕工的時候被拿掉。

Hermes 有 `delegation.subagent_auto_approve` 可以打開，
註解直接寫 `opt-in YOLO for cron/batch` —— 誠實地標示它是什麼。

---

## Step 4：出錯的時候看得出是哪一步嗎

```bash
bun run lesson-19 locate
```

```
真相（demo 自己記的）　　　　父 agent 收到的 tool result：
  統計 checkout 的錯誤碼    工具成功　最常見的是 E-400。
  統計 inventory 的錯誤碼   工具失敗　最常見的是 E-118。   ← 檔案根本讀不到
  統計 notify 的錯誤碼      工具成功　最常見的是 E-402。
```

委派**同時**改善和惡化了可觀測性：

| | 委派 | 單一 agent |
|---|---|---|
| 「哪一步壞了」 | ✓ 每個子任務有名字 | ✗ 錯誤散在一長串工具呼叫裡 |
| 「有沒有壞」 | ✗ **中間隔了一層自然語言摘要** | ✓ tool result 直接在 context 裡 |

> 摘要不是證據。這是 [Lesson 29](../lesson-29-evidence/README.zh-TW.md) 的結論在
> 委派上的版本：子 agent 的摘要跟 assistant 的自述是同一種東西 ——
> 由模型生成、看起來很像結論、而且沒有任何東西保證它對應真實發生的事。
>
> 修法也一樣是結構性的：把子 agent 的 tool result 統計
> （成功幾次、失敗幾次）跟摘要**一起**回傳，不要只回摘要。

---

## Step 5：實測 —— 一個 agent 做三件事 vs 三個 agent 各做一件

```bash
PROVIDER=gemini bun run lesson-19:agent
MODE=delegate PROVIDER=gemini bun run lesson-19:agent
```

同一個問題（三個服務各自最常出現的錯誤碼）、同一份語料、同一個模型。
判定全部確定性：`includes()` 比對三個錯誤碼，以及那個「舊編號方案」的但書。

**真 Gemini 3.6 Flash，各三次**：

| | 模型呼叫 | 子 agent | token（total） | 錯誤碼 | 但書 |
|---|---|---|---|---|---|
| solo | 6 / 6 / 4 | 0 | 11,251 / 9,718 / 9,983 | 3/3 3/3 3/3 | 有 有 有 |
| delegate | 23 / 23 / 22 | 3 | 35,203 / 41,546 / 39,147 | 3/3 3/3 3/3 | 有 有 有 |

```
正確率   一樣（3/3 vs 3/3）
成本     3.9 倍 token、3.9 倍模型呼叫
```

### 預期對了一半

> **對的那一半**：多 agent 沒有比較聰明，只是多付溝通成本。
> 而且代價比預期的大 —— 事前猜 1.5-2 倍，實際是 **3.9 倍**。
>
> 錯的那一半：預期那個但書會在摘要那一層掉。沒有掉，3/3 都活著。
> 負責 inventory 的那個子 agent 每次都把它寫進摘要了。

第二點值得記下來，因為它是一個**反方向的教訓**：

> 一個專門用來製造資訊遺失的機關（把但書放在檔頭），
> 模型每一次都沒有掉。**這不代表委派不會掉資訊**，
> 只代表**這個題目太簡單**：但書就在檔案開頭三行、而且用 `NOTE:` 標著。
>
> 跟 Lesson 16 第一輪、Lesson 30 第一輪同一個家族的錯：
> 陰性結果要先證明測試有鑑別度（提議的原則 10）。

### 3.9 倍是從哪裡來的（這才是有用的部分）

看 trace 就知道，**每個子 agent 都自己重新探索了一遍**：

```
→ delegate_task  "Analyze logs/notify.log …"
    ↳ read_file(logs/notify.log)      ← 它的工作
    ↳ list_files()
    ↳ read_file(package.json)
    ↳ read_file(logs/checkout.log)    ← 別人的工作
    ↳ read_file(logs/inventory.log)   ← 別人的工作
    ↳ list_files(logs)
  ← 摘要 901 字，工具 6 次
```

父 agent 已經 `list_files` 過了，但那個知識**跨不過邊界**。
每個子 agent 都要自己從零搞清楚檔案在哪。

> 委派省下來的是父 agent 的 context，付出去的是每個子 agent 的重新探索。
> 當子任務又小又獨立時，重新探索的成本會**大於**它省下來的。
>
> 反過來說，委派划算的條件也就清楚了：
> **子任務要夠大**（探索成本佔比小）、**子任務的中間過程要夠髒**
> （不然沒東西可省）、而且**它產出的摘要要真的比原文短很多**。
> 三個都不成立的時候，你只是把一件事拆成四次對話。

### 這不是「不要用多 agent」

真的需要隔離的時候（不同的權限、不同的模型、不同的工具集、
互相有敵意的輸入），那條邊界就是你要的東西，3.9 倍是它的價目。
這一課的貢獻是把價目印出來，不是叫你別買。

---

## 這課刻意不做的事

| 沒做 | 為什麼 |
|---|---|
| 平行執行子 agent | Hermes 有（ThreadPoolExecutor + batch 模式）。它會讓 wall-clock 變好看，但 **token 成本一分不變** —— 而這一課量的是後者 |
| 角色扮演（Researcher / Writer / Reviewer） | 那是 prompt 設計，不是機制。CrewAI 值得看的不是角色名字，是任務依賴怎麼表示 |
| 子 agent 的即時轉播 | Hermes 有 `delegation_live_log.py`（424 行，`tail -f` 得動的逐筆記錄）。它是好東西，但屬於 observability |
| 子 agent 用不同的模型 | 很實用（便宜模型做子任務），但那是 Lesson 26 的成本題，不是委派的機制 |
| 遞迴委派的正確做法 | 這一課直接禁止。要允許的話，你需要的是深度預算 + 全域 token 預算，那是 Lesson 24 的形狀 |

---

## 跑不起來？

| 症狀 | 原因 |
|---|---|
| 子 agent 什麼都不知道 | 那是設計。要它知道就得寫進 `context` 參數 |
| 子 agent 一直說「我需要問使用者」 | `clarify` 被擋掉了，而且它那一側真的沒有人。把資訊放進 `context` |
| delegate 模式沒有比較快 | 這一課是循序跑的（見「刻意不做」）。而且就算平行，token 也不會變少 |
| 但書掉了 | 那正是要量的東西。看子 agent 的摘要那一段輸出，**確認是在哪一層掉的** |
| `lesson-19:agent` 說要 PROVIDER | 那支程式量的是模型行為，一定要金鑰 |

---

## 練習

### 練習 1：把摘要換成結構化的回報 ⭐

現在子 agent 回一段自然語言。改成
`{ summary, toolCalls: n, failures: n, filesRead: [...] }`，
然後重跑 Step 4 的 `locate`。

**這是 Lesson 29 的做法搬到委派上**：不要問子 agent 發生了什麼，
直接記錄發生了什麼。

### 練習 2：讓資訊真的掉一次 ⭐⭐

Step 5 的但書沒有掉，因為題目太簡單。設計一個會掉的：
把但書藏在檔案中段、不要用 `NOTE:` 標記、或者讓它只在**兩個檔案交叉比對**
時才成立（例如 checkout 的 E-402 和 notify 的 E-402 其實是同一批請求）。

跑之前先寫下你預期第幾次會掉。

### 練習 3：平行 + 預算 ⭐⭐

改成 `Promise.all` 平行跑三個子 agent，然後加一個**全域 token 預算**：
超過就不再委派。

做完會發現一個沒預期的問題：平行的子 agent 沒辦法知道預算已經被別人用掉了。
這是 Lesson 24 的 `Budget` 在多 agent 下的版本。

### 練習 4：把 blocklist 打壞五次 ⭐⭐⭐

一次拿掉一個，各設計一個實驗證明它為什麼在那裡：

| 拿掉 | 要證明什麼 |
|---|---|
| `delegate_task` | 指數展開（`BLOCK=off` 已經示範，改成量 token） |
| `clarify` | 子 agent 卡住／死鎖 |
| `memory` | 兩個子 agent 同時寫，最後只剩一個的內容 |
| `send_message` | 父 agent 不知道信已經寄出去了 |
| `cronjob` | 子 agent 排了一個工作，明天用父 agent 的身分跑 |

最後一個做完會接回 Lesson 18：那個工作可以是任何東西，包括
一個會重啟 daemon 的工作。

---

## 對照原始碼

| 這課的概念 | Hermes |
|---|---|
| 子 agent 的契約（fresh conversation / 自己的 task_id / 摘要回傳） | `tools/delegate_tool.py:1-19` 的 docstring |
| 五個不准的工具 | `tools/delegate_tool.py:46-54` |
| 子 agent 的批准預設是拒絕、以及死鎖的理由 | `tools/delegate_tool.py:60-95` |
| 逐筆轉播（`tail -f` 子 agent） | `tools/delegation_live_log.py:113-139` |
| 背景 fan-out 完成之後怎麼通知父 agent | `tools/process_registry.py:2131-2145` |
| 委派的 session 不進跨 session 搜尋 | `tools/session_search_tool.py:38-40`（`_HIDDEN_SESSION_SOURCES`） |

> 最後一列很小但很對：子 agent 的 session **不該**出現在
> [Lesson 17](../lesson-17-search/README.zh-TW.md) 的跨 session 搜尋結果裡。
> 它們是實作細節，不是使用者跟你的對話 —— 混進去只會洗版。
> 這跟 Lesson 17 那個「cron 摘要洗版」是同一個問題。

### CrewAI 當第二個對照

值得看的不是 Researcher / Writer / Reviewer 這種角色名字，是三件事：
任務依賴怎麼表示、context 什麼時候該隔離、某個 agent 失敗整條 workflow 怎麼辦。
Step 5 那個實驗就是為了回答第二題設計的。

---

## 下一課

**Hermes 篇到這裡完整了**：15 記憶 → 16 skills → 17 搜尋 →
18 排程 → 19 委派。回頭看，這五課回答的是同一個問題的五個面向：

> 一個活很久的 agent，怎麼在你不看著的時候繼續存在。

**照閱讀順序**，接下來是證據那條支線：
[Lesson 29](../lesson-29-evidence/README.zh-TW.md) → 28 → 37。
這一課的 Step 4 已經把它的引子講完了 —— **摘要不是證據**。
