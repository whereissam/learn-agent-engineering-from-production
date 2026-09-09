# Lesson 31: Moving the ifs Out of `runTurn`

> [繁體中文](README.zh-TW.md)
>
> Second lesson of the Mastra part. Prerequisites:
> [Lesson 05](../lesson-05-compaction/), [Lesson 08](../lesson-08-permissions/),
> [Lesson 26](../lesson-26-cost/).
>
> Source: `mastra/packages/core/src/processors/`,
> `processors/processors/pii-detector.ts`.

So far, every added capability has had one obvious implementation: another `if` in
the loop.

```ts
if (contextTooLong) compact()
if (toolIsDangerous) askForApproval()
if (costTooHigh) stop()
if (textContainsSecret) redact()
```

Each `if` is reasonable, and together they make the loop responsible for control
flow, policy, safety and storage format all at once. This lesson makes one move:
shift the boundary policies that change into a processor pipeline and leave the
loop alone.

## Step 0: turn the processors off first

```bash
bun run lesson-31
```

The demonstration uses a fake `.env` tool result:

```text
read_file(.env) → tool result → model context
                            ↘ trace
                            ↘ memory
```

With no processor, all three paths can see the fake token. No real model is needed
here, because what is being verified is not "will the model use the secret" but
something earlier and deterministic: did the secret cross a boundary.

## Step 1: the smallest pipeline

`processor.ts`'s interface has a single method:

```ts
interface Processor {
  readonly id: string
  process(payload: Readonly<Payload>): ProcessResult | Promise<ProcessResult>
}
```

The pipeline hands each processor's output to the next in order. Truncation,
normalisation, injection detection and cost gating can all grow on this same seam
without being compiled into `runTurn`.

Two invariants have tests protecting them:

- do not mutate the input in place. The original tool result may still be going to
  another sink
- a processor may not quietly change `boundary`. The policy layer cannot turn "send
  to the model" into "write to trace"

## Step 2: protecting the model alone is not enough

The second scenario adds `SecretRedactor` to the `model` pipeline only:

```text
model   safe
trace   LEAK
memory  LEAK
```

This is the lesson's one thesis:

> Before entering the model, before entering the log, and before entering memory
> are three different boundaries.

The model not seeing the secret only proves the cloud model did not receive it. A
trace may be read straight from the raw tool result by an observability hook, and
memory may persist the original message after the turn completes. Neither
inherits a model-input processor's result automatically.

The memory path is the dangerous one: Lesson 15 already showed that memory gets
recalled in future sessions. Missing it once turns into ongoing context
contamination.

## Step 3: handle it at each sink's entrance

The third scenario configures a pipeline for each of the three boundaries:

```ts
const pipelines = {
  model:  new ProcessorPipeline([new SecretRedactor()]),
  trace:  new ProcessorPipeline([new SecretRedactor()]),
  memory: new ProcessorPipeline([new SecretRedactor()]),
}
```

All three become `safe`. The repetition looks tedious, but it writes the data flow
down: when a new persistence sink is added, the types force you to decide that
sink's pipeline rather than silently inheriting the original text.

`findings` records only the kind and the count, never the matched string.
Otherwise the redactor's own audit log becomes a second secrets database.

## Step 4: the point is not the regex

This `SecretRedactor` recognises a few environment variables and provider tokens
and deliberately does not pretend to be complete. A real version also needs:

- provider-specific token patterns and entropy detection
- an allowlist for false positives, with versioning
- block / warn / redact strategies
- matching across chunks while streaming
- handling of images, file attachments and structured tool results

Mastra's `pii-detector.ts` runs over a thousand lines precisely because it handles
those strategies, streaming, and several kinds of PII at once. This lesson does not
compress those into one magic regex; it extracts the more portable part: where a
processor should hang.

## Step 5: what makes a good processor

| Mechanism | Earlier lesson | Suitable boundary |
|---|---|---|
| context compaction / token limit | Lesson 05 | model input |
| permission / moderation | Lesson 08 | tool execution / model input |
| secret / PII redaction | Lesson 31 | model, trace and memory separately |
| cost guard | Lesson 26 | around the model call |
| output scrubber | — | before returning to the user or writing to a sink |

Processors are not a licence to cram every middleware in. Anything that changes the
loop's control flow still does not fit — [Lesson 33](../lesson-33-durable/)'s
suspend/resume, for instance; that needs a serialisable state machine, not one
more text-transformation hook.

## The contract test

```bash
bun test tests/processors.test.ts
```

The test needs no API key, because what it protects are our own invariants:
redaction happens, non-sensitive content survives, the input is not mutated, and
the three boundaries do not impersonate each other.

Same division as Lesson 30: CI can prove your own pipeline is not broken, not that
every secret in the world will be detected. The latter needs continuously updated
fixtures and measurement.

## What this lesson deliberately leaves out

| Left out | Why |
|---|---|
| using an LLM to detect names and addresses | this lesson verifies data flow, not classifier quality |
| writing real trace / memory files | in-memory sinks suffice to show whether a boundary was crossed, and avoid the demo leaving secrets behind |
| unifying every sink's retention policy | that is product policy; this lesson teaches the mechanism for one call |
| modifying the existing `runTurn` | a processor's value is precisely that the core loop stays as it was |

## Exercises

### Exercise 1: add email and credit-card detection ⭐

Write a false-positive fixture for each first. `4111 1111 1111 1111` is easy;
"which 16-digit numbers should not be redacted" is the actual work.

### Exercise 2: add a block strategy ⭐⭐

Let a processor choose `redact` or abort. Think through whether the safe default is
the same for all three boundaries: when a trace cannot be written, should the whole
agent turn fail?

### Exercise 3: test processor ordering ⭐⭐

Add a truncation processor that keeps the first 40 characters and swap its order
with the redactor. Which order can leave half a token behind? Write the answer as a
contract test.
