# Lesson 26: 成本與預算

> 前置：[Lesson 24](../lesson-24-research-loop/)（結構性預算）。
>
> 這個系列到目前為止量過準確率、量過排序品質、量過引用正確性——
> **就是沒量過錢。** 這一課補上。

## 這課要回答的問題

1. 一次呼叫到底用了多少 token？（比你想的難）
2. 錢花在哪個步驟？（跟直覺不一樣）
3. 「多跑一層」值不值得？
4. 怎麼在不改動任何一課的程式碼的前提下，把成本記下來？

---

## Step 0：`total ≠ input + output`

```bash
bun run lesson-26:probe
```

真的跑出來的（Gemini 3.6 Flash）：

```
案例               input  output   total      差額      低估倍數  stopReason
────────────────────────────────────────────────────────────────────────
極短 (100)            13       1     107      93      7.6x  end
一句話 (400)           16      13     412     383     14.2x  max_tokens
一句話 (4000)          16      47     686     623     10.9x  end
長篇 (2000)           26     643    2022    1353      3.0x  max_tokens
```

第一列：你問「只回答一個字：hi」，模型回了 1 個 token。
`input + output = 14`。

**實際計費的 total 是 107。**

中間那 93 個是 **thinking token**。它不在 `completion_tokens` 裡，
但你要付錢，而且通常是照 output 價計費——也就是最貴的那一種。

用 `input + output` 算成本，這一筆會**低估 7.6 倍**。

### 換一家 provider，同一個欄位的意思就變了

同一支 probe 打 OpenAI：

```
案例               input  output   total      差額      低估倍數  stopReason
極短 (100)           121     100     221       0      1.0x  max_tokens
一句話 (400)          124     195     319       0      1.0x  end
一句話 (4000)         124     260     384       0      1.0x  end
長篇 (2000)          134    2000    2134       0      1.0x  max_tokens
```

**差額全部是 0。**

不是 gpt-5 不做 reasoning，是它把 reasoning token **算進
`completion_tokens` 裡**（細項在 `completion_tokens_details.reasoning_tokens`）。
Gemini 不算進去，但算進 `total_tokens`。

```text
OpenAI    completion_tokens 已含 reasoning   →  total = input + output
Gemini    completion_tokens 不含 thinking    →  total > input + output
```

> **同一個欄位名，兩家的語意不一樣。** 這就是 provider 抽象最難的地方，
> 也是為什麼這一課的計價一律用 `total`：
> 對 OpenAI 它等於 input + output（不會重複計），
> 對 Gemini 它才抓得到 thinking。**一個公式同時對兩家成立。**

順帶一提，OpenAI 的 input 是 121-134（同樣的短 prompt，Gemini 只有 13-26）。
tokenizer 不同、系統開銷不同，**跨 provider 比 token 數沒有意義，
要比就比錢。**

### 而且它吃掉 maxTokens 額度

看「一句話」那兩列：同一個問題，只有 `maxTokens` 不同。

```
額度 400   → output 13 個 token，stopReason = max_tokens   ← 被砍斷
額度 4000  → output 47 個 token，stopReason = end          ← 正常說完
```

一句話的答案只需要 47 個 token，但額度 400 不夠——
**因為 383 個額度被拿去想了。**

> **對推理型模型來說，`maxTokens` 不是「輸出長度上限」，
> 是「想 + 寫的總額度」。**

這直接解釋了 Lesson 24 Step 5 那個在網址中間斷掉的報告。
當時我以為是「13 條證據太多、3000 token 寫不完」，
現在知道真正的原因是**thinking 先吃掉了大部分額度**。
（那一課的修法——把上限調到 6000——碰巧是對的，但理由是錯的。）

---

## Step 1：把計量接上去，而且不改任何一課

```ts
const provider = withMetering(selectStreamingProvider(), meter, classify);
```

就這一行。Lesson 24 的 `research()`、`steps.ts`、`state.ts` **一個字都沒改**。

### 為什麼用裝飾器而不是傳參數

gpt-researcher 的做法是把 `cost_callback` 傳進每一個會呼叫模型的函式
（`query_processing.py`、`compression.py` 都有）。很直接，但：

| 做法 | 好處 | 代價 |
|---|---|---|
| 傳 callback 進每個函式 | 精確，呼叫端知道自己是誰 | 每個簽章多一個參數，漏傳一個就少算一筆 |
| **包一層 provider** | 零侵入，漏不掉 | 只看得到 request，要自己猜這筆是哪個步驟 |

