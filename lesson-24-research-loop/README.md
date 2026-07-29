# Lesson 24: Deep Research loop

> 前置：[Lesson 21](../lesson-21-crawl/)（fetch）、[22](../lesson-22-retrieval/)（檢索）、
> [23](../lesson-23-real-world/)（讀過真實專案的原始碼）。
>
> 這一課解決 Lesson 22 Step 8 那個問題：**agent 不知道什麼時候該停。**
> 解法不是更好的 prompt。

## 這課要回答的問題

1. 為什麼一個「更聰明的 agent」解決不了「跑不完」這件事？
2. 停止條件要放在哪裡？
3. 研究跑三層，context 為什麼不會爆？
4. 一次研究要花多少錢——**開跑前**算得出來嗎？

---

## Step 0：先看它跑完的樣子

```bash
bun run lesson-24
```

```
問題：有哪些 open source 專案可以把影片動作 retarget 到 Unitree G1？現在還能用嗎？

預算：breadth=3 depth=2 pages=2  →  最多 9 次搜尋、18 次抓取、約 13 次模型呼叫
（這個上界是開跑前就算得出來的。對照 Lesson 22：那個 agent 的上界是「撞到步數上限」）

研究過程
[depth=2 breadth=3] 3 條 query
  ? Unitree G1 video human motion retargeting open source github
      ✓ https://arxiv.org/abs/2603.04417
      ✓ https://github.com/openmotion/retarget-anything
      → 3 條結論，3 個後續問題
  ? Unitree G1 pose estimation teleoperation retargeting framework
      ✓ https://openmotion.dev/docs/retarget-anything/getting-started
      ✓ https://www.unitree.com/g1/developer
      → 3 條結論，3 個後續問題
  ? human motion capture to Unitree G1 humanoid robot retargeting code
      → 沒有新頁面可讀（都讀過了或都抓不到）
  [depth=1 breadth=2] 2 條 query
    ? retarget anything CPU installation dependencies and Booster T1 support
        ✓ https://github.com/openmotion/retarget-anything/blob/main/LICENSE
        ✓ https://discourse.ros.org/t/g1-retargeting-foot-sliding/45211
        → 3 條結論，3 個後續問題
    ? Unitree G1 23 DoF SDK joint index mapping 2024 vs 2026
        ✓ https://blog.kinelabs.dev/humanoid-mimic-0-7
        ✓ https://github.com/kinelabs/humanoid-mimic
        → 3 條結論，3 個後續問題

實際用掉
  搜尋 7  抓取 9  模型呼叫 9  耗時 28.0s
  擋掉重複：URL 22 次、query 0 次
  證據 13 條，來自 9 個不重複的網址
```

**同一個問題，Lesson 22 的 agent 跑了兩次、兩次都撞上 16 步上限、沒有答案。**

這裡 28 秒跑完，13 條證據每一條都掛著真實網址，報告有結論有 caveat。

而且注意那個「擋掉重複：URL 22 次」——如果沒有這個機制，
它會重複抓同樣的頁面 22 次。

---

## Step 1：誰握著控制流

這一課最重要的一句話：

> **Deep Research 不是一個更聰明的 agent，是一個把 agent 當零件用的程式。**

```text
Agent loop（Lesson 1-23）
  while (模型還在呼叫工具) { 問模型下一步 }
  ↑ 控制流在模型手上。它覺得要再搜一次，你就得再搜一次。

Research loop（這一課）
  for (每一層) { 生 query → 平行搜尋 → 抓 → 壓成結論 → 深一層 }
  ↑ 控制流在程式手上。模型只被叫來做四件小事，每件都有明確的輸入輸出。
```

四個步驟（`steps.ts`）：

| 步驟 | 輸入 | 輸出 |
|---|---|---|
| `clarify` | 問題 | 3 個澄清問題 |
| `generateQueries` | 方向 + 已知結論 | N 條 query（含「為什麼要搜」） |
| `extractLearnings` | query + 網頁正文 | 結論（帶來源）+ 後續問題 |
| `writeReport` | 全部結論 | 報告 |

每一個都是**單次呼叫、沒有工具、可以單獨測試、可以單獨換模型**。

Lesson 22 那個 agent 的失敗，本質上不是它笨，是**沒有人在管它**。
換更強的模型只會讓它用更好的理由多搜五次。

