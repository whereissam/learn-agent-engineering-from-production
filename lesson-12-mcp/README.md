# Lesson 12: An MCP Client in a Product

> [繁體中文](README.zh-TW.md)
>
> Prerequisites: [Lesson 8](../lesson-08-permissions/) (risk classes),
> [Lesson 2](../lesson-02-tools/) (tools and approval).
>
> Connect tools somebody else wrote. The protocol has three methods; all the
> difficulty is in the fact that somebody else's process is not under your
> control.
>
> Source: `openworker/coworker/mcp/` (5 files, 647 lines),
> `mastra/packages/mcp/src/{client,server}`

## Questions this lesson answers

1. What is the actual difference between an MCP tool and one you wrote?
2. One server in the user's config is broken. Should the agent still start?
3. Why should an MCP tool default to the highest risk class?
4. Why prefix tool names, and what does prefixing break?
5. What happens when you send a model a schema you cannot change?

---

## Step 0: run it first

No API key needed:

```bash
bun run lesson-12
```

```
連線 MCP server
  ✓ fleet  3 個工具
  ✗ ghost  initialize 逾時（5000ms）
  ✗ rubble  MCP server "rubble" 結束了（code 1）
  （5020ms，壞掉的兩台沒有拖垮啟動）

載到的工具
  mcp__fleet__list_robots  [external]  ← fleet/list_robots
  mcp__fleet__get_robot  [external]  ← fleet/get_robot
  mcp__fleet__schedule_maintenance  [external]  ← fleet/schedule_maintenance
```

Two of the three servers are broken, deliberately. Sooner or later a user's
`mcp.json` has a broken entry (a package update, an expired token, a renamed
command), and the agent has to start anyway.

Other things to try:

```bash
PROVIDER=gemini bun run lesson-12   # 真模型
MODE=auto bun run lesson-12         # AUTO 模式下 MCP 工具還會不會被問
COLLIDE=1 bun run lesson-12         # 名稱截斷造成的碰撞（Step 4）
TODAY=1 PROVIDER=gemini bun run lesson-12  # Step 6 的對照組
```

---

## Step 1: the protocol is small enough to write yourself

`server.ts` is a real MCP server: zero dependencies, under 200 lines. The whole
protocol is three methods:

```
initialize     握手，交換版本與能力
tools/list     你有哪些工具
tools/call     跑一個
```

Messages are newline-delimited JSON-RPC 2.0 over stdin/stdout.

> Which means a server must never `console.log`. That writes non-JSON into the
> protocol channel and the client sees a stream of parse failures. It is the
> first trap of writing an MCP server, so every debug output in this lesson
> goes to stderr.

There is one more easily confused point, marked in `server.ts`:

```ts
// 工具的錯誤是 `isError: true` 的正常回應，不是 JSON-RPC error。
reply(id, { content: [{ type: "text", text }], isError });
```

A protocol-level error (no such method) and a tool-level error (robot not
found) are different things. Conflate them and the agent cannot tell "retry"
from "try something else".

---

## Step 2: the difference is trust, not protocol

| | Your own tool (Lesson 2) | An MCP tool |
|---|---|---|
| where it runs | your process | **somebody else's process** |
| who wrote it | you | somebody else |
| how it breaks | throws an error you recognise | timeout, silence, a vanished process |
| who wrote the description | you | **somebody else**, and you cannot change it |
| who wrote the schema | you | **somebody else**, and you cannot change it |

So half of `client.ts` handles misbehaviour: timeouts, waking every pending
request when the process dies, collecting stderr.

### Timeouts: the opposite of Lesson 9

Lesson 9's inbox `wait()` deliberately has no timeout, and here one is
mandatory. The test is the same:

> After this times out, is there a safe default action?
>
> - the inbox waits on a human decision, and neither allowing nor refusing on
>   expiry is safe → no timeout
> - MCP waits on a tool result, and on expiry you call it failed → timeout

---

## Step 3: one broken server must not take the others down

```
✗ ghost   initialize 逾時（5000ms）    ← 接受連線但永遠不回握手
✗ rubble  結束了（code 1）             ← 啟動就掛
（5020ms）
```

`ghost` is the hard one: no error, only silence. Without a timeout the agent
never starts.

Note the total is 5020ms, not the sum of two timeouts, because connections are
parallel:

```ts
const results = await Promise.allSettled(SERVERS.map(...));
```

Connect serially and startup becomes the sum of every broken server's timeout.
Three broken servers is 15 seconds, and the user assumes the program hung.

---

## Step 4: names need prefixes, and prefixes bite

The model sees tool names as `mcp__<server>__<tool>`, sanitised to OpenAI's
rule `[A-Za-z0-9_-]{1,64}` (compare `tool_name` in `tools.py`).

The prefix is necessary: when two servers both have `search`, the model has to
tell them apart.

But the 64-character limit causes collisions:

```bash
COLLIDE=1 bun run lesson-12
```