我們選後者，然後用一個 `classify(request)` 函式從 prompt 認出步驟。
有點土，但那個土的部分**完全留在 Lesson 26 裡**，不會污染 Lesson 24。

> 這也是設計原則 6 的實踐：新功能加在核心旁邊，不要改核心。

### 失敗的呼叫也要記帳

```ts
// 串流中斷或出錯時不會有 done 事件。這種呼叫一樣要付錢。
if (!recorded) meter.calls.push({ label: `${classify(request)} (未完成)`, ... });
```

不記的話，你會以為「失敗的呼叫是免費的」。它不是。

---

## Step 2：錢花在哪裡（跟直覺不一樣）

```bash
PRICE_INPUT=0.30 PRICE_OUTPUT=2.50 bun run lesson-26 -- --shapes
```

> ⚠️ 上面那兩個價格是**我隨手放的假設值**，只為了讓數字看起來像錢。
> `prices.ts` 預設是空的，理由見 Step 4。

真的跑出來的：

```
breadth=2 depth=1
  預估上界：搜尋 2、抓取 4、模型呼叫 4    實際：搜尋 2、抓取 4、模型呼叫 4
  證據 6 條
  步驟                    次數   total token      占比          美元
  extractLearnings       2         5,503   55.9%    $0.00846
  writeReport            1         3,595   36.5%    $0.00742
  generateQueries        1           752    7.6%    $0.00134
  ─ 合計 input 3,364、output 1,859、total 9,850（thinking 佔 47%）
  合計 $0.0172

breadth=3 depth=2
  預估上界：搜尋 9、抓取 18、模型呼叫 13   實際：搜尋 7、抓取 8、模型呼叫 11
  證據 16 條
  步驟                    次數   total token      占比          美元
  extractLearnings       6        12,520   47.2%    $0.02255
  writeReport            1         7,363   27.7%    $0.01540
  generateQueries        4         6,669   25.1%    $0.01121
  ─ 合計 input 7,826、output 2,724、total 26,552（thinking 佔 60%）
  合計 $0.0492
  ⚠ 2 次呼叫被 maxTokens 截斷
```

三個發現：

### 1. 最貴的不是寫報告，是讀網頁做摘要

`extractLearnings` 佔 47-56%，`writeReport` 只佔 28-37%。

直覺會覺得「寫三頁報告」最貴，但實際上**把六頁網頁壓成三條結論**才是大宗，
因為那一步的 input 很長（整頁正文）而且要跑很多次。

**這個結論直接決定你該優化哪裡。** 想省錢的話：
先裁短餵給 `extractLearnings` 的正文，而不是叫報告寫短一點。

### 2. thinking 佔比隨深度上升

```
breadth=2 depth=1   thinking 佔 47%
breadth=3 depth=2   thinking 佔 60%
```

越深，模型要考慮的東西越多，想得越久。**成本不是照 token 線性成長的，
它照「模型要做多難的判斷」成長。**

### 3. 但每條證據的單價幾乎沒變

```
breadth=2 depth=1    $0.0172 / 6 條  =  $0.0029 / 條
breadth=3 depth=2    $0.0492 / 16 條 =  $0.0031 / 條
```

**多跑一層沒有變貴。** 這是這一課最實用的一個數字：
它把「要不要多跑一層」從感覺問題變成算術問題。

> 注意這只是這份語料、這個問題、這個模型的結果。
> 重點不是 $0.003 這個數字，是**你現在有辦法算它了**。

---

## Step 3：又一次漏帳（這次是我們自己的 provider）

計量接上去之後，probe 的後三個案例都印「這個 provider 沒有回報 usage」。

追下去發現：`shared/streaming/openai.ts` 在 `stopReason === "max_tokens"`
的時候會提早 `return`，而那條路徑**沒有帶上 usage**。

```diff
  if (stopReason === "max_tokens") {
      yield { type: "done", response: {
          blocks: ..., raw: ..., stopReason,
+         usage,   // ← 漏了三課
      }};
      return;
  }
```

諷刺的地方是：**被截斷的呼叫通常是最貴的那幾筆**（模型想了很久才被砍斷），
而那正是我們唯一漏記的一條路徑。

這已經是這個系列第五次同一種病：**沒有出錯、只是沒有資料**
（設計原則 7）。

---

