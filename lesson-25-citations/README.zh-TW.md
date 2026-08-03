# Lesson 25: 引用與評估

> [English](README.md)
>
> 前置：[Lesson 7](../lesson-07-evaluation/README.zh-TW.md)（確定性評分）、
> [Lesson 24](../lesson-24-research-loop/README.zh-TW.md)（研究產出的證據）。
>
> AI Search 主線的最後一課（26、27 是續篇）。它要抓的是一種**看起來完全合規**的錯。

## 這課要回答的問題

1. 報告裡每一句話都掛著網址，怎麼知道那一頁真的說了那句話？
2. 這聽起來像語義判斷，為什麼不用 LLM 當裁判？
3. 一個「土」的確定性檢查，抓得到多少？抓不到什麼？

---

## Step 0：一個真實的錯

拿 Lesson 24 真的跑出來的報告裡的一句話（完整內容在 `fixtures.ts`，一字未改），
把其中一個引用搬掉：

```markdown
* **Kinematic Foot Sliding**: Deploying `humanoid-mimic` 0.7 on the Unitree G1
  causes foot sliding during fast footwork … A practical workaround requires
  slowing trajectory playback speed to 0.8x
  (https://technews.example.com/2026/07/humanoid-robot-funding-round)
```

那個網址是真的，頁面也真的抓過。**但它是一篇募資新聞，從頭到尾沒提過腳步滑動、
播放速度，也沒提過 0.8x。**

這叫**引用嫁接**（citation grafting）：

```text
the URL is real
the page really was fetched (Lesson 24 already blocks invented URLs)
the content is real
and this page does not support this sentence
```

它比整段幻覺危險，因為**每一層檢查都會放它過**。
你點進去、看到一篇真的技術文章、於是相信了整句話。

---

## Step 1：為什麼不用 LLM 當裁判

「這句話有沒有被這一頁支持」聽起來就是語義判斷，找個模型評分很自然。
但 Lesson 7 那條原則在這裡一樣成立：

> 評分要是確定性的，否則你沒辦法回答「剛才那個改動有沒有讓事情變糟」。

裁判自己會飄的話，`--compare` 就沒有意義——你分不出來是系統退步了，
還是裁判今天心情不一樣。Lesson 22 Step 5 那個「平均上升但一題崩塌」
就是靠確定性評分抓到的。

所以這一課用一個很土的方法：

```text
1. pull checkable "atoms" out of the sentence: numbers, versions, dates, identifiers, licence names
2. look for those atoms in the body of every cited source
3. a source where not one atom is found  → that citation is grafted
4. an atom found in no source at all     → that number was invented or altered
```

它不檢查語義，只檢查「這些具體的東西在不在」。

---

## Step 2：跑起來

```bash
bun run lesson-25
```

四份報告：一份是 Lesson 24 的真實輸出，三份是從它**故意改壞**的
（改法寫在 `fixtures.ts` 的程式碼裡，可以自己核對）。

```
Lesson 24's real output, not a word changed
  claims 16  uncited 0  atoms 100  unsupported 5  grafted 0  unknown 0

number drift        planted: 0.8x → 0.5x, 18 ms → 8 ms, 50 Hz → 120 Hz
  claims 16  uncited 0  atoms 100  unsupported 7  grafted 1
  ✓ unsupported 7 ≥ 3

citation grafting   planted: the joint-index line gains a cooking site; the foot-sliding line gets a funding story
  claims 16  uncited 0  atoms 100  unsupported 6  grafted 2
  ✓ grafted 2 ≥ 2

bare assertions     planted: citations stripped from every other line
  claims 16  uncited 7  atoms 100  unsupported 43  grafted 0
  ✓ uncited 7 ≥ 5
```

三份改壞的都被抓到了。但**最有意思的是第一份**。

---

## Step 3：檢查器在真實輸出裡找到什麼

```bash
bun run lesson-25 -- --show real
```

真實報告有 16 條 claim、100 個原子，而最上面那一行是個意外：

```
claims 16  uncited 0  atoms 100  unsupported 5  grafted 0  unknown 0
```

**零條沒引用的句子，零個嫁接的引用。** 每一句事實都掛了來源，而且每一個掛上去的
來源都真的支持那句話。這不是這一課第一版量到的結果，但這是重跑之後誠實的結果。

### 剩下的那幾個，以及它們被誤讀過一次

