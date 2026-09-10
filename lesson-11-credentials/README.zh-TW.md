# 第 11 課：agent 手上那張憑證

> [English](README.md)
>
> 先修：[第 09 課](../lesson-09-unattended/)（沒人在場的時候）、
> [第 10 課](../lesson-10-agent-server/)（它為不只一個人跑）、
> [第 31 課](../lesson-31-processors/)（三個邊界、三條 pipeline）。
>
> 來源：`mastra/packages/mcp/src/client/oauth-provider.ts`——`:24` 的
> `OAuthStorage` 介面、`:299` 的 `saveTokens`、`:368` 的 `hasValidTokens`。

第 12 課接上一個別人在跑的工具。遲早那個工具後面會有一張憑證，而這一課談的是那張
憑證本身，不是 OAuth 那套舞步——因為舞步是一份你查得到的協定，而底下這些不是。

```bash
bun run lesson-11                              # offline: three deterministic failures
RUNS=3 PROVIDER=openai bun run lesson-11:agent # real model: what it does about them
```

## Step 1：一個回答不了自己問題的函式

```text
  hasValidTokens()  true
  get()             TokenExpired
```

兩個問的是同一張過期的 token。第一個是 Mastra 的，忠實重建，而它自己的註解解釋了
原因（`oauth-provider.ts:375`）：

> Note: Token expiration checking would require parsing the JWT or tracking when
> we received the token. The MCP SDK handles token refresh automatically when
> needed.

那段註解是誠實的，而它上面那個名字不是。`hasValidTokens()` 檢查的是「有沒有一個
字串」，不是「它能不能用」——而每一層蓋在上面的東西，都繼承了那個名字許下的承諾。

這不是在抱怨 Mastra。它是 `vault.ts` 之所以要存 `expiresAt` 的理由，而來源那個
`set(key, value)` 的儲存介面根本沒有地方放它。

## Step 2：錯誤訊息是一道資料邊界

token 過期的時候，工具得說出來。而它說的話會進到模型的 context——再從那裡進到
trace、進到記憶。

```text
  verbose  LEAKS THE TOKEN
           401 Unauthorized calling GET https://calendar.example/v1/events
           request headers: {"Authorization":"Bearer at_DEMOONLY_user-a_0000000000",...}
           hint: the access token has expired; refresh it and retry

  careful  no credential in the text
           The calendar credential has expired. It is being renewed; retry this tool once.
```

verbose 那個版本不是稻草人。把失敗的 request 印出來，是每一個「貼心的」HTTP client
都會做的事，而 `Authorization` header 是 request 的一部分。

第 31 課正好為三個邊界做了 pipeline——模型、trace、記憶——而這個字串一次跨過三個。
第 31 課那個 redactor 抓得到 `OPENAI_API_KEY=`；它抓不到這個，因為 bearer token
沒有可辨識的前綴。**解法不是在邊界上寫一個更好的正規表達式，而是不要把憑證放進
那個字串裡。**

## Step 3：差一個 map key 就是一道安全邊界

兩個使用者、一個 vault：

```text
  keyed by server        user-a asked, token belonged to user-b
      returned: 10:00 dentist; 13:00 lunch with Sam
  keyed by user+server   user-a asked, token belonged to user-a
      returned: 09:00 standup; 14:00 1:1 with Dana; 16:30 board prep (CONFIDENTIAL)
```

只用 server 當 key，user-a 拿到的是 user-b 的行事曆。**什麼都沒有失敗。** 沒有
錯誤被丟出來、沒有權限檢查被觸發、沒有測試變紅。agent 完全照著被要求的做，然後
回答了另一個人的問題。

Mastra 的儲存是 `set(key, value)`，而 provider 寫進去的字面 key 是 `'tokens'`
（`:300`）。裡面沒有使用者這個維度。就它的設計而言那是對的——一個 provider 實例
就是一個使用者對一個 server 的連線——但那代表隔離完全是呼叫端的責任，而那個介面
永遠不會提醒你。一個被跨使用者共用的 provider **就是**這個 bug。

第 8 課問一個動作准不准。第 19 課問子 agent 看得到什麼。兩個都沒問**這是在花誰的
憑證**，而一個對錯的人的資料說「可以」的權限引擎，比沒有還糟。

## Step 4：兩個以同一個狀態碼抵達的失敗

上游對這兩件事都回 `401`，而它們需要相反的回應：

| 情況 | 誰修得好 |
|---|---|
| 過期，但 refresh token 還good | 機器，一次來回就好 |
| 過期而且沒有 refresh，或被撤銷 | 一個人，加一個瀏覽器 |

`vault.ts` 給它們各自的型別——`TokenExpired` 與 `ReauthRequired`——而工具把第二種
表達成一個**旗標**，不是一句話：

```ts
return { text: "...needs the user to sign in again...", isError: true, needsHuman: true }
```

