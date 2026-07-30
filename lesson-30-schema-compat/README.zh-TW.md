# Lesson 30: 同一個 schema，不同模型不同下場

> [English](README.md)
>
> Mastra 篇第一課。前置：[Lesson 12](../lesson-12-mcp/README.zh-TW.md)（MCP）。
>
> Lesson 12 留下一個沒解的問題：MCP server 給你的 tool schema，你不能改。
> 這一課量出它會出什麼事，然後做一層相容。
>
> 對照原始碼：`mastra/packages/schema-compat/src/provider-compats/`

## 這課要回答的問題

1. 同一份 schema 送給不同 provider，真的會有差嗎？
2. 「API 拒絕」跟「API 收下但模型不照做」哪個比較可怕？
3. 約束修不了的時候怎麼辦？
4. 這種相容表要怎麼維護才不會腐爛？

---

## Step 0：先量，不要先猜

```bash
PROVIDER=gemini bun run lesson-30:probe
PROVIDER=openai bun run lesson-30:probe
```

需要金鑰，因為要量的就是真 provider 的行為。

六個基本構造（`["string","null"]`、`oneOf`、`minLength/maxLength`、
`minimum/maximum`、`enum`、巢狀選填），**兩家 provider 全過**：

```
Schema 相容性探針  gemini / gemini-3.6-flash
  ✓ nullable   type: ["string", "null"]    {"note":null}
  ✓ union      oneOf                       {"window":{"start":"2026-08-01T02:00:00Z","hours":3}}
  ✓ strlen     minLength / maxLength       {"code":"INC84920"}
  ✓ numrange   minimum / maximum           {"severity":5}
  ✓ enum       enum                        {"status":"closed"}
  ✓ nested     巢狀物件 + 選填欄位            {"incident":{"id":"INC-9","robot":{"id":"R-204"}}}
```

### 差點寫成「所以沒問題」

第一版就到這裡。六題兩家全過，看起來可以下結論「現在的模型都很好，
相容層是舊時代的產物」。

那個結論會是錯的，而且錯的原因跟 Lesson 16 一模一樣：題目太簡單。

> 一個測不出差異的測試不是「證明沒問題」，是「你還沒找到邊界」。

所以往上加難度。

---

## Step 1：邊界在這裡

```bash
TIER=hard PROVIDER=gemini bun run lesson-30:probe
TIER=hard PROVIDER=openai bun run lesson-30:probe
```

| 構造 | Gemini 3.6 Flash | GPT-5 |
|---|---|---|
| `pattern`（正規表示式） | ✓ | ✓ |
| `maxLength` 跟自然答案衝突 | ✓ | ✓ |
| `multipleOf` | **安靜地違反** | ✓ |
| `items: [A,B,C]`（tuple） | ✗ **API 400** | ✓ |
| 120 個值的 `enum` | ✓ | ✓ |
| `$ref` / `$defs`（遞迴） | ✓ | ✓ |

同一份 schema，同一句話，兩家的下場不一樣。這就是這一課存在的理由。

---

## Step 2：兩種失敗，不要混為一談

```
✗ tuple       400 status code (no body)
⚠ multipleof  應為 15 的倍數，拿到 70
```

這兩行看起來都是「壞了」，但它們是完全不同的東西：

| | API 拒絕 | 模型不照做 |
|---|---|---|
| 你怎麼知道 | 400，程式直接爆 | **不會知道** |
| 什麼時候發現 | 第一次跑就發現 | 資料髒掉之後 |
| 修法 | 改寫成它吃得下的形式 | **把約束講給模型聽** |

> 吵的失敗是禮物。 400 會逼你當場處理。
> `multipleOf: 15` 拿到 70 才是真正的問題：API 收下了、模型回了、
> 工具跑了、資料進去了，**沒有任何一層報錯**。

而且它很穩定地錯。跑五次：

```
compat=off  70  70  70  70  70
```