在下面那個連字號修正之前，這一行寫的是 `unsupported 7`，
而這份 README 當時說七個全部是檢查器的錯：

```
✗ Two open-source software projects include motion retargeting pipelines for t
    no source found: open-source
✗ * **License & Compatibility**: Released under an MIT license, version 0.7 ad
    no source found: hardware-validated
✗ * **Runtime & Hardware Specs**: Running on an NVIDIA RTX 4070 GPU, the pipel
    no source found: NVIDIA, GPU
✗ * **Backbone Weights Licensing**: While the `humanoid-mimic` codebase is MIT
    no source found: MIT-licensed
✗ * **Outdated Benchmarks**: A third-party review of seven motion retargeting 
    no source found: third-party, out-of-the-box
```

七個發現，其中五個看起來都有連字號，於是當時寫下的結論是「連字號跟大小寫，七個都是」。
**去 grep 一遍語料就知道不是。** 七個裡面只有兩個真的是連字號問題：

| 原子 | 語料裡真正有的字 | 判定 |
|---|---|---|
| `MIT-licensed` | "The project stays MIT licensed" | ✅ **連字號規則修掉了** |
| `out-of-the-box` | "…works out of the box" | ✅ **連字號規則修掉了** |
| `NVIDIA`、`GPU` | 兩個字串在**整份語料裡都不存在** | 正確的告警 |
| `third-party` | 語料裡不存在，任何寫法都沒有 | 正確的告警 |
| `open-source` | 三個頁面上有——但**這條 claim 引用的那兩頁都沒有** | 正確的告警 |
| `hardware-validated` | "validated on hardware"，同樣的字，順序相反 | 仍然是假陽性 |

> 這個誤讀才是這一步最有用的東西，而且它就是 Trap 3 再往外一層。
> 七個發現裡有五個**看起來**有連字號，所以整份清單是照外觀分類的，不是照查證分類的。
> 真正是連字號的只有兩個。
>
> **假陽性率是量出來的，不是看出來的。** 用眼睛掃過檢查器的輸出，
> 跟用眼睛掃過模型的輸出是同一個錯誤。

### 修法，以及它修不掉的東西

識別字正規化會把空白拿掉，但沒有拿掉連字號，所以 `open-source` 永遠對不上
"open source"。現在兩邊都走同一個 packing（`verify.ts` 裡的 `packWordBoundaries`），
連字號跟空白一樣是詞邊界。

**為什麼現在才浮出來**，比修法本身更值得記。當周圍的散文是中文時，
一個帶連字號的拉丁字元 token 真的就是識別字——`Apache-2.0`、`humanoid-mimic`、
`left_knee`——因為中文的一般詞彙不會用連字號連起來。英文的一般形容詞會。

> **一個啟發式規則的可攜性，只到它當初被調校的那個語言為止。**
> 這條規則沒有任何地方錯了；變的是它跑在什麼文字上。

修完之後剩下 5 個，而且不再是雜訊：

```
3 個正確告警   NVIDIA、GPU、third-party — 沒有任何來源用過這些字
1 個設計上正確 open-source — 語料三頁上有，但這條 claim 引用的兩頁都沒有
1 個假陽性     hardware-validated vs "validated on hardware"
```

最後那個是**詞序**沒對上，不是連字號，而修掉它意味著要比對詞袋而不是字串——
那條路通往 Step 2 拒絕踏進去的語意判斷。它留著，並且被寫下來。

而那三個正確的告警是安靜的發現：模型寫「an NVIDIA RTX 4070 GPU」，
它的來源只寫「an RTX 4070」；模型寫「a third-party review」，來源什麼都沒說。
沒有一句是假的，也沒有一句有來源。這種小小的補完是報告失真最常見的方式，
而且幾乎不可能靠人工抽查找到。


---

## Step 4：三個坑，都在評估這一側

這一課最值得記的部分，是**評估本身出錯的三次**。
評估錯了比系統錯了更危險，因為它會叫你去修一個沒壞的東西。

### 坑 1：切句子的佔位符壞了，所有引用都變成空的

第一版的 `splitSentences` 先把網址換成佔位符、切完再換回來。
佔位符寫壞了（本該是空白的地方變成了別的字元），於是**沒有任何網址被還原**。

結果：

```
claims 12  uncited 12  atoms 82  unsupported 82  grafted 0
```