---

## Step 2：預算是算出來的，不是撞出來的

抄 `deep-research/src/deep-research.ts:230`：

```ts
const newBreadth = Math.ceil(breadth / 2);
const newDepth = depth - 1;
```

每深一層，廣度砍半、深度減一。**模型全程沒有「要不要繼續」的發言權。**

為什麼廣度要砍半？因為不砍的話成本是 `breadth^depth`：

```text
breadth=4, depth=3, 不砍半    4 + 16 + 64 = 84 次搜尋
breadth=4, depth=3, 砍半      4 + 8 + 8   = 20 次搜尋
```

而且有了固定規則，`estimateCost()` 就寫得出來：

```
預算：breadth=3 depth=2 pages=2  →  最多 9 次搜尋、18 次抓取、約 13 次模型呼叫
```

> **這跟「MAX_STEPS = 16」是完全不同的東西。**
> MAX_STEPS 是熔斷器：它在你已經燒掉 16 步之後才動作，而且動作是「放棄」。
> 預算是計畫：它在你按下 Enter 之前就告訴你上限，而且跑完會有結果。

實測 7 次搜尋 / 9 次抓取，都在上界以內——**低於上界是正常的**，
因為去重和抓取失敗會讓實際值往下掉。上界的用途是保證，不是預測。

---

## Step 3：loop 裡流動的是 learnings，不是網頁

研究跑三層，context 為什麼不會爆？因為每一層的網頁都被壓成結論之後才往下傳。

```text
搜尋 → 抓 2 頁正文（幾千字）
      → extractLearnings
      → 最多 3 條一句話結論 + 3 個後續問題
      → 下一層只帶結論走
```

對照 `deep-research.ts:102`，形狀一模一樣。

**這是 Lesson 5 的 context 壓縮長在 research loop 裡的樣子。**
差別是 Lesson 5 的壓縮是被動的（context 快滿了才壓），
這裡的壓縮是主動的（每一層都壓，不管滿不滿）。

下一層的 query 也不是原始問題，而是上一層的產物（`deep-research.ts:252`）：

```ts
`Previous research goal: ${goal}
Follow-up directions:
${followUps.map((q) => `- ${q}`).join("\n")}`
```

所以研究會**越走越深**，而不是換個說法把同一件事再問一次。
看 Step 0 的第二層 query 就知道：

```
retarget anything CPU installation dependencies and Booster T1 support
Unitree G1 23 DoF SDK joint index mapping 2024 vs 2026
```

這兩條不可能從原始問題直接生出來，它們是讀完第一層之後才問得出來的。

---

## Step 4：三個防護，每個都對應到前面某一課的傷

### 1. 已經讀過的 URL 直接跳過

抄 `gpt-researcher/gpt_researcher/skills/researcher.py:801` 的 `_get_new_urls`。
那個 Set 是**整棵研究樹共用**的，`:108` 有一句註解特別交代不能清空。

實測擋掉 22 次。八條 query 在同一個小語料上跑，重複是必然的。

> 有趣的是 **deep-research 沒有做這件事**。它的 `visitedUrls` 只用在報告
> 最後列 Sources（`:229`、`:292`），從來沒拿來避免重複抓取。
> 兩個專案在這裡的選擇不同，我們照 gpt-researcher 的做。

### 2. 已經下過的 query 直接跳過

prompt 裡已經寫了「不要重複已經下過的 query」。**但那只是拜託。**

假 provider 第一次跑就重複了兩條，所以這件事寫進程式：

```ts
const seen = new Set(state.queriesRun.map(normalizeQuery));
```

`normalizeQuery` 把字排序後比對，所以
「unitree g1 retargeting」和「retargeting unitree g1」算同一條。

### 3. 一條 query 失敗不弄垮整輪

抄 `deep-research.ts:282`：catch 之後回空結果，其他分支照跑。

配上並行度 2（`ConcurrencyLimit`，`deep-research.ts:30` 的預設值也是 2）。

---

## Step 5：兩個靜默失敗，都是自己踩的 ★

這一課寫完第一次跑真模型時，有兩個東西壞了，而且**都沒有任何錯誤訊息**。

### 失敗一：抓了四頁，0 條結論

