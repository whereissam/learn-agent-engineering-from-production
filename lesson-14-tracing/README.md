# Lesson 14: What Did This Agent Actually Do Last Week?

> [繁體中文](README.zh-TW.md)
>
> Prerequisites: [Lesson 08](../lesson-08-permissions/) (the audit log is its
> Exercise 4), [Lesson 18](../lesson-18-scheduling/) (things run unattended),
> [Lesson 19](../lesson-19-delegation/) (things delegate),
> [Lesson 26](../lesson-26-cost/) (cost is measured, not estimated).
>
> Source: `mastra/packages/core/src/observability/types/tracing.ts` — the
> `SpanType` enum at `:35`, `traceId` at `:768`, `parent` at `:810`.

Lesson 8's Exercise 4 builds an audit log: every permission decision, the rule it
relied on, appended to a file. It answers *what happened* completely.

Then the operator asks the question it cannot answer:

> This `stripe_create_refund` — whose request was it part of, and what did that
> request cost?

```bash
bun run lesson-14                              # offline: six questions, two records
RUNS=3 PROVIDER=openai bun run lesson-14:agent # real model: what it says when it cannot know
```

## Step 1: the morning

Four things, overlapping:

```text
08:00  a cron run summarises overnight alerts     (Lesson 18)
08:01  Dana asks for a refund      → delegates to a subagent (Lesson 19)
08:01  Sam asks for deploy status  → starts while Dana's is still running
08:02  Dana asks something else in a second tab   → two open requests, one person
```

Nothing adversarial, nothing fails interestingly. An ordinary morning is already
enough.

## Step 2: both records carry the same information

The recorder writes a log line **and** a span for every event, with identical
attributes. The comparison is about structure, not about withholding — "logs are
worse" is trivial to prove by writing worse logs.

The log:

```text
08:00:00  system  cron: summarise overnight alerts   4200tok 3c
08:01:00  dana    dana: process the refund on ch_4471
08:01:14  dana    model: verify                      38400tok 27c
...
```

The spans are the same events plus one field: `parentSpanId`. That is the entire
difference, and Mastra's taxonomy is the shape worth copying — `AGENT_RUN` and
`WORKFLOW_RUN` are documented as **root** spans, `TOOL_CALL` and
`MODEL_GENERATION` are not.

## Step 3: six questions an operator actually asks

A record answers a question if the answer can be **computed from it without
guessing** — the same standard Lesson 29 applies to evidence.

| question | log | spans |
|---|---|---|
| What did the agent do between 08:00 and 08:04? | yes | yes |
| Which actions were auto-allowed, which were asked? | yes | yes |
| That refund call — which request was it part of? | no | yes |
| What did Dana's refund request cost? | no | 30c |
| The subagent burned 38,400 tokens — on whose behalf? | no | yes |
| Three refund calls: three refunds or one retried? | yes | yes |
| | **3/6** | **6/6** |

Three of six favour the log or tie, and that is not politeness. The first two are
what logs are *for*, and a log answers them more simply than a tree does. The
split is not detail versus detail:

> A log records events. A tree records causality. Every question about cost,
> blame or delegation is the second kind.

The retry question is the interesting near-miss. A log can answer it — but only
because whoever wrote the tool remembered to log an `attempt` field. The tree
knows from its shape, whatever anyone remembered.

## Step 4: the workaround, actually attempted

"Just sum the log by actor" is what everyone reaches for, so the demo runs it
rather than dismissing it:

```text
  sum of Dana's log lines    39c
  Dana's refund, from tree   30c
```

The 9c is Dana's *second* request, the one she opened in another tab. `actor` is
a stand-in for `request` and it holds exactly as long as nobody has two things
open — which is the ordinary state of any chat interface.

**This is the correction that mattered most while building the lesson.** The
first draft's morning had one request per person, so summing by actor returned
30c: the right answer, by accident. The demo was asserting the log could not do
something its own data showed it doing. A scenario that does not contain the
failing case cannot demonstrate the failure, and `tests/tracing.test.ts` now pins
that 39c so the case cannot quietly disappear again.