```
✓ acme-internal-platform-tools-production-cluster  5 個工具
  ⚠ 名稱碰撞 mcp__acme-internal-platform-tools-production-cluster__create_inc
    …/create_incident_report 會被 …/create_incident_summary 蓋掉

載到的工具
  …__list_robot
  …__get_robot
  …__schedule_m
  …__create_inc        ← 5 個工具只活下來 4 個
```

The server name is 47 characters, and `mcp__` plus `__` takes it to 54, leaving
a budget of 10 characters for the tool name. So `create_incident_report` and
`create_incident_summary` truncate to the same name and the second silently
overwrites the first.

> Two tools sharing a prefix on the same server is the collision shape you are
> most likely to hit, far more common than two servers having a tool with the
> same name, because tools on one server routinely share a verb prefix
> (`create_`, `list_`, `get_`).

`openworker` does not detect collisions (`tools.py:33` truncates directly). We
added a warning, because silently losing a tool is the hardest kind of bug to
trace: the model says it has no tool for producing a full report, and your
config plainly lists one.

---

## Step 5: MCP tools default to EXTERNAL

```
mcp__fleet__list_robots  [external]
```

`list_robots` sounds entirely harmless. Why the highest risk?

> Because that name and that description were both written by somebody else.
> "List robots in the fleet" does not mean it only does that.

In code it is one line, reaching back to Lesson 8's `risk.ts:128`:

```ts
const metadata: ToolRiskMetadata = { requiresApproval: true, category: "mcp" };
// classify() 看到 requiresApproval → RiskClass.EXTERNAL
```

`category: "mcp"` matters too: as Lesson 8 Step 5 covered, connector-class
tools cannot be unlocked wholesale with "always allow this tool".