每一條都是「沒有引用」、每一個原子都是「查無來源」。
而程式沒有報錯，四份報告都「跑完了」。

只看「有沒有跑完」的話，Lesson 24 的報告會顯得爛到極點。

修法不是修佔位符，是**把佔位符整個拿掉**——`。！？` 不會出現在網址裡，
ASCII 的 `.` 只有後面接空白才切，網址裡的點後面不會有空白。
少一個機制就少一個會壞的地方。

### 坑 2：評估讀的來源，跟 agent 讀的來源不是同一份

修好之後，關節映射那條被判成：

```
no source found: 7, 9, 3, 17, 15, left_hip_pitch, left_knee, rad/s
```

但那些數字**明明就在頁面上**。

原因：Lesson 21 的 `fetcher.ts` 對 `unitree.com/g1/developer` 會回一份
**動態產生的長文件**（那份 SDK 遷移指南），而評估直接讀
`corpus/index.json` 裡的短版。

```text
what the agent read   ≠   what the answer is checked against
```

於是**正確的引用被判成幻覺**。修法是讓評估走跟 `runQuery` 完全一樣的
`fetchPage` + `extractMain` 路徑。

> 評估的來源必須跟系統實際看到的來源是同一份。
> 這句話聽起來很廢，但它是這一課最貴的一行。

### 坑 3：正規化把相鄰的數字黏在一起

還剩兩個誤判：「2026 年 6 月」的 `6`、「Apache License… 2004 年 1 月」的 `2004`。

來源是英文的（`released June 2026`），月份會轉換成 `june → 6`，
然後把所有空白拿掉方便比對：

```text
"released June 2026"  →  "released 6 2026"  →  "released62026"
atom 6 requires "no digit either side"  →  a 2 follows it  →  judged unsupported
```

修法：**數字和識別字要用不同的正規化**。識別字去空白
（讓 `Apache-2.0` 和 `Apache - 2.0` 相等），數字保留單一空白當邊界。

三個坑修完之後，真實報告從「14 個查無來源」變成「5 個」。

當時寫下的結論是「剩下的 5 個全部是真的問題」。Step 3 就是一個月後
真的有人拿語料去核對那句話會發生什麼事——殘餘一樣是 5 個，組成不同，
而且其中一個仍然是檢查器的錯。**找到三個坑不是停止找第四個的理由。**

---

## Step 5：這個方法抓不到什麼（先講清楚）

| 抓得到 | 抓不到 |
|---|---|
| 引用了沒說這件事的來源 | 原子都在，但因果關係說反了 |
| 數字被改掉或編出來 | 「A 比 B 好」這種沒有原子的主觀句 |
| 事實句完全沒有引用 | 來源說「不支援」，報告寫成「支援」 |
| 引用了不存在的網址 | 斷章取義（引用真的存在，但語境相反） |

最後一格特別要小心：一句話的原子全部找得到，不代表這句話是對的。

那為什麼還值得做？

> 寧可要一個抓得到 70% 問題的確定性檢查，
> 也不要一個號稱抓得到 95%、但自己每次結果都不一樣的 LLM 裁判。

而且它便宜（不用模型）、可重現、可以進 CI、可以做回歸。
剩下那 30% 要靠人工抽查——但抽查的範圍已經被縮小到「原子都對得上」的那些句子了。

---

## Step 6：回歸比較

跟 Lesson 7 一樣的形狀：

```bash
bun run lesson-25 -- --save      # save a baseline
bun run lesson-25 -- --compare   # compare after every later change
```

```
compared against the baseline
  ✓ every metric matches the baseline
```

改了 Lesson 24 的 prompt、換了模型、調了 breadth 之後，跑這個。
指標變差會直接指出來，而且指得出是哪一份、哪個指標。

沒有這一步，你只有「感覺好像變好了」。

---

## 跑不起來？

| 症狀 | 原因 | 解法 |
|---|---|---|
| `Lesson 20's corpus not found` | 語料還沒產生 | `bun run lesson-20:corpus` |
| 所有 claim 都是「沒有引用」 | 報告格式不是「句尾括號放網址」 | 改 `report.ts` 的 `URL_PATTERN` 和註腳解析 |
| 正確的引用被判成嫁接 | 評估讀的來源跟系統讀的不一樣 | 見 Step 4 坑 2 |
| `No baseline yet` | 沒跑過 `--save` | `bun run lesson-25 -- --save` |