不是偶爾失手，是**它根本沒把那個約束當一回事**。

---

## Step 3：相容層

`compat.ts` 只做兩件事，對應上面兩種失敗：

```ts
if (key === "items" && Array.isArray(value) && !target.tupleItems) {
  // 結構改寫：tuple → anyOf + 長度限制
  out.items = { anyOf: value.map(...) };
  notes.push(`${path} is a fixed-length tuple: [...]`);
}

if (!target.enforcesNumeric) collect(out, NUMERIC_KEYS, notes, path);
// 約束搬家：留在 schema 裡，同時寫進 notes
```

然後 `notes` 接到工具描述後面：

```
Record an incident.

Constraints you must follow exactly:
- downtime_minutes must satisfy multipleOf=15, minimum=15, maximum=480
```

這正是 mastra 的做法。它的 `google.ts` 有一句註解把理由講完了：

> Google models support these properties but the model doesn't respect
> them, but it respects them when they're added to the tool description

### 結果

```bash
TIER=hard COMPAT=1 PROVIDER=gemini bun run lesson-30:probe
```

```
compat=off  70  70  70  70  70      ← 五次全違反
compat=on   75  75  75  75  75      ← 五次全正確
```

`tuple` 那題也從 400 變成通過。

### 兩個容易做錯的細節

一、約束搬進 description 之後，schema 裡要留著。

```ts
// 契約測試裡有這一條
test("約束搬走之後仍然留在 schema 裡", ...)
```

搬進描述是「多講一次」，不是「改成用講的」。拿掉的話，
本來會遵守的 provider 也失去它了。

二、不要就地改寫輸入。

這一課的整個主題是「別人的 schema 不是你的」。
一個安靜地改掉呼叫端資料的函式，是下一個難查的 bug。
契約測試也有這一條。

---

## Step 4：這張表會過期，而重點就在這裡

```ts
export const TARGETS: Record<string, CompatTarget> = {
  gemini: { tupleItems: false, enforcesNumeric: false, enforcesString: true },
  openai: { tupleItems: true,  enforcesNumeric: true,  enforcesString: true },
  unknown:{ tupleItems: false, enforcesNumeric: false, enforcesString: false },
};
```

這是 2026-07 對 `gemini-3.6-flash` 和 `gpt-5` 量出來的。
模型改版就可能變。

> 能重跑的量測才是資產，抄來的常數不是。
>
> 這條在這個系列已經出現三次了：
> Lesson 22 憑印象猜去重門檻 0.5（實際 0.17）、
> Lesson 27 抄 gpt-researcher 的相關性門檻（對這裡的 embedding 沒用）、
> 現在是這張表。三次都是同一種錯：把別人量出來的數字當成通則。

所以真正該進版控的是 `probe.ts`，不是那張表。表是量測的**輸出**。

### `unknown` 為什麼全部是 false

沒量過的 provider 一律當成「什麼都不支援、什麼都不遵守」。

保守的預設會讓 schema 被過度改寫、描述變囉嗦，但那只是浪費一點 token。
反過來（樂觀預設）的代價是資料髒掉，而且你不會知道。

**這跟 Lesson 12 把所有 MCP 工具預設成 EXTERNAL 是同一條原則：
預設值是給還沒量過的人用的。**

---

## Step 5：契約測試

`tests/schema-compat.test.ts`，跟 `provider-contract.test.ts` 一樣分兩半：

```
不需要金鑰   相容層的結構改寫是純函式，可以完整測（CI 跑這半）
需要金鑰     provider 到底吃不吃，只有真的打才知道（lesson-30:probe）
```

> CI 擋的是「相容層自己壞掉」，不是「provider 又改了」。
> 後者擋不住，只能定期重量。分清楚這兩件事，才不會寫出一個
> 假裝在防守、實際上什麼都沒防到的測試。

mastra 那邊對應的是 `provider-compats/test-suite.ts`，
一份共用的斷言跑遍所有 provider 的相容層。

