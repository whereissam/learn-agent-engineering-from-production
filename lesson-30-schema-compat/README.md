# Lesson 30: One Schema, Different Fates on Different Models

> [繁體中文](README.zh-TW.md)
>
> First lesson of the Mastra part. Prerequisite: [Lesson 12](../lesson-12-mcp/)
> (MCP).
>
> Lesson 12 left one problem unsolved: the tool schema an MCP server hands you is
> not yours to change. This lesson measures what that causes, then builds a
> compatibility layer.
>
> Source: `mastra/packages/schema-compat/src/provider-compats/`

## Questions this lesson answers

1. Does sending the same schema to different providers really differ?
2. Which is worse, "the API rejects it" or "the API accepts it and the model
   ignores it"?
3. What do you do when a constraint cannot be fixed?
4. How is a compatibility table maintained without rotting?

---

## Step 0: measure first, do not guess

```bash
PROVIDER=gemini bun run lesson-30:probe
PROVIDER=openai bun run lesson-30:probe
```

A key is required, because what is being measured is a real provider's behaviour.

Six basic constructs (`["string","null"]`, `oneOf`, `minLength/maxLength`,
`minimum/maximum`, `enum`, nested optionals), and **both providers pass all of
them**:

```
Schema 相容性探針  gemini / gemini-3.6-flash
  ✓ nullable   type: ["string", "null"]    {"note":null}
  ✓ union      oneOf                       {"window":{"start":"2026-08-01T02:00:00Z","hours":3}}
  ✓ strlen     minLength / maxLength       {"code":"INC84920"}
  ✓ numrange   minimum / maximum           {"severity":5}
  ✓ enum       enum                        {"status":"closed"}
  ✓ nested     巢狀物件 + 選填欄位            {"incident":{"id":"INC-9","robot":{"id":"R-204"}}}
```

### This nearly became "so there is no problem"

The first version stopped here. Six cases, both providers passing, and the
conclusion writes itself: "modern models are fine, compatibility layers are a
relic".

That conclusion would be wrong, for exactly the reason Lesson 16 was: the task was
too easy.

> A test that cannot detect a difference does not "prove there is no problem"; it
> means you have not found the boundary yet.

So the difficulty went up.

---

## Step 1: the boundary is here

```bash
TIER=hard PROVIDER=gemini bun run lesson-30:probe
TIER=hard PROVIDER=openai bun run lesson-30:probe
```

| Construct | Gemini 3.6 Flash | GPT-5 |
|---|---|---|
| `pattern` (regular expression) | ✓ | ✓ |
| `maxLength` conflicting with the natural answer | ✓ | ✓ |
| `multipleOf` | **silently violated** | ✓ |
| `items: [A,B,C]` (tuple) | ✗ **API 400** | ✓ |
| an `enum` with 120 values | ✓ | ✓ |
| `$ref` / `$defs` (recursive) | ✓ | ✓ |

The same schema and the same sentence, with different fates on each. That is why
this lesson exists.

---

## Step 2: two kinds of failure, not to be conflated

```
✗ tuple       400 status code (no body)
⚠ multipleof  應為 15 的倍數，拿到 70
```

Both lines look like "broken", and they are completely different things:

| | The API rejects it | The model ignores it |
|---|---|---|
| how you find out | a 400; the program blows up | **you do not** |
| when you find out | on the first run | after the data is dirty |
| the fix | rewrite it into a form it accepts | **state the constraint to the model** |

> A loud failure is a gift. A 400 forces you to deal with it on the spot.
> `multipleOf: 15` receiving 70 is the real problem: the API accepted it, the model
> answered, the tool ran, the data went in, and **not one layer complained**.

And it fails very consistently. Five runs:

```
compat=off  70  70  70  70  70
```

Not an occasional slip: **it simply does not treat that constraint as real**.

---

## Step 3: the compatibility layer

`compat.ts` does only two things, matching the two failures above:

```ts
if (key === "items" && Array.isArray(value) && !target.tupleItems) {
  // 結構改寫：tuple → anyOf + 長度限制
  out.items = { anyOf: value.map(...) };
  notes.push(`${path} is a fixed-length tuple: [...]`);
}

if (!target.enforcesNumeric) collect(out, NUMERIC_KEYS, notes, path);
// 約束搬家：留在 schema 裡，同時寫進 notes
```

Then `notes` is appended to the tool description:

```
Record an incident.

Constraints you must follow exactly:
- downtime_minutes must satisfy multipleOf=15, minimum=15, maximum=480
```

This is exactly mastra's approach. A comment in its `google.ts` states the whole
reason:

> Google models support these properties but the model doesn't respect
> them, but it respects them when they're added to the tool description

### The result

```bash
TIER=hard COMPAT=1 PROVIDER=gemini bun run lesson-30:probe
```

```
compat=off  70  70  70  70  70      ← 五次全違反
compat=on   75  75  75  75  75      ← 五次全正確
```

The `tuple` case also goes from a 400 to a pass.

### Two details that are easy to get wrong

First, once a constraint moves into the description, it must stay in the schema.

```ts
// 契約測試裡有這一條
test("約束搬走之後仍然留在 schema 裡", ...)
```

Moving it into the description is "saying it twice", not "switching to saying it".
Remove it and providers that would have honoured it lose it too.

Second, do not rewrite the input in place.

This lesson's entire theme is "somebody else's schema is not yours". A function
that silently mutates the caller's data is the next hard-to-find bug. The contract
test covers this too.

