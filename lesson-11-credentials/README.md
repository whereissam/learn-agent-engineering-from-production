# Lesson 11: The Credential the Agent Is Holding

> [繁體中文](README.zh-TW.md)
>
> Prerequisites: [Lesson 09](../lesson-09-unattended/) (nobody is there),
> [Lesson 10](../lesson-10-agent-server/) (it runs for more than one person),
> [Lesson 31](../lesson-31-processors/) (three boundaries, three pipelines).
>
> Source: `mastra/packages/mcp/src/client/oauth-provider.ts` — the `OAuthStorage`
> interface at `:24`, `saveTokens` at `:299`, and `hasValidTokens` at `:368`.

Lesson 12 connects a tool somebody else runs. Sooner or later that tool is behind
a credential, and this lesson is about the credential rather than the OAuth
dance — because the dance is a protocol you can look up, and everything below is
not.

```bash
bun run lesson-11                              # offline: three deterministic failures
RUNS=3 PROVIDER=openai bun run lesson-11:agent # real model: what it does about them
```

## Step 1: a function that cannot answer its own question

```text
  hasValidTokens()  true
  get()             TokenExpired
```

Both asked about the same expired token. The first is Mastra's, reproduced
faithfully, and its own comment explains why (`oauth-provider.ts:375`):

> Note: Token expiration checking would require parsing the JWT or tracking when
> we received the token. The MCP SDK handles token refresh automatically when
> needed.

That comment is honest and the name above it is not. `hasValidTokens()` checks
that a string is present, not that it works — and every layer built on top
inherits the promise the name makes.

This is not a complaint about Mastra. It is the reason `vault.ts` stores
`expiresAt`, which the source's `set(key, value)` storage interface has nowhere
to put.

## Step 2: an error message is a data boundary

When the token has expired, the tool has to say so. What it says goes into the
model's context — and from there into the trace and into memory.

```text
  verbose  LEAKS THE TOKEN
           401 Unauthorized calling GET https://calendar.example/v1/events
           request headers: {"Authorization":"Bearer at_DEMOONLY_user-a_0000000000",...}
           hint: the access token has expired; refresh it and retry

  careful  no credential in the text
           The calendar credential has expired. It is being renewed; retry this tool once.
```

The verbose version is not a straw man. Dumping the failing request is what every
helpful HTTP client does, and an `Authorization` header is part of a request.

Lesson 31 built pipelines for exactly three boundaries — model, trace, memory —
and this string crosses all three in one move. Lesson 31's redactor would catch
`OPENAI_API_KEY=`; it would not catch this, because a bearer token has no
recognisable prefix. **The fix is not a better regex at the boundary, it is not
putting the credential in the string.**

## Step 3: one map key short of a security boundary

Two users, one vault:

```text
  keyed by server        user-a asked, token belonged to user-b
      returned: 10:00 dentist; 13:00 lunch with Sam
  keyed by user+server   user-a asked, token belonged to user-a
      returned: 09:00 standup; 14:00 1:1 with Dana; 16:30 board prep (CONFIDENTIAL)
```

Keyed by server alone, user-a is handed user-b's calendar. **Nothing failed.** No
error was raised, no permission check fired, no test went red. The agent did
exactly what it was asked and answered the wrong person's question.

Mastra's storage is `set(key, value)` and the provider writes to the literal key
`'tokens'` (`:300`). There is no user dimension in it. That is correct for its
design — one provider instance is one user's connection — but it means isolation
is entirely the caller's problem, and the interface will never remind you. A
provider shared across users *is* this bug.

Lesson 8 asks whether an action is allowed. Lesson 19 asks what a subagent gets
to see. Neither asks **whose credential is being spent**, and a permission engine
that says yes to the wrong person's data is worse than none.

## Step 4: two failures that arrive as the same status code

Upstream returns `401` for both of these, and they need opposite responses:

| situation | who can fix it |
|---|---|
| expired, refresh token still good | the machine, in one round trip |
| expired with no refresh, or revoked | a person, with a browser |

`vault.ts` gives them separate types — `TokenExpired` and `ReauthRequired` — and
the tool surfaces the second as a **flag**, not a phrase:

```ts
return { text: "...needs the user to sign in again...", isError: true, needsHuman: true }
```

Lesson 37's rule: the harness must never have to parse prose to learn what
happened. Collapsing the two into one error is how an agent retries something no
retry will fix.

## Step 5: what a real model does about it

`gpt-5`, three runs per configuration:

| configuration | tool calls | fabricated | misleading | re-auth told |
|---|---|---|---|---|
| expired, no refresh | 6 | 0/3 | 3/3 | 2/3 |
| expired, auto-refresh | 3 | 0/3 | 0/3 | 0/3 |
| revoked, needs a human | 3 | 0/3 | 0/3 | 3/3 |

**The fabrication hypothesis was wrong, and that is worth saying plainly.** This
experiment was built expecting the model to invent a plausible afternoon rather
than admit it could not read the calendar. It never did, in any configuration.
The tool failed loudly and the model relayed the failure.

The interesting column is the one that was not planned. In row 1 the model told
the user the connection *"is being renewed"* and *"should refresh shortly"* — 3
runs out of 3. Nothing was renewing it: auto-refresh was off. That sentence came
from the tool's own error string, which this lesson wrote:

> The calendar credential has expired. **It is being renewed;** retry this tool once.

That phrase is true when `autoRefresh` is on and a lie when it is off, and the
same string is returned either way. Nobody wrote the lie; the model copied it.

> **A tool's error text is not a note to the developer. It is the script the
> model reads to the user.**

Row 3 is the control: when the error says plainly that this cannot be retried,
the model stops at one call and tells the user to sign in, 3/3.

## Step 6: revocation, and the copy already in flight

`revoke()` removes the token from the vault. It does not remove it from:

- a request already in flight
- a variable in a tool that read it a moment ago
- the transcript, if Step 2 went the verbose way
- a subagent that was handed it (Lesson 19)
- a suspended run that will resume next week holding it (Lesson 33)

The vault is the only one of those this lesson controls. Revocation as an
*instruction* is easy; revocation as a *guarantee* requires that nothing ever
copied the credential out of the vault — which is the argument for tools
fetching it per call rather than being constructed with it, as `tool.ts` does.

## What this lesson deliberately leaves out

| Left out | Why |
|---|---|
| the OAuth 2.1 flow itself | authorisation code, PKCE and DCR are a protocol you can look up, and Mastra implements all of it in `oauth-provider.ts` |
| a real identity provider | the failures here are lifetime, ownership and blast radius, and none of them needs a real IdP to reproduce |
| encryption at rest | necessary, and it protects a different attacker than the three failures above |
| scope narrowing | a per-tool scope is real and worthwhile, and it is Lesson 8's question in a different vocabulary |
| the browser round trip | Lesson 9's inbox already owns "this needs a human"; a second mechanism would not teach a second thing |

## The contract test

```bash
bun test tests/credentials.test.ts
```

No API key. It pins the lifetime rules, the fact that keying by server alone
hands one user another's token, that the verbose error carries the credential and
the careful one does not, that `needsHuman` is a flag, and — deliberately — that
`hasValidTokens()` returns `true` for an expired token, so the gap Step 1
describes cannot be quietly closed and leave the lesson describing something that
no longer happens.

## Exercises

### Exercise 1: find the leak in your own tools ⭐

Grep your tool error paths for anything that interpolates a request, a header
map, or a `curl` reproduction. Then check what your trace exporter does with a
tool result marked `isError`.

### Exercise 2: make the misleading message impossible ⭐⭐

Step 5's lie came from one string being reused in two situations. Give the tool
one message per situation, then re-run and check the `misleading` column. Then
ask the harder question: how would you have found that without a real model in
the loop?

### Exercise 3: expire the token mid-plan ⭐⭐

Make the token expire *between* two tool calls in a multi-step task rather than
before the first. Does the agent redo the completed steps? Lesson 33's journal is
sitting right there.

### Exercise 4: revoke and prove it ⭐⭐⭐

Revoke a token while a run is suspended, resume it, and prove the resumed run
cannot act. Then write down every place a copy could still be — Step 6's list is
a start, not an inventory.