## Step 5: hand each record to a model

The offline half is about the record. This is about the reader — because when the
record cannot answer, a person paging through a log at least *feels* the
uncertainty, and a plausible cost figure is indistinguishable from a real one
once it reaches a dashboard.

`gpt-5`, three runs, asked for Dana's refund cost with an explicit escape hatch
("say CANNOT DETERMINE"). True answer: 30c.

| record | correct | declined | wrong |
|---|---|---|---|
| flat log | 0/3 | 3/3 | 0/3 |
| log, names removed | 0/3 | 0/3 | **3/3** |
| span tree | 1/3 | 2/3 | 0/3 |

Read the middle row. Stripping the descriptive names — `model: verify` becomes
`model` — took the model from *declining every time* to **confidently answering
39c every time**. Same numbers, same structure, same question. The names were
doing the safety work: they let the reader see that the grouping was ambiguous.
Remove them and it finds a plausible aggregation and reports it as fact.

That was not the planned finding. The first version scored the log's one correct
answer as luck; it was not luck, it was semantic grouping from strings like
"verify the charge is refundable" — real information that happens to be in this
scenario's naming and would be ambiguous the moment there were two refunds.

And the last row is an honest limit: **the span tree does not guarantee a right
answer either.** It declined 2/3 on a record that fully supports the computation.
A structure that makes an answer *possible* does not make a reader produce it.

## Step 6: the rendering is not the record

The span-tree row above only works because `agent.ts` hands over one row per
span with `parent=` as a field. The first version pretty-printed the tree with
indentation — the same output `demo.ts` shows a human — and the model declined
2/3, exactly as it did on the flat log.

The parent relationships were in the data and **not in the record being handed
over**. Indentation is a rendering; a rendering is not a contract. That is
Lesson 37's rule from the other side: there the harness must not parse prose to
learn what happened, and here neither must the reader.

## What this lesson deliberately leaves out

| Left out | Why |
|---|---|
| OpenTelemetry, OTLP, exporters | a wire format for the thing this lesson is about. Mastra's `observability/` has the real one; the parent pointer is the idea |
| sampling | necessary at volume and it is a cost decision, not a structural one |
| latency and flame graphs | the same tree answers those, and cost attribution is the question Lesson 8 left open |
| storing traces | Lesson 33 already asks where mutable run state lives, and the answer is the same shape |
| a real tracing backend | it would teach ClickHouse and a product data model, which the TODO rejected for exactly this reason |

## The contract test

```bash
bun test tests/tracing.test.ts
```

No API key. It pins that both records carry the same attributes (or the
comparison is rigged), that one person really does have two overlapping
requests, that summing by actor returns 39 and not 30, that the subagent hangs
under the request that caused it, and that at least two of the six questions
favour the log.

It pins no model behaviour. Step 5's numbers are measurements.

## Exercises

### Exercise 1: add the seventh question ⭐

Write one an operator would ask that **the tree also cannot answer**. It exists,
and finding it is the point — a mechanism you cannot state the limits of is one
you will over-trust.

### Exercise 2: wire it to Lesson 26 ⭐⭐

Lesson 26 measures cost per call. Feed those numbers into span attributes and
produce a per-request bill. Then check what happens to the total when a subagent
retries.

### Exercise 3: break the tree ⭐⭐

Drop `parentSpanId` on one span in the middle and re-run the six questions. How
many break? An orphaned subtree is what a crashed process actually leaves behind
(Lesson 33), so decide what the reader should say about it.

### Exercise 4: reproduce Step 5's middle row ⭐⭐⭐

Anonymise the names and get the confident 39c. Then try to make it decline again
*without* restoring the names — by adding a field, a warning, anything. If you
cannot, you have found why the structure has to carry the answer rather than the
prose.