## Step 4：為什麼 `prices.ts` 是空的

因為設計原則 3 說「不要編造」，而價格是最容易編造的東西：

1. 每隔幾個月就變
2. 同一個模型在不同區域、不同層級、有沒有快取，價格都不同
3. **一個看起來很精確但其實過期的數字，比沒有數字更危險**——你會拿它做決策

所以這一課的立場是：

```text
token 是可以量測的事實      → 一定顯示
錢是需要外部資訊的推算      → 你自己填，而且要記下確認日期
```

```ts
export interface Price {
  input: number;   // 每百萬 token 美元
  output: number;
  verifiedOn: string;  // 沒有這個欄位的價格不值得相信
}
```

沒填價目時一切照跑，只是不顯示金額。

---

## 跑不起來？

| 症狀 | 原因 | 解法 |
|---|---|---|
| 「沒有價目表，只顯示 token」 | 這是預設行為 | `PRICE_INPUT=… PRICE_OUTPUT=… bun run lesson-26` |
| 「這個 provider 沒有回報 usage」 | 沒開 `stream_options.include_usage` | 已在 `shared/streaming/openai.ts` 開啟 |
| `PROVIDER=fake` 沒有 token 數 | 假 provider 不產生 usage | 正常。fake 只用來看結構 |
| Anthropic 沒有 usage | `shared/streaming/anthropic.ts` 還沒接 | 練習 1 |

---

## 練習

### 練習 1：把 Anthropic 的 usage 接上 ⭐⭐

`shared/streaming/anthropic.ts` 還沒回報 usage。Anthropic 的串流會在
`message_start` 和 `message_delta` 事件裡帶 usage，形狀跟 OpenAI 不一樣。

接上之後**跑一次 probe**：Anthropic 的 thinking token 也是這樣算的嗎？
（這題會讓你發現「各家的 usage 語意不一樣」，而那正是 provider 抽象最難的地方。）

### 練習 2：找出「每條證據最便宜」的形狀 ⭐⭐

跑 breadth/depth 的幾種組合，畫出「每條證據多少錢」。

會不會有一個甜蜜點？超過之後是不是開始變貴（重複的證據越來越多）？
**這題會用到 Lesson 24 的去重計數。**

### 練習 3：加一個硬預算 ⭐⭐⭐

給 `CostMeter` 一個上限，超過就讓後續呼叫失敗。然後回答：

1. 預算用完的時候，該中止還是「用現有證據先寫一份報告」？
2. 怎麼讓 research loop 知道自己快沒錢了，而不是撞牆才知道？
3. 如果一半的證據已經收集完，寫出來的報告要怎麼標示「這是預算內的部分結論」？

**第 3 題最重要**：一份不誠實的半成品報告，比沒有報告更糟。

### 練習 4：分級用模型 ⭐⭐⭐

`extractLearnings` 佔了一半以上的成本，但它做的事情其實不難
（讀一段文字、抽出幾個事實）。

改成用便宜的模型跑 `extractLearnings`，貴的模型只跑 `writeReport`。

然後——**這是重點**——用 Lesson 25 的引用檢查跑一次，
確認證據品質沒有掉。省錢很容易，省錢又不掉品質才是工程。

---

## 對照原始碼

| 這一課的概念 | 對照 |
|---|---|
| 成本累加器 | `gpt-researcher/gpt_researcher/utils/costs.py:63`（`estimate_llm_cost`） |
| 把成本串進每個呼叫 | `gpt-researcher/gpt_researcher/agent.py:773`（`add_costs`）+ 各處的 `cost_callback` |
| 結構性預算（次數上界） | 本系列 [Lesson 24](../lesson-24-research-loop/) 的 `estimateCost()` |

> gpt-researcher 用的是**估算**（照字元數估 token），我們用的是
> provider 回報的**實際值**。估算的好處是不用等回應就能擋下太貴的請求，
> 實際值的好處是準。成熟的系統兩個都要：**送出前估算擋門，收到後實際值對帳。**

---

## 下一課

**Lesson 27: 本地文件 + web 混合檢索**（還沒寫）：把 Lesson 22 的檢索
接到自己的檔案上。

```text
本地文件沒有 URL，「來源」是什麼？（檔名 + 第幾段）
本地文件沒有新鮮度和權威度，排序公式要怎麼改？
本地和網路說得不一樣時，相信誰？
PDF、docx 怎麼變成 chunk？
```