---

## 練習

### 練習 1：把 Lesson 24 的輸出接進來 ⭐⭐

現在 fixtures 是寫死的。改成讀 Lesson 24 跑出來的報告
（把 `demo.ts` 加一個 `--json` 輸出，或直接存檔）。

然後：跑三次同一個問題，看三份報告的指標差多少。
這會告訴你 Lesson 24 的穩定性，而那是目前完全沒量過的東西。

### 練習 2：加「語境相反」的檢查 ⭐⭐⭐

Step 5 說抓不到「來源說不支援、報告寫成支援」。

想一個確定性的方法。提示：否定詞（not、no longer、deprecated、
不再、已棄用）在來源和 claim 裡的出現情況，可以做一個很粗但有用的訊號。

先想清楚它的誤判率會有多高，再決定要不要做。

### 練習 3：把它變成 Lesson 24 的閘門 ⭐⭐

現在是事後評估。改成：`writeReport` 產出報告之後，
**先驗一次**，發現嫁接就把那條引用拿掉再輸出。

思考題：拿掉引用會讓那句話變成「裸露斷言」，是不是反而更糟？
還是該把整句話拿掉？誰來決定？

### 練習 4：換一個領域跑跑看 ⭐⭐⭐

這是這一課真正的作業。把你自己領域的一份 AI 產出報告丟進來
（把來源正文放進 corpus map 就好）。

你大概會發現三件事：

1. 原子抽取要調（你的領域有你的識別字格式）
2. 誤判會比這裡多（真實來源比這份語料雜）
3. **它還是會抓到東西**——而且通常是你讀十遍都不會發現的那種

### 練習 5：把最後一個假陽性修掉，或決定不修 ⭐⭐⭐

Step 3 剩下的只有一個：`hardware-validated` 對上來源的 "validated on hardware"。
同樣的字，順序相反，所以字串比對看不到。

最直覺的修法是把帶連字號的識別字當成無序詞袋來比對。試試看——然後量它的代價。
`open-source` 會變成 `open` + `source`，兩個都是停用詞等級的英文字，
這個原子就完全失去鑑別力了。

這個練習的重點不是那段程式碼。是在手上有數字的情況下，
決定「少一個假陽性」值不值得換來它帶進來的假陰性，然後把這個決定寫在規則旁邊。

---

## 對照原始碼

| 這一課的概念 | 對照 |
|---|---|
| 確定性 rubric、`--save` / `--compare` | 本系列 [Lesson 7](../lesson-07-evaluation/README.zh-TW.md) |
| 證據綁來源 | 本系列 `lesson-24-research-loop/state.ts` 的 `Learning.sources` |
| 長報告怎麼寫又不掉引用 | `gpt-researcher/gpt_researcher/actions/report_generation.py`（309 行） |

> 四個真實專案（deep-research、gpt-researcher、firecrawl、crawl4ai）
> **都沒有引用驗證**。它們產生引用，但沒有任何一個回頭檢查引用是否成立。
> 這不是他們差——是這件事只有領域內的人做得出來，因為只有你知道
> 你的來源長什麼樣、你的使用者在乎哪種錯。

---

## AI Search 篇到這裡

六課下來，從「一個 agent 加一個搜尋工具」走到「一條可以量測的研究管線」：

```text
20  what search returns is a snippet, not a page; the query decides which face you see
21  the body is only half the page; extraction failure is silent
22  BM25 + dense + fusion + dedup + signals; the mean score will lie to you
23  how real projects do it; copying it back exposed a bug latent for three lessons
24  the control flow is taken back from the model; the budget is computed, not discovered by crashing into it
25  citations have to be verified; the evaluation itself can be wrong
```

每一課都有一段實測記錄，而且**每一課的結論都跟開工前的預期不一樣**。
那些差異才是這一篇真正的內容。

---

## 下一課

[Lesson 26: 成本與預算](../lesson-26-cost/README.zh-TW.md)：這六課從來沒有量過錢。
gpt-researcher 把 `cost_callback` 串進**每一個** LLM 呼叫，這裡一個都沒有。

那一課會量到一件反直覺的事：`total` 遠大於 `input + output`，
而中間那段差額不但要付錢，還會吃掉你的 `maxTokens` 額度。
