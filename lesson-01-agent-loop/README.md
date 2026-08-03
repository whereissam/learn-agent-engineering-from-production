# Lesson 1: The Minimal Agent Loop

> [繁體中文](README.zh-TW.md)
>
> Prerequisites: none. This is the first lesson.
>
> Goal: turn "AI agent" from a vague idea into code you can point at line by
> line. By the end you will know what sits at the core of tools like Claude
> Code and Cursor.

## Questions this lesson answers

1. The model only emits text, so how does it "read my files"?
2. What is a tool, and who runs it?
3. Why does an agent need a loop instead of one call?
4. Every LLM API differs; how do you avoid welding yourself to one vendor?

---

## Step 0: run it first

See it move, then understand it. No API key needed:

```bash
cd agent-lessons
bun install
PROVIDER=fake bun run lesson-01
```

At the prompt, type anything and press Enter:

```
provider: fake  model: scripted
Ask a question. /exit or Ctrl+C to leave

> What bugs does this project have?
  → read_file({"path":"README.md"})
  → read_file({"path":"src/store.ts"})
  → read_file({"path":"src/config.ts"})
  → read_file({"path":"src/does-not-exist.ts"})
  ✗ ENOENT: no such file or directory, open '.../src/does-not-exist.ts'

[fake provider] I ran 3 rounds of tool calls.

A real model would give you an answer here. Set an API key and run it again to see real reasoning.
```

Stop and read those lines. Every `→` is one trip around the loop: the model
says it wants a file, your program actually reads it, the contents go back,
and the model decides what to do next.

The second trip reads two files at once. That is a parallel tool call: the
model knows the two files are independent, so it asks for both together.

The `✗` is deliberate. The model asked for a file that does not exist and the
program did not crash. The error went back to the model as a tool result. A
real model reads that and says "that file is not there, let me try another
one", then carries on. This is the mechanism that lets an agent repair itself.

### Switch to a real model

