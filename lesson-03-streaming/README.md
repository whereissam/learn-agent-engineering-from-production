# Lesson 3: Streaming and Interruption

> [繁體中文](README.zh-TW.md)
>
> Prerequisites: [Lesson 2](../lesson-02-tools/).
>
> Goal: let the agent talk while it thinks, and let you stop it at any moment
> with the conversation still usable afterwards. That last clause is the hard
> part of this lesson.

## Questions this lesson answers

1. How is the typewriter effect done?
2. What actually happens inside the program the instant you press Ctrl+C?
3. Is interrupting mid-sentence handled the same way as interrupting mid-tool?
4. Why can an interruption break the conversation?

---

## Step 0: run it first

```bash
PROVIDER=fake bun run lesson-03
```

Ask anything. The first two turns call tools, then it starts a long answer.
Press Ctrl+C in the middle of it:

```
This reply is deliberately long, to give you enough time to press Ctrl+C and
try interrupting it.

When you do, watch for three things:
First, the text stops immediately, mid-wo
                                         ← Ctrl+C landed right here

[interrupted]

>                                        ← the prompt is back; keep talking
```

Three things happened:

1. it stopped mid-character, not after finishing the paragraph
2. the text already printed did not vanish, because it is valid data
3. the program did not crash; you are back at the prompt and can continue

Press Ctrl+C again while idle to actually exit.

> Want it slower and easier to hit by hand?
> `FAKE_DELAY_MS=100 PROVIDER=fake bun run lesson-03`

---

## Step 1: the typewriter effect is one line

The provider stops returning a result and starts emitting events:

```ts
export type StreamEvent =
  | { type: "text_start" }
  | { type: "text_delta"; delta: string }   // ← the next small piece of text
  | { type: "text_end" }
  | { type: "tool_call"; id: string; name: string; args: Record<string, unknown> }
  | { type: "done"; response: ModelResponse }
  | { type: "error"; message: string; aborted: boolean };
```

The loop consumes them like this:

```ts
case "text_delta":
  partialText += event.delta;
  process.stdout.write(event.delta);   // ← the entire typewriter effect
  break;
```

That is all. No animation, no timer. The data always arrived in pieces; you
are simply printing them as they land. The waiting in earlier lessons was
self-inflicted: we insisted on collecting everything before printing.

### Streaming is the primitive

```ts
async call(request, signal) {
  return await drain(provider.stream(request, signal));
}
```

The non-streaming version is the streaming one drained. It does not work the
other way round: you cannot manufacture streaming out of an API that returns
only when everything is ready. So a provider implements `stream()` and gets
`call()` for free.

Lesson 5's compaction uses `call()`, because nobody watches that step.

### The OpenAI trap: tool arguments stream character by character

Anthropic's SDK assembles tool arguments for you. OpenAI's does not:

```
delta.tool_calls[0].function.arguments = '{"pa'
delta.tool_calls[0].function.arguments = 'th":"RE'
delta.tool_calls[0].function.arguments = 'ADME.md"}'
```

You reassemble them yourself, keyed by `index`, and can only `JSON.parse` once
everything has arrived:

```ts
if (call.function?.arguments) existing.args += call.function.arguments;
//                                            ↑ += , not =
```

Write `=` and you keep only the last fragment, then parsing fails. It is the
most common streaming mistake there is.

---

## Step 2: how interruption works

```ts
let currentRun: AbortController | undefined;

// A fresh controller per turn
currentRun = new AbortController();
await runTurn(provider, messages, ctx, currentRun.signal);
```

The `AbortSignal` travels all the way down: into the HTTP request, where the
SDK drops the connection, and into tool execution. Ctrl+C calls `abort()`.

### The signal has to be caught in two places, as measured

```ts
function installSigintHandler(rl: Interface): void {
  rl.on("SIGINT", handleInterrupt);
  process.on("SIGINT", handleInterrupt);
}
```

An earlier version installed only `rl.on("SIGINT")`, and Ctrl+C during
streaming did nothing at all. Why:

| Situation | Who receives it |
|---|---|
| stdin is a terminal and readline is waiting for input | `rl.on("SIGINT")`; readline intercepts, the process level never sees it |
| `runTurn` is executing, readline is not waiting | `process.on("SIGINT")` |
| stdin is not a TTY (pipe, CI) | `process.on("SIGINT")` |

Install only one and there is a situation where Ctrl+C is ignored.

### An error is an event, not a throw

```ts
| { type: "error"; message: string; aborted: boolean };
```

This is deliberate. When a stream fails halfway, the text already emitted is
still valid; the user has seen it. A provider that throws leaves that text
with nowhere to go.

As an event, the loop can save what accumulated and then deal with the error.

---

## Step 3: three interruption points, the core of this lesson

Interruption is not one thing, it is three. Each leaves the conversation
history in a different partial state.

```
call the model ────────► tool calls arrive ────► run the tools ────► next turn
      ▲                                          ▲                 ▲
      │                                          │                 │
     [A]                                        [B]               [C]
 mid-sentence                                mid-tool        tools done, stopping
```

### Point A: mid-sentence

```ts
if (partialText.trim()) {
  messages.push({
    role: "assistant",
    blocks: [{ type: "text", text: partialText }],
    raw: { role: "assistant", content: partialText },
  });
  messages.push({
    role: "user",
    text: "[I interrupted your last reply. Wait for my next instruction; do not resume on your own.]",
  });
}
```

Why keep half a sentence?

Because the user read it. Throw it away and the history no longer matches
what is on screen: the user remembers the agent saying something the model has
no record of saying. Contradictions follow.

Why add a user message?

