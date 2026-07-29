# Lesson 7: Evaluation

> 前置：[Lesson 6](../lesson-06-domain-tools/)。這一課直接評估那個 agent。
>
> 這是**第 4 層**，也是 Pi 篇的最後一課。它最容易被忽略，卻最能區分 demo 和產品。

## 這課要回答的問題

1. 我的 agent 到底準不準？
2. 改了 prompt 之後是變好還是變壞？
3. 怎麼評分才不會被自然語言的無限種寫法搞死？
4. 哪些錯誤是「不完美」，哪些是「不能上線」？

---

## 為什麼需要這一課

沒有評估的話，你調 prompt 的流程是這樣：

```
改 prompt → 手動跑一次 → 「嗯感覺好像好一點」→ 上線
```

問題：

- 你只看了一個案例，其他四個可能被你改壞了
- 「感覺好一點」不是資料
- 換 model 的時候，你完全不知道會不會退步
- 三個月後有人改了 prompt，沒人發現某個案例壞掉了

**有評估之後：**

```
改 prompt → bun run lesson-07-evaluation/eval.ts --compare baseline
→ real-fall 0 → 12  ← 修好了
→ clock-skew 11 → 14 ← 修好了
→ 沒有退步
```

---

## Step 0：先跑起來

```bash
bun run lesson-07-evaluation/eval.ts
```

實際輸出（Gemini 3.6 Flash）：

```
PASS  crouch-not-fall       100%  12/12  12 calls  37.4s
  ✓ no_dangerous_misclassification  沒有危險的誤判
  ✓ classification                  "near_miss"（最佳答案）
  ✓ window_overlap                  5360..5860ms 與真實區間 5000..6200ms 有重疊
  ✓ has_evidence                    5 條證據
  ✓ numbers_plausible               21/22 個引用的數字對得上實際資料 (95%)
  ✓ calibrated_confidence           confidence=high

────────────────────────────────────────────────────────────────
通過 5/5   總分 63/64 (98%)   48 次工具呼叫   143.5s
```

跑單一案例、存基準、比較基準：

```bash
bun run lesson-07-evaluation/eval.ts real-fall
bun run lesson-07-evaluation/eval.ts --save baseline
bun run lesson-07-evaluation/eval.ts --compare baseline
```

> ⚠️ 這會呼叫真的模型，跑完七個案例大約 2.5 分鐘、48 次工具呼叫。
> 用便宜的 model 省錢：`MODEL=gemini-3.5-flash-lite bun run lesson-07-evaluation/eval.ts`

---

## Step 1：不要用字串比對評分

最常見的錯誤做法：

```ts
// ✗ 這永遠不會有用
if (report.summary === "機器人在 8400ms 跌倒") pass();
```

自然語言有無限多種正確寫法。「機器人跌倒了」「發生跌倒事故」
「robot fell at t=8400ms」都對，但沒有一個等於你的標準答案。

**改成檢查「可驗證的事實」：**

| 檢查 | 怎麼驗 | 權重 |
|---|---|---|
| `no_dangerous_misclassification` | enum 比對禁止清單 | 3（critical） |
| `classification` | enum 比對可接受清單 | 3 |
| `window_overlap` | 兩個數值區間有沒有交集 | 2 |
| `numbers_plausible` | 從 evidence 撈數字，跟真實 telemetry 比 | 2 |
| `mentions_data_issue` | 關鍵字任一命中 | 3（critical） |
| `has_evidence` | 陣列長度 | 1 |
| `calibrated_confidence` | 資料有問題時不該是 high | 1 |

每一項都是確定性的。同樣的報告評一百次，分數一樣。

### 為什麼不用 LLM 當裁判？

LLM-as-judge 有它的用處（評文筆、語氣、幫助程度這種主觀的東西），
但它自己也會出錯、也要花錢、也不可重現。

> **原則：先把能確定性檢查的部分做完，剩下的才考慮 LLM judge。**

大部分人跳過第一步直接上 LLM judge，然後得到一堆看起來很科學、
其實不可靠的分數。

---

## Step 2：時間窗用「重疊」不用「相等」

```ts
const overlaps = rs !== null && re !== null && rs <= te && re >= ts;
```

不要求精確吻合，因為「事件什麼時候開始」本來就有解釋空間。
真實跌倒是 8200-9000ms，模型回報 8400-13980ms 也算對，
因為它抓到了正確的事件，只是把「躺著沒動」也算進去了。

