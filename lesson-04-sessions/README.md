# Lesson 4: Session Persistence

> [繁體中文](README.zh-TW.md)
>
> Prerequisites: [Lesson 3](../lesson-03-streaming/).
>
> Goal: close the program and still have the conversation. Resume it, review
> it, rewind and ask again.
>
> This lesson contains a finding that changes your intuition: a session is not
> an array, it is a tree.

## Questions this lesson answers

1. How do you store a conversation? Is one big JSON file fine?
2. Why record a `parentId`?
3. After rewinding and asking again, where did the old conversation go?
4. When should the write happen?

---

## Step 0: run it first

```bash
PROVIDER=fake bun run lesson-04
```

Ask something, then `/exit`. Start it again, this time resuming:

```bash
PROVIDER=fake bun run lesson-04-sessions/agent.ts --resume
```

```
續跑 .../lesson-04-sessions/.sessions/2026-07-27T08-58-59-686Z.jsonl（6 筆記錄）
```

Type `/history` to see the conversation you just had:

```
  e0001  user        第一個問題
  e0002  assistant   我先看一下專案結構。
  e0003  toolResult  1 tool result(s)
  e0004  assistant   接著讀 store.ts。
  e0005  toolResult  1 tool result(s)
  e0006  assistant   這是一段刻意寫得很長的回覆…
```

### Built-in commands

| Command | What it does |
|---|---|
| `/history` | print the messages on the current branch |
| `/tree` | print every record in the file, abandoned branches included |
| `/rewind <id>` | go back to one record; later messages grow a new branch |
| `/file` | show the session file path |

---

## Step 1: why JSONL

The storage format is JSONL, one JSON object per line:

```jsonl
{"id":"e0001","parentId":null,"timestamp":"…","message":{"role":"user","text":"第一個問題"}}
{"id":"e0002","parentId":"e0001","timestamp":"…","message":{"role":"assistant",…}}
{"id":"e0003","parentId":"e0002","timestamp":"…","message":{"role":"toolResult",…}}
```

Against one large JSON array, it buys four things:

| | JSONL | one big JSON |
|---|---|---|
| adding a message | `append`, O(1) | read, modify, rewrite the whole file |
| the program crashes | at worst the last line is broken | the whole file may be ruined |
| watching it live | `tail -f session.jsonl` | not possible |
| large files | line by line | the whole thing into memory |

The second row matters most. An agent may run for a long time and the odds of
crashing partway are not small. JSONL corruption is local, and the loader
skips a broken line:

```ts
} catch {
  console.warn(`[session] skipping malformed line ${index + 1}`);
}
```

With one big JSON file, crashing mid-write means the conversation is gone.

### When to write: file first, return second

```ts
this.records.push(entry);
this.head = entry.id;

// Write, then return
await appendFile(this.path, `${JSON.stringify(entry)}\n`, "utf8");
return entry;
```

The order is deliberate. On a crash, "it was written and the caller does not
know" is far easier to deal with than "the caller believes it was saved and it
was not". The second leaves memory and disk disagreeing with no way to notice.

---

## Step 2: a session is a tree

The most important idea in this lesson.

### Why an array is not enough

Picture a very ordinary situation:

```
你：「幫我把這個函式改成用 async」
AI：（改了，但改錯方向）
你：「不對，我是說…」
```

Rather than explain, what you actually want is to go back and ask the question
differently. That is the up-arrow-and-edit in Claude Code, and the edit button
in ChatGPT.

Which raises the question: what happens to the old conversation?

- delete it → you have lost data. If the new phrasing is worse, there is no
  way back.
- keep it → then how does it relate to the new conversation? An array cannot
  express that.

The answer: they are two branches of one tree.

### `parentId` is the whole mechanism

Every record points at the one before it:

```ts
export interface SessionEntry {
  id: string;
  parentId: string | null;   // ← the one field that turns an array into a tree
  timestamp: string;
  message: Message;
}
```

Normally that forms a straight line:

```
e0001 ← e0002 ← e0003 ← e0004
```

But speak after `/rewind e0002` and the new message's `parentId` is `e0002`:

```
e0001 ← e0002 ← e0003 ← e0004     （舊分支，被放棄）
            ↖
              e0007 ← e0008        （新分支，目前在這）
```

### Seeing it happen

```
> /rewind e0002
  已退回 e0002。接下來的訊息會長出一條新分支，舊的分支還在檔案裡。

> 新的問法
（AI 回答…）

> /tree
  檔案裡共 12 筆記錄，目前分支上有 8 筆
  ● e0001 ← root   user
  ● e0002 ← e0001  assistant
  ○ e0003 ← e0002  toolResult      ← 舊分支
  ○ e0004 ← e0003  assistant
  ○ e0005 ← e0004  toolResult
  ○ e0006 ← e0005  assistant
  ● e0007 ← e0002  user            ← 新分支從 e0002 長出來
  ● e0008 ← e0007  assistant
  ● e0009 ← e0008  toolResult
  ● e0010 ← e0009  assistant
  ● e0011 ← e0010  toolResult
  ● e0012 ← e0011  assistant
  ● = 目前分支   ○ = 已放棄的分支（還在檔案裡，沒有刪除）
```