---

## 這課刻意不做的事

| 沒做 | 為什麼 |
|---|---|
| Zod → JSON Schema | mastra 有一整包（`zod-to-json`、v3/v4 兩套）。那是型別工程，不是 provider 差異 |
| Anthropic 的實測 | 手上沒有金鑰。表裡沒有它，就會落到 `unknown`（保守），**這正是預設值該有的行為** |
| 每個 provider 一個 class | mastra 那樣分是因為它要處理十幾個。三個的時候一張表更好讀 |
| structured output | 那是另一個 API 面，不是 tool schema |

---

## 跑不起來？

| 症狀 | 原因 |
|---|---|
| `這支程式要量的就是真 provider 的行為` | 沒設 `PROVIDER`。這一課的探針一定要金鑰 |
| 全部 `－ 模型沒有呼叫工具` | prompt 沒有逼它用工具，或模型當天心情不同。重跑 |
| `400 status code (no body)` | 這是**預期結果**之一，看 Step 1 那張表 |
| 結果跟 README 不一樣 | 很正常，模型會改版。**那正是 Step 4 的重點** |

---

## 練習

### 練習 1：加一個 provider ⭐

有 Anthropic 金鑰的話，跑 `PROVIDER=anthropic bun run lesson-30:probe --`
（`TIER=hard`），把結果填進 `TARGETS`。

填之前先想：如果它某一題時好時壞，那一格該填 true 還是 false？

### 練習 2：找出下一個邊界 ⭐⭐

Step 1 那六題只有兩題會壞。加更硬的：`allOf`、`not`、
`patternProperties`、`additionalProperties: false`、
`dependentRequired`、10 層深的巢狀。

記得 Step 0 的教訓：測不出差異的時候，先懷疑題目太簡單。

### 練習 3：把相容層接進 Lesson 12 ⭐⭐

MCP 工具的 schema 是別人的。在 `agent.ts` 把
`parameters: tool.inputSchema` 換成走 `compatSchema`。

做完之後跑 `COLLIDE=1`，你會發現一件事：
**描述變長了，而索引成本是每一輪都要付的**（Lesson 16 Step 1）。
約束搬進描述不是免費的。

### 練習 4：讓 notes 只搬「真的會被違反」的約束 ⭐⭐⭐

現在只要 target 說「不遵守」，所有數值約束一律搬。
但實測裡 `minimum`/`maximum` 是被遵守的（severity 那題），
只有 `multipleOf` 沒有。

改成逐個約束量測、逐個決定。做完會發現這張表要變成二維的
（provider × 約束種類），而**維護成本也跟著平方成長**，
所以要想清楚哪些格子值得量。

---

## 對照原始碼

| 這課的概念 | Mastra |
|---|---|
| 每個 provider 一份相容層 | `packages/schema-compat/src/provider-compats/{openai,anthropic,google,deepseek,meta,openai-reasoning}.ts` |
| 「模型不遵守就搬進 description」 | `google.ts` 的 `defaultZodStringHandler` / `defaultZodNumberHandler` |
| Google 不支援 `null` 的處理 | `google.ts:213` |
| haiku 不遵守 string 長度 | `anthropic.ts:49` |
| `optional` 逐型別列白名單 | `anthropic.ts:38`、`google.ts:200` |
| 跑遍所有 provider 的契約測試 | `provider-compats/test-suite.ts` |

> mastra 的 `provider-compats` 有六個檔案，每個都在處理
> 「這家吃得下什麼、這家會遵守什麼」。**那六個檔案的存在本身就是證據**：
> 這件事沒有通則，只能一家一家量。

---

## 下一課

**概念上的下一課**是 [Lesson 31: 把 runTurn 裡的 if 搬到外面](../lesson-31-processors/README.zh-TW.md)。
這一課的相容層其實已經是一個 processor 了：它在請求送出**之前**改寫請求。
Lesson 31 會把這個位置變成一個正式的擴充點。