---

## Step 4: this table will go stale, and that is the point

```ts
export const TARGETS: Record<string, CompatTarget> = {
  gemini: { tupleItems: false, enforcesNumeric: false, enforcesString: true },
  openai: { tupleItems: true,  enforcesNumeric: true,  enforcesString: true },
  unknown:{ tupleItems: false, enforcesNumeric: false, enforcesString: false },
};
```

This was measured in 2026-07 against `gemini-3.6-flash` and `gpt-5`. A model
revision can change it.

> A measurement you can re-run is an asset; a constant you copied is not.
>
> This has now appeared three times in the series:
> Lesson 22 guessing a dedup threshold of 0.5 from intuition (0.17 in reality),
> Lesson 27 copying gpt-researcher's relevance threshold (useless for these
> embeddings), and now this table. All three are the same error: treating somebody
> else's measurement as a general rule.

So the thing that belongs in version control is `probe.ts`, not that table. The
table is the measurement's **output**.

### Why `unknown` is false everywhere

An unmeasured provider is assumed to support nothing and honour nothing.

A conservative default over-rewrites schemas and makes descriptions verbose, but
that only wastes a few tokens. The optimistic default's cost is dirty data, and you
will not know.

**Same principle as Lesson 12 defaulting every MCP tool to EXTERNAL: defaults are
for people who have not measured yet.**

---

## Step 5: the contract test

`tests/schema-compat.test.ts`, split in two like
`provider-contract.test.ts`:

```
不需要金鑰   相容層的結構改寫是純函式，可以完整測（CI 跑這半）
需要金鑰     provider 到底吃不吃，只有真的打才知道（lesson-30:probe）
```

> CI guards against "the compatibility layer broke", not "the provider changed
> again". The latter cannot be guarded, only re-measured periodically. Keeping the
> two straight is what stops you writing a test that pretends to defend while
> defending nothing.

The counterpart in mastra is `provider-compats/test-suite.ts`, one shared set of
assertions run across every provider's compatibility layer.

---

## What this lesson deliberately leaves out

| Left out | Why |
|---|---|
| Zod → JSON Schema | mastra has a whole package for it (`zod-to-json`, v3 and v4). That is type engineering, not provider difference |
| measuring Anthropic | no key at hand. Absent from the table it falls to `unknown` (conservative), **which is exactly what a default should do** |
| one class per provider | mastra splits that way because it handles more than a dozen. With three, one table reads better |
| structured output | a different API surface, not tool schema |

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| `這支程式要量的就是真 provider 的行為` | `PROVIDER` is unset. This lesson's probe requires a key |
| everything says `－ 模型沒有呼叫工具` | the prompt did not force tool use, or the model is in a different mood today. Re-run |
| `400 status code (no body)` | one of the **expected results**; see the table in Step 1 |
| the results differ from the README | entirely normal, models get revised. **That is precisely Step 4's point** |

---

## Exercises

### Exercise 1: add a provider ⭐

With an Anthropic key, run `PROVIDER=anthropic bun run lesson-30:probe --` (with
`TIER=hard`) and fill the results into `TARGETS`.

Before filling it in, think: if one case passes sometimes and fails other times,
does that cell get true or false?

### Exercise 2: find the next boundary ⭐⭐

Only two of Step 1's six cases break. Add harder ones: `allOf`, `not`,
`patternProperties`, `additionalProperties: false`, `dependentRequired`, nesting 10
levels deep.

Remember Step 0's lesson: when you cannot detect a difference, first suspect the
task is too easy.

### Exercise 3: wire the compatibility layer into Lesson 12 ⭐⭐

An MCP tool's schema is somebody else's. In `agent.ts`, route
`parameters: tool.inputSchema` through `compatSchema`.

Then run `COLLIDE=1` and you will discover something: **the descriptions got
longer, and indexing cost is paid every turn** (Lesson 16 Step 1). Moving
constraints into descriptions is not free.

### Exercise 4: make notes carry only constraints that really get violated ⭐⭐⭐

Right now, if the target says "does not honour", every numeric constraint moves.
But in the measurements `minimum`/`maximum` are honoured (the severity case) and
only `multipleOf` is not.

Change it to measure and decide per constraint. Doing so turns the table
two-dimensional (provider × constraint kind), and **maintenance cost grows
quadratically with it**, so think about which cells are worth measuring.

---

## Compared with the source

| Concept in this lesson | Mastra |
|---|---|
| one compatibility layer per provider | `packages/schema-compat/src/provider-compats/{openai,anthropic,google,deepseek,meta,openai-reasoning}.ts` |
| "if the model does not honour it, move it into the description" | `defaultZodStringHandler` / `defaultZodNumberHandler` in `google.ts` |
| handling Google's lack of `null` support | `google.ts:213` |
| haiku not honouring string length | `anthropic.ts:49` |
| `optional` allowlisted per type | `anthropic.ts:38`, `google.ts:200` |
| a contract test run across every provider | `provider-compats/test-suite.ts` |

> mastra's `provider-compats` has six files, each handling "what this vendor
> accepts and what this vendor honours". **The existence of those six files is
> itself the evidence**: there is no general rule here, only measuring one vendor at
> a time.

---

## Next lesson

**Conceptually the next lesson** is
[Lesson 31: moving the ifs out of runTurn](../lesson-31-processors/). This lesson's
compatibility layer is already a processor: it rewrites the request **before** it
is sent. Lesson 31 turns that position into a formal extension point.
