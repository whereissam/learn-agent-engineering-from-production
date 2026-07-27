# Build an AI Agent From Scratch

> For people who can code but have no idea how AI agents actually work.
> Every lesson is a small program you can run, read in one sitting, and change.
>
> **Written while reading the source of [Pi](https://github.com/earendil-works/pi),
> [OpenWorker](https://github.com/andrewyng/openworker), and
> [Hermes](https://github.com/nousresearch/hermes-agent).**

> 🇹🇼 中文版是主要版本，內容更完整：[README.md](README.md)
> （English version below is a condensed translation.)

## What this is

Everyone is talking about AI agents. But open Claude Code or Cursor and you
hit tens of thousands of lines; most people give up two files in.

The core of an agent is small. **About 50 lines.** Everything else is
engineering: UI, session management, permissions, error handling, context
compaction. Important, but not the agent.

This series pulls those 50 lines out, lets you see them, then adds one layer
at a time.

## Why learn this when Claude Code already exists?

There is a distinction worth being precise about:

> **"Using Claude Code / Codex"** and **"building agent systems"** are
> different skills.

The vendors have solved the general layer: understand a request, read and
write files, call a terminal, edit code, run tests. You rarely need to
rebuild that.

**But what they shipped is a general-purpose executor.** It does not know how
your company works, what your product's rules are, when to stop, which
operations are too risky, or what "correct output" means for you.

Say you point Claude Code at a robot observability product. It can write the
code. You still have to decide:

- How does it know what each telemetry field means?
- How does it tell a real fall from sensor noise?
- Which code may it change alone, and which touches robot safety and needs
  a human?
- What simulations, tests, or replays count as "verified"?
- On failure: retry, change approach, or stop and escalate?
- After context compaction, how does it not forget what it already did?
- How do you know it saved you time rather than creating review work?

The model cannot decide any of that for you.

### An analogy

> Claude Code is a very capable new engineer.
> Agent development is designing the SOPs, permissions, CI, test environment,
> and review process.

However good the new hire is, you don't hand them production root access and
say "make the product good."

What is usually hard is not the agent but the **harness** around it: guides,
sensors, tests, permissions, sandboxes, feedback loops, exit conditions.

### When you don't need this

If you just want to write code, refactor a few files, explain a codebase,
write unit tests, or fix CI, then learning the tools well plus `AGENTS.md`,
skills, MCP, and basic CI is probably enough.

A lot of what gets called "agent development" is an LLM in a while loop with
a few tools. There is limited value in rebuilding that.

### When you do

**When you put an agent inside your product, rather than using one to build
your product.**

The value then comes from data contracts, event time alignment, reliable
tools, domain context, permission boundaries, evaluation sets, replay
verification, human approval, and observability. That is agent engineering.

### The four layers, and what this series covers

| Layer | Content | Here |
|---|---|---|
| **1. Agent mechanics** | model → tool call → tool result → next → stop | ✅ Lessons 1-5 |
| **2. Harness engineering** | guides + sensors: `AGENTS.md`, tests, typecheck, review, permissions | ✅ Lessons 2, 5, 8, 9 |
| **3. Domain tools** | an agent's ceiling is what it can operate, not prompt wording | ✅ Lesson 6 |
| **4. Evaluation** | fixed cases and scoring; otherwise you cannot tell if a change helped | ✅ Lesson 7 |

Layers 3 and 4 are where the moat is, so this series **does not tell you to
figure them out yourself** - Lesson 6 designs a domain toolset from scratch,
and Lesson 7 runs the full measure → find → fix → confirm loop.

## Lessons

**Pi (agent engine)**

| # | Topic | What you learn |
|---|---|---|
| [01](lesson-01-agent-loop/) | Minimal agent loop | Tool calling, conversation history, provider abstraction |
| [02](lesson-02-tools/) | More tools | write/edit/bash, output truncation, approval gate |
| [03](lesson-03-streaming/) | Streaming and interruption | Token output, Ctrl+C, repairing state after an abort |
| [04](lesson-04-sessions/) | Session persistence | Save, resume, why a session is a tree not an array |
| [05](lesson-05-compaction/) | Context compaction | What to do when a conversation gets too long |
| [06](lesson-06-domain-tools/) | Domain tools | Layer 3: turning a general agent into a specialist |
| [07](lesson-07-evaluation/) | Evaluation | Layer 4: measure → find → fix → confirm no regression |

**OpenWorker (productising the harness)**

| # | Topic | What you learn |
|---|---|---|
| [08](lesson-08-permissions/) | Risk classes and permissions | From a boolean to four risk levels; why AUTO still can't escape the sandbox |
| [09](lesson-09-unattended/) | When nobody is there | Unattended approval, inbox queue, suspending and waking an agent |

**Hermes (long-running agents)**

| # | Topic | What you learn |
|---|---|---|
| [15](lesson-15-memory/) | Long-term memory | Three hooks, `MEMORY.md`/`USER.md`, **memory as a persistent injection surface** |
| [16](lesson-16-skills/) | Skills and self-improvement | Progressive disclosure, review gate, tool allowlists |
| [17](lesson-17-search/) | Cross-session search | Ranking hygiene, recall blindness, why there is no LLM here |

### One thing worth noticing

From Lesson 1 to Lesson 17, the core while loop **barely changes**. Lesson 6
swaps in an entirely different toolset and `runTurn` is untouched.

> **The agent is small. The engineering around it is large.**

## Requirements

Either:

- **[Bun](https://bun.sh) 1.3+** (recommended - runs `.ts` directly, reads `.env`)
- or **Node.js 22+**

Plus one API key, or **no key at all** (see the fake provider below).

## Install

```bash
git clone <this repo>
cd agent-lessons
bun install     # or npm install
```

## API keys

Put one in `.env` (already gitignored):

```bash
cp .env.example .env
```

```bash
GEMINI_API_KEY=AIza...
# ANTHROPIC_API_KEY=sk-ant-...
# OPENAI_API_KEY=sk-...
```

Only one is needed. With several set, selection order is
`anthropic → openai → gemini`, or force it with `PROVIDER`.

| Provider | Sign up | Notes |
|---|---|---|
| **Gemini** | <https://aistudio.google.com/apikey> | Free tier, easiest start |
| **Anthropic** | <https://console.anthropic.com/> | |
| **OpenAI** | <https://platform.openai.com/> | |

### No key: the fake provider

```bash
PROVIDER=fake bun run lesson-01
```

`fake` is a scripted model. It does not think, but **the agent loop is
entirely real** - real tool calls, real file reads, real error handling.
Stepping through it with a debugger is the fastest way to understand the loop.

(Every real agent project needs something like this for tests, otherwise
every test run costs money and is not reproducible.)

## Run

```bash
bun run lesson-01      # … through lesson-17
bun test               # 74 tests, no API key needed
```

Lessons 8, 9, 15, 16, 17 are offline demos and never need a key.

### Reset the playground

From Lesson 2 on, the agent really edits files in `playground/`:

```bash
bun run reset
```

## Cost

A Lesson 1 conversation reads 3-5 small files, usually under US$0.05. But
**token use grows quickly** because the full history is resent every turn.
Lesson 5 addresses that. Use a cheap model, or `PROVIDER=fake`.

## Status and known gaps

Lessons 1-7 have all been run end to end against a live model
(Gemini 3.6 Flash). Lessons 8-9 and 15-17 are offline demos. `bun test`
runs 74 tests without a key.

Not yet verified: the Anthropic and OpenAI providers are implemented and
typecheck, but have not been exercised against live models.

Full roadmap and gaps: [docs/TODO.md](docs/TODO.md).

## Credits

Architecture, naming, and many design trade-offs are taken from:

- **[Pi](https://github.com/earendil-works/pi)** by [badlogic](https://github.com/badlogic) - agent runtime
- **[OpenWorker](https://github.com/andrewyng/openworker)** - desktop AI coworker
- **[Hermes](https://github.com/nousresearch/hermes-agent)** by Nous Research - personal agent platform

Every lesson ends with a table mapping its concepts to specific files and
line numbers in those projects, so you can go read the production code.

License: MIT