Without it, the model sees its own truncated reply and finishes the thought.
But pressing Ctrl+C meant "stop talking". This message says so explicitly.

Interrupted before it said anything? Nothing to do; the history was never
dirtied.

### Point B: mid-tool

There is a hard rule here:

> Every tool call must have a matching tool result.

Miss one and the next request comes back 400
(`tool_use ids were found without tool_result blocks`).

So after an interruption the tools that never ran still need a cancelled
result:

```ts
for (const call of toolCalls) {
  if (abortedDuringTools || signal.aborted) {
    abortedDuringTools = true;
    results.push({
      toolCallId: call.id,
      toolName: call.name,
      content: "Cancelled: the user interrupted before this tool ran.",
      isError: true,
    });
    continue;   // ← do not actually run it
  }
  // ... normal execution
}

// Only push once every result is filled in
messages.push({ role: "toolResult", results });
```

Note that the `push` is outside the loop. The history is either complete or
not yet written; it must not sit in between.

### Point C: tools finished, but stop now

The history is already legal, since every result was filled in. It only needs
a note:

```ts
messages.push({
  role: "user",
  text: "[I interrupted your tool execution. Wait for my next instruction.]",
});
```

---

## Step 4: what interruption cannot do

One thing this design deliberately does not attempt: finished tools are not
rolled back.

If the model called `write_file` and the file was written, pressing Ctrl+C
afterwards leaves the file changed. Interruption can only stop what has not
happened yet.

That is a trade-off rather than laziness. Rollback needs transactions: every
tool needs an undo, or the whole sandbox needs snapshots, and the complexity
explodes.

Real agents behave the same way. It is also why Lesson 2's approval mechanism
matters more than interruption does: stopping something beforehand is far
easier than cleaning up after it.

---

## Step 5: prove the interruption did not break the conversation

After Ctrl+C, keep talking:

```
> hello
This reply is deliberately long...
First, the text stops immediately, mid-wo
[interrupted]

> still there?          ← the conversation continues
This reply is deliberately long...
```

The second turn working is the proof that the history stayed legal.

Remove Step 3's repair logic and try again: the second turn fails, and against
a real provider you get an API 400 directly. That is the fastest way to check
whether this lesson was implemented correctly.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Ctrl+C does nothing | only `rl.on("SIGINT")` was installed | install both, see Step 2 |
| Ctrl+C kills the program outright | SIGINT was never intercepted | as above |
| The next request 400s after an interruption | tool results were not filled in | see Step 3, point B |
| The model finishes the sentence it was interrupted in | the "do not continue" message is missing | see Step 3, point A |
| `JSON.parse` fails on tool arguments (OpenAI/Gemini) | fragments assembled with `=` instead of `+=` | see Step 1 |
| All the text appears at once, no typewriter effect | `call()` was used instead of `stream()` | check the loop is consuming events |

---

## Exercises

### Exercise 1: show a thinking indicator ⭐

There can be several blank seconds between sending the request and the first
`text_delta`. Add a spinner and clear it on `text_start`.

Hint: make sure the spinner's characters do not fight with the model's output.

### Exercise 2: show tokens spent when interrupted ⭐⭐

Add `{ type: "usage"; inputTokens: number; outputTokens: number }` to
`StreamEvent`, fill it in both providers, and print it on interruption.

You will notice something: interruption does not refund anything. The tokens
already generated are billed.

### Exercise 3: make "continue" a built-in command ⭐⭐

After an interruption, `/continue` should let the model resume where it was
cut off instead of waiting for new instructions.

Think about it: does that change the message Step 3's point A adds?

### Exercise 4: interrupt a running shell command ⭐⭐⭐

`run_command` currently receives no `signal`, so on Ctrl+C the child process
keeps running in the background until it finishes on its own.

Extend `ToolContext` to carry `signal` and wire it up in `shell-tool.ts`:

```ts
signal.addEventListener("abort", () => child.kill("SIGTERM"));
```

Then take on the harder question: what about a process SIGTERM cannot kill?
(Hint: SIGTERM first, SIGKILL after a grace period.)

### Exercise 5: stream tool arguments live ⭐⭐⭐

Tool calls are currently displayed once the arguments are complete. Show them
as they arrive:

```
→ write_file(path: "src/store.ts", content: "import { ALPH...
```

This needs new event types (`tool_call_start` / `tool_call_delta`). Doing it
explains why this lesson deliberately does not: half a JSON object is nearly
useless to a UI, and the complexity is real. Pi does it (`toolcall_delta`),
because it renders live file diffs.

---

## Compared with Pi's source

| Concept in this lesson | Where it lives in Pi |
|---|---|
| streaming event types | `packages/ai/src/types.ts` (`AssistantMessageEvent`) |
| the `StreamFn` interface | `packages/agent/src/types.ts:28` |
| the loop that consumes stream events | `packages/agent/src/agent-loop.ts:317-361` |
| interruption handling | `agent-loop.ts:196-200` (`stopReason === "aborted"` finishes up) |
| repairing state after an interruption | `packages/agent/src/agent.ts:496` (`handleRunFailure`) |
| decoupling events from the UI | `packages/agent/src/agent.ts:243` (`subscribe`) |
| handling tools from truncated output | `agent-loop.ts:381` (`failToolCallsFromTruncatedMessage`) |

Pi's `AssistantMessageEvent` has more than a dozen event types (thinking
start/end, tool arguments streaming character by character, usage updates).
This lesson keeps six. Understand the six first, then go see why a dozen are
needed.

---

## Next lesson

[Lesson 4 - Session persistence](../lesson-04-sessions/): close the program
today and the conversation is gone. Writing it to disk walks into an
interesting problem, which is that a session is not an array but a tree.