第 37 課的規則：harness 絕不該為了知道發生什麼事而去解析散文。把這兩件事併成同一個
錯誤，就是 agent 一直重試某個重試永遠修不好的東西的原因。

## Step 5：真模型會對這些做什麼

`gpt-5`，每種組態三次：

| configuration | tool calls | fabricated | misleading | re-auth told |
|---|---|---|---|---|
| expired, no refresh | 6 | 0/3 | 3/3 | 2/3 |
| expired, auto-refresh | 3 | 0/3 | 0/3 | 0/3 |
| revoked, needs a human | 3 | 0/3 | 0/3 | 3/3 |

**「模型會編造」這個假設是錯的，而這件事值得直說。** 這個實驗當初是預期模型會編出
一個聽起來合理的下午行程，而不是承認它讀不到行事曆。它一次都沒有，在任何組態下都
沒有。工具大聲地失敗了，而模型把那個失敗轉述出去。

有意思的是那個沒被計畫到的欄位。第 1 列裡，模型告訴使用者連線「正在更新中」、
「應該很快就會好」——三次裡三次。沒有任何東西在更新它：auto-refresh 是關掉的。那句
話來自工具自己的錯誤字串，而那是這一課寫的：

> The calendar credential has expired. **It is being renewed;** retry this tool once.

那句話在 `autoRefresh` 開著的時候是真的、關著的時候是謊話，而兩種情況回傳的是同一個
字串。沒有人寫那個謊；模型是抄來的。

> **工具的錯誤文字不是給開發者看的註記。它是模型唸給使用者聽的台詞。**

第 3 列是對照組：當錯誤明白說了這件事不能重試，模型就停在一次呼叫，並叫使用者去
登入，三次裡三次。

## Step 6：撤銷，以及那份已經在路上的副本

`revoke()` 把 token 從 vault 拿掉。它沒有從這些地方拿掉：

- 一個已經在路上的 request
- 某個工具剛剛讀出來放著的變數
- 對話紀錄，如果 Step 2 走的是 verbose 那條路
- 一個被交付了它的子 agent（第 19 課）
- 一個下週才會恢復、而且手上還握著它的暫停中的 run（第 33 課）

那裡面只有 vault 是這一課控制得到的。撤銷當成一個**指令**很容易；撤銷當成一個
**保證**，要求的是從來沒有任何東西把憑證從 vault 裡複製出去——而那正是「工具每次
呼叫時去取，而不是在建構時就拿著」的理由，也是 `tool.ts` 的做法。

## 這一課刻意不做的部分

| 不做 | 為什麼 |
|---|---|
| OAuth 2.1 流程本身 | authorization code、PKCE、DCR 是一份你查得到的協定，而 Mastra 在 `oauth-provider.ts` 裡全都實作了 |
| 一個真的 identity provider | 這裡的失敗是生命週期、擁有者、影響範圍，沒有一個需要真的 IdP 才重現得出來 |
| 靜態加密 | 必要，而且它防的是跟上面三個失敗不同的攻擊者 |
| scope 收窄 | 每個工具一個 scope 是真的、也值得做，而它是第 8 課的問題換一套詞彙 |
| 瀏覽器那一趟來回 | 「這需要一個人」已經是第 9 課 inbox 的事；第二套機制不會多教一件事 |

## 契約測試

```bash
bun test tests/credentials.test.ts
```

不需要 API key。它釘住生命週期規則、只用 server 當 key 會把一個人的 token 交給
另一個人、verbose 錯誤帶著憑證而 careful 沒有、`needsHuman` 是一個旗標，以及
——刻意地——`hasValidTokens()` 對一張過期的 token 回傳 `true`，好讓 Step 1 描述的
那個縫不會被安靜補起來、留下一課在描述一件不再發生的事。

## 練習

### 練習 1：在你自己的工具裡找出那個外洩 ⭐

把你的工具錯誤路徑 grep 一遍，找任何會把 request、header map、或一段可重現的
`curl` 內插進去的地方。然後看看你的 trace exporter 拿標記為 `isError` 的工具結果
做了什麼。

### 練習 2：讓那句誤導的話不可能出現 ⭐⭐

Step 5 那個謊來自同一個字串被用在兩種情況。給工具每種情況一句話，然後重跑、檢查
`misleading` 那一欄。接著問更難的問題：如果 loop 裡沒有真模型，你要怎麼發現它？

### 練習 3：讓 token 在計畫中途過期 ⭐⭐

讓 token 在一個多步驟任務的**兩次工具呼叫之間**過期，而不是在第一次之前。agent 會
把已經做完的步驟重做一次嗎？第 33 課那本 journal 就在旁邊。

### 練習 4：撤銷，然後證明它 ⭐⭐⭐

在一個 run 暫停的時候撤銷 token、把它恢復、然後證明恢復之後的 run 動不了。接著把
每一個可能還有副本的地方寫下來——Step 6 那張清單是個起點，不是一份清冊。