Look at `e0007 ← e0002`. It skips `e0003` to `e0006` and attaches straight to
`e0002`. That is the fork.

Not one record of the old branch was deleted. That is what append-only buys:
you never lose anything, you only stop walking down a path.

### Which messages go to the model?

```ts
messages(): Message[] {
  const chain: Message[] = [];
  let cursor = this.head;
  while (cursor) {
    const record = byId.get(cursor);
    if (!record) break;
    if (!("type" in record)) chain.push(record.message);
    cursor = record.parentId;   // ← walk backwards
  }
  return chain.reverse();
}
```

Walk from `head` along `parentId` back to the root, then reverse.

Only the current branch goes to the model. Abandoned branches stay in the
file but stay invisible, or the model would be confused by things it said and
had rejected.

---

## Step 3: the loop barely changed (again)

Against Lesson 3, `runTurn` differs like this:

```diff
- messages.push({ role: "assistant", blocks: response.blocks, raw: response.raw });
+ await session.append({ role: "assistant", blocks: response.blocks, raw: response.raw });
```

`push` becomes `await session.append`. That is it.

There is one more small change, and it is what makes `/rewind` work:

```ts
for (let step = 0; step < MAX_STEPS; step++) {
  // Recompute the messages from the session every turn
  const messages = session.messages();
```

Messages are no longer a long-lived array; they are recomputed from the tree
each time. So once `/rewind` moves `head`, the next turn naturally uses the
new branch.

---

## Step 4: one non-obvious trap

On `--resume`, `head` becomes the last record in the file:

```ts
for (const [index, line] of raw.split("\n").entries()) {
  const record = JSON.parse(line) as SessionRecord;
  session.records.push(record);
  session.head = record.id;    // ← every line overwrites, so the last one wins
}
```

If you used `/rewind` before quitting last time, the last record is not
necessarily on the longest branch. Resuming lands you on the branch you were
actually sitting on, which is usually what you want, but it is worth knowing.

A real agent stores `head` in the file too (or in a `session.meta.json`)
instead of inferring it from the last line.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Session file not found` | `.sessions/` is empty | run once without `--resume` |
| `/rewind` says `No such entry` | the id is mistyped | check ids with `/history` first |
| The conversation feels wrong after resuming | you landed on an abandoned branch | `/tree` to see where you are, then `/rewind` |
| `.sessions/` keeps growing | there is no cleanup | deliberate; see exercise 4 |

`.sessions/` is already in `.gitignore`.

---

## Exercises

### Exercise 1: add `/sessions` to list them all ⭐

List every file in `.sessions/` with its timestamp, message count, and first
user message as a title.

### Exercise 2: `--resume <filename>` ⭐

Only the most recent session can be resumed today. Allow naming one.

### Exercise 3: store head in the file ⭐⭐

Fix Step 4's trap. Write a meta record at the end noting which entry is head,
and prefer it when loading.

Then think: what if that meta record is also corrupt? Do you need a fallback?

### Exercise 4: token accounting ⭐⭐

`appendMeta()` is written and unused. Record a usage entry at the end of each
turn, then add `/cost` to total up what the session spent.

(`SessionMeta` in `shared/session/session.ts` exists for this.)

### Exercise 5: visualise the fork ⭐⭐⭐

`/tree` is a flat list today. Make it an actual tree:

```
e0001 user
└─ e0002 assistant
   ├─ e0003 toolResult        ← 舊分支
   │  └─ e0004 assistant
   └─ e0007 user  ●           ← 目前分支
      └─ e0008 assistant
```

You need to build a children map by inverting `parentId` first.

### Exercise 6: decide what compaction should store ⭐⭐⭐

Lesson 5 does context compaction: a long run of old messages becomes one
summary.

Think first: after compacting, should the original messages be deleted from
the file?

(Hint: think about what append-only is for. The answer is in the next lesson.)

---

## Compared with Pi's source

| Concept in this lesson | Where it lives in Pi |
|---|---|
| JSONL storage | `packages/agent/src/harness/session/jsonl-storage.ts` (376 lines) |
| the session tree and `parentId` | `packages/agent/src/harness/types.ts:375` (`SessionTreeEntryBase`) |
| computing the message chain from the tree | `packages/agent/src/harness/session/session.ts` |
| meta records (model changes and so on) | `harness/types.ts:387-401` (`ThinkingLevelChangeEntry`, `ModelChangeEntry`, ...) |
| compaction records | `harness/types.ts:403` (`CompactionEntry`) |
| resuming | `packages/agent/src/agent.ts:350` (`continue()`) |

Pi's `SessionTreeEntryBase` is almost identical to our `SessionEntry`:
`type`, `id`, `parentId`, `timestamp`. What it adds is node types that are not
messages: model changes, thinking-level changes, compactions, all in the same
tree.

The payoff is that the session's entire history, configuration changes
included, is fully replayable.

---

## Next lesson

[Lesson 5 - Context compaction](../lesson-05-compaction/): as the conversation
grows, resending the whole history every turn is slow and expensive, and
eventually hits the context window. The next lesson deals with that, and
answers exercise 6.
