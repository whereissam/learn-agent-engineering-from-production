# Lesson 5: Context Compaction

> [繁體中文](README.zh-TW.md)
>
> Prerequisites: [Lesson 4](../lesson-04-sessions/). The last lesson about the
> engine itself (1-5).
>
> Goal: let the agent keep talking without blowing up because the conversation
> got long.

## Questions this lesson answers

1. Why does a longer conversation cost more, and how much more?
2. When should you compact, and how far?
3. What should a summary keep, and what should it drop?
4. After compacting, should the original messages be deleted? (The answer to
   Lesson 4's exercise 6.)

---

## Step 0: run it first

```bash
bun run lesson-05
```

```
> read the playground's README, every file under docs and every file under
  src, then list what each module is responsible for
```

Real output, Gemini 3.6 Flash, default threshold 8000:

```
  [compacting… about 8417 tokens right now]
  [compacted 43 messages: 8417 → 406 tokens, 95% saved]

  [compacting… about 15638 tokens right now]
  [compacted 46 messages: 15638 → 7351 tokens, 53% saved]

> /tokens
  55 messages, about 16290 tokens
  compaction threshold 8000 (currently 204%)
```

One ordinary investigation triggered compaction twice, and the two runs saved
very different fractions (95% versus 53%). That difference is itself a lesson;
Step 4 covers it.

> This playground is deliberately much larger than the ones in Lessons 1-4
> (14 files, roughly 26KB), because a small project cannot demonstrate the
> problem. The earlier playgrounds hold 3 files, about 800 tokens read
> end to end, so you would have to drop the threshold to 300 to see compaction
> at all, and then what you are watching is a tuned-down parameter rather than
> a genuinely full context.

To see it without an API key, use the fake provider and a low threshold:

```bash
COMPACT_AT=300 PROVIDER=fake bun run lesson-05
```

```
  [compacting… about 666 tokens right now]
  [the summary is no shorter than the original; skipping compaction]

  [compacting… about 797 tokens right now]
  [compacted 5 messages: 797 → 510 tokens, 36% saved]
```

"Skip when the summary is not shorter than the original" is also Step 4.

Use `/tokens` at any time to see where you are:

```
> /tokens
  8 messages, about 662 tokens
  compaction threshold 8000 (currently 8%)
```

---

## Step 1: how bad the problem is

An LLM is stateless. It does not remember the previous turn, so every turn
resends the whole conversation. Token usage therefore grows quadratically, not
linearly:

| Turn | Tokens sent this turn | Cumulative |
|---|---|---|
| 1 | 1,000 | 1,000 |
| 2 | 2,000 | 3,000 |
| 5 | 5,000 | 15,000 |
| 10 | 10,000 | 55,000 |
| 20 | 20,000 | 210,000 |

20 turns in, the total you have sent is 10 times the size of the last one.

And it is not only money:

1. latency: more input tokens means the first character arrives later
2. the ceiling: hitting the context window fails outright and wastes the turn
3. quality: in a very long context, the model is likelier to overlook what
   sits in the middle

> Prompt caching cuts cost substantially (a repeated prefix is roughly 10x
> cheaper) but does nothing about the context window ceiling. You still need
> compaction.

---

## Step 2: the shape of compaction

```
before: [msg1][msg2][msg3]……[msg40][msg41][msg42]
         └───────── 40 old messages ─────┘ └ recent ┘

after:  [summary:msg1-msg36][msg37]……[msg42]
         └─ one passage ──┘  └─ kept verbatim ─┘
```

Keeping the tail is the crucial part. The most recent messages are usually
exactly what the user is talking about; summarise those and the agent
immediately forgets what you were doing.

```ts
export const DEFAULT_COMPACTION: CompactionConfig = {
  triggerTokens: Number(process.env.COMPACT_AT ?? 8000),
  keepRecent: 6,
  summaryMaxTokens: 2000,
};
```

### When to check

```ts
let messages = session.messages();

// Check before sending the request
if (shouldCompact(messages, COMPACTION)) { … }
```

The timing matters: before sending, not after the response arrives. Check too
late and the enormous request has already gone out, already paid for.

### Token estimation is deliberately imprecise

```ts
return Math.ceil(chars / 4);
```

Real precision means calling the provider's `count_tokens` API, which differs
per vendor and costs another round trip. But compaction's trigger point does
not need precision; being 10% out changes nothing.

The `4` is an English rule of thumb. Chinese runs about 1.5 to 2 characters
per token, so this function underestimates Chinese. That is intentional:
better to underestimate and compact slightly late than to overestimate and
compact early, because compacting early wastes the price of a summary.

---

## Step 3: the summary prompt is the whole game

Compaction quality rests entirely on this prompt. See
[`shared/compaction.ts`](../shared/compaction.ts):

```
The summary you write REPLACES those messages. Anything you leave out is
gone forever - the agent will not be able to recover it.

Preserve, in this order of priority:
1. What the user asked for, including constraints and preferences they stated.
2. Files that were read or modified, with their paths. Note what was changed.
3. Decisions made and the reasoning behind them.
4. Facts discovered about the codebase (structure, conventions, gotchas).
5. Anything that failed, and why - so the agent does not repeat it.
6. Work that is still outstanding.

Drop: full file contents, verbose command output, exploratory dead ends.
```

Three design points:

**1. Spell out the consequence.** "Anything you leave out is gone forever"
measurably raises how much the model retains.

**2. Give an explicit ordering.** Without one, the model writes a
well-composed summary containing nothing actionable ("we discussed code
quality issues", which is useless).

**3. Say what to drop.** Otherwise the model keeps a little of everything and
the summary never gets small.

Item 5 is the one most often forgotten: failed attempts must survive.
Otherwise the compacted agent cheerfully retries the approach that just
failed.

### The summary goes in as `user`, not `assistant`

```ts
const summaryMessage: Message = {
  role: "user",
  text: "[The following is a summary of the earlier part of this conversation…]\n\n" + summary + …,
};
```

An assistant message represents something the model said, and this summary was
produced by the harness. Filing it as assistant makes the model believe it
said all this, which can produce strange self-reference ("as I mentioned
earlier") about things it never said.

---

## Step 4: compaction can make things worse

This came out of measurement. The first compaction:

```
  [compacting… about 666 tokens right now]
  [compacted 3 messages: 666 → 678 tokens, -2% saved]
                                       ↑ a net loss
```

The cause: a summary has a fixed floor. The "[here is a summary...]" wrapper,
plus the several lines the model writes at minimum, can exceed the original
when the compacted messages were short to begin with.

So check after computing it:

```ts
if (tokensAfter >= tokensBefore) {
  return {
    messages,              // ← fall back to the originals
    tokensAfter: tokensBefore,
    compactedCount: 0,     // 0 means "never mind, nothing was compacted"
  };
}
```

After the fix:

```
  [compacting… about 666 tokens right now]
  [the summary is no shorter than the original; skipping compaction]
                                  ← one summary paid for, but the context did not grow

  [compacting… about 797 tokens right now]
  [compacted 5 messages: 797 → 510 tokens, 36% saved]
```

> Note that skipping still paid for one summary. Avoiding that means tuning
> `keepRecent` and `triggerTokens` so that there is always enough to compact
> when the trigger fires.

---

## Step 5: the cut point is not arbitrary

```ts
function findCutoff(messages: Message[], keepRecent: number): number {
  let cutoff = Math.max(0, messages.length - keepRecent);

  // Move forward until the cut point is not a toolResult
  while (cutoff < messages.length && messages[cutoff]?.role === "toolResult") {
    cutoff++;
  }

  return cutoff;
}
```

The cut must not land between an `assistant` carrying a tool call and its
`toolResult`.

Cut there and the retained messages begin with a `tool_result` that has no
matching `tool_use`, and the API returns 400 immediately. This is the other
face of Lesson 3's point B:

> A tool call and its result must appear as a pair.

Lesson 3 was "fill in the results when interrupted"; this is "do not separate
them when slicing".

---

## Step 6: originals are not deleted (Lesson 4's exercise 6)

```ts
await session.appendMeta("compaction", {
  summary: result.summary,
  tokensBefore: result.tokensBefore,
  tokensAfter: result.tokensAfter,
  compactedCount: result.compactedCount,
});
await session.append(result.messages[0] as Message);
```

Note that there is only append here, and no deletion anywhere.

Compaction changes what gets sent to the model next time, not what stays on
disk. The original messages are still in the JSONL file, so at any point you
can:

- review the full conversation (`/tree` shows all of it)
- check whether the summary dropped something important
- use real conversations as training or evaluation data
- rerun with a different summary prompt

This is the payoff from Lesson 4's append-only design. The context the model
sees and the history you keep are two different things; do not weld them
together.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Compaction never fires | the threshold is too high | `COMPACT_AT=300 bun run lesson-05` |
| It always says "skipped" | it triggers too early, nothing to compact | raise `COMPACT_AT` or lower `keepRecent` |
| The agent forgets what it was doing after compacting | `keepRecent` is too small | raise it, or improve the summary prompt |
| The API 400s after compacting | the cut separated a tool call from its result | see Step 5 |
| Compaction is slow | it is an extra LLM call | expected. Use a cheap model for it (exercise 3) |

---

## Exercises

### Exercise 1: print the summary ⭐

Add a `/summary` command showing the most recent compaction's summary, which
is already stored in the session via `appendMeta`.

Read what it kept and what it dropped. That is the most direct way to judge
compaction quality.

### Exercise 2: write a bad summary prompt on purpose ⭐

Replace `SUMMARY_SYSTEM_PROMPT` with `"Summarize the conversation."` and run a
long conversation.

Watch the agent's behaviour after compaction: does it forget the user's
requirements? Does it retry something that already failed?

### Exercise 3: summarise with a cheap model ⭐⭐

Summarising does not need your strongest model. Let `compact()` take a
different provider:

```ts
compact(cheapProvider, messages, config, signal)
```

Opus or GPT-5 for the conversation, Haiku or Flash-Lite for the summary.

### Exercise 4: measure the quadratic growth ⭐⭐

Record the input tokens sent each turn and tabulate them. Run once with
compaction off and once on, then compare cumulative usage.

### Exercise 5: hierarchical compaction ⭐⭐⭐

After two compactions you have summary + summary + recent messages. Fold the
old summary into the new one instead, producing a single rolling summary.

Then think: does information bleed away across repeated summarisation? (It
does. It is called summarization drift. How do real systems mitigate it?)

### Exercise 6: context editing, delete instead of summarise ⭐⭐⭐

Another way to save tokens is to delete old tool output while keeping the
message structure. The result of reading a 10000-line file is almost certainly
useless 20 turns later.

Implement `clearOldToolResults(messages, keepRecent)`, replacing old tool
result contents with `"[output cleared to save context]"`.

Compare it with summary-based compaction: which saves more? Which keeps more
useful information? (Real systems do both. The Claude API has both built in.)

---

## Compared with Pi's source

| Concept in this lesson | Where it lives in Pi |
|---|---|
| the compaction flow | `packages/agent/src/harness/compaction/compaction.ts` (880 lines) |
| branch summarisation | `harness/compaction/branch-summarization.ts` |
| recording compaction in the session | `harness/types.ts:403` (`CompactionEntry`) |
| when compaction triggers | `packages/agent/src/types.ts:217` (`shouldStopAfterTurn`) |
| the context transform hook | `types.ts:195` (`transformContext`) |
| the summary prompt | `harness/compaction/compaction.ts`, next to the logic |

One field of `CompactionEntry` is worth a look:

```ts
export interface CompactionEntry<T = unknown> extends SessionTreeEntryBase {
  type: "compaction";
  summary: string;
  firstKeptEntryId?: string;   // ← the entry from which the originals are kept
  tokensBefore: number;
  retainedTail?: AgentMessage[];
  …
}
```

`firstKeptEntryId` lets Pi reconstruct exactly what the context looked like at
the moment of compaction, because the original messages are all still in the
tree. Same principle as Step 6, implemented more thoroughly.

---

## That is the engine

Five lessons in, your agent has:

| | Capability | Core file |
|---|---|---|
| 1 | tool calling, the agent loop, the provider abstraction | `lesson-01-agent-loop/agent.ts` |
| 2 | several tools, output truncation, approval | `shared/tools/` |
| 3 | streaming, interruption, state repair | `shared/streaming/` |
| 4 | session persistence, branching | `shared/session/` |
| 5 | context compaction | `shared/compaction.ts` |

And that core loop has barely changed between Lesson 1 and Lesson 5. It is the
one thing this series most wants you to remember:

> An agent is small. The engineering around it is large.

### Where to go next

Read Pi's source. You are equipped for it now:

```bash
git clone https://github.com/earendil-works/pi
```

Start at `packages/agent/src/agent-loop.ts:170-272`. You have written those
100 lines five times; Pi's version handles more edge cases.

Or wire this into something of your own. The `shared/` directory from these
five lessons is reusable: swap the tools, swap the system prompt, and you have
an agent for your own domain.

---

## Next lesson

[Lesson 6: Domain tools](../lesson-06-domain-tools/): the engine is complete
here. But `read_file` and `write_file` only do generic things, and your value
is not there.

The next lesson replaces the entire tool set (telemetry queries, anomaly
scans, incident reports) without changing a single line of `runTurn`. That is
what these five lessons were really building towards.