**評分標準要容忍合理的差異，只抓真正的錯誤。** 太嚴格的標準會產生
一堆假失敗，然後你就會開始忽略評估結果，那評估就白做了。

---

## Step 3：抓幻覺（檢查引用的數字是不是真的）

模型很會編出看起來合理的數字。所以我們把 evidence 裡的數字撈出來，
跟真實 telemetry 比對：

```ts
const cited = report.evidence.flatMap(extractNumbers);
const plausible = cited.filter((n) =>
  (n >= 0 && n <= facts.durationMs) ||                          // 是合理的時間戳
  realValues.some((v) => v !== 0 && Math.abs((n - v) / v) < 0.15), // 接近某個真實峰值
);
```

實測結果：

```
numbers_plausible  21/22 個引用的數字對得上實際資料 (95%)
numbers_plausible  26/27 個引用的數字對得上實際資料 (96%)
```

95% 而不是 100%，是因為模型有時會引用區間平均或自己算的衍生值。
所以門檻設在 70%，不是 100%。

**這個檢查是「模型有沒有真的去查資料」最直接的證據。**
一個沒查資料、憑經驗編報告的 agent，這一項會很難看。

---

## Step 4：分「不完美」和「不能上線」

這是這一課最重要的設計。看 `rubric.ts`：

```ts
checks.push({
  name: "no_dangerous_misclassification",
  passed: !hitForbidden,
  weight: 3,
  critical: true,     // ← 這個
  detail: ...
});
```

`critical: true` 的檢查一旦失敗，**整個案例直接判定失敗，不管其他項目幾分**。

哪些算 critical？

| 案例 | 禁止的分類 | 為什麼 |
|---|---|---|
| real-fall | `nominal`、`near_miss` | 把真跌倒說成沒事，機器人壞了沒人知道 |
| crouch-not-fall | `fall` | 假警報。一天 100 個假警報，沒人會再看警報 |
| missing-data | `fall`、`external_collision` | 對一段沒有資料的時間下確定結論 |

注意 `missing-data` 那一項。**不是「答錯」，是「不該有答案卻給了答案」。**

一個會在資料不足時老實說「無法判斷」的 agent，比一個總是給出
自信答案的 agent 有用得多。這件事只有靠評估才測得出來。

實測輸出會把它標紅：

```
⚠  2 個案例有危險錯誤，這比分數低嚴重得多
```

---

## Step 5：七個案例的設計邏輯

```
sess_001  real-fall            真的跌倒        → 測「抓得到嗎」
sess_002  crouch-not-fall      蹲下不是跌倒    → 測「會不會假警報」
sess_003  external-collision   外力碰撞        → 測「分得出成因嗎」
sess_004  missing-data         資料有洞        → 測「知不知道自己不知道」
sess_005  clock-skew           時鐘偏移        → 測「有沒有察覺陷阱」
```

前三個測「判斷準不準」，**後兩個測「知不知道自己不知道」**。

後兩個其實更重要。第一種錯誤你看報告就會發現；第二種錯誤看起來
完全正常，只是悄悄地基於錯誤的假設。

### 每個案例都用同一句 prompt

```ts
prompt: "分析這個 session 發生了什麼事，並寫一份事故報告。"
```

刻意的。如果 `missing-data` 的 prompt 寫成「注意這個 session 資料有缺」，
那你測的是「模型會不會照指示做」，不是「模型會不會自己發現問題」。

**評估案例不能暗示答案。**

---

## Step 6：完整的閉環（實測）

這一課寫完之後，我跑了一次評估，結果是這樣：

```
CRITICAL  real-fall             0%   0/1   1 calls   3.5s
  ✗ produced_report        agent 沒有呼叫 create_incident_report
    error: 400 status code (no body)

PASS      crouch-not-fall     100%  12/12
PASS      external-collision  100%  12/12
PASS      missing-data        100%  13/13

CRITICAL  clock-skew           73%  11/15
  ✓ classification         "near_miss"（最佳答案）
  ✓ window_overlap         7000..7380ms 與真實區間有重疊
  ✗ mentions_data_issue    沒有提到資料問題（預期：offset, clock, 時鐘, 偏移, 2300）
  ✗ calibrated_confidence  資料品質有問題，但回報 high confidence

通過 3/5   總分 48/53 (91%)
⚠  2 個案例有危險錯誤
```

**兩個問題，兩種性質完全不同。**