```
? human video motion retargeting Unitree G1 humanoid
    ✓ arxiv.org/abs/2603.04417
    ✓ github.com/kinelabs/humanoid-mimic
    ✓ github.com/openmotion/retarget-anything
    ✓ www.unitree.com/g1/developer
    → 0 條結論，0 個後續問題
```

四頁抓到了、抽取成功了、然後什麼都沒有。沒有例外、沒有警告。

可能的原因有三種，而當時的程式碼**一種都分不出來**：

```text
模型根本沒回出可解析的 JSON
模型回了結論但覺得沒東西可講
模型回了結論，但引用了沒抓過的網址，被我們的來源過濾丟掉
```

修法是強迫自己講出原因（`steps.ts` 的 `Extraction.failure`）：

```
→ 0 條結論，0 個後續問題 （模型沒有回出可解析的 JSON）
→ 0 條結論，0 個後續問題 （2 條被丟掉：引用了沒抓過的網址）
```

### 失敗二：報告在網址中間斷掉

第一次跑出來的報告結尾是這樣：

```
...會導致足部滑移 (https://github.com/kin
```

13 條證據，`maxTokens: 3000` 寫不完。而**看起來就像它寫完了**。

`ask()` 拿到 `stopReason === "max_tokens"` 卻直接忽略。修法：

```ts
if (response.stopReason === "max_tokens") {
  state.trace.push(`⚠ 輸出撞到 ${maxTokens} token 上限，內容不完整`);
  state.budget.truncatedOutputs++;
}
```

### 為什麼這兩個要寫進課程

因為它們是同一種病，而這已經是這個系列第四次遇到：

```text
Lesson 21 Step 5   抽取器丟掉表格，沒有任何訊號       → 燒掉兩次 16 步上限
Lesson 22 Step 5   訊號有偏誤，被平均分數蓋住          → 一題從 1.000 崩到 0.131
Lesson 23 Step 6   平行工具呼叫被合併，潛伏三課        → 400 no body
Lesson 24 Step 5   萃取 0 條、報告被截斷，都不出聲     → 你以為它做完了
```

> **會爆的失敗不可怕，可怕的是安靜的失敗。**
> 每加一個階段，就問自己一次：「這一步什麼都沒做的時候，我看得出來嗎？」

---

## Step 6：跟 Lesson 22 的 agent 正面對照

同一個問題、同一個模型、同一份語料、同一條檢索管線。

| | Lesson 22 的 agent | Lesson 24 的 loop |
|---|---|---|
| 控制流在誰手上 | 模型 | 程式 |
| 上界 | `MAX_STEPS=16`（熔斷器） | 開跑前算得出來（預算） |
| 停止條件 | 模型不再呼叫工具 | `depth` 歸零 |
| context 成長 | 整段對話一直累積 | 每層壓成結論，不累積網頁 |
| 重複 URL | 沒有機制 | 擋掉 22 次 |
| 失敗隔離 | 一個工具錯誤進對話歷史，影響後面所有輪 | 一條 query 失敗只影響那條 |
| **實測結果（跑兩次）** | **都撞上限、沒有答案** | **28 秒完成，13 條有來源的證據** |

要說清楚的是：**這不代表 agent loop 比較差。**

Lesson 1-23 的 agent loop 適合「我不知道要做幾步」的任務——改程式、
debug、探索。research 是一個**形狀已知**的任務：拆問題、找資料、讀、總結。
形狀已知的任務就該用程式控制流程，把模型放在它擅長的小格子裡。

> 選錯形狀比選錯模型貴得多。

---

## Step 7：我們比 deep-research 多做的一件事

`deep-research.ts:107` 的 learning 是純字串：

```ts
learnings: z.array(z.string())
```

所以寫報告時只能把全部倒進 prompt，最後貼一份「所有造訪過的網址」。
**那份清單沒辦法告訴你哪一句話來自哪一個網址。**

我們的 `Learning` 多存了 `sources`，而且在程式裡強制檢查：

```ts
// steps.ts：只留真的抓過的網址
sources: rawSources.filter((s) => known.has(s))
```

模型很愛「順手」補一個看起來合理的 URL——那正是 Lesson 21 Step 6 看到的
**引用嫁接**。這裡用程式擋掉，不用 prompt 拜託。

實測有效：13 條證據全部掛著真的抓過的網址。

但這只擋掉了「引用了沒抓過的頁面」。還有一種錯沒擋掉：
**引用了真的抓過的頁面，但那一頁根本沒說這句話。**

