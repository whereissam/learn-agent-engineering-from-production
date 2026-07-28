# Lesson 6: 領域工具

> 前置：[Lesson 3](../lesson-03-streaming/)（streaming）。
>
> 這是**第 3 層**。前五課教的是怎麼造引擎，這一課開始教怎麼讓引擎在
> 你自己的領域裡真的有用。

## 這課要回答的問題

1. 為什麼不能只給 agent `read_file`，讓它自己讀資料想辦法？
2. 哪些工作該給程式做，哪些該給模型做？
3. 工具的錯誤訊息要怎麼寫，模型才修得好？
4. 怎麼強迫模型「有結論就要有證據」？

---

## 不需要機器人知識

這一課用「四足機器人的事故分析」當領域。**你完全不需要懂機器人。**
需要知道的只有三個訊號：

| 訊號 | 白話 |
|---|---|
| `imu_pitch_deg` | 身體前後傾幾度。正常走路 0-5 度 |
| `foot_contact` | 四隻腳有沒有踩在地上 |
| `joint_torque_max` | 關節出力多大。正常走路 15-25 Nm |

而整課最核心的判斷，其實是常識：

> **跌倒 = 腳全部離地，而且爬不起來。**
> **蹲下 = 腳一直踩在地上。**

兩者的 pitch 看起來很像（都會大幅前傾），但 `foot_contact` 完全不同。
這個「一個訊號就能區分兩個看起來很像的情況」，正是領域知識的典型長相。

> 換成你的領域也一樣：電商的「棄單」跟「還在逛」、
> SEO 的「排名掉了」跟「季節性波動」，都是同一種形狀的問題。

資料是合成的，用固定亂數種子產生，跑一百次都一樣。**七個 session**，
每一個對應 Lesson 7 的一個評估案例：

| session | 是什麼 | 測什麼 |
|---|---|---|
| `sess_001` | 真正跌倒 | 抓得到嗎 |
| `sess_002` | 快速蹲下 | 會不會假警報（`foot_contact` 是關鍵） |
| `sess_003` | 外力碰撞 | 分得出成因嗎 |
| `sess_004` | 取樣缺口 | 知不知道自己不知道 |
| `sess_005` | 影片時鐘偏移 | 有沒有察覺陷阱 |
| `sess_006` | **同一段紀錄裡兩次事件** | 會不會只報最嚴重的那個 |
| `sess_007` | **極慢傾倒（6 秒）** | 候選視窗來得晚，會不會照抄 |

後兩個是後來補的。原本五個有一個共同的形狀——**一個 session 一個突發
事件**——而真實 telemetry 不長那樣。`sess_007` 特別值得看：
`find_anomalies` 的候選從 t=7060ms 才開始（門檻要 `pitch>30` 才觸發），
但傾倒其實 t=4000ms 就開始了。**候選晚了三秒。**



```bash
bun run lesson-06:data
```

---

## Step 0：先跑起來

```bash
bun run lesson-06
```

```
> 分析 sess_002 發生了什麼事，寫報告
```

實際跑出來的軌跡（Gemini 3.6 Flash）：

```
→ get_session(sess_002)            檢查資料品質
→ find_anomalies(sess_002)         找候選區間
→ query_telemetry(0..12000)        看全域
→ query_telemetry(5000..6500)      放大異常區間
→ query_telemetry(6500..12000)     看事後有沒有恢復
→ query_telemetry(0..5000)         看事前的基準
→ get_video_frame(5620)            交叉驗證
→ list_sessions()
→ compare_sessions(sess_001, sess_002)   跟真的跌倒比對
→ create_incident_report(...)
```

產出的報告：

```json
{
  "classification": "near_miss",
  "confidence": "high",
  "window_start_ms": 5360,
  "evidence": [
    "在 t=5620ms 處 imu_pitch_deg 達到峰值 37.70°（常規行走為 0-5°）",
    "在 t=5580ms 處 joint_torque_max 達到峰值 51.36 Nm（常規行走為 15-25 Nm）",
    "全過程無足部離地（airborne samples 為 0，視頻畫面 t=5620ms 確認 4/4 足部著地）",
    "imu_accel_z 在 9.40..10.20 m/s² 之間，排除外部強衝擊碰撞",
    "t>6500ms 後恢復正常行走"
  ]
}
```

