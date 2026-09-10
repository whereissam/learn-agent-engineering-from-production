# Lesson 32: 200 Tools Do Not Fit in Context

> [繁體中文](README.zh-TW.md)
>
> Third lesson of the Mastra part. Prerequisites:
> [Lesson 12](../lesson-12-mcp/), [Lesson 17](../lesson-17-search/),
> [Lesson 20](../lesson-20-search-agent/), [Lesson 26](../lesson-26-cost/).
>
> Source: `mastra/packages/core/src/processors/processors/tool-search.ts` (654
> lines) and `tool-search-stores.ts` (258 lines).

Connect ten MCP servers and you have two hundred tools. Every lesson so far has
put the whole tool list in every request, because with eight tools that is
obviously right.

This lesson is about what happens at two hundred, and the first thing that
happens is not what the cost argument predicts.

```bash
bun run lesson-32              # offline: bytes, ranks, phases
PROVIDER=openai bun run lesson-32:agent   # real model, 12 tasks, 4 modes
```

## The catalogue

`catalog.ts` holds 20 services x 10 operations. It is synthetic — nobody
publishes a 200-tool dump you can clone — and it is built around the property
that makes real catalogues hard:

```text
"send"       19 of 200 tools mention it
"message"    13 of 200 tools mention it
"issue"      27 of 200 tools mention it
"create"     51 of 200 tools mention it
"list"       35 of 200 tools mention it
```

Two hundred *distinct* tools would be an easy problem. What you actually get from
ten vendors is four ways to file a bug and five ways to send a message. The 12
tasks are phrased the way a person asks — "wake up whoever is on call", not
"trigger a PagerDuty incident" — because a task set written in tool vocabulary
measures nothing.

## Step 0: switch the mechanism off

Put all 200 schemas in one request:

```text
Mode: ceiling — all 200 tools in one request
  rejected  400 Invalid 'tools': array too long. Expected an array with maximum length 128, but got an array with length 200 instead.
```

The lesson was going to be about token cost. It is not, or not first. **On
OpenAI, a 200-tool request is not a legal request.** No amount of prompt work
gets past it; the tool list has a maximum length and 200 is over it.

That reframes the whole thing. Tool search is usually sold as an optimisation,
and an optimisation is something you can decline. This is a ceiling.

## Step 1: what the catalogue costs when it does fit

```text
  all 200 tools          45773 bytes
  2 meta-tools            693 bytes
  ratio               66x
```

Bytes, not tokens — `demo.ts` has no API key and will not pretend to tokenise.
The real number comes from the provider in Step 3.

## Step 2: BM25 over the tool descriptions

The mechanism itself is small, and Mastra names its three states on
`tool-search.ts:12`:

```ts
export type ToolSearchFilterPhase = 'search' | 'load' | 'active';
```

`search` — in the index, no schema in context. `load` — the model asked for it by
name. `active` — the full schema is in the request and it can be called. The
model gets two meta-tools, `search_tools` and `load_tool`, and nothing else.

The index is the same BM25 from Lessons 17 and 20 pointed at a different corpus:
tool `name + description` instead of session messages (`tool-search.ts:354`). That
is the cheap part, and worth saying out loud — this mechanism is not a new
retrieval technique.

The tokenizer is not the same, though. Mastra's options at `tool-search.ts:113`
split on underscores and hyphens and carry **no stopword list**. The underscore
split is load-bearing: `github_update_branch_protection` has to become five terms
or a query for "branch protection" never reaches it.

Feed BM25 the user's raw sentence and it is mediocre:

```text
  task            rank  expected tool
  oncall             1  pagerduty_trigger_incident
  refund             3  stripe_create_refund
  signups            1  snowflake_run_query
  mainpush        none  github_update_branch_protection
  checkout        none  sentry_list_issues
  staging            8  aws_ec2_stop_instance
  meetingnotes    none  notion_create_page
  shipped           13  twilio_send_sms
  designbug          1  linear_create_issue
  launch             5  sendgrid_send_campaign
  noisy              2  datadog_mute_monitor
  backups            1  aws_s3_get_bucket_size

  in top 5: 7/12    ranked at all: 9/12
```

