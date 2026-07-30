# Lesson 19: Handing Work Off, and What It Can See

> [繁體中文](README.zh-TW.md)
>
> Last lesson of the Hermes part. Prerequisites:
> [Lesson 5](../lesson-05-compaction/) (context compaction),
> [Lesson 9](../lesson-09-unattended/) (approval),
> [Lesson 18](../lesson-18-scheduling/) (unattended running).
>
> Source: `hermes-agent/tools/delegate_tool.py` (3697 lines),
> `tools/async_delegation.py` (1069 lines). CrewAI serves as a second reference
> (see the end).

```bash
bun run lesson-19                      # 四個機制，不用金鑰
BLOCK=off bun run lesson-19 blocklist  # 遞迴委派
APPROVE=auto bun run lesson-19 approval

PROVIDER=gemini bun run lesson-19:agent                # 一個 agent 做三件事
MODE=delegate PROVIDER=gemini bun run lesson-19:agent  # 三個 agent 各做一件
```

## Questions this lesson answers

1. What can a subagent see? What can it not see?
2. What is a subagent **absolutely not allowed** to do, and why?
3. When a subagent needs approval, who does it ask?
4. Do more agents make it smarter?

---

## Step 0: write the prediction down first

This lesson comes with a ready-made trap: multi-agent demos **look**
impressive (three roles talking to each other, dividing work, consolidating),
and "looks impressive" is not "works better".