**注意它沒有說這是跌倒。** pitch 衝到 37 度看起來很像跌倒，
但它去查了 `foot_contact`，發現腳一直在地上，所以判定為 near_miss。

這就是領域工具在做的事：把「該看哪個訊號」做進工具裡。

---

## Step 1：loop 一行都沒改

先講最重要的一件事。把 `lesson-06-domain-tools/agent.ts` 的 `runTurn` 跟 Lesson 3 對照，
**它們是一樣的**。

改的只有兩個地方：

```diff
- const registry = new ToolRegistry([readFileTool, writeFileTool, editFileTool, ...]);
+ const registry = new ToolRegistry([listSessionsTool, getSessionTool, queryTelemetryTool, ...]);

- const SYSTEM_PROMPT = "You are a coding agent...";
+ const SYSTEM_PROMPT = "You are an incident analyst for a quadruped robot fleet...";
```

**換工具 + 換 prompt = 換領域。** 引擎不用動。

這也回答了一個常見問題：「我要做一個 XX 領域的 agent，該用哪個 framework？」
通常答案是：你不需要新的 framework，你需要新的工具。

---

## Step 2：能用程式算的，不要給模型算

這是領域工具設計的第一原則。

假設我只給模型 `read_file`，它要分析一個 session 就得：

```
讀進 600 筆 JSON 樣本（100KB）
→ 自己在腦內找最大值
→ 自己算平均
→ 自己判斷哪段異常
```

三個問題：

| 問題 | 後果 |
|---|---|
| **token 爆炸** | 一個 session 100KB，五個就把 context 塞滿了 |
| **算術不可靠** | LLM 做數值統計會出錯，而且錯得很有自信 |
| **不可重現** | 同一份資料問兩次，可能給出不同的峰值 |

所以 `query_telemetry` 回傳的不是原始樣本，是**統計摘要**：

```
imu_pitch_deg      min=  -2.31  max=  37.70  mean=   5.42  peak@5620ms
joint_torque_max   min=  11.02  max=  51.36  mean=  22.15  peak@5580ms

foot_contact: at least one foot on the ground for the entire window
```

600 筆樣本壓成 8 行。而且 `max=37.70` 這個數字是**程式算的，永遠正確**。

> **分工原則：程式負責算，模型負責解讀。**
> 模型擅長的是「37 度加上腳沒離地，所以這不是跌倒」這種判斷，
> 不是「這 600 個數字裡最大的是哪個」。

---

## Step 3：工具給候選，模型下結論

`find_anomalies` 用寫死的門檻掃過整個 session：

```ts
if (Math.abs(s.imu_pitch_deg) > 30) hits.push({ ... });
if (s.imu_accel_z > 15) hits.push({ ... });
if (s.foot_contact.every((c) => !c)) hits.push({ ... });
```

但它的 description 寫得很小心：

```
Returns candidate windows with the signal that triggered them.
These are CANDIDATES, not conclusions: you must inspect each one
to decide what actually happened.
```

**這個分工是刻意的：**

```
確定性的規則  →  負責 recall（不要漏掉任何可疑的地方）
模型          →  負責 precision（判斷哪些是真的）
```

反過來做（讓模型自己掃全部資料找異常）既貴又不穩定。
規則掃描是 O(n) 而且免費，模型只需要看幾個候選區間。

這個模式在很多領域都適用：log 分析、異常偵測、code review、
安全掃描。**先用便宜的確定性方法縮小範圍，再讓模型做判斷。**

---

## Step 4：工具要主動報告資料品質

`get_session` 有一段看起來多餘的東西：

```ts
const gaps = findGaps(samples, meta.sample_rate_hz);

if (gaps.length > 0) {
  lines.push("DATA QUALITY WARNING: sampling gaps detected");
  for (const gap of gaps) {
    lines.push(`  no samples between t=${gap.start_ms}ms and t=${gap.end_ms}ms`);
  }
  lines.push("  Do not draw conclusions about what happened inside these windows.");
}
```

為什麼要主動講？

**因為模型不會主動懷疑資料。** 如果工具不說，它會很自然地假設資料是完整的，
然後對一段根本沒有資料的時間做出結論。

這是 agent 產生幻覺結論最常見的來源之一：