### 問題 1：基礎設施不穩（不是模型的錯）

`real-fall` 的 400 是**間歇性**的。我手動跑同一個 session 完全正常，
分類、時間窗都對。

這是真實 API 的常態。修法是重試：

```ts
const MAX_ATTEMPTS = 3;
for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
  try {
    await runTurn(...);
    break;
  } catch (e) {
    error = ...;
    if (attempt < MAX_ATTEMPTS) await sleep(1000 * 2 ** (attempt - 1));
  }
}
```

**但只重試「基礎設施錯誤」，不要重試「模型答錯」。**
重試到它答對只是在自欺欺人。

沒有重試的話，你的分數會混進網路噪音，然後你會以為是 prompt 改壞了。

### 問題 2：真的有東西沒做好（是我的 prompt 的錯）

`clock-skew` 的分類和時間窗都對，但**完全沒提到影片時鐘偏移 2300ms**。

工具有講（`get_session` 會報告 offset），模型看到了，但覺得不值得寫進報告。

這是我 prompt 的漏洞。修法：

```diff
  1. Call get_session FIRST. It reports sampling gaps and clock offsets.
     If there is a gap, you cannot conclude anything about that window.
+    If get_session reports ANY data quality issue (a sampling gap, or a clock
+    offset between video and telemetry), you MUST record it in the report's
+    caveats, even if it did not change your conclusion. A reader of the report
+    cannot see the tool output, so an unmentioned caveat is an invisible one.
```

最後那句是關鍵：**報告的讀者看不到工具輸出，所以沒寫出來的注意事項
等於不存在。** 給模型「為什麼」比給它「做什麼」有效。

### 修完之後

```bash
bun run lesson-07-evaluation/eval.ts --compare gemini-baseline
```

```
通過 5/5   總分 63/64 (98%)   48 次工具呼叫   143.5s

跟基準 "gemini-baseline" 比較
基準：gemini/gemini-3.6-flash  2026-07-27T10:20:43.559Z

  real-fall            0 → 12   +12  ← 修好了
  crouch-not-fall     12 → 12    ±0
  external-collision  12 → 12    ±0
  missing-data        13 → 13    ±0
  clock-skew          11 → 14    +3  ← 修好了

沒有退步
```

**3/5 → 5/5，91% → 98%，而且確認其他三個案例沒被改壞。**

這就是評估的完整價值：

```
量測 → 發現具體問題 → 修 → 再量測 → 確認真的變好而且沒有副作用
```

沒有這個閉環，你只是在憑感覺調 prompt。

> 剩下那 1 分（`clock-skew` 的 `calibrated_confidence`）是刻意留著的。
> 模型有察覺到時鐘偏移了，但還是給 high confidence。這是校準問題，
> 比「沒察覺」輕微很多。要不要為了這 1 分繼續調 prompt，是產品決定，
> 不是技術決定。**評估的意義不是拿滿分，是讓你知道自己差在哪。**

---

## Step 7：接進 CI

`--compare` 在有退步時會設 `process.exitCode = 1`：

```ts
if (regressions > 0) {
  console.log(red(bold(`⚠  ${regressions} 個案例退步了`)));
  process.exitCode = 1;   // ← CI 可以擋
}
```

所以你可以這樣用：

```yaml
- run: bun run lesson-07-evaluation/eval.ts --compare production
```

有人改了 prompt 造成退步，PR 就會紅。**這是把 agent 品質變成
工程紀律的關鍵一步。**

實務建議：

- eval 很貴又慢，不要每個 commit 都跑。用 label 或排程觸發
- 案例數量從 5-10 個開始就好，重點是涵蓋不同的失敗模式
- 每次線上出包，就把那個 case 加進來。**評估集會隨著時間變成你最有價值的資產**

---

## 跑不起來？

| 症狀 | 原因 | 解法 |
|---|---|---|
| `找不到基準 "xxx"` | 還沒存過 | 先 `--save xxx` |
| 每次分數都不一樣 | 模型本來就有隨機性 | 正常。看趨勢不看單次；跑多次取平均 |
| 某案例間歇性失敗 | API 間歇錯誤 | 已有重試。看 `error` 欄位確認是不是基礎設施問題 |
| 全部 0 分 | agent 沒寫報告 | 單獨跑 `bun run lesson-06` 看它卡在哪 |
| 跑很久 | 5 個案例 × 每個 10 次工具呼叫 | 用便宜的 model，或只跑單一案例 |

---