So following Lesson 7's method, **write the prediction before running**
(`docs/TODO.md`'s exact words):

> Multi-agent is not smarter; it makes state boundaries explicit. Without a
> genuine isolation requirement it only adds communication cost.

The measurements are in Step 5. **Half of that is wrong**, and the wrong half is
more useful than the right half.

---

## Step 1: delegation is an information boundary

The top of Hermes's `delegate_tool.py` states the whole contract:

> Each child gets:
> - A fresh conversation (no parent history)
> - Its own task_id (own terminal session, file ops cache)
> - The parent's toolsets, with child-only blocked tools stripped
> - A focused system prompt built from the delegated goal + context
>
> **The parent's context only sees the delegation call and the summary
> result, never the child's intermediate tool calls or reasoning.**

```bash
bun run lesson-19 isolation
```

```
父 agent 的對話：
  │ 使用者：我們的 staging 環境從上週開始就一直噴 E-118。
  │ 使用者：喔對了，**staging 的資料是假的，不要拿去做結論**。
  │ 助理：了解，我看一下 logs/。

子 agent 的整個 context：
  │ 統計 logs/inventory.log 裡最常出現的錯誤碼
  │ Context: 檔案在 workspace 底下。

「staging 的資料是假的」有沒有跨過去：沒有
```

> One mechanism is both the feature and the bug, depending on whether that
> sentence mattered. The parent's context does not get flooded by the child's
> ten tool calls (the feature), but the child also does not know the data is
> fake (the bug).
>
> What goes into the `context` argument is the parent's decision, and the parent
> frequently forgets.

Which is why delegation is not "more brains". It is a boundary, and both sides
pay for it.

---

## Step 2: five prohibitions, five different reasons

The blocklist at `delegate_tool.py:46-54`, comments copied along with it:

```python
DELEGATE_BLOCKED_TOOLS = frozenset([
    "delegate_task",  # no recursive delegation
    "clarify",        # no user interaction
    "memory",         # no writes to shared MEMORY.md
    "send_message",   # no cross-platform side effects
    "cronjob",        # no scheduling more work in the parent's name
])
```

Five lines look like five examples of one rule. They are not.

| Tool | What it blocks |
|---|---|
| `delegate_task` | **resources**: it expands exponentially |
| `clarify` | **the channel**: there is no user on the child's side at all |
| `memory` | **shared state**: if anyone can write it, the isolation is fake |
| `send_message` | **external side effects**: unrecallable, and the parent does not know |
| `cronjob` | **identity**: scheduling future work in the parent's name |

The last one is the easiest to miss, because it is not about what happens now
but **whose name something later happens under**.

> It also connects straight back to [Lesson 18](../lesson-18-scheduling/): that
> lesson's guard blocks **the content of a job** (would it kill the daemon),
> and this blocklist blocks **who is entitled to schedule jobs**. Neither is
> sufficient alone; drop either and there is a hole.

### With it turned off

```bash
bun run lesson-19 blocklist              # 1 個子 agent
BLOCK=off bun run lesson-19 blocklist    # 15 個
```

Two per level with a depth cap of 4 gives 15. **Reality has no depth cap**; the
cap is your API quota or your wallet, and the parent only sees the top level's
summary — it does not know what happened below, or how much it cost.

### And absent from the list is not the same as never called

The blocklist removes tools from the **tool list**, so normally the model cannot
call them. But `runChild` keeps a second check anyway, because **models call
tools they were never given** — in Lesson 20 the model searched for a project
name that did not exist anywhere in the corpus, which is the same behaviour.
`tests/delegation.test.ts` has a case guarding this.

---

## Step 3: when a subagent needs approval, who does it ask

```bash
bun run lesson-19 approval                 # 預設：拒絕
APPROVE=auto bun run lesson-19 approval    # 寫出去了
```

Hermes's default is **automatic denial**, and the reason has two layers
(`delegate_tool.py:60-76`):

```
安全  子 agent 的動作沒有人看得到，不該有收不回來的副作用
活性  子 agent 跑在 worker thread 裡，拿不到互動式的批准 callback，
      掉回 input() 會跟父進程的 TUI 搶 stdin —— 死鎖
```

> The second layer is why this comment is worth copying. "Subagents should not
> have side effects" is a policy you can argue with; "not doing this deadlocks"
> is a fact.
>
> A safe default that also solves a liveness problem does not get removed when
> somebody is in a hurry.

Hermes has `delegation.subagent_auto_approve` to turn it on, and the comment
says `opt-in YOLO for cron/batch` — honestly labelled as what it is.

---

## Step 4: when it breaks, can you tell which step

```bash
bun run lesson-19 locate
```

```
真相（demo 自己記的）　　　　父 agent 收到的 tool result：
  統計 checkout 的錯誤碼    工具成功　最常見的是 E-400。
  統計 inventory 的錯誤碼   工具失敗　最常見的是 E-118。   ← 檔案根本讀不到
  統計 notify 的錯誤碼      工具成功　最常見的是 E-402。
```

Delegation **simultaneously** improves and degrades observability:

| | Delegated | Single agent |
|---|---|---|
| "which step broke" | ✓ every subtask has a name | ✗ the error is scattered through a long chain of tool calls |
| "did anything break" | ✗ **a natural-language summary sits in between** | ✓ the tool result is right there in context |

> A summary is not evidence. This is [Lesson 29](../lesson-29-evidence/)'s
> conclusion in its delegation form: a child's summary and an assistant's
> self-report are the same kind of thing — generated by a model, looking very
> much like a conclusion, with nothing guaranteeing it corresponds to what
> happened.
>
> The fix is structural in the same way: return the child's tool-result counts
> (how many succeeded, how many failed) **alongside** the summary, not the
> summary alone.

---

## Step 5: measured — one agent doing three things vs three agents doing one each

```bash
PROVIDER=gemini bun run lesson-19:agent
MODE=delegate PROVIDER=gemini bun run lesson-19:agent
```

Same question (the most frequent error code in each of three services), same
corpus, same model. The verdict is entirely deterministic: `includes()` against
the three error codes, plus the caveat about the "old numbering scheme".

**Real Gemini 3.6 Flash, three runs each:**

| | Model calls | Subagents | Tokens (total) | Error codes | Caveat |
|---|---|---|---|---|---|
| solo | 6 / 6 / 4 | 0 | 11,251 / 9,718 / 9,983 | 3/3 3/3 3/3 | 有 有 有 |
| delegate | 23 / 23 / 22 | 3 | 35,203 / 41,546 / 39,147 | 3/3 3/3 3/3 | 有 有 有 |

```
正確率   一樣（3/3 vs 3/3）
成本     3.9 倍 token、3.9 倍模型呼叫
```

### The prediction was half right

> **The right half**: multi-agent was not smarter, it only paid more
> communication cost. And the cost is larger than predicted — the guess was
> 1.5-2x, the reality is **3.9x**.
>
> The wrong half: the caveat was predicted to be dropped at the summary layer.
> It was not; it survived 3/3. The subagent handling inventory wrote it into its
> summary every time.

The second point is worth recording, because it is a lesson **in the opposite
direction**:

> A mechanism designed specifically to induce information loss (put the caveat
> in the file header) did not lose it once. **That does not mean delegation
> never loses information**; it means **this task was too easy**: the caveat was
> three lines into the file and tagged with `NOTE:`.
>
> Same family of error as Lesson 16's first round and Lesson 30's first round:
> a negative result has to first prove the test can discriminate (proposed
> principle 10).

### Where the 3.9x comes from (this is the useful part)

The trace says it: **every subagent re-explored from scratch**.

```
→ delegate_task  "Analyze logs/notify.log …"
    ↳ read_file(logs/notify.log)      ← 它的工作
    ↳ list_files()
    ↳ read_file(package.json)
    ↳ read_file(logs/checkout.log)    ← 別人的工作
    ↳ read_file(logs/inventory.log)   ← 別人的工作
    ↳ list_files(logs)
  ← 摘要 901 字，工具 6 次
```

The parent had already run `list_files`, but that knowledge **does not cross the
boundary**. Every child has to work out where the files are by itself.

> What delegation saves is the parent's context; what it pays is every child's
> re-exploration. When the subtasks are small and independent, re-exploration
> costs **more** than it saves.
>
> Which also makes the conditions for delegation paying off clear: **the
> subtask must be big enough** (so exploration is a small fraction), **its
> intermediate process must be messy enough** (otherwise there is nothing to
> save), and **its summary must genuinely be much shorter than the original**.
> When none of those hold, you have merely split one thing into four
> conversations.

### This is not "do not use multi-agent"

When isolation is genuinely required (different permissions, different models,
different tool sets, mutually hostile inputs), that boundary is the thing you
want, and 3.9x is its price. This lesson's contribution is printing the price
tag, not telling you not to buy.

---

## What this lesson deliberately leaves out

| Left out | Why |
|---|---|
| running subagents in parallel | Hermes has it (ThreadPoolExecutor plus a batch mode). It makes wall-clock look better but **does not change token cost by a cent** — and token cost is what this lesson measures |
| role play (Researcher / Writer / Reviewer) | that is prompt design, not mechanism. What is worth studying in CrewAI is not the role names but how task dependencies are expressed |
| live streaming of a subagent | Hermes has `delegation_live_log.py` (424 lines, a per-entry log you can `tail -f`). Good thing, but it belongs to observability |
| subagents on a different model | very practical (cheap models for subtasks), but that is Lesson 26's cost question, not delegation's mechanism |
| how to do recursive delegation properly | it is simply forbidden here. Allowing it needs a depth budget plus a global token budget, which is Lesson 24's shape |

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| the subagent knows nothing | that is the design. To make it know, write it into the `context` argument |
| the subagent keeps saying "I need to ask the user" | `clarify` is blocked, and there really is nobody on its side. Put the information in `context` |
| delegate mode is not faster | this lesson runs sequentially (see "deliberately left out"). And parallel would not reduce tokens either |
| the caveat got dropped | that is the thing being measured. Look at the subagent-summary section of the output and **identify which layer dropped it** |
| `lesson-19:agent` demands PROVIDER | that program measures model behaviour and needs a key |

---

## Exercises

### Exercise 1: replace the summary with a structured report ⭐

Right now the child returns a paragraph of prose. Change it to
`{ summary, toolCalls: n, failures: n, filesRead: [...] }`, then re-run Step 4's
`locate`.

**This is Lesson 29's approach moved onto delegation**: do not ask the child
what happened, record what happened.

### Exercise 2: make information actually get lost ⭐⭐

Step 5's caveat survived because the task was too easy. Design one that will not:
bury the caveat mid-file, drop the `NOTE:` marker, or make it hold only when
**two files are cross-referenced** (for instance, checkout's E-402 and notify's
E-402 are actually the same batch of requests).

Write down which run you expect it to drop on before you run it.

### Exercise 3: parallel plus a budget ⭐⭐

Switch to `Promise.all` for the three subagents, then add a **global token
budget**: stop delegating once it is exceeded.

Doing it exposes an unanticipated problem: parallel children cannot know the
budget was already spent by someone else. This is Lesson 24's `Budget` in its
multi-agent form.

### Exercise 4: break the blocklist five ways ⭐⭐⭐

Remove one at a time and design an experiment proving why each is there:

| Removed | What to prove |
|---|---|
| `delegate_task` | exponential expansion (`BLOCK=off` already shows it; switch to measuring tokens) |
| `clarify` | the child hangs or deadlocks |
| `memory` | two children write at once and only one survives |
| `send_message` | the parent does not know the email went out |
| `cronjob` | the child scheduled a job that runs tomorrow under the parent's identity |

Finishing the last one loops back to Lesson 18: that job can be anything,
including one that restarts the daemon.

---

## Compared with the source

| Concept in this lesson | Hermes |
|---|---|
| the child's contract (fresh conversation / own task_id / summary return) | the docstring at `tools/delegate_tool.py:1-19` |
| the five forbidden tools | `tools/delegate_tool.py:46-54` |
| child approval defaults to denial, and the deadlock reason | `tools/delegate_tool.py:60-95` |
| per-entry streaming (`tail -f` a child) | `tools/delegation_live_log.py:113-139` |
| how a background fan-out notifies the parent on completion | `tools/process_registry.py:2131-2145` |
| delegated sessions stay out of cross-session search | `tools/session_search_tool.py:38-40` (`_HIDDEN_SESSION_SOURCES`) |

> That last row is small and exactly right: a child's session **should not**
> appear in [Lesson 17](../lesson-17-search/)'s cross-session search results.
> They are implementation details, not the user's conversation with you — mixing
> them in only floods the results. Same problem as Lesson 17's flood of cron
> summaries.

### CrewAI as a second reference

What is worth studying is not role names like Researcher / Writer / Reviewer but
three things: how task dependencies are expressed, when context should be
isolated, and what happens to the whole workflow when one agent fails. Step 5's
experiment was designed to answer the second.

---

## Next lesson

**The Hermes part is now complete**: 15 memory → 16 skills → 17 search →
18 scheduling → 19 delegation. Looking back, those five lessons answer five
facets of one question:

> How does a long-lived agent keep existing while you are not watching?

**In reading order**, next is the evidence thread:
[Lesson 29](../lesson-29-evidence/) → 28 → 37. This lesson's Step 4 already
gave its opening line — **a summary is not evidence**.