> 不是模型在唬爛，是工具沒說實話。

`sess_004` 就是為了這個做的：中間 3 秒完全沒有取樣。試試看：

```
> 分析 sess_004
```

好的行為是回報 `inconclusive` 並在 caveats 說明資料有洞。
壞的行為是對那 3 秒編一個故事。Lesson 7 會把這個做成正式的評估案例。

同理，`sess_005` 的影片時間戳比 telemetry 早 2300ms。
`get_video_frame` **自動幫你換算**，而不是要求模型自己算：

```ts
const videoT = t + meta.video_offset_ms;
```

能在工具裡消掉的複雜度，就不要留給模型。每一個「要模型記得做」的
換算，都是一個它遲早會忘記的地方。

---

## Step 5：錯誤訊息是寫給模型的 prompt

比較這兩種寫法：

```ts
// ✗ 沒用的錯誤
throw new Error("No data");

// ✓ 模型可以據此行動的錯誤
throw new Error(
  `No samples between t=${start}ms and t=${end}ms. ` +
  `This session has data from t=${first}ms to t=${last}ms. ` +
  "Either the window is outside the recording, or it falls inside a sampling gap " +
  "(call get_session to check).",
);
```

第二種包含三個要素：

1. **發生什麼事**（這個區間沒資料）
2. **實際狀況是什麼**（資料範圍是 0..12000）
3. **下一步可以做什麼**（去呼叫 get_session 確認）

模型看到第一種只能瞎猜；看到第二種會直接修正查詢範圍。

同樣的原則用在 session id 上：

```ts
throw new Error(
  `Invalid session_id "${sessionId}". Expected the form sess_001. ` +
    "Call list_sessions to see valid ids.",
);
```

**每一個錯誤訊息都該告訴模型「接下來該做什麼」。**

---

## Step 6：用 schema 強迫結構化

`create_incident_report` 不是「寫一段文字到檔案」，它的參數是有結構的：

```ts
classification: { type: "string", enum: ["fall", "near_miss", "external_collision", "nominal", "inconclusive"] },
confidence:     { type: "string", enum: ["high", "medium", "low"] },
evidence:       { type: "array", items: { type: "string" } },
caveats:        { type: "array", items: { type: "string" } },
```

如果只給 `write_file`，模型會寫出一段散文。散文沒辦法：

- 程式化檢查（Lesson 7 的評估需要）
- 存進資料庫、串到 dashboard
- 保證它真的有引用證據

而且分類是 **enum 不是自由文字**。不然你會得到「疑似跌倒」「輕微失衡」
「可能碰撞」十幾種說法，下游根本沒辦法統計。

### 用程式強制規則，不要用 prompt 拜託

```ts
if (classification !== "nominal" && evidence.length === 0) {
  throw new Error(
    `A "${classification}" classification requires at least one evidence entry. ` +
      "Go back and query the telemetry, then cite the specific numbers you found.",
  );
}
```

在 system prompt 裡寫「請附上證據」，模型**大部分時候**會照做。
在工具裡檢查，它**每次**都得照做，否則工具就失敗，它得重來。

> **能用 harness 保證的事，不要交給 prompt 祈禱。**

---

## Step 7：實測踩到的坑（Gemini `thought_signature`）

這一課第一次接真模型時，第二輪請求直接 `400 status code (no body)`，
沒有錯誤訊息，完全看不出原因。

查了半天發現：**Gemini 會在 tool call 上附一個 `thought_signature`，
而且下一輪必須原封不動送回去。**

```json
{
  "extra_content": { "google": { "thought_signature": "EswCCskCARFNMg..." } },
  "id": "cY8cifxX",
  "type": "function",
  "function": { "name": "get_session", "arguments": "..." }
}
```

我的 streaming provider 在重建訊息時把 `extra_content` 丟掉了，於是 400。

**這跟 Lesson 1 講的 `raw` 欄位是同一件事。** 當時的例子是 Anthropic 的
thinking block 必須原樣傳回，現在多了一個：Gemini 的 thought_signature。

修法是在累積 tool call 碎片時，把 provider 自訂的欄位一起收下來：

```ts
for (const [key, value] of Object.entries(call)) {
  if (key === "index" || key === "id" || key === "type" || key === "function") continue;
  existing.extra = { ...existing.extra, [key]: value };
}
```