那個要逐句比對正文才驗得出來，**是 Lesson 25 的題目**。
這一課的 `sources` 欄位就是為那一課鋪的路。

---

## 跑不起來？

| 症狀 | 原因 | 解法 |
|---|---|---|
| `找不到 Lesson 20 的語料` | 語料還沒產生 | `bun run lesson-20:corpus` |
| `這段文字不在 embedding 快取裡` | 模型生了新 query 而你沒有金鑰 | `PROVIDER=fake bun run lesson-24`，或設金鑰 |
| 證據 0 條 | 看 trace 裡括號的原因 | 見 Step 5，三種原因會分開講 |
| `⚠ 輸出被 token 上限截斷` | 證據太多、報告寫不完 | 調小 `--breadth`／`--depth`，或調大 `writeReport` 的 maxTokens |
| 跑很久 | 預設 breadth=3 depth=2 | `--breadth 2 --depth 1` 便宜很多 |

---

## 練習

### 練習 1：把 depth 調到 3 ⭐

```bash
bun run lesson-24 -- --breadth 3 --depth 3
```

先看它印出來的預算上界，再看實際用掉多少。

**第三層的 query 值得那些錢嗎？** 這題沒有標準答案，
但你會第一次有能力用數字回答它。

### 練習 2：拿掉 visited 去重 ⭐

把 `research.ts` 裡 `state.visited.has(hit.url)` 那段註解掉。

看抓取次數從 9 變成多少、證據有沒有變多。
（我實測是抓取變多、證據幾乎沒變——**多花的錢買到的是同一份內容**。）

### 練習 3：讓 `--ask` 真的等使用者回答 ⭐⭐

現在 `--ask` 只印出澄清問題。改成真的讀使用者的回答，
然後把答案接到 `state.question` 後面再開始研究。

（`shared/repl.ts` 有現成的 `LineReader`。）

觀察：回答之後的 query 有變得比較準嗎？

### 練習 4：加一個「證據不足就再跑一層」 ⭐⭐⭐

現在的預算是純結構性的：`depth` 歸零就停，不管找到幾條證據。

改成：如果跑完證據少於 N 條，就自動再跑一層（但總層數仍有硬上限）。

**這題的難點不是程式，是想清楚：**

1. 這樣做會不會退化成「模型說了算」？
2. 「證據不足」要怎麼定義才不會被自己騙？（3 條爛證據 vs 1 條好證據）
3. 硬上限該設多少？根據什麼？

### 練習 5：把 research loop 包成 agent 的一個工具 ⭐⭐⭐

反過來：讓 Lesson 22 的 agent 擁有一個 `deep_research(question)` 工具，
內部就是這一課的 loop。

思考：agent 什麼時候該用 `web_search`，什麼時候該用 `deep_research`？
你要怎麼在工具的 description 裡講清楚，它才不會每次都用貴的那個？

---

## 對照原始碼

| 這一課的機制 | 出處 |
|---|---|
| `breadth/2`、`depth-1` | `deep-research/src/deep-research.ts:230` |
| 下一輪 query = researchGoal + followUps | `deep-research.ts:252` |
| learnings 而不是網頁在 loop 裡流動 | `deep-research.ts:102` |
| 並行度寫死的小數字 | `deep-research.ts:30` |
| 單一分支失敗回空結果 | `deep-research.ts:282` |
| `visited_urls` 過濾與跨層共用 | `gpt-researcher/gpt_researcher/skills/researcher.py:801`、`:108` |
| 研究前先問澄清問題 | `deep-research/src/feedback.ts` |
| 防禦性 JSON 解析 | `gpt-researcher/gpt_researcher/actions/query_processing.py:6` |

全部可以驗證：

```bash
bun run lesson-23:check
```

---

## 下一課

**[Lesson 25: 引用與評估](../lesson-25-citations/)**：這一課的每條證據都掛著網址，
但**沒有人檢查那一頁真的說了那句話**。

```text
引用的句子在來源正文裡真的存在嗎？
數字有沒有在轉述中被改掉？
報告裡有沒有哪一句話沒有任何證據支持？
換模型、調 breadth 之後，這些指標有沒有退步？
```

評分會跟 Lesson 7 一樣是**確定性的**，不是再叫一個模型來打分。