Users can of course relax individual entries (`riskOverrides`, "I trust this
server"), but the default has to be conservative, because a default is for
people who have not read that server's source.

---

## Step 6: the schema you cannot change

`schedule_maintenance`'s schema is deliberately awkward, and it is legal:

```json
{
  "window": { "oneOf": [ { "type": "string" }, { "type": "object", ... } ] },
  "notes":  { "type": ["string", "null"] }
}
```

The point is not that it is awkward, it is that you did not write it. The MCP
server belongs to somebody else and you take what you are given. `openworker`
passes it through untouched (`tools.py:_openai_schema`, whose comment says "for
fidelity"), and so do we.

### Measured: Gemini handles it

Real Gemini 3.6 Flash, three runs, and all three correctly chose the object
branch of the `oneOf` and correctly filled in the `notes` string:

```json
{"robot_id":"R-204","window":{"start":"2026-08-01T02:00:00Z","hours":3},"notes":"更換電池"}
```

So the worry that a provider cannot digest an MCP schema did not materialise,
at least for Gemini. But that is exactly where Lesson 30 starts: one vendor
coping does not mean all of them do, and you cannot change that schema, only
add a compatibility layer on your side.

### The measurement caught something else, and worse

Across the same three runs, the date the model filled in was 2024-08-01 every
time. Today is 2026-07-28, and the user's "8/1" meant 2026-08-01.

```
┌ 需要批准
│ fleet/schedule_maintenance
│ {"robot_id":"R-204","window":{"start":"2024-08-01T02:00:00","hours":3},…}
│ 這個操作的副作用會跑到這台機器外面，收不回來
└
  （ANSWER=y，自動回答）
  ✓ Maintenance scheduled for R-204. On-site team notified.
```

The permission engine did everything right: correct class, intercepted, and the
arguments printed in the approval box. Then y was pressed, and a wrong date
entered an irreversible external operation.

> The approval box displayed it. That does not mean anybody read it.
> Lesson 8 solved "should we ask"; this is "did anybody actually look after we
> asked", and the permission engine cannot solve the second.

### Cause and fix

The model's system prompt does not contain today's date, so it can only fall
back on its training prior.

```bash
TODAY=1 PROVIDER=gemini bun run lesson-12
```

```
{"robot_id":"R-204","window":{"start":"2026-08-01T02:00:00Z","hours":3},…}
```

Fixed 3/3. In code it is one line:

```ts
(TODAY ? `\n\nToday's date is ${new Date().toISOString().slice(0, 10)}.` : "")
```

> Any tool that takes a date argument requires today's date in the system
> prompt.
>
> That rule matters especially in the MCP lesson, because MCP tool arguments are
> defined by somebody else, and you do not know whether a server takes dates
> unless you read its schema.

---

## What this lesson deliberately skips

| Skipped | Why |
|---|---|
| HTTP / SSE transport | stdio already covers the protocol; changing transport is a transport problem |
| OAuth (`oauth.py`, 240 lines) | see "the OAuth half-lesson" below |
| resources and prompts | MCP has these two as well, but agents mostly use tools |
| dynamic tool reloading | a server can announce that its tools changed. Adding it doubles the lesson |

### The OAuth half-lesson

`openworker/coworker/mcp/oauth.py` (240 lines) handles OAuth 2.1 plus PKCE plus
dynamic client registration for remote MCP servers. Not implemented here, but
three of its conclusions are worth copying directly:

1. Tokens do not go in the config file. `mcp.json` is plain text and users
   paste it to each other. Tokens live in a SecretStore with mode 0600, under
   the profile `mcp-oauth:<server>`.
2. A background context must not open a browser. It has an
   `InteractiveAuthRequired` exception, and the comment records a real
   incident:

   > owner-hit 2026-07-20: an authorize page opened at app launch

   The cause was a vendor invalidating refresh tokens, so every code path that
   touched that server tried to open an authorization page, including tool
   enumeration at startup. Only an explicit user click may go interactive;
   everything else raises and skips that server.
3. The exception arrives wrapped in an ExceptionGroup. The SDK's transport runs
   in an anyio task group, so the check has to recurse (`is_auth_required`); a
   plain `isinstance` misses it.

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| Every server times out | is `process.execPath` not bun? This lesson uses it to spawn itself |
| Constant `bad JSON` | there is a `console.log` in your server. Use `process.stderr.write` |
| Startup takes 15 seconds | connections became serial. Use `Promise.allSettled` |
| One tool fewer than expected | see Step 4's name collision |
| The model says it cannot find a tool | truncation changed the name from what your config says |

---

## Exercises

### Exercise 1: drop `ghost`'s timeout to 500ms ⭐

`MCP_CONNECT_TIMEOUT_MS=500 bun run lesson-12`.

Startup gets faster, but ask yourself: can you tell a genuinely slow server
from a broken one? What should that timeout be?

### Exercise 2: fix the name collision ⭐⭐

Today there is only a warning. Actually solve it: fall back to a hash suffix on
collision (`mcp__acme__create_inc_a1b2`) and keep a map from the name the model
sees to the real tool.

Doing it reveals something: that map has to be stored with the session
(Lesson 4), or tool calls in old conversations stop resolving after a restart.

### Exercise 3: make `FAIL_MODE=slow` run ⭐⭐

`tools/call` stalls for 30 seconds against a 10-second call timeout.

Watch what the agent does after the timeout, then consider: that server is
still running the tool. If it were `schedule_maintenance`, you may have just
booked a maintenance window while telling the model it failed. There is no good
answer here; understanding the problem is the value.

### Exercise 4: add include/exclude ⭐

`client.ts` already supports it and `agent.ts` does not use it. Give `fleet`
`includeTools: ["list_robots", "get_robot"]` and watch
`schedule_maintenance` disappear.

Then do the arithmetic: a server offering 40 tools when you need 2 means you pay
the indexing cost of the other 38 on every single turn (Lesson 16 Step 1).

### Exercise 5: wire MCP tools into Lesson 9's inbox ⭐⭐⭐

Approval currently asks the terminal. Make it unattended: an MCP tool needing
approval goes to the inbox.

This forces a new problem: an MCP connection is a live process. After eight
hours of waiting, is that server still alive? Should you reconnect? Is the tool
call id still valid afterwards?

---

## Compared with the sources

`openworker/coworker/mcp/` totals 647 lines (`__init__` 29, `client` 158,
`config` 129, `oauth` 240, `tools` 91). Line counts verified.

| Concept in this lesson | OpenWorker | Mastra |
|---|---|---|
| connection and lifecycle | `client.py` `MCPManager._serve` | `packages/mcp/src/client/client.ts` |
| one task per server, enter and exit in the same task | `client.py:87` (an anyio cancel-scope constraint) | |
| flattening tool results | `client.py` `_result_payload` | |
| `mcp__<server>__<tool>` and the 64-character limit | `tools.py:33` `tool_name` | |
| passing the schema through untouched | `tools.py` `_openai_schema` ("for fidelity") | `packages/schema-compat/` (**where it is actually fixed**) |
| include / exclude | `tools.py` `_filtered` | |
| MCP tool means approval required | `tools.py` `ToolMetadata(requires_approval=…)` | |
| the config file (paste-compatible with Claude Desktop) | `config.py` `load_mcp_servers` | `client/configuration.ts` |
| OAuth plus PKCE plus DCR | `oauth.py` | `client/oauth-provider.ts` |
| no browser in a background context | `oauth.py` `InteractiveAuthRequired` | |

> Two implementations corroborating each other is useful: OpenWorker is Python,
> Mastra is TypeScript, and the shape is nearly identical. That shape is MCP
> itself, not one person's taste.

---

## Next lesson

[Lesson 30: one schema, different outcomes per model](../lesson-30-schema-compat/)

Step 6 already laid out the problem: the schema an MCP server hands you is not
yours to edit. Gemini digested it this time, but `oneOf` and `["string","null"]`
do not necessarily pass elsewhere. That lesson builds a compatibility layer and
pins it down with a contract test that runs against every provider.
