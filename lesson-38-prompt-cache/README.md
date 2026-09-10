# Lesson 38: The Cache You Break Yourself

> [繁體中文](README.zh-TW.md)
>
> Prerequisites: [Lesson 05](../lesson-05-compaction/), [Lesson 15](../lesson-15-memory/),
> [Lesson 26](../lesson-26-cost/), [Lesson 32](../lesson-32-tool-search/).
>
> Source: `opencode/packages/llm/src/protocols/utils/cache.ts` (16 lines) and
> `protocols/anthropic-messages.ts` (855 lines).

Every lesson so far has assembled a request and sent it. This one asks what the
*previous* request has to do with it, and the answer decides most of your bill.

```bash
bun run lesson-38                          # offline: where the prefix breaks
PROVIDER=openai bun run lesson-38:probe    # real: what the provider charges
```

This is the last lesson in the series, and it is the only one that is mostly
about the earlier lessons. Lessons 05, 15 and 32 each added something to the
request, and none of them mentioned what it costs to add it *there*.

## Step 1: the one fact everything follows from

A provider caches a **prefix**, not a request. It reads from byte zero and reuses
what it has seen before, stopping at the first difference.

So a cache is not something you switch on. It is something you preserve, and you
destroy it from the front. One line at the top of a system prompt is worth more
than every optimisation downstream of it.

## Step 2: the measurement

Five turns of the same conversation, six ways of assembling it, `gpt-5`. The
number is the provider's own `usage.prompt_tokens_details.cached_tokens` — never
computed by us, for the reason Lesson 26 gives.

| configuration | cached, turns 2-5 | hit rate | what it is |
|---|---|---|---|
| stable prefix | 55040 | 98% | the control |
| timestamp first | 0 | 0% | one line in a system prompt |
| memory in system | 0 | 0% | Lesson 15's shape |
| tool list grows | 54144 | 96% | Lesson 32's shape |
| tool list reordered | 53760 | 96% | same tools, different order |
| volatile last | 55168 | 98% | the same content, moved |

Turn 1 is excluded from every row: it is cold by construction, and including it
would penalise all six equally for the same thing.

Two rows carry the lesson. **A timestamp at the front of an otherwise identical
prompt costs the entire prefix, on every turn, forever.** And the last row is the
same timestamp and the same recalled memories, moved to the end of the message
list: 98%. The model sees identical information in both. Only the position
changed.

## Step 3: what this series told you to do, and what it costs

`memory in system` is not a strawman. It is Lesson 15, faithfully:

```ts
manager.buildSystemPrompt()   // recalled memories, at the top, every turn
```

Recalling memories and putting them where the model will weight them most is
correct behaviour for a memory system. It is also the single most expensive
place to put anything that changes.

| Lesson | What it adds | Where it puts it | Cost |
|---|---|---|---|
| 15 memory | recalled memories | system prompt | the whole prefix, every turn |
| 05 compaction | a summary replacing history | mid-conversation | everything after the rewrite point, once |
| 32 tool search | tools, as they load | end of the tool list | ~2%, see Step 4 |
| 31 processors | edits on the way out | wherever they hang | depends entirely on where |

None of those lessons is wrong. What is wrong is that none of them mentioned
this, and the series had to be finished before the cost could be seen at all.

## Step 4: the prediction that was wrong

The plan for this lesson, written into `docs/TODO.md` before any of it ran, said
Lesson 32's growing tool list would break the prefix "because the tool list is
part of the prefix". It measured 96%.

Two reasons, and both are worth more than the original claim:

**It grows by appending.** Growth is not what breaks a prefix; rewriting what
came before it is. A tool list that gains entries at the end is as safe as a
message list that gains turns at the end — and `tool list reordered`, which adds
and removes nothing, is the shape to actually fear. In this catalogue it costs
the same 2%, because the tool block is small.

**The order of blocks in your request object is not the order the provider
hashes.** `{ system, tools, messages }` is how you wrote it; the measurements
only make sense if `tools` is treated as sitting *after* `messages`. So
`prefix.ts` carries both orderings, and says plainly that one of them came from
measurement rather than documentation:

```ts
export const SECTIONS: Section[] = ["system", "tools", "messages"];
export const OPENAI_ORDER: Section[] = ["system", "messages", "tools"];
```

Neither is a promise. It is what one provider did on one day, which is why the
lesson ships a probe rather than a rule.

## Step 5: a repeatable cache experiment is not measuring a cache

The first version of `probe.ts` used a fixed timestamp — `21:0N:00Z` — so that
runs would be reproducible. The second run reported this:

```text
  stable prefix          99%
  timestamp first        99%
  memory in system       99%
  tool list grows        99%
```

Every configuration perfect, including the two that had just measured 0%.

Nothing had been fixed. A deterministic "volatile" field is not volatile: run 2
sent byte-identical requests to run 1 and hit the cache run 1 had populated. The
experiment was measuring its own previous execution.

The fix is a per-run nonce, and *where* it goes is the same question the whole
lesson is about. It has to be at a **stable position inside every builder** — the
first line of the system prompt, constant for the life of the process. Putting it
only in the volatile builders was the first attempt and it was also wrong: the
untouched configurations went on hitting the previous run's cache.

```ts
export const RUN_ID = Math.random().toString(36).slice(2, 10);
export const SYSTEM_BASE = `Session ${RUN_ID}\n${SYSTEM_RULES}`;
```

`tests/prompt-cache.test.ts` pins that, because it is not a detail — it is the
difference between a result and a coincidence. Lesson 32's `MAX_TOKENS` artifact
was the same class of mistake one lesson earlier, and the pattern is worth
naming: **when a measurement agrees with you completely, suspect the harness
before believing it.**

## Step 6: read the section, not the percentage

`bun run lesson-38` counts characters offline, and its own output argues against
its headline number:

```text
  configuration           reusable     lost  first change in
  stable prefix               100%      181         messages
  timestamp first               0%    64118           system
  memory in system              0%    64180           system
  tool list grows              98%     1029            tools
  tool list reordered          97%     1853            tools
  volatile last                99%      576         messages
```

`tool list reordered` rewrites its entire tool list and still shows 97% reusable,
because the 40k-character system prompt dwarfs everything else. The percentage is
dominated by whatever is biggest; **the section is the signal.**

## Step 7: Anthropic makes you choose, four times

OpenAI caches the prefix implicitly. Anthropic does not — you mark where to
cache, and you get four marks per request across `tools`, `system` and
`messages`. OpenCode's comment at `anthropic-messages.ts:234` says what happens
past that:

> Beyond the cap the API returns a 400 — so the lowering layer counts emitted
> markers and silently drops any that exceed it.

So `Breakpoints` has two fields, and the second one is the interesting one:

```ts
export interface Breakpoints {
  remaining: number
  dropped: number
}
```

`dropped` exists because dropping is invisible. Nothing throws, nothing warns.
You arranged a discount, you did not receive it, and the only evidence is the
bill. That is the same shape as Lesson 32's silently-truncated response and
Lesson 33's silently-replayed step: **the failures that survive longest are the
ones with no error attached.**

## What this lesson deliberately leaves out

| Left out | Why |
|---|---|
| Anthropic measurements | no key here. The breakpoint logic is reproduced and tested; the numbers in Step 2 are OpenAI's and are labelled as such |
| pricing the saving in currency | Lesson 26 owns money, and cache discounts differ per provider and tier |
| a cache-aware `runTurn` | design principle 6. The finding is where to put things, not another wrapper |
| semantic or response caching | a different mechanism: reusing an *answer*, not a prefix. It answers a different question and fails differently |
| fixing Lessons 15 and 32 | they are correct as written for what they teach. Exercise 2 is where you decide whether the trade is worth it |

## The contract test

```bash
bun test tests/prompt-cache.test.ts
```

No API key. It pins the structural claims — a front-loaded change reuses nothing,
the same content moved to the end reuses almost everything, appending costs an
order of magnitude less than rewriting, four breakpoints then silence — and the
methodology fix from Step 5. It pins no hit rates: those are measurements, and a
test that fails when a provider changes its cache is a test that gets deleted.

## Exercises

### Exercise 1: find the timestamp in your own agent ⭐

Log the system prompt of two consecutive turns and diff them. Most agents have
exactly one line that differs, and it is usually a date, a session id, or a
"tools available" list rendered from a `Set`.

### Exercise 2: move Lesson 15's memory ⭐⭐

Put recalled memories in the last user message instead of the system prompt, then
re-run Lesson 15's injection experiment. Cheaper, certainly — but does the model
still weight them the same way? Lesson 15's whole point was that memory is a
persistent injection surface, and moving it changes where it sits relative to the
user's words. Measure both properties before deciding.

### Exercise 3: place four breakpoints ⭐⭐

Given tools, a system prompt, a long history and a current turn, choose the four
marks. Then write down which one you would drop first when a fifth thing wants a
mark, and why.

### Exercise 4: make it visible ⭐⭐⭐

Add cache hit rate to Lesson 26's cost accounting, and have it warn when the rate
falls between turns. Then find out what fraction of your own agent's requests are
paying full price without anybody noticing.