## 練習

### 練習 1：故意把 prompt 改壞 ⭐

把 `SYSTEM_PROMPT` 裡「foot contact 是關鍵判別訊號」那段刪掉，
然後跑 `--compare`。

看 `crouch-not-fall` 會不會變成 `fall`（危險錯誤）。
**這題讓你親眼看到評估在防什麼。**

### 練習 2：換 model 比較 ⭐

```bash
MODEL=gemini-3.5-flash-lite bun run lesson-07-evaluation/eval.ts --compare gemini-baseline
```

便宜的 model 掉幾分？掉在哪一項？值不值得？

**這是評估最實際的用途之一：用資料決定要不要換便宜的 model。**

### 練習 3：加一個「成本」指標 ⭐⭐

現在只記了工具呼叫次數。加上 token 用量和估算成本，
然後在比較時一起顯示。

你會遇到一個真實的取捨：分數 +2 但成本 +40%，划算嗎？

### 練習 4：加一個新的失敗模式案例 ⭐⭐

在 `generate.ts` 加一個新 session，例如：
「兩次事件」（agent 常常只報告第一個）或
「極慢的傾倒」（3 秒才倒下，門檻式偵測可能漏掉）。

然後寫對應的評估案例。**這是最貼近真實工作的練習。**

### 練習 5：LLM-as-judge 補充確定性檢查 ⭐⭐⭐

有些東西程式檢查不了，例如「這份報告對值班工程師有沒有用」。

加一個用 LLM 評分的檢查項，但要：
- 只佔一小部分權重（確定性檢查仍是主體）
- 用低溫、固定 prompt
- 跑三次取多數決（減少裁判本身的隨機性）

然後比較：LLM judge 的分數跟確定性分數會不會打架？哪個比較穩定？

### 練習 6：把你自己領域的案例寫出來 ⭐⭐⭐

這是這整個系列的最後作業。

挑你的領域，寫 5 個評估案例。至少要包含：
- 一個「正常情況」
- 一個「看起來像但其實不是」（測假警報）
- 一個「資料不足」（測知不知道自己不知道）

**第三個最重要，也最少人做。**

---

## 對照 Pi 原始碼

**這一課沒有直接對應的 Pi 原始碼。** Pi 是 coding agent，
它的 `packages/evals/` 只有兩個檔案，用 `vitest-evals` 做行為測試
（跑真的 agent session，檢查最終回覆），規模比這一課小很多。

| 這一課的概念 | Pi 的對應位置 |
|---|---|
| 行為評估的骨架 | `packages/evals/src/pi-harness.ts` |
| 可重現的假 provider（測試用） | `packages/ai/src/providers/faux.ts` |

**這是刻意的。** 評估集跟你的領域綁死，沒有任何開源專案能幫你寫，
所以這一課的內容是照第 4 層的原則從零設計的，不是抄 Pi。

---

## 你跑完整個系列了

七課下來：

| 層 | 課 | 你做過什麼 |
|---|---|---|
| **1. Agent 機制** | 1-5 | agent loop、工具、streaming、中斷、持久化、壓縮 |
| **2. Harness** | 2, 5 | 批准機制、輸出截斷、context 管理 |
| **3. 領域工具** | 6 | 把「該看哪個訊號」做進工具裡 |
| **4. 評估** | 7 | 量測 → 發現問題 → 修 → 確認沒退步 |

而那個核心 while 迴圈，從 Lesson 1 到 Lesson 7 **一行都沒有變過**。

回到最開始那句話：

> **Agent 的本質很小。周圍的工程很大。**

現在你兩邊都做過一次了。

### 接下來

1. **讀 [Pi](https://github.com/earendil-works/pi) 的原始碼。** 你有能力了。
2. **把 Lesson 6-7 換成你自己的領域。** 這是唯一能產生護城河的部分。
3. **在你現在的專案裡練第 2 層。** 不需要做新的 agent app：
   寫 `AGENTS.md`、加 `scripts/verify`、建 `tests/fixtures/`，
   然後要求 coding agent 每次都跑完整個閉環。

---

## 下一課

**[Lesson 8: 從 boolean 到風險分級](../lesson-08-permissions/)**：
Pi 篇到這裡結束，引擎會跑、有領域工具、也量得出好壞。

接下來換一組問題：**這個 agent 可以被信任到什麼程度？**
Lesson 2 那個 `mutating: boolean` 撐不住真實產品，下一課看為什麼。