Five misses, and every one is a vocabulary miss rather than a ranking bug.
"Someone pushed straight to main again" shares no term with "branch protection
rules". "Text the customer that their order shipped" shares none with "SMS".
Keyword retrieval cannot bridge that, which is Lesson 22's finding arriving in a
new place.

**This is why the model writes the query, not you.** Nothing in the design says
`search_tools` receives the user's sentence.

## Step 3: the real model, four modes

12 tasks, `gpt-5`, `MAX_TOKENS=8192`:

| mode | correct | input tokens | model calls |
|---|---|---|---|
| ceiling (200 tools) | rejected by the provider | — | — |
| flat (128 tools) | 11/12 | 48950 | 12 |
| search-bare (2 meta-tools) | 10/12 | 14009 | 36 |
| search (+ Mastra's instruction) | 9/12 | 14707 | 35 |

The flat baseline is deliberately generous: 128 tools is OpenAI's ceiling, and the
expected tool is **always** in the list. Truncating a catalogue and hoping the
answer survived is what people actually do first, but measuring accuracy that way
measures the truncation.

Read the table honestly:

- **the token difference is real.** 3.5x, and it grows with the catalogue while
  the meta-tool cost stays flat.
- **the accuracy difference is not.** 11 versus 10 versus 9 out of 12 is one or
  two tasks. At n=12 that is noise, and a lesson that claimed "tool search costs
  you 17% accuracy" from it would be lying.
- **the round trips are real, and they are the hidden price.** 36 model calls
  against 12. Cheaper in tokens, three times the latency, three times the
  opportunity to derail.

## Step 4: the wrong answers are all the same wrong answer

Every miss, in both modes, is a near-duplicate across vendors:

| task | wanted | called |
|---|---|---|
| checkout | `sentry_list_issues` | `datadog_search_logs` |
| meetingnotes | `notion_create_page` | `slack_send_message` |
| launch | `sendgrid_send_campaign` | `hubspot_send_marketing_email` |

Two of those three are defensible. Searching Datadog logs for checkout 500s is a
reasonable thing to do; posting meeting notes to Slack is a reasonable thing to
do. **The task set's single right answer is a judgement call**, and that is the
honest limit of this measurement — the catalogue has genuine ties in it, so a
score of 12/12 was never available to either mode.

What it does show: the difficulty is not the count. It is that fifteen tools are a
plausible answer to "notify someone", and neither a bigger context window nor a
better index resolves a tie that the catalogue itself contains.

## Step 5: the finding that was a bug in the harness

The first run of this experiment scored search mode **2/12**, with most tasks
coming back as "no tool call" — the model apparently answering in prose instead
of searching. The obvious conclusion was that Mastra's injected instruction
(`tool-search.ts:438`) is what makes the mechanism work at all.

It was not. `MAX_TOKENS` was 2048, and `gpt-5` spends its output allowance on
reasoning before it emits anything. A response with no text and no tool call is
not a refusal; it is a truncation, and it reads exactly like one. Raising the
budget to 8192 moved search mode from 2/12 to 9/12 and moved `search-bare` — with
**no** instruction — from 0/12 to 10/12.

So the honest result about the instruction is: at an adequate output budget, on
this model, with these 12 tasks, it made no measurable difference. That is a
weaker claim than the first run offered, and it is the one the numbers support.
Lesson 26 measured the same trap from the cost side; here it very nearly became a
finding.

## Step 6: three phases are three separate places to say no

Mastra threads a `filter(toolName, tool, phase)` through all three states, and the
difference between them is a difference in conversation:

```text
  refuse at search  searchable=false loadable=true  callable=true
  refuse at load    searchable=true  loadable=false callable=false
  refuse at active  searchable=true  loadable=true  callable=false
```

Refusing at `active` means the model read the schema, planned around the tool, and
failed at the call. Refusing at `search` means it never learned the tool existed.

Note the first row: **hiding a tool from search does not stop it being loaded.**
A model that learns the name elsewhere — from memory (Lesson 15), a previous
session (Lesson 17), or the user typing it — walks straight past the filter. If
the answer is "this user may not do that", it belongs at `load` or in Lesson 8's
permission engine, not in the search index. `tests/tool-search.test.ts` pins that
as a contract test so the demo cannot quietly start claiming otherwise.

## Step 7: where the loaded set lives

This lesson's `ToolSearchSession` keeps the loaded set in memory for one run.
Mastra makes it pluggable (`tool-search-stores.ts`): `LegacyMapLoadedToolStore`
with a TTL, `ContextLoadedToolStore` keyed by thread.

That is not a detail, and the questions it answers are the ones you meet in week
two:

- a tool loaded at turn 3 — still loaded at turn 40, or has the TTL dropped it?
- the process restarted — does the model have to rediscover everything?
- two threads for one user — do they share a loaded set?

Those are [Lesson 33](../lesson-33-durable/)'s questions arriving early. Where
mutable agent state lives is the same problem whether the state is a loaded tool
set or a suspended workflow.

## What the production version looks like

vLLM's [Semantic Router](https://github.com/vllm-project/semantic-router) ships
this mechanism at a scale this lesson cannot reach, and its published numbers
([blog](https://vllm-sr.ai/blog/semantic-tool-selection/), measured on the
Berkeley Function Calling Leaderboard) are worth putting next to the ones above:

| tools | baseline accuracy | with selection |
|---|---|---|
| 49 | 94% | 94% |
| 207 | 64% | 94% |
| 417 | 20% | 94% |
| 741 | 13.62% | 43.13% |

and 127315 tokens of tool catalogue down to 1084.

Two differences from this lesson matter. It selects with **embeddings and cosine
similarity** rather than BM25, which is Lesson 22's dense-versus-sparse trade
appearing again — and given that every miss in Step 2 was a vocabulary miss,
that is the right direction. And it filters **before the model sees anything**,
with no `search_tools` turn at all, which removes the round-trip cost Step 3
measured while also removing the model's judgement from the loop.

Their table is also the answer to Step 3's flat baseline winning on accuracy: at
49 tools selection changes nothing, at 417 it is the difference between 20% and
94%. This lesson's 200-tool catalogue sits on the near side of the crossover.
That is worth knowing before you add the mechanism to a 30-tool agent.

## The contract test

```bash
bun test tests/tool-search.test.ts
```

No API key. It protects the mechanism's invariants — the meta-tools are always
present, nothing is callable before it is loaded, a rejected name is reported
rather than swallowed, hiding from search is not access control — and one loose
floor on retrieval quality. It deliberately does **not** pin 7/12 or 9/12: those
are measurements, and a test that fails when a model changes is a test that gets
deleted.

## What this lesson deliberately leaves out

| Left out | Why |
|---|---|
| embedding-based selection | Lesson 22 already built dense retrieval; the point here is where the seam goes, and the production comparison above says what changes |
| Mastra's `autoLoad` mode | it collapses search and load into one step, which removes the phase this lesson is about |
| per-thread stores and TTLs | Step 7 — the state question is Lesson 33's, and it deserves the room |
| tool *result* size | a 200-tool catalogue and a 200KB tool result are different problems; Lesson 05 handles the second |
| re-ranking search hits with a model | Lesson 17 measured that and Hermes had already deleted it: the thing calling the tool is a model already |

## Exercises

### Exercise 1: fix the five vocabulary misses ⭐

Add a `keywords` field to `CatalogTool`, index it alongside the description, and
put "SMS", "text message", "branch protection", "direct push" where they belong.
Re-run `bun run lesson-32` and count. Then ask the harder question: who writes
those keywords for a tool that arrived from someone else's MCP server?

### Exercise 2: find the crossover ⭐⭐

`FLAT_LIMIT=32 bun run lesson-32:agent` and then 64, 128. Plot accuracy and input
tokens against catalogue size. The Semantic Router table above says the crossover
is somewhere past 200 — find out where it is for *your* provider, and remember
that n=12 will not settle a one-task difference.

### Exercise 3: enforce a permission at the right phase ⭐⭐

Take Lesson 8's risk classes and wire them into the `PhaseFilter`. Decide, with a
reason, which class is refused at `search`, which at `load`, and which reaches
`active` and asks for approval instead. The demo's Step 5 shows why the choice is
not cosmetic.

### Exercise 4: kill the process ⭐⭐⭐

Load three tools, persist the session, restart, and reload. Everything Lesson 33
is about is already sitting in the `loaded` set, which is the smallest piece of
agent state you can lose and notice.