**教訓：中立抽象永遠涵蓋不了所有 provider 的內部欄位。
不認得的東西要原樣保留，不要丟掉。**

（非串流版本沒這個問題，因為它直接把 API 回傳的整個 message 物件存進 `raw`。
是我在串流版本自己重建訊息時才引入的 bug。）

---

## 跑不起來？

| 症狀 | 原因 | 解法 |
|---|---|---|
| `Session sess_XXX not found` | id 打錯 | 先問 agent「有哪些 session」 |
| 沒有 `data/sessions/` | 資料還沒產生 | `bun run lesson-06-domain-tools/data/generate.ts` |
| `400 status code (no body)`（Gemini） | tool call 的 `extra_content` 被丟掉 | 見 Step 7，已修 |
| 模型把 sess_002 判成 fall | prompt 沒強調 foot contact | 看 `SYSTEM_PROMPT` 的 discriminator 那段 |
| 報告寫得很空泛 | evidence 沒有強制檢查 | 見 Step 6 |

---

## 練習

### 練習 1：把好工具改成爛工具 ⭐

把 `query_telemetry` 改成直接回傳原始 JSON 樣本（不做統計），
然後問同一個問題。

觀察：token 用量差多少？模型算的峰值正確嗎？問兩次答案一樣嗎？

**這題最能體會第 3 層的價值。**

### 練習 2：拿掉資料品質警告 ⭐

把 `get_session` 的 gap 警告註解掉，然後問 `sess_004`（有 3 秒資料洞）。

看模型會不會對那 3 秒編故事。這就是「工具不說實話」的後果。

### 練習 3：加一個 `get_robot_history` 工具 ⭐⭐

同一台機器人過去的事故紀錄。這會讓 agent 能回答
「這台機器人是不是常常跌倒？」

思考：這個工具該回傳原始紀錄，還是統計摘要？（回想 Step 2）

### 練習 4：換一個你自己的領域 ⭐⭐⭐

這是這一課真正的作業。挑一個你熟悉的領域，設計 5-7 個工具。
例如 SEO：

```text
get_page_metrics(url, date_range)
find_traffic_drops(site, threshold)
compare_serp_position(keyword, before, after)
get_page_content(url)
create_seo_report(...)
```

自問四個問題：

1. 哪些計算該在工具裡做完？（不要讓模型算平均值）
2. 哪些工具是 mutating，需要批准？
3. 每個工具的錯誤訊息有沒有告訴模型下一步？
4. 最終產出有沒有 schema，能不能程式化檢查？

### 練習 5：找出你的「foot contact」訊號 ⭐⭐⭐

這一課的核心是：**有一個訊號能區分兩個看起來很像的情況。**

在你的領域裡找出那個訊號，然後把它寫進 system prompt 的
「discriminator」段落，並確保有工具能取得它。

這通常是領域專家最有價值的知識，也是最難從資料裡自動學到的東西。

---

## 對照 Pi 原始碼

Pi 本身是 coding agent，沒有領域工具。但工具的**形狀**是共用的：

| 這一課的概念 | Pi 的對應位置 |
|---|---|
| Tool 介面 | `packages/agent/src/types.ts:380` (`AgentTool`) |
| content vs details 分離 | `types.ts:355` (`AgentToolResult`) |
| 輸出截斷 | `harness/utils/truncate.ts` |
| 執行環境抽象 | `harness/types.ts:373` (`ExecutionEnv`) |

`AgentToolResult` 有個欄位值得特別看：

```ts
export interface AgentToolResult<T> {
  content: (TextContent | ImageContent)[];   // → 給模型看的
  details: T;                                // → 給 UI / log 的，模型看不到
}
```

我們這一課的工具只回傳字串（也就是只有 `content`）。真實產品會用
`details` 回傳結構化資料給 UI 畫圖，同時只給模型精簡的文字結論。
**同一次工具呼叫，兩種消費者，兩種格式。**

---

## 下一課

**[Lesson 7: Evaluation](../lesson-07-evaluation/)**：你現在有一個會分析事故的 agent。
但它**準不準**？換個 model 會變好還變壞？改了 prompt 有沒有退步？

沒有評估，你只是在憑感覺調 prompt。最後一課處理這個。