Put an API key in `.env` (see the [root README](../README.md#quick-start)),
then:

```bash
bun run lesson-01
```

What follows is real output, Gemini 3.6 Flash, abridged:

```
> Why do some short URLs return 404?

  → read_file({"path":"README.md"})
  → read_file({"path":"src/server.ts"})
  → read_file({"path":"src/store.ts"})
  → read_file({"path":"src/config.ts"})

The 404 errors occur primarily due to a **case sensitivity mismatch** between how short codes are saved and how they are looked up:

### 1. Root Cause: Case-Sensitivity Mismatch

* **Code Generation**: ALPHABET includes both lowercase and uppercase letters.
  generateCode() can create codes with uppercase letters (e.g. "aB3xYz").
* **Saving**: save(url) stores the code in the entries Map with its original casing.
* **Lookup**: lookup(code) converts the code to lowercase before querying the Map.

Because JavaScript Map keys are case-sensitive, looking up "ab3xyz" fails to match
"aB3xYz". As a result, lookup() returns undefined, and the server sends a 404.

Since 26 out of the 62 characters in ALPHABET are uppercase, ~98% of freshly
generated 6-character codes contain at least one uppercase letter and fail
immediately upon creation.

### 2. Secondary Cause: Eviction (MAX_ENTRIES)

… once a link is evicted, subsequent lookup requests for that code also return 404.
```

That is an agent. It had never seen this project; it read its way there. Only
the first bug was planted; the eviction one it found on its own, and the ~98%
figure it worked out from the alphabet rather than reading it anywhere.

> Run this three times and you get three different answers: sometimes only the
> case bug, sometimes the case bug plus eviction. The reasoning is stable and
> the presentation is not, which is worth seeing once before Lesson 7 tries to
> score any of it.

> That turn took about 4 tool calls and a dozen seconds. Ask the same question
> with a different provider to compare how deep each model digs.

> The project in `playground/` was written for this course and the bugs were
> planted on purpose. Fix them, or point the agent at your own project; it
> works the same.

---

## Step 1: the 50 lines that matter

Open [`agent.ts`](agent.ts) and find `runTurn`. The whole agent is this
function:

```ts
async function runTurn(messages: Message[]): Promise<void> {
  while (true) {
    // 1. Call the model
    const response = await provider.call({
      system: SYSTEM_PROMPT,
      messages,
      tools: TOOLS,
      maxTokens: MAX_TOKENS,
    });

    // 2. Push the model's reply into history
    messages.push({ role: "assistant", blocks: response.blocks, raw: response.raw });

    // 3. Check stopReason before reading content
    if (response.stopReason === "refusal") return;
    if (response.stopReason === "max_tokens") return;

    // 4. Print what the model said
    for (const block of response.blocks) { /* ... */ }

    // 5. No tool calls left → this turn is done
    const toolCalls = response.blocks.filter((b) => b.type === "toolCall");
    if (toolCalls.length === 0) return;

    // 6. Run every tool, collect the results
    const results: ToolResult[] = [];
    for (const call of toolCalls) {
      try {
        results.push({
          toolCallId: call.id,
          toolName: call.name,
          content: await executeTool(call.name, call.args),
        });
      } catch (error) {
        results.push({
          toolCallId: call.id,
          toolName: call.name,
          content: (error as Error).message,
          isError: true,   // ← failures go back to the model too
        });
      }
    }
    messages.push({ role: "toolResult", results });

    // 7. Back to step 1
  }
}
```

That is all of it. You have now seen the complete core of an AI agent.

The central loop in Claude Code, Cursor and Devin has this same shape. Their
extra tens of thousands of lines are more tools, streaming, UI, permissions,
session management and context compaction. All important, all around the edge.

### Details that are easy to miss

The `messages` array only grows. Every turn resends the entire history,
because the model has no memory of its own; it reads the whole conversation
from scratch each time. That is also why long conversations get expensive.

Step 5 tests whether tool calls exist, not `stopReason === "tool_use"`. The
stop reason is what the provider claims; the blocks are what actually arrived.
Trust the content, because stop-reason semantics differ subtly per provider.

The try/catch in step 6 is not optional. Every tool call must have a matching
result sent back, including the ones that failed. Miss one and the next
request comes back as a 400 ("tool_use ids were found without tool_result
blocks"), which is the single most common beginner error.

---

## Step 2: what a tool is

A tool has three parts.

### (1) The manual the model reads

```ts
const readFileTool: ToolSpec = {
  name: "read_file",
  description:
    "Read the full contents of a text file in the project. " +
    "Use this before answering any question about what the code does.",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "File path relative to the project root, e.g. 'src/server.ts'",
      },
    },
    required: ["path"],
  },
};
```

`description` is not a comment, it is prompt. That string goes into the
model's context verbatim, and it is the only thing the model has to decide
whether to reach for this tool. "Reads a file" and "use this before answering
any question about what the code does" produce noticeably different behaviour.

`parameters` is [JSON Schema](https://json-schema.org/). The model generates
arguments to fit it.

> Want to feel that immediately? Cut the description down to `"reads a file"`,
> run the same question again, and watch the model get lazier and guess more.
> It is the cheapest way to understand that prompt engineering is engineering.

### (2) The code that actually runs

```ts
async function executeTool(name: string, args: Record<string, unknown>): Promise<string> {
  if (name !== "read_file") throw new Error(`Unknown tool: ${name}`);

  const path = args.path;
  if (typeof path !== "string") throw new Error("read_file requires a string 'path'");

  const target = resolve(ROOT, path);

  // args came from the model: treat them as untrusted input
  if (target !== ROOT && !target.startsWith(`${ROOT}/`)) {
    throw new Error(`Path escapes the project root: ${path}`);
  }

  return await readFile(target, "utf8");
}
```

Two things worth remembering.

The contract is throw on failure. Do not dress an error up as a normal
result. Let the loop turn throws into `isError: true` results, so the model
knows it failed instead of reading the error message as file contents.

Those three lines of path checking are not decoration. `args.path` is a
string the model generated. Without the check, `"../../../.ssh/id_rsa"` gets
read out to it. Every model output is untrusted input; even if you trust the
model's intent, someone may have injected instructions upstream (prompt
injection).

### (3) The sandbox boundary

```ts
const ROOT = resolve(import.meta.dirname, "playground");
```

One constant is this agent's entire permission model. It can only read what
lives under `playground/`.

A real agent needs a more serious answer: Docker, a micro-VM, or OS-level
sandboxing. The idea is the same either way. Draw the line where the tool
executes, not in a prompt that asks the model to behave.

---

## Step 3: why there is a provider layer

`agent.ts` contains no `import Anthropic` and no `import OpenAI`. It knows
only the neutral interface in [`providers/types.ts`](providers/types.ts).

Why the extra layer? Because tool calling has a different shape everywhere:

| | Anthropic | OpenAI | Gemini |
|---|---|---|---|
| Tool definition | `{ name, description, input_schema }` | `{ type: "function", function: {...} }` | `functionDeclarations` |
| Argument format | parsed object | **JSON string**, you parse it | parsed object |
| Tool results | all in **one** user message | **one message each**, `role: "tool"` | `functionResponse` parts |
| System prompt | its own `system` field | `messages[0]` | `systemInstruction` |
| Error marker | an `is_error` field | none, only in the text | none |

Hardcode one of those into the loop and switching providers means rewriting
the loop.

One contrast makes it concrete. Here is the same neutral message translated
by each side:

```ts
// providers/anthropic.ts — 1 neutral message → 1 native message
case "toolResult":
  return {
    role: "user",
    content: message.results.map((r) => ({
      type: "tool_result",
      tool_use_id: r.toolCallId,
      content: r.content,
      is_error: r.isError,
    })),
  };

// providers/openai.ts — 1 neutral message → N native messages
case "toolResult":
  return message.results.map((r) => ({
    role: "tool" as const,
    tool_call_id: r.toolCallId,
    content: r.isError ? `Error: ${r.content}` : r.content,
  }));
```

Note that the OpenAI branch returns an array and the Anthropic branch returns
a single object. The loop above never needs to know.

### That ugly `raw` field

```ts
export interface AssistantMessage {
  role: "assistant";
  blocks: AssistantBlock[];  // neutral form, your code reads this
  raw: unknown;              // the provider's own object, kept untouched
}
```

It looks like a design failure. It is necessary.

Anthropic models emit thinking blocks. Those blocks must be handed back
byte-for-byte or the next request is rejected, and their internal structure is
Anthropic-specific: no neutral representation can cover every field of every
provider.

So both are kept. `blocks` is what your code reads; `raw` is what goes back
to the provider unchanged.

Almost every real agent harness has this field. It is the compromise a neutral
abstraction has to make when it meets reality, and knowing it exists means you
will not be confused when you read someone else's code.

---

## Step 4: five traps you will hit

Writing a first agent, nearly everyone hits all five.

### 1. Forgetting to push the assistant message

```ts
// ✗ wrong: the model never learns what it said, and repeats the same call forever
const response = await provider.call({ messages, ... });
const results = await executeTools(response);
messages.push({ role: "toolResult", results });

// ✓ right: the assistant message goes into history first
messages.push({ role: "assistant", blocks: response.blocks, raw: response.raw });
messages.push({ role: "toolResult", results });
```

Symptom: the agent loops forever, reading the same file.

### 2. Returning nothing when a tool fails

```ts
// ✗ wrong: swallowing the error
try {
  results.push({ ...await run(call) });
} catch { /* ignored */ }

// ✓ right: a failure is also a result
catch (error) {
  results.push({ toolCallId: call.id, content: error.message, isError: true });
}
```

Symptom: the next request 400s, complaining that a `tool_use` has no matching
`tool_result`.

### 3. Splitting tool results across messages (Anthropic)

Three tool calls in one assistant message means three `tool_result` blocks in
one user message. Splitting them into three messages raises no error, but the
model learns that parallel calls are not available here and drops to one tool
at a time, which is three times slower.

### 4. Not handling truncated output

When the model hits `max_tokens` the output stops mid-stream, including the
JSON for tool arguments. That JSON may still parse while being half a value.

```ts
if (response.stopReason === "max_tokens") {
  // Every tool call in this turn is suspect. Run none of them.
  return;
}
```

Symptom: the agent occasionally calls a tool with odd arguments, such as half
a file path.

### 5. Reading `content[0]` directly

The model may refuse (`stopReason: "refusal"`), and then the content can be an
empty array. Always read `stopReason` before the content.

---

## Troubleshooting

These came out of building the lesson, not from imagining what might break:

| Symptom | Cause | Fix |
|---|---|---|
| `process.loadEnvFile is not a function` | Bun lacks that Node API | Already handled with a `typeof` check. Bun reads `.env` by itself |
| `Request timed out.` after 30 seconds | The API is unreachable. The SDK retries 3 times, 10 seconds each | Check with `curl -I https://generativelanguage.googleapis.com`. Corporate networks, VPNs and proxies often block it |
| `Top-level await is currently not supported with the "cjs" output format` | Running a file outside the project with `tsx`, without `type: "module"` | Use `bun run`, or move the file into the project |
| `404 model not found` | Your account cannot use the default model id | `MODEL=gemini-3.5-flash-lite bun run lesson-01` |
| The agent rereads the same file forever | The assistant message never went into history | See trap 1 |
| `tool_use ids were found without tool_result blocks` | A failing tool returned no result | See trap 2 |

---

## Exercises

Do them in order. Each one walks you into a real problem.

### Exercise 1: add a `list_files` tool ⭐

Let the agent list a directory instead of guessing file names.

- add a `ToolSpec` to `TOOLS`
- add a branch to `executeTool`, using `readdir` from `node:fs/promises`
- do not forget the path check

Then run it: did the behaviour change? Does it list before reading?

### Exercise 2: write a bad description ⭐

Change `read_file`'s description to `"reads a file"` and rerun the same
question.

Watch for it getting lazier, guessing more, calling fewer tools.

The point is to feel that a description is prompt, not a comment.

### Exercise 3: print real token usage ⭐⭐

Add `usage: { inputTokens, outputTokens }` to `ModelResponse`, fill it in
both providers, and print it every turn.

Watch the input tokens climb every single turn. That is why agents are
expensive, and it is the problem Lesson 5 (context compaction) exists to
solve.

### Exercise 4: add a tool-call ceiling ⭐⭐

The loop can currently run until the end of time. Add a `maxIterations`, say
20, and stop with a message to the user.

Then think: once you stop, what state is `messages` in? Can you resume?
(Hint: if the last message is a `toolResult`, calling `runTurn` again picks up
where it left off.)

### Exercise 5: let a tool modify files ⭐⭐⭐

Add a `write_file` tool. This walks you into the first real design question:

Should you ask the user before writing?

Reading is safe; writing is not. Add a confirmation: when the model asks to
write, prompt for y/n in the terminal, and on a refusal return an
`isError: true` result saying the user declined.

That is the thing Claude Code shows you every time it wants to edit a file.
(Pi models it as a `beforeToolCall` hook; see the table below.)

---

## Compared with Pi's source

Reading a production implementation after writing your own makes it much
clearer. [Pi](https://github.com/earendil-works/pi) is an open-source project
that separates the parts of an agent runtime unusually cleanly:

| Concept in this lesson | Where it lives in Pi |
|---|---|
| the `while` loop in `runTurn` | `packages/agent/src/agent-loop.ts:170-272` |
| the only place the LLM is called | `agent-loop.ts:281-372` (`streamAssistantResponse`) |
| the `ToolSpec` / `executeTool` contract | `packages/agent/src/types.ts:380-403` (`AgentTool`) |
| neutral vs native messages | `types.ts:319` (`AgentMessage`) plus `convertToLlm` |
| the provider abstraction | `types.ts:28` (`StreamFn`), `packages/ai/src/providers/` |
| handling truncated output | `agent-loop.ts:381` (`failToolCallsFromTruncatedMessage`) |
| a fake provider for tests | `packages/ai/src/providers/faux.ts` |
| the full version of `read_file` | `packages/agent/src/harness/tools/read.ts` |
| the sandbox boundary | `packages/agent/src/harness/types.ts:373` (`ExecutionEnv`) |
| approval before writing | `types.ts:271` (the `beforeToolCall` hook) |

Pi's `agent-loop.ts` is 792 lines, but the core loop is the 100 lines from 170
to 272. You can go read it now.

---

## Next lesson

[Lesson 2 - More tools](../lesson-02-tools/): add `write_file`, `edit_file`
and `run_command`, then hit the first real problem, which is tool output long
enough to blow up the context. (What happens when you `ls -R` a large project,
or `cat` a 10MB log?)
