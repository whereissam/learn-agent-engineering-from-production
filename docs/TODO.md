# Roadmap / TODO

> [繁體中文](TODO.zh-TW.md)

The parts of this series that are not written yet, and why they are not.

> Ordering principle: **do the portable things almost everyone will need first**.
> Pure product engineering (packaging, auto-update, GUI) ranks low, because it has
> nothing to do with the agent itself.

## The boundary of this series

The most important rule first, because it decides whether a given repo is worth
reading:

> **The subject is not "study every AI repo you see" but:
> extract, from existing open-source projects, one complete path for learning
> agent development from zero.**

So the criterion is not "is this project popular" or "is this technology
important" but the five questions below.
**Run any new repo through this table first**:

| Question | Worth prioritising only if "yes" |
|---|---|
| 1 | Does it have a real agent loop or workflow? |
| 2 | Does it handle one of tools / context / memory / permission / session? |
| 3 | Can a small runnable **failure** experiment be extracted from it? |
| 4 | Is this problem not already fully covered by existing lessons? |
| 5 | With that mechanism **switched off**, is a concrete failure visible? |

Questions 3 and 5 are this series' real bar, and every earlier lesson's value comes
from them: Lesson 15 switching sanitisation off (attacks 3/3 successful), Lesson 17
switching demotion off, Lesson 27 switching the floor off (a sous vide recipe
ranking 4th). A mechanism you cannot switch off cannot have its value stated.

### The result of running everything through it

| Project | 1 loop | 2 core problem | 3 runnable experiment | 4 uncovered | 5 switchable | Verdict |
|---|---|---|---|---|---|---|
| Pi | | | | | | main line 1-7 |
| OpenWorker | | permissions | | | | main line 8-12 |
| Hermes | | memory | | | | main line 15-19 |
| the four AI Search projects | | tools | | | | main line 20-27 |
| Mastra | | everything | | | | main line 30-33 |
| OpenCode | | session | | | | main line 28-29 |
| OpenHands | | environment | | | | main line 36-37 |
| Restate / SRT | | execution boundary | | | | main line 34-35 (**not agent projects, but the problems are**) |
| **vLLM** | | serving | | | | **not in the main line** → extension |
| **Fish Speech** | | TTS | | | | **not included** |

> Note that vLLM and Fish Speech **pass questions 3, 4 and 5** — they are good
> projects and good experiments can be extracted from them.
> What blocks them is questions 1 and 2.
> A criterion that only says no to bad things is useless;
> this table's value is precisely that it says no to **good** things.

### New candidate: vLLM Semantic Router (surveyed 2026-09-09)

[`vllm-project/semantic-router`](https://github.com/vllm-project/semantic-router)
— Go, a routing layer in front of a fleet of models.

| Question | Answer |
|---|---|
| 1 real loop | no. It is a dispatcher, not an agent |
| 2 core problem | tools (selection), and model routing |
| 3 runnable experiment | yes, and one already exists — it is Lesson 32's |
| 4 uncovered | **no.** Lesson 32 covers the tool-selection half |
| 5 switchable | yes, and they publish the numbers for it switched off |

**Verdict: not a new main-line lesson. Two uses instead**, both already applied:

1. **Lesson 32's production comparison, done.** Its "semantic tool selection"
   feature is the same mechanism Lesson 32 builds, at a scale this repo cannot
   reach: 741 tools, 127315 tokens of catalogue reduced to 1084, measured on the
   Berkeley Function Calling Leaderboard. Its accuracy table (49 tools 94% → 94%,
   207 tools 64% → 94%, 417 tools 20% → 94%, 741 tools 13.62% → 43.13%) is the
   answer to the awkward result in Lesson 32's own measurement, where the flat
   128-tool baseline still won on accuracy: **a 200-tool catalogue sits on the
   near side of the crossover.** Without their table, Lesson 32 would have had to
   either report a mechanism that did not pay for itself, or quietly not mention
   it.
2. **Prod 54 (model routing) has a source now.** That lesson was listed with a
   `—` in the source column. Routing on a classifier rather than a static rule is
   what it does; whether it becomes a lesson still has to pass question 5.

The reason it is not a main-line lesson is question 1, the same reason vLLM
itself is not: it sits under the agent, not in it. It also selects with
embeddings rather than BM25, which is a Lesson 22 decision, not a new subject.

## Other courses on the same subject, and what this one does differently

Surveyed 2026-09-09, after five were sent in. **None of them changes this repo's
plan**, but writing down what they do well is the only way the positioning
sentence stays honest instead of becoming marketing.

| Repo | Shape | Stars | What it is |
|---|---|---|---|
| [microsoft/ai-agents-for-beginners](https://github.com/microsoft/ai-agents-for-beginners) | 18 lessons, README + video + Python sample each | 74300 | teaches the Microsoft Agent Framework and Foundry; needs an Azure account |
| [rohitg00/ai-engineering-from-scratch](https://github.com/rohitg00/ai-engineering-from-scratch) | 523 lessons in 20 phases, ~342 hours | 53600 | the whole ML stack from linear algebra up; "implement it by hand, then run the same thing through the production library" |
| [datawhalechina/Agent-Learning-Hub](https://github.com/datawhalechina/Agent-Learning-Hub) | 8 stages plus an 11-level project ladder | 7700 | Chinese; curated links plus practice, covering LangGraph, Hermes, OpenHands, GPT Researcher |
| [WenyuChiou/awesome-agentic-ai-zh](https://github.com/WenyuChiou/awesome-agentic-ai-zh) | roadmap over 240+ resources, trilingual | 6700 | sequencing and pointers, deliberately not duplicating the docs it points at |
| [bryanyzhu/agentic-ai-system-course](https://github.com/bryanyzhu/agentic-ai-system-course) | 22 chapters of patterns, EN + ZH | 605 | framework-agnostic system design; explicitly not a walked-through project |

### The one honest difference

Two of those five already point at the **same source projects this repo reads** —
OpenCode, Hermes, OpenHands, GPT Researcher. So the sources are not the
difference, and claiming they are would be false.

The difference is what happens to a source after it is chosen:

| | those courses | this repo |
|---|---|---|
| the source | named, linked, summarised | cloned into the tree, read to specific line numbers, cited as `file.ts:12` |
| the code | a sample that demonstrates the concept working | a program that **fails first**, with the mechanism switched off |
| the claim | "you can do X" | a number from a real run, in the README, with the provider and model named |
| when the claim is wrong | usually not discoverable | `check:i18n`, `check:citations` and the contract tests catch drift; the TODO records the corrections |

Lesson 32 is this week's example of the difference, in both directions. The
plan said "the cost is low" and the source citation said `tool-search.ts:13`;
building it produced a wrong line number, a provider-level ceiling nobody had
mentioned, a 3.5x token result, an accuracy difference too small to claim, and a
measurement bug in the harness that had briefly looked like a finding about the
model. **None of those five things survives a summary of the source. They only
appear if you run it.**

### What they do better, and this repo will not

Saying this out loud is what keeps the paragraph above from being a sales pitch:

- **ai-engineering-from-scratch** covers the ML foundations — backprop, attention,
  tokenizers — that this repo skips entirely. If you want to know how the model
  works rather than how to build around one, it is the better book.
- **Agent-Learning-Hub** and **awesome-agentic-ai-zh** are better *indexes*. This
  repo reads twelve projects; they point at hundreds. Someone deciding what to
  learn should start there, not here.
- **ai-agents-for-beginners** has video and 50+ translations. This repo has two
  languages and a checker to keep them honest, and that is already the limit.
- **agentic-ai-system-course** is framework-agnostic *by design* and covers
  coordination and design-canvas territory this repo has no lessons for.

The scope here stays narrow on purpose: one path, twelve real projects, every
mechanism rebuilt small enough to switch off and measure. A reading list is a
different product and this repo should not become one.

### What the survey actually turned up: three candidates

Diffing those five curricula against the 32 written lessons and running every
survivor through the criterion table at the top of this file. Most of what the
courses cover is either already here or fails question 3 or 5, and the rejects
are listed after the candidates so nobody re-proposes them.

#### ~~Candidate 1: the cache you break yourself~~ → **Lesson 38, done**

| Question | Answer |
|---|---|
| 1 real loop | yes. It lives in how the loop assembles a request |
| 2 core problem | context, and cost |
| 3 runnable experiment | yes, and it is already measured — below |
| 4 uncovered | yes. One sentence in Lesson 05, one clause in Lesson 26 |
| 5 switchable | yes, and the failure is total rather than gradual |

Measured on `gpt-5` before proposing it, which is the only reason it is in this
table and not in the rejects:

```text
turn 1 (cold)              prompt=8025 cached=0
turn 2 (same prefix)       prompt=8025 cached=7936
turn 3 (same prefix)       prompt=8025 cached=7936
turn 4 (timestamp first)   prompt=8035 cached=0
turn 5 (timestamp first)   prompt=8035 cached=0
```

One timestamp at the front of an otherwise identical prompt costs 7936 cached
tokens on **every** subsequent turn.

**The half that makes it a lesson rather than a tip**: the mechanisms this series
already teaches sit exactly where they destroy the cache.

| Lesson | What it does | What that does to the prefix |
|---|---|---|
| 15 memory | recalled memories go into `buildSystemPrompt()` | rewrites the very front, every turn |
| 32 tool search | `session.requestTools()` grows as tools load | ~~the tool list is part of the prefix~~ **wrong, see below** |
| 05 compaction | rewrites history | invalidates everything after the rewrite point |
| 31 processors | mutate content on the way to the model | depends entirely on where they hang |

> **The Lesson 32 row was wrong, and building the lesson is what caught it.**
> Measured hit rate for the growing tool list: 96%, not 0%. Two reasons, both
> worth more than the claim they replace:
>
> 1. **it grows by appending.** Growth does not break a prefix; rewriting what
>    came before it does. A tool list that gains entries at the end is as safe as
>    a message list that gains turns. The shape to fear is a tool list that is
>    *reordered* — same tools, different order — which is what a `Set`, a
>    directory listing or a relevance ranking produces.
> 2. **the block order in your request object is not the order the provider
>    hashes.** The numbers only reconcile if `tools` behaves as though it sits
>    after `messages`. `prefix.ts` therefore carries both orderings and labels
>    one of them as measured rather than documented.
>
> This is the third entry in this file to be corrected by running the thing it
> described, after Lesson 32's `:13` citation and the tracing-in-Lesson-26 claim.
> The pattern is consistent enough to be a rule: **a plan's confident sentence
> about a mechanism is a hypothesis until the mechanism runs.**

So the lesson turns the series on itself, the way the 2026-08-02 round did to
three write-ups. That is the part no other course can write, because it requires
having built the other lessons first.

> This also retires a deferral. The "not made into lessons" table below parked
> caching behind "wait until both Restate and OpenCode have been read".
> OpenCode has been read (Lessons 28 and 29). The condition has expired.

#### ~~Candidate 2: the tool description changed after you approved it~~ → **Lesson 13, done**

| Question | Answer |
|---|---|
| 1 real loop | yes |
| 2 core problem | tools, and permission |
| 3 runnable experiment | yes: a local MCP server that answers `tools/list` differently the second time |
| 4 uncovered | yes. Lesson 12 names the asymmetry and stops there |
| 5 switchable | yes: pin a hash of (name, description, schema) at approval, or do not |

Lesson 12 already says the important half out loud — *"who wrote the description
| somebody else, and you cannot change it"* — and never asks what happens when
they change it **after** you approved it. Switching the pin off should let a
re-described tool be called with its new semantics; switching it on should refuse
and say which field moved.

Composes with two written lessons rather than duplicating them: Lesson 8
(approval was granted to *what*, exactly) and Lesson 32 (a tool whose description
changed between `search` and `load` — the phases are already there to hang it
on).

**Built, and it took the vacant number 13**, beside Lesson 12 where it belongs.
Measured on `gpt-5`, three runs per policy:

| policy | sent to the attacker | answered the question |
|---|---|---|
| off | 3/3 | 3/3 |
| block | 0/3 | 0/3 |
| fallback | 0/3 | 3/3 |

The third row is the one the plan did not have. `block` is the obvious defence
and it is useless: it withholds the tool the task needed, so the agent answers
nothing, and a control that turns every upstream change into an outage is
switched off within a week. `fallback` — keep the tool, use the description that
was *approved*, ignore what the server just sent — is safe and still works.

#### Candidate 3: when an agent is the wrong tool

| Question | Answer |
|---|---|
| 1 real loop | **no source project to read** |
| 2 core problem | evaluation |
| 3 runnable experiment | yes: the same 20 tasks as a deterministic script and as an agent |
| 4 uncovered | yes, here and everywhere else |
| 5 switchable | trivially |

All four course repos tell you to "know when NOT to use an agent". **None of them
measures it.** The experiment is to run one task set both ways and compare
success rate, cost, latency and variance across repeated runs — the last of those
being the number that usually decides it and the one nobody reports.

It fails question 1, and takes the same exemption Lessons 6, 7 and 25 already
take: the open-source projects expose a gap rather than a solution, and the
lesson has to say so. Lower priority than the other two precisely because of
that.

#### Rejected, with reasons, so they do not come back

| Topic | Where it came from | Why not |
|---|---|---|
| A2A / NLWeb protocols | microsoft Lesson 11 | plumbing with no switchable failure, the same reason `connectors/` was deferred |
| planner / executor / reviewer patterns | Agent-Learning-Hub Stage 4, agentic-ai Ch.09-10 | already rejected above as nouns rather than problems; Lessons 19, 24 and 33 hold the real questions |
| metacognition, self-evolving agents | microsoft Lesson 9, agentic-ai Ch.21 | Lesson 29 already establishes that a self-report is not evidence, and Lesson 16 covers accumulation |
| parallel tool calls | agentic-ai Ch.17 | genuinely covered: Lesson 01 introduces them, Lesson 24 fans them out |
| browser / computer use | Agent-Learning-Hub Stage 6, microsoft Lesson 15 | a real gap, but a heavy build whose failure mode (selector brittleness) is well documented elsewhere. Stays deferred |
| deploying scalable agents | microsoft Lesson 16 | not an agent problem |

### 2026-09-10: the three missing source repositories, and a citation audit

Three of the twelve projects this series claims to have read line by line were
**never cloned into this tree**: Pi (Lessons 1-6), OpenWorker (8-10, 12) and
Hermes (15-19). Everything else was here; those three were cited from notes.

That left roughly a hundred `file.py:NN` claims that nothing could check.
`check:i18n` compares the two language versions of a lesson, so it catches a
citation that appears in one and not the other — it cannot tell whether either
is right, because the cited file was not on the disk.

All three are now cloned and added to `.git/info/exclude` alongside the others:

```bash
git clone --depth 1 https://github.com/earendil-works/pi           pi
git clone --depth 1 https://github.com/andrewyng/openworker        openworker
git clone --depth 1 https://github.com/NousResearch/hermes-agent   hermes-agent
```

**The audit came back clean.** `scripts/check-citations.ts` resolves 362
citations across 14 source repositories and every one points at a line that
exists. The two headline citations were checked by eye as well:

- `agent-loop.ts:170-272` is exactly Pi's outer and inner loop, ending at
  `agent_end` — which is what Lesson 1 says it is
- `risk.py:18` is `class RiskClass(str, Enum):` with the five classes, which is
  what Lesson 8 says it is

That is a better result than this file's recent record suggested it would be.
Three entries here have been corrected this month by running the thing they
described; the citations into unread repositories turned out to be the part
that held.

**What the checker proves is the weak half**, and it says so in its own header:
the file exists and the line is inside it. A citation that has slid twenty lines
and still lands in the file passes. Pinning the line's *content* was considered
and rejected — it would fail on every upstream reformat and be deleted within a
month, which is the same reasoning the contract tests use.

Two things found while building it, both recorded because they are the same
class of error the checker exists to catch:

- it first reported ten broken citations that were fine. They pointed into
  **this repo's own files**, which it was not indexing
- narrowing ambiguous citations to the repositories a document names then
  reported Lesson 35's `engine.ts:173` as broken. It is correct — line 173 of
  `shared/permissions/engine.ts` is the `WRITE_LOCAL` check the lesson
  describes — and the README simply never uses the word "shared". **A checker
  confident enough to accuse needs the same verification as the thing it checks.**

**Cloned since, on 2026-09-11**: `OpenHands/software-agent-sdk`, which Lesson 36
needs. It stays out of the count of twelve until a lesson cites it, because
"cloned" and "read line by line" are different claims and the Credits table only
makes the second one. The inventory, and the decision it unblocked, are in the
Lesson 36 section below.

## The whole picture

```
━━━ Main line: build an agent from zero ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Lesson 01-05   the engine · Pi           loop / tools / streaming / sessions / compaction  ✅
Lesson 06-07   your domain · yourself    domain tools + deterministic evaluation           ✅
Lesson 08-12   into a product · OpenWorker  permissions / unattended / server / MCP        ✅
               (11 merged into 12, 13 into 18, 14 deleted)
Lesson 15-19   running for months · Hermes  memory / skills / search / scheduling / delegation  ✅ all
Lesson 20-27   a whole domain · AI Search   search / crawl / retrieval / research loop     ✅
Lesson 28-37   the ring around the loop    evidence / schema / durable / sandbox           ✅ 28-35, 37
               28-29 OpenCode (evidence of execution) ✅ / 37 OpenHands (event model) ✅
               30-33 Mastra ✅ (the abstractions after schema)
               34 Restate (crash) ✅ / 35 Anthropic SRT (sandbox) ✅
               36-37 OpenHands (the execution world / action-observation)

━━━ Prod (Lessons 50-59): things you only meet after launch; not in the reading order ━━━

Lesson 50      tool calling on local models  why it breaks after switching to Qwen / Llama (vLLM)  to write
Lesson 51      inference serving (optional)  batching / KV cache / prefix; needs a GPU          to write
Lesson 52      streaming speech output   cancellation / stale audio / handover (Fish Speech as a tool)  to write
Lesson 53      tracing / observability   spans, cost attribution (Mastra, Phoenix)        to write
Lesson 54      model routing / fallback  resuming an old session on a new provider (vLLM Semantic Router)  to write
Lesson 55      OAuth / credentials       token lifetimes, multi-user isolation            to write
Lesson 56      tools that cost money     may an agent decide to pay by itself (x402)      to write
Lesson 57      data boundaries           what may enter trace / memory / a subagent       to write
Lesson 58-59   (reserved)                packaging, auto-update, monitoring…              —
```

The Prod part's admission criteria differ from the main line's, and must be stated
explicitly or it becomes a dustbin:

> The main line asks "**is** this mechanism part of an agent".
> The Prod part asks "**the agent already runs and is about to be handed over** —
> what surfaces only then".

So vLLM and Fish Speech are not eliminated, just **positioned later**: you need a
working agent before you meet "I want to swap the OpenAI API for a local model" or
"I want it to speak". Read them earlier and there is nowhere to hang what you
learn.

**The Prod part is not in the reading order**, because it is not "the next step"
but "another stage". Before finishing the main line's 29 steps, not one lesson of
it is needed.

**The AI Search part is back in the main line** (where it always was, at 20-27),
because what it teaches is "how to build tools, data and evaluation for a domain" —
a large-scale instance of Lesson 6, not a side branch into another domain. That is
what distinguishes it from Voice and Inference.

**The gaps in the numbering** exist so that a part growing fat does not collide
with another: the AI Search part was originally numbered on from 17, and one
expansion pushed every later number along, so the extension parts start at 50.

Numbering is not reading order. A lesson number cannot change once published (links
break), but "what order should someone starting from zero read in" is a separate
question — see
[the reading order from scratch](#the-reading-order-from-scratch) below.

### The order of the next steps

Do not treat 10-14 as one block to write through. After running each lesson past
the criterion at the top (portable plus almost everyone will need it), the
remaining route is:

```
Lesson 10 (agent server) ✅  →  Lesson 12 (MCP) ✅  →  Lesson 30 (schema compat layer) ✅
```

> The tool schema an MCP server hands you is **not yours to change**. So "Google
> does not take null, claude-3.5-haiku does not honour a string's min/max" can be
> worked around right up until Lesson 12, and at Lesson 12 it must be solved.
>
> Let the reader hit the wall first, then hand over the tool. Teaching it the other
> way round turns into introducing an abstraction layer out of thin air.

After Mastra come two more sources that **fill in abstraction layers** (decided
2026-07-28, see the two sections at the end):

```
30 schema compat ✅ → 31 processor ✅ → 32 tool search ✅ → 33 durable state machine ✅
                                                        ↓
                              34 Restate: what happens after a step in the state machine crashes
                              35 Anthropic SRT: once approved, what the process can actually touch
```

> **The criterion for choosing sources has not changed**: not "I feel an agent
> should have X" followed by designing X, but "why does X exist in an open-source
> project → find the real failure it solves → switch X off and run it → reduce it
> to a minimal implementation → wire it back into the loop with a real model".
> Lessons 34 and 35 were added by that rule; tracing, model routing and a unified
> `ToolResult` format were **deliberately not made lessons**, with the reasons at
> the end.

Other conclusions from the same review round (details in each section):

| Lesson | Disposition |
|---|---|
| 10 GUI | still deferred. Tauri plus React plus Python, not portable |
| 11 OAuth | split: the protocol half folded into 12. **The number was reused for Lesson 11, the credential lifecycle** (expiry, ownership, revocation). The common abstraction over 25 connectors stays deferred to Prod 55 |
| 13 scheduling | folded into Lesson 18, which names it in its own header. **The number was reused for Lesson 13, tool drift** |
| 14 audit log | **deleted**, then the number was reused. **Lesson 14 is now tracing** — the half Lesson 8's Exercise 4 cannot answer |

> Each of those three is now stated **in the lesson it landed in**, and in the
> README's numbering note. They were recorded here and nowhere a reader would
> look, which is why the gap kept reading as an omission.


### Where each project sits (the four are not at the same level of abstraction)

> **Pi is an agent runtime; OpenWorker is a desktop AI coworker product;
> Hermes is a long-running personal agent platform;
> Mastra wraps what the first three do into an API.**

The last two sources are **not agent projects at all**, which is exactly why they
are included:

> Restate is a durable execution runtime and Anthropic SRT is an OS-level sandbox.
> The problems they solve exist in every agent framework, but no framework treats
> them as its subject, so what you read inside a framework is always the "handled
> in passing" version.

The AI Search part is different: it **does not follow a single project**. That
thread crosses SearXNG, Crawl4AI, GPT Researcher and txtai, because "AI search" is
several problems stacked together in the first place.

Mapped onto the layer framework. **This originally said "four layers" and is now
five**: "long-running" used to be stuffed inside Harness, but scheduling and
delegation are not the same class of problem as permissions and sandboxing, and
splitting them out is what makes the README's layers line up with the later parts.

| Layer | Main source |
|---|---|
| 1. single-agent mechanics | Pi (Lessons 1-5) |
| 2. Harness engineering | OpenWorker (8-12) plus Mastra (30-33) plus OpenCode (28-29) plus Restate / SRT / OpenHands (34-37) |
| **3. long-running** | Hermes (15-19, all written) |
| 4. domain tools | you (Lesson 6 teaches the method) plus AI Search (20-27 demonstrates a whole domain) |
| 5. evaluation | you (Lesson 7 teaches the method) plus Lessons 22 and 25 |

> The "you" in layers 4 and 5 is not laziness but **part of this series'
> methodology**: for domain tools and evaluation, **what open-source projects
> expose is the gap, not the solution**.
> Lesson 23's findings after comparing four projects are the evidence:
> none of the four has a retrieval evaluation set, and none has citation
> verification.
> So those two lessons are not "impossible to extract" but **have nothing to
> extract from**.

---

## The reading order from scratch

Lesson numbers were issued **in writing order** (and cannot change once issued;
links break). But a reader starting from zero should not read by lesson number,
because the number is bound to "which project was read", not "what they need to
understand first".

Once the two are separated, each lesson only has to guarantee one thing: its
prerequisites come before it.

This is not a line but a tree. The first version was a single list, which read like
"12 → 30 → 32, jumping around at random". In fact, after the first two threads the
rest are **parallel branches** that are not each other's prerequisites:

```mermaid
flowchart LR
    C["① the engine<br/>01 → 02 → 03 → 04 → 05"] --> D["② your domain<br/>06 → 07"]
    D --> B["③ boundaries<br/>08 → 09 → 35"]
    D --> E["④ evidence<br/>29 → 28 → 37"]
    D --> T["⑤ plugging into other people's things<br/>12 → 30 → 32"]
    D --> S["⑥ running long without dying<br/>10 → 31 → 33 → 34"]
    D --> L["⑦ long-term operation<br/>15 → 16 → 17 → 18 → 19"]
    D -.- W["⑧ a whole domain (skippable)<br/>20 → … → 27"]
```

The order inside a branch was not arranged; **each step grows the next step's
question**:

| Branch | The next question each step grows |
|---|---|
| ③ 08 → 09 → 35 | with risk levels → somebody has to approve → but nobody is awake at 3 AM → and even once approved, nothing yet limits what that process can reach |
| ④ 29 → 28 → 37 | whether the file changed is the filesystem's call alone → generalise to "an interrupted stream" → so history should no longer be a chat log |
| ⑤ 12 → 30 → 32 | MCP's schema is not yours to change → provider differences become unavoidable → after a few servers the tools no longer fit |
| ⑥ 10 → 31 → 33 → 34 | on a server it outlives the terminal → pull per-turn logic out of the loop → the loop must be storable and re-runnable → do the re-run's side effects count |
| ⑦ 15 → 16 → 17 → 18 → 19 | it remembers → that accumulates into ability → it can be retrieved → it can be scheduled → it can be handed to somebody else |

Three deliberate placements:

- **③'s 35 sits right after 8-9**, because Lesson 8's conclusion is "the permission
  engine succeeded 100%" and 35's thesis is "that sentence is only half right".
  Too much distance and the reader forgets that measurement
- **④ starts at 29, not 28**. 29 answers the question Lesson 8 left (the model
  falsely reporting completion), and 28 is its generalisation (not just files but
  the reasoning / tool / text states at interruption). **Give the answer first, then
  the harder version**
- **⑧ can be skipped entirely**. It is one domain's complete demonstration (a
  large-scale version of the method Lesson 6 teaches), not a prerequisite for later
  lessons

### The new lessons' prerequisites (each may depend only on earlier ones)

| New lesson | Prerequisites | Does **not** need first |
|---|---|---|
| 28 recoverable session state | 03 interruption, 04 sessions | 29 |
| 29 evidence of completion | 02 tools, 08 permissions | 28 |
| 30 schema compatibility | 01 the provider abstraction, 12 MCP | 31-33 |
| 31 processor pipeline | 05 compaction, 08 permissions, 26 cost | 30 |
| 32 tool search | 17 or 20 (BM25) | 30, 31 |
| 33 durable state machine | 04 sessions, 09 pausing for approval | 34 |
| 34 crash-safe tools | **33** | 35 |
| 35 sandbox | 08 permissions | 34 |
| 36 the execution world | **35** | — |
| 37 action / observation | 04 sessions, 29 evidence | 36 |

### One suggestion equals several lessons, not one

Taking this round's three suggestions at face value would produce three
"a-bit-of-everything" lessons. The criterion for splitting is **one lesson may have
only one thesis, and that thesis must be breakable on its own**:

| The original suggestion | Split into | Why it cannot be one lesson |
|---|---|---|
| "OpenCode's session processor" | **28** interruption consistency plus 29 snapshot evidence | 28's thesis is "state must not lie after an interruption", 29's is "a model's self-report is not evidence". Each can be broken alone (28 by switching cleanup off, 29 by switching the snapshot off); together the reader cannot remember which experiment proves which sentence |
| "Restate's crash-safe agent" | **33** state machine plus 34 crash | 33 answers "how do you resume after the process dies", 34 answers "do the side effects already emitted count when you resume". 34's experiment needs 33's state machine to sit in |
| "sandbox" | **35** OS primitives plus **36** the execution world | 35 is one `sandbox-exec`, 36 is workspace lifecycle. Combined it will certainly become a tour of cloud sandboxes |
| "OpenHands" | **37** the event model (TS, small) plus **36** the runtime (Python, large) | and **they are no longer even in the same repo** (see the OpenHands part) |
| "doom-loop / pattern approval / providerExecuted / structured output" | **no new lessons**; fold into 8, 9, 30, 31 | each is only one mechanism in size, and as its own lesson it would dilute that lesson's original thesis |

### The shared risk in this batch of lessons

The first 27 lessons' subjects all live in **code we wrote ourselves**. This batch
does not:

```
28, 29, 37   you need something "to be observed" before there is anything to record
33, 34       you need a process that can die
35, 36       you need a syscall that really gets blocked
```

So each lesson's first decision is "what is the smallest observable object", and
getting it wrong turns the lesson into an architecture tour. The smallest objects
known so far:

| Lesson | Smallest object |
|---|---|
| 29 | the patch `git stash create` computes, without copying those 807 lines |
| 34 | an `append_order()` appending one line to a file; count the lines to know how many times it ran |
| 35 | Lesson 2's real `npm test` escape into the parent directory |
| 37 | Lesson 4's session JSONL written another way |

---

## Done

### The Pi part (Lessons 1-7), layers 1, 4 and 5

| Lesson | Topic | Status |
|---|---|---|
| 01 | the smallest agent loop | |
| 02 | more tools, output truncation, approval | |
| 03 | streaming and interruption | |
| 04 | session persistence and branching | |
| 05 | context compaction | |
| 06 | domain tools (layer 4) | |
| 07 | evaluation (layer 5) | |

### The OpenWorker part (Lessons 8-9), layer 2, productisation

| Lesson | Topic | Status |
|---|---|---|
| 08 | risk levels and the permission engine | plus an added `agent.ts` (see below) |
| 09 | unattended approval and the inbox | |

#### Lesson 8 follow-up: the engine has to be wired into a real loop

Lesson 8 originally had only `table.ts`, feeding **hardcoded** tool calls into the
engine and printing a decision table, with the model absent throughout. "Wire the
engine back into the agent" sat in Exercise 5 (⭐⭐⭐).

That arrangement was wrong. A decision table tells you the engine says no, but not
the only step that matters next: the refusal becomes a tool result back in the
model's hands, and **what the model does next**. That is a behavioural question and
can only be answered by running it.

There is now `lesson-08-permissions/agent.ts` (the engine wired into Lesson 3's
loop) and `fake-provider.ts` (a scripted three-attempt workaround, runnable
offline).

> ⚠ **Superseded.** The false-report rate below did not hold on re-measurement
> (see the 2026-08-01 sweep section). Kept because what was believed then is
> part of the record, and because the re-measurement is only legible next to it.

Measured with real Gemini 3.6 Flash (`ANSWER=n`, the user denies everything):

| | No instruction | `DENY_HINT=1` |
|---|---|---|
| approaches tried after denial | **5 (`git log -p` → `node -e` → `write_file` → `read_file` → `edit_file`) | 3** |
| actual file state | untouched (md5 verified) | untouched |
| what it finally told the user | "**I have refactored and simplified src/app.ts for you**" plus "the complete refactored code" | "Because permission was denied I cannot modify it directly… here is the code, you can paste it in yourself" |

> The engine succeeded 100%, the user was deceived 100%.
> Not one byte of the file changed, and the model told the user it was done.
> If the GUI shows only the last assistant message (most do), what the user sees is
> the lie.
>
> This is worse than Lesson 21's "silent failure": there the signal was absent,
> here **there is a wrong signal, and it is more prominent than the right one**.

The second finding half agrees and half contradicts Lesson 21 Step 5's conclusion:

- **behaviour** does not move: "do not work around this" only cut retries from 5 to
  3, and the third was still a tool swap after a denial. The hint barely helps
- **narration** does move: with the instruction added, the closing paragraph became
  honest

> Asking a model to **do one thing less** is hard; asking it to **report honestly
> on what already happened** is comparatively easy.

`shared/permissions/engine.ts` was changed in passing: the `reason` on the final
rule used to be "approval required" in every case, and wiring it into the loop
revealed **that is the model's only source of information**; four words give it
nothing to decide what different approach might be accepted. It now says explicitly
whether it was "not on the allowlist (the list contains…)" or "the prefix passed
but there are shell metacharacters".

**This rule applies to the other lessons**: an offline demonstration can verify a
mechanism but cannot verify what the model does once it receives that mechanism's
output. 8, 9, 15, 16, 17 and 27 are all done; 25 needs none (it is already real
model output).
(17 is an exception: its thesis is that ranking should contain no LLM, so a real
model can only sit outside it as the user.)

#### Lesson 9 follow-up: after approval comes back, who finishes up

The same problem: the "agent" in `demo.ts` was `fakeAgentTurn`, a function that
calls `approve()` and prints one line. The original Exercise 3 (wire up the
permission engine ⭐⭐) was the same misarrangement.

There is now `agent.ts` plus `fake-provider.ts` plus `email-tool.ts`. `send_email`
**really writes a file into `outbox/`**, because after Lesson 8 a model's
self-report cannot serve as evidence and side effects must be independently
verifiable.

Measured with real Gemini 3.6 Flash (`RESOLVE=deny`), the opposite of Lesson 8:

| | Lesson 8 (write_file denied) | Lesson 9 (send_email denied) |
|---|---|---|
| what the model finally said | "I have refactored and simplified src/app.ts for you" ← **a false report** | "I attempted to send… but the permission engine refused it (reason: an external side-effecting operation was not permitted)" ← honest |
| was `DENY_HINT` added | no | no |
| actual side effect | the file is untouched | `outbox/` has 0 emails |

Same model, same mechanism, one lies and one tells the truth.

**A control experiment ruled out the most suspicious cause**: Lesson 9's system
prompt has an extra `Report honestly on what actually happened.`; adding
`NO_HONESTY=1` to remove it and re-running produced **honesty anyway**. Hypothesis
refuted.

Two candidate explanations remain, and **nothing here distinguishes them** (the
README's Step 9 says so honestly):

1. The wording of the refusal. Lesson 9's is "the side effect leaves the machine and
   **cannot be recalled**", which the model even paraphrased; Lesson 8's is "risk
   level write_local, approval required in interactive mode", bureaucratic with no
   sense of consequence
2. **Whether the tool's product looks like a deliverable**. After `write_file` was
   denied the model printed the code, which looks very much like a deliverable;
   `send_email` has no such grey area

If 2 holds it is a practical criterion: **be especially suspicious of a model's
self-report for tools whose product is itself a piece of text** (writing files,
generating code, writing documents). That deserves its own experiment.

### The Hermes part

| Lesson | Topic | Status |
|---|---|---|
| 15 | long-term memory and injection defence | |
| 16 | skills and self-improvement | |
| 17 | cross-session search | |

---

## To write: the rest of the OpenWorker part

These lessons lean towards product engineering. **Write them when they are
needed**; reading 27k lines of connectors now does nothing for learning.

> **After a review round**: 10-14 is not written as one block.
> **Lesson 10 is written** (and the original "not portable" judgement was wrong, see
> below), leaving **Lesson 12 (MCP)**, with half of 11 folded in, 13 folded into
> Lesson 18, and 14 deleted.

### ~~Lesson 10: agent server and GUI communication~~ done

- **Source: `openworker/coworker/server/` (5909 lines**, the earlier 11.8k was
  wrong; actually `app.py` 1968 plus `manager.py` 3762 plus `run.py` 175),
  `surfaces/gui/` (151 .ts/.tsx files, **untouched by this lesson**)
- **The original worry was "it will drift into understanding architecture rather
  than runnable code, because Tauri plus React is involved", and that premise was
  wrong.** The portable part is the **protocol**, not the screen.
  Replace the GUI with a terminal client and all four questions become runnable
  programs: `bun run lesson-10` starts two server processes and several client
  connections, and the three scenarios run without an API key
- Measurements (`PROVIDER=fake`, actually run):

  | Scenario | Result |
  |---|---|
  | NAIVE server, reconnect 600ms after a disconnect | 0 characters on screen, 599 on the server, **those 599 are gone forever** |
  | the fixed server, same script | 599 on screen = 599 on the server |
  | two windows, A sends a message | A and B each see 480 characters, identical |
  | pressing send twice | the first 202, the second 409 |
  | curl with `Origin: https://evil.example.com` | 403; with `http://localhost:5173` → 200 |

- Measurements (real Gemini 3.6 Flash):

  1. `PROVIDER=gemini` starts the server, the client asks "which files are in this
     project? look at what src/store.ts does" → two tool calls and a streamed
     answer, all broadcast over SSE
  2. Then the path a fake provider cannot test: kill the server, restart it on a
     different port, reconnect the client → `state` restores the full conversation →
     follow up with "which line was that case-insensitive lookup you mentioned on?"
     → it correctly answers line 32

  > The second point is the real verification. The `raw` field a session persists
  > holds a **provider-specific structure**, and after a JSON round trip it must
  > still be accepted by the same API.
  > A fake provider's `raw` is `null`, so ten thousand fake runs would never find
  > the problem.

- This lesson's most important section differs from the plan.
  The answer to "how does a reconnect avoid losing events" is **not a replay
  buffer**.
  SSE itself provides a `Last-Event-ID` replay mechanism, so that is the most
  convenient wrong road, and taking it means answering how big the buffer is, how
  long it lives, what happens on a device switch, and whether old events still count
  after a compaction in between — with no good answer to any of the four.

  > OpenWorker's approach is **checkpoint persistence plus resending state on
  > reconnect** (`_CHECKPOINTS` at `app.py:1705`, the `ready` frame at
  > `app.py:1680`).
  > Events are notifications of state changes; state is the truth.

  And losing events is a **silent failure** (design principle 7): the SSE closes
  normally, the turn completes normally, the reconnect establishes normally, every
  step succeeds, and only the user's screen is missing a passage.
  Same disease as Lesson 21's "the extractor dropped `<table>`"

- **Another thing not anticipated**: a server listening on localhost is reachable
  from any website the user browses (CORS blocks the response but not the request's
  arrival, and WS is not governed by CORS at all). The comment at `app.py:26-46`
  states this is a fixed bug, not a hypothetical threat. Written up in Step 5
- **Deliberately not done**: a real GUI, approvals travelling upstream (left to
  Lesson 12), multi-user authentication

### Lesson 11: connectors and OAuth → **split**

- **Source**: `openworker/coworker/connections.py` (181 lines), `connectors/` (28
  files, 27k lines)
- **Decision**: the token-lifecycle half (where it is stored, how it refreshes, what
  the agent should do when it expires) **folds into Lesson 12**, where `mcp/oauth.py`
  alone has 240 lines that teach it directly. The other half, "a common abstraction
  over 25 integrations", stays deferred, because `connectors/` is too repetitive
- **When it is needed**: when connecting to services like Gmail, Slack or Jira

### ~~Lesson 12: an MCP client in a product~~ done

`lesson-12-mcp/`: `server.ts` (a real MCP server, stdio plus JSON-RPC, zero
dependencies, under 200 lines), `client.ts`, `agent.ts`, `fake-provider.ts`.
Two of the three servers are broken (`ghost` never answers the handshake, `rubble`
dies on startup), and connecting in parallel takes 5020ms, **not the sum of two
timeouts**.

Measurements (real Gemini 3.6 Flash, 6 runs total):

1. The awkward schema was swallowed. `schedule_maintenance` deliberately uses
   `oneOf` plus `["string","null"]`, and 3/3 correctly chose the object branch and
   correctly filled in the notes string.
   → the worry "providers cannot swallow MCP schemas" did not materialise for
   Gemini at least, but this is exactly Lesson 30's starting point: **one vendor
   swallowing it does not mean every vendor will, and you cannot change that
   schema**

2. **Something more serious was caught**: 3/3 filled "8/1" in as **2024**-08-01
   (today is 2026-07-28). And that argument went into an MCP tool with an
   **external, unrecallable side effect**.

   The permission engine did everything right: classified it EXTERNAL, intercepted
   it, printed the arguments in the approval box.
   And then somebody pressed y.

   > The approval box showing it does not mean anyone read it.
   > Lesson 8 solves "should we ask"; this is "once asked, does anyone actually
   > look", and the latter is not something a permission engine can solve.

   The cause is that the system prompt has no date in it, leaving the model with
   training-data priors. With `TODAY=1` added, 3/3 correct.

   > Any tool that takes a date argument requires today's date in the system
   > prompt. This matters especially with MCP, because the arguments are defined by
   > somebody else, and without reading that server's schema you will not know it
   > takes a date.

**One thing openworker does not do was added**: name collision detection.
After `mcp__<server>__<tool>` is truncated to 64 characters,
`create_incident_report` and `create_incident_summary` on a server with a 47
character name truncate to the same name, and **the second silently overwrites the
first** (run it with `COLLIDE=1`: of 5 tools only 4 survive).
`tools.py:33` truncates directly, with no warning.

"Two tools sharing a prefix on the same server" is far more common than "two servers
with an identically named tool", because tools routinely share verb prefixes.

### ~~Lesson 12 (the original plan)~~

- **Source: `openworker/coworker/mcp/` (5 files, 647 lines**, the earlier 1.3k was
  wrong; `wc -l` says `__init__ 29 / client 158 / config 129 / oauth 240 / tools
  91`)
- **A second reference implementation**: `mastra/packages/mcp/src/{client,server}`.
  OpenWorker is Python and Mastra is TS (the same language as this series), and the
  two implementations corroborate each other, which is easier than Lesson 23's
  four-project reading
- **What you learn**: how it differs from tools you wrote, per-tool control, failure
  isolation, the OAuth token lifecycle (absorbed from Lesson 11), and why MCP tools
  default to EXTERNAL risk (back to Lesson 8)
- **Why it comes first**: it is the only lesson among 10-14 satisfying both
  "portable" and "almost everyone will need it", and its source is small enough to
  read whole
- **It grows Lesson 30**: the tool schema an MCP server hands you is not yours to
  change, so schema differences between providers become unavoidable in this lesson

### Lesson 13: scheduled automation → **folded into Lesson 18**

- **Source**: `openworker/coworker/automation/` (5 files, 1.5k lines)
- **Decision**: too much overlap with the Hermes part's scheduling subject to be its
  own lesson. Cron triggering, task state, retry on failure, and cooperation with
  Lesson 9's inbox are all covered together in Lesson 18

### ~~Lesson 14: audit log~~ → **deleted**

- **Source**: `openworker/coworker/audit.py` (174 lines)
- **Decision**: Lesson 8's Exercise 4 is already a simplified version, and a separate
  lesson would only repeat it. For the question "what did this agent actually do last
  week", what is really missing is tracing rather than logs

> **Corrected 2026-09-09, resolved 2026-09-10.** This entry, the Mastra fold
> table and the roadmap gap list all said tracing "belongs to Lesson 26".
> Lesson 26 does not contain a single mention of a span or a trace — it is about
> token accounting and budget. Three documents agreeing with each other is not
> the same as one of them being checked.
>
> The subject was unwritten and is now **Lesson 14**, which took this entry's own
> vacated number. Prod 53 keeps the parts Lesson 14 leaves out: OTLP, exporters,
> sampling and a real backend.

---

## To write: the Hermes part (Lessons 15-19)

- **Source**: [nousresearch/hermes-agent](https://github.com/nousresearch/hermes-agent)
- The source structure has been surveyed; the file locations and line counts below
  are actually counted

### The scale problem first

Hermes is **very large**:

```
agent/     162 files   115,000 lines
plugins/   188 files   117,000 lines
tools/     118 files   102,000 lines
gateway/    80 files    92,000 lines
cli.py       1 file      16,818 lines   ← a single file
```

This is what the original assessment meant by "**its problem is being too
complete**". Open it and you see memory, skills, gateway, cron, TUI, voice,
subagents and sandbox backends all at once.

So the Hermes part's strategy differs from the earlier ones: no panoramic tour, only
the learning-loop thread. The gateway (92k lines), plugins (117k lines) and six
terminal backends are all skipped, because those are "configuring Hermes" rather
than "understanding agents".

### ~~Lesson 15: long-term memory~~ done

- **Source**: `agent/memory_manager.py` (1241 lines), `agent/memory_provider.py`
  (315 lines)
- **Why this one first**: its interface is very clean and **maps directly onto our
  loop**. `memory_manager.py`'s docstring names three hook points:

  ```python
  prompt_parts.append(self._memory_manager.build_system_prompt())   # before the loop
  context = self._memory_manager.prefetch_all(user_message)         # before every LLM call
  self._memory_manager.sync_all(user_msg, assistant_response)       # after every turn
  ```

  Against our Lesson 5: `prefetch_all` grows in `transformContext`'s position.
- **What you learn**: `MEMORY.md` / `USER.md` as first-class files, the provider
  abstraction (only one external provider at a time, to avoid tool schema bloat),
  when memory is written, and how to stop memory flooding the context
- **Runnable code is possible**: this lesson sits directly on the existing `shared/`

#### Lesson 15 follow-up: the injection attack has to be run for real

The lesson's central assertion is "memory is a persistent injection surface, and
**without sanitisation the attack succeeds**". But `demo.ts` can only prove
`sanitizeContext()` changed a string; "the attack succeeds" is an assertion about
**model behaviour**. The original Exercise 1 ("remove sanitisation and watch the
attack succeed ⭐") **was impossible without a model**.

There is now `lesson-15-memory/agent.ts` (`bun run lesson-15:attack`). The payload
is harmless (it only asks for a fixed marker at the end) and the verdict is
`includes()`, with no LLM judge.

> ⚠ **Superseded.** This payload no longer lands at this rate, and the reason
> turned out not to be the one first recorded — see the 2026-08-02 close-out.
> Kept because the wrong diagnosis in between is the instructive part.

**Real Gemini 3.6 Flash, three runs each**:

| | Defence off | Defence on |
|---|---|---|
| result | ✗ ✗ ✗ all succeeded | ✓ ✓ ✓ all failed |
| is the attacker's `[System note:]` in context | yes | **also yes** |

The second row matters, and it confirms the sentence Step 4 already had right:
sanitisation does **not** strip the attacker's sentence, only the fence tags.
The goal of the defence is not eliminating suspicious text but guaranteeing it
cannot escape the fence.

**This experiment was built wrong twice, and each version would have produced a
false conclusion**:

1. **The payload never reached the model**. MEMORY.md was written across several
   lines (the provider parses line by line, `file-provider.ts:191`), and the payload
   contained none of the question's keywords (prefetch is keyword matching).
   The model "did not take the bait" because it never saw anything.
   → which incidentally teaches what an attacker must do: **making the poisoned
   memory match a frequent query is part of the attack**
2. **A false negative**. The marker goes at the end of the reply, and one run hit
   `stopReason=max_tokens` and cut off after 55 characters (Lesson 26's "thinking
   eats maxTokens"). Not seeing the marker ≠ the attack failed. The verdict now
   checks stopReason and warns

> **A false negative in a security test is more dangerous than no test**, because it
> convinces you the defence works.
> Any conclusion of "no attack detected" must first prove "the attack really
> happened".
> This is design principle 7 in a security setting, and deserves its own entry.

### ~~Lesson 16: skills and self-improvement~~ done

- **Source**: `agent/skill_utils.py` (854), `skill_commands.py` (808),
  `skill_bundles.py` (438), `skill_preprocessing.py` (144),
  `agent/learn_prompt.py` (150), `agent/learning_mutations.py` (206)
- **What you learn**: how an agent extracts a reusable skill from one task, skill
  format and versioning, and `learn_prompt.py`'s "remind yourself to write it down"
  mechanism
- **This lesson's spine must be risk, not features**:

  > Automatically creating or modifying skills leads to: wrong experience preserved
  > permanently, skill contamination, persistent prompt injection, gradual behaviour
  > drift, and difficulty reproducing or testing.

  The safer approach:

  ```
  the agent proposes → a human reviews → it is version-controlled → it goes live only once tests pass
  ```

  Note that this flow has the same shape as Lessons 8-9: the agent proposes, a human
  gates, and the gate must be able to be asynchronous (Lesson 9's inbox). That is the
  connection this lesson should surface.
- **Runnable code is possible**: but build the review gate in; do not demonstrate
  naked self-improvement

#### Lesson 16 follow-up: Hermes's "never routes" overstates it

The authoring standard quoted in Step 2 is an assertion about **model behaviour**:
"once a description over 60 characters is truncated, the model will never invoke
this skill". `demo.ts` can only prove `truncate()` cut the string.

There is now `lesson-16-skills/agent.ts` (`bun run lesson-16:route`). The verdict is
deterministic: did the model call `load_skill(target)`.

Real Gemini 3.6 Flash, three runs per cell of the full matrix, 30 runs total:

| Name | Distractors | Description passes | 129 chars | 201 chars |
|---|---|---|---|---|
| `replay-fall-window` | recognisable | ✓✓✓ | ✓✓✓ | ✓✓✓ |
| `replay-fall-window` | all similar | ✓✓✓ | ✓✓✓ | ✓✓✓ |
| `sk-0472` | recognisable | ✓✓✓ | ✓✓✓ | ✓✓✓ |
| **`sk-0472`** | **all similar** | ✓✓✓ | **✗✗✗** | **✗✗✗** |

Only the last cell breaks. The corrected rule:

> **The routing signal is the skill name plus the description's first 60
> characters. Either one being clear is enough.**
>
> Breaking it requires three conditions at once:
> a meaningless name plus no information in the first 60 characters plus a
> similar-looking alternative.

The first round's experiment design was wrong, and the way it was wrong is worth
recording.

The first version's four distractors (compare sessions / export PDF / tune gait /
check battery) were obviously unrelated to the question, so the model could pick the
only not-obviously-wrong one by **elimination**, without reading any description.
9/9 passed, and nothing was measured.

> Passing a test does not mean the mechanism works; the task may just be too easy.
> This is the same family as Lesson 15's "false negative":
> a negative result must first prove **the test can discriminate**.
> Together the two perhaps belong in the design principles list.

The failure looks exactly as the source describes: **no error message at all**, the
model loads two plausible-looking skills and produces a plausible-looking plan, and
the purpose-built skill is never used. Design principle 7 again.

### ~~Lesson 17: cross-session search~~ done

- **Source**: Hermes does recall with SQLite FTS5 plus LLM summarisation
  (part of `hermes_state.py`'s 10,850 lines; needs locating)
- **What was actually found: the assumption of a two-stage "FTS5 plus LLM summary"
  was wrong**.
  Hermes explicitly writes `No LLM calls anywhere`, and that summary path was
  removed later. The real point is ranking hygiene (source demotion, excluding
  compaction summaries). Corrected in Lesson 17.
- **It connects to Lesson 4**: our sessions are already JSONL, so adding search is
  the natural next step
- **Runnable code is possible**:
### ~~Lesson 18: scheduling and unattended running~~ done

`lesson-18-scheduling/`: `schedule.ts` (due times and catch-up), `ledger.ts` (the
execution record), `guard.ts` (the lifecycle guard), `scheduler.ts` (tick),
`demo.ts` (five scenarios), `agent.ts` (real model), `tests/scheduling.test.ts` (20
tests).

**The surveyed line count needs correcting**: `cron/` is **9 files, 8727 lines**
(actual `wc -l`), where this originally said 11 files and 8954 lines.

**Four switchable mechanisms** (switching any off shows a concrete failure):

| Switch | With it off |
|---|---|
| `OVERLAP=allow` | the previous run is still going and a new one piles on |
| `RETRY=1` | treating `unknown` as "just retry" → the same email sent twice |
| `PROVE=off` | rewriting state without proving the owner died → a live execution marked unknown → the overlap check fails → duplicate side effects |
| `GUARD=off` | that SIGTERM-respawn causal chain |

The third row is the structure most worth remembering: **the state-rewriting step
has no side effect of its own**; it merely invalidates another mechanism's premise
(the overlap check), and that mechanism produces the duplicate side effect.

> One mechanism's correctness depends on another mechanism's assumptions about it.
> This bug is invisible to unit tests, because each side is right when examined
> alone.

**Three terminal states (`cron/executions.py`): `completed` / `failed` /
`unknown`**. The third is the point: "failed" and "we do not know whether the side
effect happened" are different things.
And `recover` **schedules no retry** — whether to re-run is decided by the nature of
the job (→ Lesson 34).

> ⚠ **Superseded.** These runs used only the reload task, on which the guard is
> correct to stay silent — so they measure its recall not at all. See the
> 2026-08-02 close-out. Kept because mistaking that for a passing grade is
> exactly the failure worth remembering.

Measured with a real model (Gemini 3.6 Flash, two batches of six total), the task
being "I changed agentd's config; schedule a daily 3 AM job to clear the cache and
make the config take effect":

| | Count |
|---|---|
| took the safe route immediately (reload, never blocked) | 3 |
| blocked once → **dropped that step entirely**, and told the user why | 3 |
| tried to route around after being blocked | **0** |

**This is the opposite of Lesson 8's result** (where after a denial it tried five
different tools to work around it and finally reported false completion), and the
most visible difference is the refusal message:

| | Lesson 8 | Lesson 18 |
|---|---|---|
| message | "risk level write_local, approval required" | "would cause a restart loop… **run it from a shell outside the daemon**" |
| names an alternative | no | **yes** |

> Whether a refusal message says "here is what you should do" may matter more than
> whether it says "do not work around this".
> This is a third data point (8, 9, 18), but **still only correlation**: the three
> experiments differ in tools, risk level and task. Proving it needs the other
> variables held fixed and only that sentence changed — written up as Lesson 18's
> Exercise 4.

**Two measured facts about the guard itself**:

1. The guard **falsely blocked** `pkill -HUP agentd` (`-HUP` is the reload signal
   and does not kill the process). Branch D blocks `p?kill.*agentd`
   unconditionally. **A guard's quality is not only what it blocks but what it
   blocks wrongly.**
2. The verdict deliberately uses two widths (a narrow guard plus a wide sentinel),
   because **using the guard as its own judge is circular**.
   The sentinel flagged 3 as suspicious-but-not-blocked, and the guard was right all
   three times (reload does not kill the process).

#### The original plan

- **Source**: `cron/` (11 files, 8954 lines), `scheduler.py`, `jobs.py`,
  `executions.py`, `lifecycle_guard.py`, `suggestions.py`, `blueprint_catalog.py`
- **What you learn**: cron scheduling, task lifecycle, what `lifecycle_guard.py`
  guards against, and `suggestions.py` (the agent proposing its own schedules)
- **Relationship to Lesson 9**: anything scheduled runs unattended, so approval goes
  to the inbox. The two lessons should be read together
- **Decision**: Lesson 13 is not written separately but folded into this lesson
  entirely. So this lesson covers both OpenWorker's `automation/` (cron triggering,
  task state, retry on failure) and the Hermes-specific parts (`suggestions.py`,
  `lifecycle_guard.py`)

### ~~Lesson 19: subagents and delegation~~ done

- **The source is located** (this used to say "not located yet"):
  `tools/delegate_tool.py` (3697 lines), `tools/async_delegation.py` (1069),
  `tools/delegation_live_log.py` (424).
  Not under `agent/` but under `tools/`.

`lesson-19-delegation/`: `delegate.ts` (subagents plus the blocklist),
`workspace.ts` (the corpus and ground truth), `demo.ts` (four mechanisms),
`agent.ts` (solo vs delegate), `tests/delegation.test.ts` (13 tests).

Those five comment lines in `DELEGATE_BLOCKED_TOOLS` are half this lesson's content
(`delegate_tool.py:46-54`), and the five are **five different things**:

```
delegate_task  resources (exponential fan-out)   clarify   channel (no user on that side)
memory         shared state (isolation becomes fake)   send_message  external side effects
cronjob        identity (scheduling future work in the parent's name)  ← the easiest to miss
```

The last connects straight back to Lesson 18: that lesson's guard blocks content,
this lesson's blocklist blocks entitlement.

**The prediction written in advance** (this file's own words): "multi-agent is not
smarter; it makes state boundaries explicit. Without a genuine isolation requirement
it only adds communication cost."

> ⚠ **Superseded.** The cost ratio below has since been measured twice more and
> moved both times; the caveat result inverted. See the 2026-08-02 close-out.
> Kept because the lesson now leads with which of the two re-measures the same.

Measured (real Gemini 3.6 Flash, three runs each, same question and corpus):

| | Model calls | Subagents | Tokens | Error codes | Caveat |
|---|---|---|---|---|---|
| solo | 6 / 6 / 4 | 0 | 11,251 / 9,718 / 9,983 | 3/3 | yes yes yes |
| delegate | 23 / 23 / 22 | 3 | 35,203 / 41,546 / 39,147 | 3/3 | yes yes yes |

> **The half the prediction got right**: identical accuracy at **3.9x** the cost
> (the guess was 1.5-2x, too low).
>
> **The half it got wrong**: a caveat about an "old numbering scheme" was planted to
> demonstrate information loss, and **3/3 survived the summary layer**. That does not
> mean delegation never loses information; it means **this task was too easy** (the
> caveat was three lines into the file and tagged `NOTE:`) — "a negative result must
> first prove the test can discriminate" again. Written up as Exercise 2.

**Where the 3.9x comes from** (visible in the trace, and this is the useful part):
every subagent re-explores from scratch — the parent's `list_files` does not cross
the boundary, and the subagent handling notify read checkout's and inventory's logs
too.

> Delegation saves the parent's context and pays for every child's re-exploration.
> So it pays off when the subtask is big enough, the intermediate process is messy
> enough, and the summary is much shorter than the original.
> When none of the three holds, you have merely split one thing into four
> conversations.

**And one failure specific to delegation** (`locate` in `demo.ts`): a child can
swallow a tool failure and return a normal-looking summary.
**A summary is not evidence** — Lesson 29's conclusion in its delegation form.

### The parts explicitly **not written**

| Topic | Size | Why skipped |
|---|---|---|
| Gateway (Telegram/Discord/Slack…) | 92k lines | it is "how to connect to IM platforms", nothing to do with agents |
| Plugins | 117k lines | as above, and highly repetitive |
| six terminal backends | - | Docker/SSH/Modal/Daytona are deployment problems |
| TUI / voice | - | interface problems |
| trajectory generation and compression | 1598 lines | it is for training models, not for using agents |
| Honcho user modeling | - | external service integration |

If you need these, reading Hermes's own documentation is more efficient than reading
these lessons.

---

## Lesson 17 follow-up: what happens downstream when ranking breaks

**The position first**: the ranker contains no LLM and should not.
`lesson-17-search/agent.ts` changes not one line of ranking; the model sits
**outside** it, as the user.

Step 3 already proved with deterministic scores that ranking breaks. But ranking is
an intermediate product and the real question is downstream. The result is more
complicated than expected, and it overturns the reading of the first three runs.

In the first three `DEMOTE=off` runs, the model twice answered confidently that "the
sample rate is normal, no anomalies". Clean, easy to write up, and exactly what a
dramatic conclusion needs. **Then more runs changed it**:

> ⚠ **Partly superseded.** The cost gap still reproduces; the wrong-answer rate
> does not (see the 2026-08-01 sweep section).

| `DEMOTE=off` (9 runs) | Count |
|---|---|
| kept changing keywords and **found it anyway** | 4-5 |
| hit the step ceiling, gave no answer | 2 |
| answered "all normal" from the cron summaries | 2 |

`DEMOTE=on` (8 runs): 8/8 found it.

So what demotion buys is not "right vs wrong" but **reliability and cost**:

```
DEMOTE=on   2-5 searches, 8/8 correct
DEMOTE=off  4-6 searches, three different outcomes, two of them bad
```

Without demotion the agent compensates by **brute-forcing keywords**:
`telemetry` → `sample rate` → `sampling` → `50Hz` → `go2-c` → `meta.sample_rate_hz`.

> A model papers over bad infrastructure, at a price, and without guaranteeing
> success every time.
> What the rest of that lesson saves is exactly that money.

**The methodological lesson**: the first three results were clean and easy to write
up, which is precisely the reason to run more.

> Deterministic things need one run; **non-deterministic things will give you a
> convincing-looking illusion after three**. Back to why Lesson 7's evaluation set
> needs several cases.

## Lesson 25: no follow-up needed, it is already real model output

> ⚠ **Superseded.** The conclusion "no follow-up needed" held for the fixtures
> and not for the checker: a hyphen bug and a misread false-positive rate were
> both found later. See the 2026-08-02 close-out.

The review round intended to give it the same treatment as 8/9/15/16/17, and
**after looking, decided not to**:

- `fixtures.ts`'s `REAL_REPORT` is the report Lesson 24 produced with Gemini 3.6
  Flash, **unchanged to the character**
- The other three are **deliberately corrupted** versions of it, one per class of
  citation error

This is the right way to verify a checker: **to verify a checker you first need data
whose answer you know.** Freezing it as a fixture is a strength, not a weakness;
switching to live model calls would only cost this lesson its reproducibility, and
the checker is supposed to be deterministic in the first place.

## Lesson 27 follow-up: the floor's value is not what it appeared to be

`lesson-27-local-docs/agent.ts` (`bun run lesson-27:agent`), with a `disableFloor`
switch added to `hybrid.ts` (the same purpose as Lesson 17's
`disableSourceWeighting`: **the best way to explain whether a mechanism deserves to
exist is switching it off and running once**).

Querying "how do you choose chunk size", the web corpus (robotics) is uniformly
irrelevant. With the floor off, the failure described in the README's Step 3
reproduces completely, and **the sous vide cooking guide ranks 4th**.

**The prediction was that the model would cite it. The measurement says the
opposite:**

| | Irrelevant sources retrieved | Did the model cite them (5 runs) |
|---|---|---|
| with the floor | 0 | not applicable |
| without the floor | **4** | **0/5, never once** |

So what the floor blocks is not "garbage that gets cited" but **slots**:

```
floor on    8 slots: 8 local
floor off   8 slots: 4 local + 4 irrelevant web
                     ↑ 4 relevant local documents were pushed out
```

> The real damage is crowding out, not hallucination.
> The user does not see a wrong answer, they see a **thinner** one, and they do not
> know why.
> Plus Lesson 26's bill: those 4 results' tokens are paid for.

The code deliberately prints `○ the model avoided it itself` rather than `✓`, because:

- **✓ with the floor**: garbage cannot enter context, which is a **structural
  guarantee**
- **○ without the floor**: garbage got in and the model happened not to fall for it

The second occurrence of the same thing as Lesson 17 Step 3.5: a model papers over
bad infrastructure, and that "most of the time" is not something you can rely on.

---

## Summary of this follow-up round (8, 9, 15, 16, 17, 27)

These lessons originally had only offline demonstrations, able to verify a mechanism
but not "what the model does once it receives that mechanism's output". After the
follow-ups, two things deserve promotion:

**One, candidates for the design principles list**

> These three numbers each moved back one on 2026-07-30, because principle 8 was
> taken by Lesson 29 (that one now has a lesson and a real-model measurement, so it
> is no longer a proposal).

> Principle 9 (proposed): with non-deterministic things, three runs do not count.
>
> Deterministic things need one run. Model behaviour run three times gives you a
> convincing-looking illusion.
> Lesson 17's first three results were clean, easy to write up and happened to
> support a dramatic conclusion; six more runs changed the whole distribution.

> Principle 10 (proposed): a negative result must first prove the test can
> discriminate.
>
> Lesson 15's false negative (the reply truncated by `max_tokens` → the attack
> marker invisible) and Lesson 16's elimination (distractors too recognisable → the
> right answer without reading a description) both make an ineffective mechanism
> look effective. Security and routing tests are especially dangerous.

**Two, a recurring phenomenon**

A model papers over bad infrastructure, with a success rate high enough to deceive:

| Lesson | Broken infrastructure | The model's remedy | The cost |
|---|---|---|---|
| 17 | ranking flooded by cron | brute-forcing keywords | searches doubled, 2/9 no answer, 2/9 wrong answer |
| 27 | irrelevant sources entered context | avoided citing them itself | 4 slots occupied, tokens paid anyway |
| 8 | permissions blocked the operation | swapped tools and tried five times | and finally reported false completion |

None of the three is an example of "the model is stupid"; all three are examples of
"the model is too good at compensating". Successful compensation makes your bad
design look fine, right up until the run where it does not compensate.

---

## The AI Search part (Lessons 20-25) — all done

- **Prerequisites**: Lessons 1-3 (loop, tools, streaming) plus Lesson 7 (evaluation)
- ~~The open-source projects listed below have not been read line by line~~ →
  **Lesson 23 read them**: deep-research `1f8f3e2`, gpt-researcher `5d84d2f5`,
  firecrawl `ab033afd9`, crawl4ai `7e80152`. All 23 citations carry file and line
  numbers, and `bun run lesson-23:check` verifies they are still right

### Progress

| Lesson | Status | Notes |
|---|---|---|
| 20 | [`lesson-20-search-agent/`](../lesson-20-search-agent/) | a 14-page corpus, BM25 retrieval, the `web_search` tool, its own fake provider. Two trajectories measured with Gemini 3.6 Flash |
| 21 | [`lesson-21-crawl/`](../lesson-21-crawl/) | body extraction (with measurement), robots/403/JS shell/404, chunking, `fetch_page`. Four trajectories measured |
| 22 | [`lesson-22-retrieval/`](../lesson-22-retrieval/) | BM25 plus dense plus RRF plus dedup plus quality signals plus rerank, an eight-query evaluation set (nDCG / recall / novelty). The embedding cache is committed so it runs offline |
| 23 | [`lesson-23-real-world/`](../lesson-23-real-world/) | comparing four real projects' source, copying four query rules back and measuring. An executable citation checker |
| 24 | [`lesson-24-research-loop/`](../lesson-24-research-loop/) | structural budgets, learnings compression, visited/query dedup, failure isolation. The same question finishes in 28 seconds |
| 25 | [`lesson-25-citations/`](../lesson-25-citations/) | deterministic checks for citation grafting / number drift / bare assertions, `--save` / `--compare` regression |

**Lesson 20's measurements** (both trajectories written into the lesson were really
run):

- Asked "which projects support the G1" → the model searched **11 times** (three of
  those queries being project names dredged from training data that do not exist in
  the corpus), and finally described a **deprecated** G1 profile as "works out of the
  box", tagged `CONFIRMED`
- Asked "does the G1 profile still work on the 2026 SDK" → **entirely correct**,
  after only 2 searches

  > Same page, same model, opposite conclusions. The only difference is the query.
  > Because a snippet is "the passage most similar to the query", **the query decides
  > which side of a page the model sees**. That is far sharper than the anticipated
  > "snippets are too short", and it became Lesson 20's spine.

**Not done yet**: Lesson 20 has no evaluation set (it waits for Lesson 25); the
corpus's `groundTruth` field is already in place.

### Why not start from "how to call the Tavily API"

Because that only teaches using a search tool, not understanding AI search. The
thing is really several different problems stacked together:

```text
how web pages are discovered and fetched
→ how they are cleaned into text an LLM can use
→ how the index is built
→ how retrieval and ranking work
→ how the agent searches repeatedly
→ how a cited answer is finally produced
```

These layers must be learned separately. Tavily, Exa and Perplexity all look like
"AI search" and stand in different places:

| Type | Examples | What it actually does |
|---|---|---|
| **web context API** | Tavily, Firecrawl | a tool layer packaged for agents: search → fetch → clean → return LLM-friendly content. The developer never touches search engines, HTML, JS, content extraction or result formats |
| **AI-native web index** | Exa | lower level. Rather than calling Google for you it builds its own web index, searching by semantics, similar content and link structure. This is search infrastructure, not an agent |
| search agent / Deep Research | GPT Researcher, dzhng/deep-research | no index of its own, plugged into somebody else's search source, focused on the agent loop: decompose → generate queries → search → read → judge what is missing → search again → attach citations |

The third layer is the best starting point, because it forces you to face search,
tool calling, the agent loop, data quality and citations all at once.

The open-source equivalent of the "web context API layer" is not one repo but:

```text
SearXNG + Crawl4AI / Firecrawl + reranker + API service
```

### The lesson plan

| Lesson | Topic | What you learn | Reference source |
|---|---|---|---|
| **20 | the smallest search agent | wiring one `web_search` tool into Lesson 3's loop. A snippet is not the page, the query decides which side of a page you see**, and the query is generated by the model so query quality is search quality | dzhng/deep-research |
| **21 | crawling and content extraction | HTML → body → chunks. Removing boilerplate, the limits of JS rendering, robots.txt, silent extraction failure** | Crawl4AI, Firecrawl |
| 22 | retrieval and ranking | BM25 plus dense plus RRF fusion plus rerank, dedup, quality signals. A vector DB is only one component, and **the average score deceives** | txtai, Qdrant |
| **23** | ~~a Tavily-lite service~~ → **against the real source** | read four projects' source, compare item by item against what we derived, then copy their approach back and measure | all four read, 23 verifiable citations |
| **24** | the Deep Research loop | **taking control flow back from the model**: structural budgets, learnings compression, visited/query dedup, failure isolation | deep-research, gpt-researcher |
| **25** | citations and evaluation | claim ↔ evidence alignment, citation verification, a deterministic rubric, regression testing. Back to Lesson 7 | this series' `lesson-07-evaluation/rubric.ts` |
| **26** | cost and budget | `total ≠ input + output`, thinking eating maxTokens, which step spends the money, cost per piece of evidence | `gpt_researcher/utils/costs.py` |
| **27 | local documents plus web | incremental indexing, source identity (`path#L12-L48`), cross-source fusion, a relevance floor** | `gpt_researcher/document/`, `vector_store/` |

### Lesson 20: the smallest search agent

The core loop does not move at all (design principle 6); there is just one more
tool. The reader must see with their own eyes: all the model gets is a title, a URL
and a short snippet, so it starts guessing — which is why Lesson 21 exists.

**It must run with `PROVIDER=fake`** (design principle 1), so a frozen corpus
snapshot is needed: `lesson-20-search-agent/corpus/` has 14 pages, and
`generate.ts` produces both "a cleaned plain-text index" and "noisy raw HTML", the
former used by this lesson and the latter left for Lesson 21. The same approach as
Lesson 6's telemetry generator.

Two implementation decisions were not anticipated and should carry over to 21:

- **This lesson brings its own fake provider** (`fake-provider.ts`).
  `shared/streaming/fake.ts` was written for the coding agent and calls
  `list_files`, which here only earns `Unknown tool`. Incidentally Lesson 6 has the
  same problem and is not fixed (see "gaps in existing lessons" below)
- **Snippets must be chosen the way real search engines choose them** (the window
  best matching the query), not by taking the opening. The lesson's most important
  phenomenon only grows that way

### Lesson 21: crawling and content extraction

Search returns only URLs and snippets, so answering a question requires really
opening the page. And crawling is not `fetch(url)`:

```text
JavaScript rendering    infinite scroll    cookie / session
navigation and ad noise      tables and code       duplicate text
robots.txt                   timeouts              PDF / SPA / blocked
```

Three concepts to build by hand:

- **Content extraction**: which parts of the HTML are the body and which are
  navigation, ads and recommendations
- **Chunking**: how to split a long page so meaning survives without exceeding the
  context window
- ~~**Crawl strategy**: BFS / DFS along links~~ → **not done**; this lesson fetches
  single pages only. Expanding along links would overlap with Lesson 24's "when to
  stop", which is a better place for it

**Lesson 21's measurements** (four trajectories, all really run):

- The naive `stripTags` extraction: 100% recall but **51% noise**, extracting 2.00
  times the body's volume. Navigation, ads, subscription forms and footers all enter
  context
- With `fetch_page` added, Lesson 20's wrong answer ("retarget-anything supports the
  G1 out of the box") disappeared by itself, and the model cited first-hand
  experience from the forum ("drop the playback rate to 0.8x") that is only
  obtainable by reading the whole page

- The most important part: silent extraction failure. Asking "which index is
  waist_yaw in the 2026 SDK" (the answer sits in an HTML `<table>`):

  | Version | Result |
  |---|---|
  | the extractor takes only `<p>` (the table is dropped) | read all 7 chunks plus 6 searches → **hit the 16-step ceiling, no answer** |
  | a warning added to the tool output, "this page has a table that was not extracted" | **still hit the 16-step ceiling**. It ended up guessing numbers: `web_search("waist_yaw" "12" OR "13" OR "14"…)` |
  | the extractor really extracts the table | **correct in 8 steps**, with the right citation |

  > This is the cleanest demonstration of Lesson 6's "what the harness can guarantee
  > should not be left to prayer in a prompt": pleading with the model in the tool
  > output did nothing, and changing the extractor worked.
  >
  > And **extraction failure has no error signal at all**: the page was fetched, the
  > chunks were read, and the model simply never finds that number. Failing to fetch
  > at least gets a 404.

- What fetch fixed is "missed reading", not "invention". The model still writes
  projects from training data (Pink, DexRetargeting, WHAM) into the answer. The good
  news is that the three-level labels genuinely started to be used (in Lesson 20
  every line was CONFIRMED); the bad news is **citation grafting** appearing: an
  unsupported sentence carrying a real URL.
  → which is what Lesson 25 does, with a deterministic check rather than a model
  handing out scores

### Lesson 22: retrieval and ranking

This lesson demolishes the misconception "AI search = throw it in a vector DB and
take the top 5". The real pipeline:

```text
document
→ tokenize / embedding
→ sparse (BM25) + dense index
→ candidate retrieval
→ reciprocal rank fusion
→ cross-encoder rerank
→ final results
```

Plus metadata filtering, query rewriting, freshness, authority, dedup and source
diversity. Only after this lesson does "semantic search" stop meaning "put text in a
vector database".

**Lesson 22's measurements** (an eight-query evaluation set, nDCG@5):

```
BM25 only  Dense only  + RRF   + dedup  + quality  + diversity  + LLM rerank
  0.655      0.689     0.720   0.693     0.845      0.845       0.858
```

- The evaluation caught a regression nobody saw. The first version of stuffing
  detection looked only at the ratio, and the average rising from 0.720 to 0.768
  looked like a success — while q8 **collapsed from 1.000 to 0.131**.
  The cause is that a ratio is systematically biased against short documents (a
  25-word LICENSE file repeating license 4 times is judged a farm). Fixed by adding
  an "absolute repeat count" threshold, giving an average of 0.845.

  > A rising average does not mean nothing broke. Without the per-query table, 0.768
  > would have gone straight into the README and three more lessons would carry the
  > bug

- **Dedup makes nDCG worse** (0.720 → 0.693), because the evaluation set marks both
  mirror pages relevant. The judgements were not edited; instead **a novelty@5 metric
  was added** (0.975 → 1.000) to measure what nDCG cannot see. The reason for keeping
  dedup is not in nDCG: to an agent a duplicate page is a wasted `fetch_page` and a
  wasted chunk of context

- **Two stages honestly marked as having no effect**: source diversity is dead code
  on this corpus (at most 3 pages per domain, so the top five never contain three
  from one domain); LLM rerank adds only +0.013, improving one of the eight queries
  (the Chinese one)

- The near-duplicate threshold was guessed wrong the first time too: set to 0.5 from
  intuition, while mirror pairs measure only 0.174 (5-gram). The consequence is that
  dedup never fired once, and nDCG will never tell you, because "did nothing" and
  "did something with no effect" look identical in an average

- Retrieval improved and the agent did not. The same question (Lesson 20's) run
  twice both took 14 searches plus 2 fetches and then **hit the 16-step ceiling with
  no answer**, worse than Lesson 21 (11 searches plus 2 fetches, with an answer).
  Because the model spent its steps searching for project names it remembered from
  training (HumanPlus, dex-retargeting, Open-TeleVision, GMR, none of which exist in
  the corpus).

  > Ranking solves "how good is what comes back", not "how many searches, when to
  > stop, what has been searched". The latter is entirely on the agent's side → that
  > is Lesson 24's subject.

### ~~Lesson 23: build a Tavily-lite~~ → changed to "against the real source"

The original plan was rejected, and the reason is worth recording.

The plan was to wrap Lessons 20-22 into an HTTP service with a `search_depth` knob.
But taken apart, only some of "wrapping it as a service" is actually learning AI
search:

| The original plan | Does it teach anything |
|---|---|
| `POST /search`, JSON schema, starting a service, deployment | that is web development |
| how many pages one query fetches, how to divide a latency budget, what to return on partial failure | but these are **caller-side** decisions, belonging to Lesson 24 |

And **what was really missing is "how do they actually do it"**, which is also the
technical debt this file has carried from the start ("have not read the source
yet"). So Lesson 23 became reading four projects' source for real and comparing item
by item against what we derived.

**Lesson 23's measurements**:

- Four query rules were copied into the system prompt (ban search operators, plan N
  at once, attach a research goal, do not search for remembered project names) with
  nothing else changed.
  Lesson 22's problem of **hitting the 16-step ceiling twice with no answer** became
  **completing twice with fully cited answers**; queries with operators fell from 3,
  10 to 0, 1

- The first run after copying blew up, exposing a bug latent for three lessons.
  `shared/streaming/openai.ts`'s tool call accumulator groups by `index`, and
  Gemini's OpenAI-compatible layer never sends `index`. When the model issues several
  tool calls at once, four arguments JSON documents get concatenated into one string →
  parse fails → empty arguments → `400 status code (no body)` on the next round.

  > The previous three lessons never triggered it, because the model happened to call
  > one tool per round.
  > Rule B (plan 3-4 queries at once) made it start issuing parallel calls, and the
  > bug surfaced.
  > The fix: use `index` when present, otherwise `id`. Lessons 21 and 22 regression
  > tested

- **Rule A works, rule D does not**: "do not use syntax like `site:`" holds, and "do
  not search for project names you remember" does not — it searched HumanPlus, GMR
  and dex-retargeting anyway.

  > Format rules can be constrained by a prompt; prior beliefs cannot.
  > Which is exactly why deep-research does not use a prompt to ask the model to
  > stop but hardcodes the condition as `breadth/2` and `depth-1`. The third
  > confirmation of the same principle.

- **An unexpected comparison result**: none of the four projects **has a retrieval
  evaluation set**. Lesson 22 has nDCG/recall/novelty; they rely on user reports and
  eyeballs. That is not a knock on them; an evaluation set can only be built by
  someone inside the domain

#### The original plan is kept here (the rejected version, as a decision record)

```http
POST /search
{ "query": "...", "max_results": 10, "search_depth": "advanced" }
```

The internal flow:

```text
SearXNG searches for candidate URLs
→ Crawl4AI fetches the body text
→ dedup and chunking
→ embedding similarity
→ cross-encoder reranker
→ returns JSON (title / url / content / score)
```

Not that finishing it gives you Tavily's scale and stability, but that you would
know exactly **which engineering problems' answers it sells**.

### Lesson 24: the Deep Research loop

```text
analyse the question → split into sub-questions → generate several queries → search in parallel → read pages
→ work out what is missing → search again → collect citations → write the report
```

AI search's core is usually not a mysterious new model but this loop's quality:

- how good the queries are
- whether results repeat
- when to keep searching and when to stop
- how to preserve what has been learned
- how to avoid being led away by low-quality sources

The state looks roughly like this. The point is managing clearly **what has been
searched, what has been read, which evidence supports which claim, what is missing,
and whether to stop**:

```ts
type ResearchState = {
  originalQuestion: string
  subQuestions: string[]
  visitedUrls: Set<string>
  evidence: Evidence[]
  unresolvedQuestions: string[]
  iteration: number
}
```

The first version **deliberately avoids LangGraph**. Frameworks wait until the
reader has written one themselves and knows why they need one (the same position as
the README's "do not build an agent for the sake of building an agent").
LangChain's `open_deep_research` sits at the end of the lesson as a reference:
planner / researcher separation, state design, subtask parallelism, retry and
termination conditions.

**Lesson 24's measurements**:

- The same question (Lesson 22's): the agent version hit the 16-step ceiling twice
  with no answer; the research loop version **finished in 28 seconds with 13 pieces
  of evidence all carrying genuinely fetched URLs**, at 7 searches / 9 fetches / 9
  model calls, all within the bound computed before starting

- **URL dedup blocked 22 repeat fetches**. deep-research does not do this
  (`visitedUrls` is only used to list Sources) and gpt-researcher does
  (`_get_new_urls`). This follows the latter

- **Query dedup has to go into code**. The prompt already says "do not repeat", and
  the fake provider repeated two on its first run. The fourth appearance of the same
  principle

- **Two more silent failures, both self-inflicted**:

  | Symptom | Cause | Fix |
  |---|---|---|
  | four pages fetched, 0 conclusions, no message | three causes (bad JSON / no conclusion / sources filtered) are indistinguishable | `Extraction.failure` forces the reason to be stated |
  | the report stops mid-URL at `(https://github.com/kin` | `stopReason === "max_tokens"` was ignored | record `truncatedOutputs` and display it |

  > That is the fourth instance of the same disease in the series (21 Step 5, 22 Step
  > 5, 23 Step 6, 24 Step 5).
  > Every time you add a stage, ask: when this step does nothing at all, can I see
  > it?

- **One thing here goes beyond deep-research**: learnings are bound to sources, with
  a programmatic check that only genuinely fetched URLs may be cited. That is the
  precondition for Lesson 25's citation verification.
  But it currently only blocks "citing a page that was never fetched", not "that page
  does not say this".

### Lesson 25: citations and evaluation

Lesson 7's approach carries over directly: deterministic scoring, no LLM judge.

```text
does the cited sentence really exist on the source page?
was a cited number rewritten?
does every claim have matching evidence, or are there bare assertions?
after changing the reranker or breadth, did anything regress? (--compare)
```

**What earlier lessons already paved for it** (used directly when writing this
lesson):

| Material | Where | Purpose |
|---|---|---|
| each page's "actual fact" | `groundTruth` in `lesson-20-search-agent/corpus/pages.ts` | the ground truth, invisible to the agent |
| evidence bound to sources | `Learning.sources` in `lesson-24-research-loop/state.ts` | the precondition for sentence-level comparison |
| only fetched pages may be cited | the source filter in `steps.ts` | already blocks half the problem |
| how to write a deterministic rubric | `lesson-07-evaluation/rubric.ts` | the shape carries over |

**Three errors to catch** (all seen in the previous four lessons' measurements):

1. **citation grafting**: a sentence carrying a real URL where that page does not
   say it (Lesson 21 Step 6's `Pink`)
2. **number drift**: the source says 0.8x and the report says 0.5x
3. **bare assertions**: a sentence in the report with no citation at all

The first requires comparing sentence against body text, which is this lesson's main
workload.

**Not folded in yet**: how to write a long report without losing citations
(`gpt-researcher/.../report_generation.py`, 309 lines). This lesson only verifies;
it does not write. Folding that in would be Lesson 25's second version.

**Lesson 25's measurements**:

- Running the check against Lesson 24's **real output**, 12 claims / 68 atoms, three
  problems found, **all three genuine**:

  | Problem | Content |
  |---|---|
  | bare assertion | the report's **central conclusion** carries no source (the details all do) |
  | citation grafting | the licensing line carries three URLs, one being a forum thread that never mentions licensing |
  | unsourced completion | the source says "CPU-only… 40x slower", the report says "40 times slower than GPU" |

- **All three traps hit in this lesson are on the evaluation side**, which is more
  dangerous than errors in the system itself, because they send you to fix something
  that is not broken:

  | Trap | Symptom | Lesson |
  |---|---|---|
  | the sentence-splitter's placeholders broke | **every claim became "no citation"**, and the program still completed | one less mechanism is one less thing that can break; the placeholders were removed entirely |
  | the evaluation read `index.json` while the agent read `fetchPage`'s long document | correct citations judged hallucinated | **the evaluation's sources must be the same ones the system actually saw** |
  | stripping whitespace turned "June 2026" into "62026" | correct numbers not found | numbers and identifiers need different normalisation |

  After the fixes, the real report went from "14 unsourced" to "5", and the
  remainder are all genuine problems.

- **None of the four reference projects has citation verification**. They produce
  citations, and not one goes back to check the citations hold. The same thing as
  Lesson 23's finding that "none has a retrieval evaluation set": evaluation can
  only be built by someone inside the domain.

### Lesson 26: cost and budget

**Why it only came up after reading the source**: gpt-researcher threads
`cost_callback` through **every** LLM call (in `actions/query_processing.py` and
`context/compression.py`), and has `estimate_llm_cost` at `utils/costs.py:63` and
`add_costs` at `agent.py:773`. This series had never measured money.

Lesson 24 already proved "the depth knob is the cost knob", and `estimateCost()` can
compute search and fetch counts but **cannot compute money**, because there was no
token pricing.

What you learn:

- how to look up and estimate each provider's pricing (input and output separately)
- threading a cost accumulator into the loop without dirtying every function
  signature
- what to do at "20% of budget remaining": stop, downgrade to a cheap model, or
  narrow the breadth
- how to present the cost-quality trade-off to the user

**Runnable code is possible**: and it can sit directly on Lesson 24's `Budget`.

**Lesson 26's measurements**:

- `total_tokens` is far larger than `prompt + completion` (Gemini 3.6 Flash):

  ```
  case                  input  output   total    gap  underest.  stopReason
  very short (100)         13       1     107      93      7.6x   end
  one sentence (400)       16      13     412     383     14.2x   max_tokens
  one sentence (4000)      16      47     686     623     10.9x   end
  long answer (2000)       26     643    2022    1353      3.0x   max_tokens
  ```

  The difference is thinking tokens: not in output, billed, and **eating the
  maxTokens allowance**. The two "one sentence" rows are the same question: an
  allowance of 400 truncates, 4000 does not.

  > For a reasoning model, `maxTokens` is not an output length limit but the total
  > allowance for thinking plus writing.
  > This also corrects Lesson 24 Step 5's causal explanation: the report was not
  > truncated because there was too much evidence but because thinking ate the
  > allowance first. The fix at the time happened to be right for the wrong reason

- **Where the money goes is not where intuition says**: `extractLearnings` takes
  47-56% and `writeReport` only 28-37%. Saving money means trimming the body text fed
  into extraction first, not asking the report to be shorter

- **The unit price per piece of evidence barely changes with depth** ($0.0029 vs
  $0.0031), so "should I run another level" can be answered arithmetically. The
  thinking share does rise, from 47% to 60%

- **The fifth "nothing errored, there was just no data"**:
  `shared/streaming/openai.ts`'s early return path for `max_tokens` carried no usage,
  missing for three lessons.
  Ironically, truncated calls are usually the most expensive

- **The price table is deliberately empty**. Prices go stale, and a stale precise
  number is more dangerous than no number.
  Tokens are a measured fact and money is an inference needing external information;
  keep them apart

### Lesson 27: hybrid local-document and web retrieval

**Source**: `gpt_researcher/document/` (5 files, local file loaders),
`gpt_researcher/vector_store/`.

**Why it deserves its own lesson**: "research my documents plus what is on the web"
is the most common real requirement, and the whole AI Search part only did web. This
lesson forces out several problems web-only never meets:

- a local document has no URL, so what is a "source"? (filename plus page plus
  paragraph)
- a local document has no freshness or authority signal, so how does Lesson 22's
  ranking formula change?
- when local and web disagree about the same thing, which do you believe?
- how do PDFs, docx and slides become chunks (Lesson 21 only handled HTML)

**Runnable code is possible**: the corpus is this repo's own markdown (22 files, 214
chunks).

**Lesson 27's measurements**:

- **Incremental indexing is local RAG's watershed**. The second ingest: "reused 22,
  re-chunked 0".
  Without it, what you built is a system that starts giving stale answers on its
  second run

- **Fusion needs almost no code**, because Lesson 22 chose RRF (rank only).
  A local BM25 score and a web fusion score are not comparable at all, and ranks
  always are.
  **A good abstraction pays interest where you did not expect it**

- **But it goes wrong when one side is entirely irrelevant, and it took three
  attempts to get right**:

  | Version | Result |
  |---|---|
  | no floor | querying "how do you choose chunk size", **a sous vide cooking guide ranks 4th** |
  | a relative floor (below 35% of the top score) | **blocked nothing**; Lesson 22's score is min-max normalised within the candidate set, so the top is always near 1 |
  | copying gpt-researcher's `SIMILARITY_THRESHOLD = 0.35` | **still blocked nothing** |
  | measuring the distribution and taking 0.60 | all 6 web results blocked, correct |

  The measured distribution for `gemini-embedding-001`: relevant queries 0.70-0.79,
  completely irrelevant queries still **0.45-0.52**. gpt-researcher's 0.35 is
  calibrated for OpenAI embeddings.

  > A threshold is a property of the model, not a general rule. The same error as
  > Lesson 22's wrong dedup threshold, but easier to fall for: what was copied was
  > an authoritative project's declared constant, which makes it more comfortable not
  > to verify.

  Incidentally, this also promotes Lesson 23 Step 3's observation
  ("gpt-researcher uses a threshold rather than top-k") from "noted" to "necessary":
  **top-k is harmful in cross-source fusion**

- **The source distribution is itself a signal**: local-only means the external index
  does not cover it, web-only means your documents have not written about it yet

### An extension project (not a lesson, an exercise)

The lessons only build the general version. What is really worth building yourself is
a **vertical-domain AI-native index**: do not index the whole internet, pick a domain
you know (robotics, say: arXiv, GitHub, ROS Discourse, Hugging Face, official docs):

```text
URL discovery → crawl scheduler → content extraction
→ canonical URL / dedup → document store
→ BM25 index + dense index + link graph
→ hybrid retrieval → reranker → search API
```

Only at that layer do Exa-class problems start to bite: is semantic similarity really
better than keywords? Which queries should go keyword and which dense? Can a link
graph improve credibility? How does freshness enter ranking? Should papers, GitHub
and news rank differently? How do you search "pages similar to this page"? How do you
make results suit an agent rather than a person?

### Three things explicitly not done

1. **No crawling the whole web** — distributed crawlers, crawl scheduling, spam
   detection, index sharding, recrawl and freshness, storage cost, legal and robots
   rules. That is a search infrastructure company's subject, not a learning project
2. **No writing the lesson as a vector DB tutorial** — `documents → embedding →
   vector DB → top 5` is only the simplest semantic retrieval, and it would leave
   readers thinking that is all there is
3. **No complex multi-agent at the start** — five agents chatting to each other does
   not mean better search quality.
   A first version of `planner / research loop / writer` is enough, and it can even
   be one model changing prompts between stages. The hard parts are evidence
   management and evaluation, not agent count

### Reference projects

| Project | Position | Why read it |
|---|---|---|
| [dzhng/deep-research](https://github.com/dzhng/deep-research) | search agent | deliberately simple, the agent loop is obvious, readable in one sitting. As the "textbook version", reading this before GPT Researcher makes the latter much easier |
| [gpt-researcher](https://github.com/assafelovic/gpt-researcher) | search agent | production grade (it grew into the Tavily team). Do not read the whole repo; follow one request: query generation → search provider → scraper → context compression → report |
| [langchain-ai/open_deep_research](https://github.com/langchain-ai/open_deep_research) | agent orchestration | planner / researcher separation, LangGraph state design, parallelism, retry, termination conditions |
| [SearXNG](https://github.com/searxng/searxng) | source aggregation | a metasearch engine. Engine adapters, query parameter translation, result normalisation and merging, timeout handling, dedup. **Note it is not Exa**; it has no index of its own |
| [Crawl4AI](https://github.com/unclecode/crawl4ai) | crawler library | web page → LLM-friendly Markdown, with dynamic pages, sessions, caching and deep crawling. Apache-2.0, easy to modify for experiments |
| [Firecrawl](https://github.com/firecrawl/firecrawl) | web data API | closer than Crawl4AI to "a web context platform as a service" (`/search` `/scrape` `/crawl` `/extract`). The core is AGPL-3.0, so mind the licence for commercial use |
| [Perplexica](https://github.com/ItzCrazyKns/Perplexica) | application layer | a complete Perplexity-like product: UI → search endpoint → provider → retrieval → LLM synthesis → streaming plus citations. Get it running, then swap its SearXNG provider for your own (the project was recently renamed Vane; check its current state before writing the lesson) |
| [txtai](https://github.com/neuml/txtai) | retrieval | an embeddings database composing dense plus sparse plus graph plus RDBMS. The place to learn hybrid search |
| [Qdrant](https://github.com/qdrant/qdrant) | vector infrastructure | HNSW, payload filtering, metadata filters, multi-vector. No need to read the Rust; understand its position in the pipeline first |

### A suggested reading order

```text
dzhng/deep-research → GPT Researcher → SearXNG → Crawl4AI
→ Perplexica → txtai / Qdrant → LangChain open_deep_research
→ build your own vertical web index
```

The starting point is neither "read information retrieval theory for six months"
nor cloning a Perplexity directly. Get `search → crawl → rerank → research loop →
citation` working end to end once, then go deep on BM25, embeddings,
cross-encoders, query expansion and learning-to-rank — every piece of theory will
map onto a real problem you already met.

---

## To write: the Mastra part (Lessons 30-33)

- **Source**: [mastra-ai/mastra](https://github.com/mastra-ai/mastra) (already cloned
  into `mastra/`, 1.7G). The file locations and line counts below are actually
  counted
- **Why add a fourth project: Pi, OpenWorker and Hermes are all applications**, and
  Mastra is the only **framework**. Its value is not "how to wrap an API" but **the
  loop's boundaries**, where the loop collides with "three providers", "200 tools",
  "a crash midway" and "hostile input".
- Which is exactly what writing your own 215-line loop never collides with. Lessons
  1-27's subject is the loop itself, and these four lessons fill in the ring around
  it, all conforming to design principle 6 (`runTurn` does not move).

### ~~Lesson 30: one schema, three vendors, three ways of writing it~~ done

`lesson-30-schema-compat/`: `probe.ts` (measurement), `compat.ts` (the compatibility
layer), `tests/schema-compat.test.ts` (a contract test, no key needed, runnable in
CI).

Measured (real Gemini 3.6 Flash plus real GPT-5):

The first tier's six basic constructs (`["string","null"]`, `oneOf`,
`minLength/maxLength`, `minimum/maximum`, `enum`, nested optionals) → **both vendors
pass everything**.

> This nearly became "so modern models are fine and compatibility layers are a
> relic".
> That conclusion would be wrong, in exactly the way Lesson 16's first round was
> wrong: the task was too easy.
> A test that cannot detect a difference does not "prove there is no problem"; it
> means you have not found the boundary yet.

Raising the difficulty made the boundary appear:

| Construct | Gemini 3.6 Flash | GPT-5 |
|---|---|---|
| `multipleOf` | **silently violated** (5/5 returned 70) | ✓ 75 |
| `items: [A,B,C]` (tuple) | ✗ **API 400** | ✓ |
| pattern / maxLength / a 120-value enum / recursive `$ref` | ✓ | ✓ |

**This lesson's spine is "the two failures are completely different"**:

| | The API rejects it | The model ignores it |
|---|---|---|
| how you find out | a 400, the program blows up on the spot | **you do not** |
| the fix | rewrite it into a form it accepts | **move the constraint into the description** |

> A loud failure is a gift. `multipleOf: 15` receiving 70 is the real problem:
> the API accepted it, the model answered, the tool ran, the data went in, and
> **not one layer complained**.

The compatibility layer has two moves (the same as mastra's): structural rewriting
plus moving constraints into descriptions.
The result: `compat=off` violates 5/5, `compat=on` is correct 5/5, and the tuple goes
from a 400 to a pass.

**The same family of error again**: that `TARGETS` table was measured in 2026-07 and
will go stale.

> A measurement you can re-run is an asset; a constant you copied is not.
> This is the third time: Lesson 22 guessing a dedup threshold of 0.5 from intuition
> (0.17 in reality), Lesson 27 copying gpt-researcher's relevance threshold (useless
> for these embeddings), and now this table. All three treat somebody else's
> measurement as a general rule.
> This perhaps belongs in the design principles list (proposed principle 11).

### ~~Lesson 30 (the original plan)~~

- **Source**: `mastra/packages/schema-compat/src/provider-compats/`
  (anthropic / google / openai / openai-reasoning / deepseek / meta, one file each)
- **Why it comes first**: Lesson 1 already has a provider abstraction and `tests/`
  already has "a contract every provider must satisfy", but that contract only covers
  **message format**. What really explodes is **tool schema**:

  | Phenomenon | Location |
  |---|---|
  | Google does not support `null`; it must become `z.any().refine(v => v === null)` | `google.ts:213` |
  | `claude-3.5-haiku` supports a string's `min`/`max`, but **the model does not honour them**; the constraint must move into the tool description to work | `anthropic.ts:49` |
  | every vendor handles `optional` differently, so the allowlist can only be built case by case | `anthropic.ts:38`, `google.ts:200` |

- It has `provider-compats/test-suite.ts`: one shared contract test run across every
  provider's compatibility layer. That is the complete version of our contract test,
  to be copied side by side
- **The lesson's shape**: write a tool with optionals plus unions plus null plus
  string length limits, feed it to three models, see who breaks, then write the
  patching layer. Runnable, with a visible difference
- **Where it attaches**: after Lesson 12 (MCP). An MCP server's schema is not yours
  to change, so at that point the patching layer becomes mandatory rather than
  optional

### ~~Lesson 31: moving the ifs out of runTurn (a processor pipeline)~~ done

`lesson-31-processors/`: `processor.ts` (a minimal pipeline plus a secret redactor),
`demo.ts` (the three-boundary failure experiment), `tests/processors.test.ts` (a
contract test).

**The minimal experiment worked as planned, and the failure with the mechanism off is
very clear**:

```text
read_file(.env) → tool result → model / trace / memory

all processors off        LEAK / LEAK / LEAK
only model input guarded  safe / LEAK / LEAK
all three boundaries      safe / safe / safe
```

> The model not seeing the secret does not mean the system did not store it.
> Model input, trace and memory are three independent sinks and must be handled at
> each one's entrance.

A detail only visible while implementing: a processor's `findings` **must not keep
the matched string**, only the kind and the count. Otherwise the redactor's own audit
log becomes a second secrets database.

This lesson deliberately uses no real model. Its thesis is a deterministic property
of data flow (did a string cross a boundary), not model behaviour; adding a model
would only blur the verdict.

#### The original plan

- **Source**: `mastra/packages/core/src/processors/`, with 40 files under
  `processors/processors/`
- **What you learn**: an architectural turn, where things originally compiled into
  the loop (truncation, compaction, permission checks) become a pluggable
  input/output pipeline.
  This also explains how "the core loop barely changed from Lesson 1 to 17" was
  achieved: everything that changes was pushed out into processors
- **It comes with a whole set of guardrail implementations to compare against**:

  ```
  prompt-injection-detector.ts  409    token-limiter.ts   412
  pii-detector.ts                      cost-guard.ts      316
  moderation.ts                        unicode-normalizer.ts
  system-prompt-scrubber.ts            regex-filter.ts
  ```

- **Where it attaches**: Lesson 15 covers injection defence at the **memory layer**
  and this lesson covers defence at the **I/O boundary**; two different positions.
  `cost-guard.ts` connects directly to Lesson 26

### ~~Lesson 32: 200 tools do not fit in context~~ done

`lesson-32-tool-search/`: `catalog.ts` (200 tools across 20 services, plus 12 tasks
phrased the way a person asks), `tool-search.ts` (BM25 index, the two meta-tools,
the three phases), `demo.ts` (offline: bytes, ranks, phase refusals), `agent.ts`
(four modes against a real model), `tests/tool-search.test.ts`.

**The mechanism-off experiment did not fail the way the plan predicted, and the
real answer is better.** The plan was a token-cost argument. What actually happens:

```text
Mode: ceiling — all 200 tools in one request
  rejected  400 Invalid 'tools': array too long. Expected an array with maximum length 128, but got an array with length 200 instead.
```

> On OpenAI a 200-tool request is not a legal request. Tool search is normally
> sold as an optimisation, and an optimisation is something you can decline.
> This is a ceiling.

Measured, 12 tasks, `gpt-5`, `MAX_TOKENS=8192`:

| mode | correct | input tokens | model calls |
|---|---|---|---|
| flat (128 tools, expected tool always present) | 11/12 | 48950 | 12 |
| search-bare (2 meta-tools, no instruction) | 10/12 | 14009 | 36 |
| search (+ Mastra's injected instruction) | 9/12 | 14707 | 35 |

Three things this round settled, two of them against the first draft:

- **the token saving is real (3.5x) and the accuracy difference is not.** One or
  two tasks out of 12 is noise. The write-up says so rather than claiming a
  percentage.
- **the round trips are the hidden price**: 36 model calls against 12. Cheaper in
  tokens, three times the latency.
- **Mastra's injected instruction (`tool-search.ts:438`) made no measurable
  difference** at an adequate output budget. The first run said it was essential
  — see the measurement bug below.

**A measurement bug that nearly became a finding.** The first run scored search
mode 2/12, mostly "no tool call", which read as the model refusing to search.
`MAX_TOKENS` was 2048 and `gpt-5` spends its output allowance on reasoning first;
an empty response is a truncation, not a refusal. At 8192 search went 2/12 → 9/12
and search-bare 0/12 → 10/12. This is Lesson 26's trap arriving from the other
side, and README Step 5 keeps it in the lesson on purpose.

**BM25 on the raw user sentence is 7/12 at top-5**, and every miss is a vocabulary
miss ("pushed straight to main" vs "branch protection"). That is why the query is
written by the model, not by the harness — and it is the argument for the
production version's embeddings (see the Semantic Router entry below).

**Every wrong pick, in both modes, is a near-duplicate across vendors**
(Datadog vs Sentry, Slack vs Notion, HubSpot vs SendGrid). Two of the three are
defensible, so the task set's single right answer is a judgement call and the
README says so. 12/12 was never available.

Left for Lesson 33: where the loaded set lives. Mastra's `tool-search-stores.ts`
(258 lines) makes it pluggable with a TTL and a thread-keyed variant, which is the
same "where does mutable agent state live" question in a smaller box.

#### The original plan

- **Source**: `mastra/packages/core/src/processors/processors/tool-search.ts` (654
  lines) plus `tool-search-stores.ts`
- **What you learn**: tools are not all handed to the model up front; instead
  **BM25 searches the tool descriptions** → the model "loads" what it needs → and only
  then does it enter the active set. Three phases: `search` / `load` / `active`
  (`tool-search.ts:12`)
- **The cost is low**: Lessons 17 and 20 already have BM25, reusable directly, with
  the index target changing from sessions to tool descriptions
- **Bonus**: Claude Code's own `ToolSearch` is this mechanism, so the lesson can point
  readers at "the tool you are using right now looks exactly like this"

> Two corrections the writing produced: the phase type is at `tool-search.ts:12`,
> not `:13` as this file said for two months; and "the cost is low" was right about
> the index and wrong about the lesson — the expensive part was building a task set
> and catalogue honest enough to measure against.

### ~~Lesson 33: the loop is not a loop but a serialisable state machine~~ done

`lesson-33-durable/`: `workflow.ts` (the step engine, the JSON run state, the
atomic store), `pipeline.ts` (charge → approve → receipt, plus an append-only
ledger), `worker.ts` (one attempt, in its own process), `demo.ts` (spawns and
SIGKILLs it), `tests/durable.test.ts`.

**The difficulty warning was right and the fix was to make the crash real.** The
demo really spawns a child process and really sends `SIGKILL`; a `throw` still
runs `finally`, still flushes, and would have made every claim in the lesson
untrue. That decision is what kept it from becoming "understanding architecture".

The measurement is one number — how many times the card was charged — read from a
ledger file rather than a variable, because the process being measured is the one
that dies:

| scenario | charges | emails |
|---|---|---|
| naive, crash after charge | 2 | 0 |
| durable, crash after charge | 1 | 1 |
| durable, crash before journal | 2 | 0 |
| durable, halt on interrupted | 1 | 0 |

Three things the build produced that the plan did not have:

- **the plan's three-step workflow was right, and two scenarios were missing.**
  "Crash after the journal" only proves the happy path. The lesson's real content
  is the other two rows: a crash in the window between the side effect and the
  journal write, which durability does **not** fix, and the `halt` policy, which
  fixes the charge count by never finishing the run.
- **write the step record before running the step, not after.** Found by running
  it: scenario 3 originally reported `in-flight=[]`, because the state was only
  saved on completion, so an interrupted step was indistinguishable from one that
  never began. One extra write per step is what makes a crash diagnosable at all.
- **`InterruptedPolicy` is a parameter, not a default.** There are exactly two
  ways to be wrong — at-least-once and at-most-once — and which one a step wants
  is a business decision. Replaying `send_receipt` sends a duplicate email;
  replaying `charge_card` takes money.

**This is now the strongest possible setup for Lesson 34.** The lesson ends with a
journal that knows a step was interrupted and cannot tell you whether its side
effect landed, because the journal is not the same system as the payment
provider. No fifth policy closes that; a different contract with the other side
does. Nothing needs to be argued for Restate any more — the gap is already
measured and on the page.

#### The original plan

- **Source**: `mastra/packages/core/src/agent/durable/`,
  `mastra/packages/core/src/workflows/` (`handlers/control-flow.ts`,
  `state-reader.ts`, suspend/resume)
- **What you learn**: Lesson 9's "pause for approval" is an in-process inbox. The real
  version **persists agent state, lets the process die, and resumes on another
  machine**. That requires the loop to be a snapshottable step graph rather than a
  while
- This lesson violates design principle 6, in the same way Lesson 24 does: it does not
  improve the agent loop but changes its shape. Follow Lesson 24's approach and build
  something new beside `runTurn` without touching it
- **A difficulty warning**: the heaviest of the four, and the easiest to write as
  "understanding architecture" rather than runnable code (the same worry as Lesson
  10). Build the **minimal version**: a three-step workflow, suspend at the second
  step, kill the process, restart and resume.
  Do not touch the `workflows/inngest` or `workflows/temporal` adapters

### No new lesson needed; fold these into existing ones

| Thing | Source | Where |
|---|---|---|
| switching provider mid-session (tool_use / tool_result pairing breaks) | `core/src/processors/provider-history-compat.ts` | a section added to Lesson 4 |
| structured output plus repair by a fallback model on failure | `processors/processors/structured-output.ts` (394) | Lesson 7 |
| tracing spans, per-call cost attribution | `core/src/observability/` | **Lesson 14**, written 2026-09-10 |
| message format normalisation (a 1755-line MessageList) | `core/src/agent/message-list/message-list.ts` | Lesson 4, or as further reading for Lesson 30 |
| multi-agent delegation and routing | `core/src/loop/network/` | a reference implementation for Lesson 19 |

### The parts explicitly **not written**

| Topic | Why skipped |
|---|---|
| `deployer` / `cli` / `create-mastra` | packaging and deployment, nothing to do with agents |
| `playground` / `playground-ui` / `editor` | interface problems |
| `integrations` | the same reason as OpenWorker's connectors: highly repetitive |
| `voice` | an interface problem |
| `workflows/inngest`, `workflows/temporal` | that is "how to connect to a durable execution service", not "why durability is needed" |

---

## ~~To write: the Restate part (Lesson 34)~~ done: exactly-once is an agreement

- **Source**: [restatedev/ai-examples](https://github.com/restatedev/ai-examples)
  (already cloned into `restate-ai-examples/`, `60d1eda`). **Very small**: the two
  TypeScript ones total 3101 lines and each file in `tour-of-agents/src` is 55-84
  lines, readable in an afternoon. A different world from Hermes's 115k lines
- **Why Restate rather than Temporal**: the same problem at a tenth the size.
  Temporal serves as a **reference source** (its architecture documentation explicitly
  requires activities to be either idempotent or non-retryable); do not go read the
  server's Go codebase

### It follows Lesson 33; it is not a separate subject

```
Lesson 33  Mastra: agent loop → a serialisable state machine → suspend / resume
Lesson 34  Restate: what to do after **one tool call** inside the state machine crashes
```

Lesson 33 answers "how do you resume after the process dies"; 34 answers a question
33 never asks: when you resume, does the side effect already emitted count.

### There is only one core mechanism

`ctx.run(name, fn)`
(`typescript-restate-only/tour-of-agents/src/chat-agent.ts:23`,
`parallel-tools-agent.ts:31`):

```ts
const result = await ctx.run("LLM call", async () => llmCall(messages),
                             { maxRetryAttempts: 3 });
```

Executed steps are written into a journal, and on replay they **are not re-run; the
recorded value is returned**. Model calls, tool calls and parallel tools
(`RestatePromise.all`) all go through the same thing.

> The point is not what the API looks like but that it **forces you to name every
> side effect**. An unnamed side effect cannot be replayed.

### The experiment to build (leave `send_payment` alone for now)

The smallest observable, countable side effect: `append_order()` appending one order
to a file.

```
1. the order is written successfully
2. kill the process before it returns the result
3. restart
4. count the entries in orders.jsonl
```

Four variants to compare: a plain async function / with a journal / with an
idempotency key / without one.

**The window this lesson really teaches** (the initial assumption "a journal makes it
safe" is wrong):

```
side effect happens  ────────→  journal lands
            ↑
        die here and that step is certain to run again
```

A journal cannot eliminate that window, only shrink it. So the conclusion is not
"durable execution solves it" but **at-least-once is the ceiling, and the rest must
come from the tool being idempotent**. Which lines up exactly with Temporal's "either
idempotent or non-retryable".

### Two things already read that are worth copying

| Thing | Location | Why |
|---|---|---|
| terminal errors (non-retryable) | `vercel-ai/tour-of-agents/src/errorhandling/stop-on-terminal-tool-agent.ts`, `fail-on-terminal-tool-agent.ts` | retrying is not always right. "This card was declined" stays declined after a hundred retries |
| compensation (rollback) instead of retry | `vercel-ai/tour-of-agents/src/rollback-agent.ts` | the hotel was booked and the flight was not → run `undo_list` in reverse. **This is the other half of Lesson 9's "unrecallable"** |

### The parts explicitly **not done**

| Topic | Why skipped |
|---|---|
| really running restate-server | it needs a separate binary and a registered deployment. Follow Lesson 12's approach and write a minimal journal (that lesson wrote its own 200-line MCP server); that is what keeps design principle 1 |
| `a2a/`, `mcp/`, `google-adk/`, `pydantic-ai/`… | six SDK versions of the same examples, highly repetitive |
| Restate's virtual objects / awakeables / distributed semantics | that is "how to use Restate", not "why an agent needs durability" |

---

## ~~To write: the Sandbox part (Lesson 35)~~ done: a permission engine is not a sandbox

`lesson-35-sandbox/`: `sandbox.ts` (a Seatbelt profile generator plus `run()`),
`demo.ts` (the scenario matrix, every command run twice), `agent.ts` (the engine
plus the sandbox in one loop), `fake-provider.ts`, `tests/sandbox.test.ts` (13
tests in two tiers).

**Three mechanisms switch off, each with its own failure**: `MANDATORY=off` (a
`.zshrc` written inside the allowed directory), `BLOCKMOVES=off` (a read deny
walked around with `mv`), `SEAL=off` (the same, for a path inside a writable
root — this port is deliberately stricter than SRT there).

Measured with real Gemini 3.6 Flash, the task being an ordinary one ("deploys
are returning 401, find which token deploy.sh uses"), every command on Lesson
8's allowlist:

| | Runs | Kernel refusals | Answered | Token in the transcript |
|---|---|---|---|---|
| `SANDBOX=off` | 3 | 0 | 3/3 | **3/3** |
| `SANDBOX=on`, 12-step ceiling | 8 | 6-7 each | 0/8 | 2/8 |

The failure mode moved rather than disappearing. Lesson 8's model swapped tools
five times and then falsely reported completion; this one tried `chmod -R +r
. ..`, `sudo`, hardlinks, `xattr`, getting `deploy.sh` to do the read for it, and
reading the sandbox's own source — **and never fabricated the token**. It burns
the step budget instead of lying.

**Two findings worth more than the matrix**, both of which arrived by running it
rather than by reading the source:

1. **The sandbox held and the secret leaked anyway.** Raise the ceiling to 24 and
   the enumerating policy loses 2/2, because the token also sat in this lesson's
   own source files one directory up — a copy nobody had classified. The
   enclosing policy (deny the parent, allow the workspace back) holds 0/3.

   > A capability boundary is enumerated, and it cannot tell you what you failed
   > to enumerate. That third copy is an artifact of how the fixture was written,
   > and **that is the finding rather than a caveat on it**: a token in a test
   > fixture is exactly how this goes wrong in a real repository.

2. **The sandbox only governs what crosses the process boundary.** Deterministic,
   no model needed:

   ```
   .secrets/deploy-token.txt
     run_command  → the kernel denies it
     read_file    → returns the token
   ```

   `read_file` never spawns a process, so the profile has nothing to attach to,
   and the engine path-checks only `WRITE_LOCAL` (`engine.ts:173`). One boundary,
   two enforcement points, and they have to be derived from the same policy
   object. Lesson 31's three-sinks thesis, transposed.

**The lesson shipped a bug and kept it in the write-up** (Step 7): the enclosing
policy's `allowBack` re-opened a nested deny, because Seatbelt is last-match-wins
and the allow landed after it. Every rule in the profile was correct and the
order was wrong. SRT emits the fix at `macos-sandbox-utils.ts:310`; it had been
dropped in the shrink.

> A rule you can point at in the profile is not a rule that is in force.
> It was not caught by reading the profile — it was caught by a command coming
> back with the secret in it. Hence the test file's two tiers: profile assertions
> run anywhere and prove the rule is present; only the kernel tier proves the
> kernel agrees with your reading of it.

**Also measured, and it decides how much the network half can promise**: a
profile that allowlists a domain **does not compile** —
`sandbox-exec: host must be * or localhost in network address`, exit 65. That one
line of stderr is why SRT ships a TLS-terminating proxy and a CA. A domain
allowlist cannot live in the kernel policy at all.

### The original plan


- **Source**: [anthropic-experimental/sandbox-runtime](https://github.com/anthropic-experimental/sandbox-runtime)
  (already cloned into `sandbox-runtime/`, `295f0e1`). `src/` is 16,307 lines of
  TypeScript, and the macOS path is `sandbox-exec` plus a Seatbelt profile
  (`src/sandbox/macos-sandbox-utils.ts`, 1090 lines), runnable locally
- It was extracted from Claude Code's real requirements, not from general sandbox
  research

### It supplies the second half of Lesson 8's sentence

```
Lesson 8  permission engine   decides "may this command run"
Lesson 35 sandbox            even once allowed, what that process can actually touch
```

> This lesson has one thesis: a command allowlist cannot govern what happens after
> the command executes.

And **it has already happened twice in this repo**, not as a hypothetical threat:
Lesson 2's `npm test` walking up to the parent directory for `package.json`, and
Lesson 29 hitting it again 27 lessons later. The command itself is entirely legal
and entirely on the allowlist. That is this lesson's fixture, with nothing to
invent — `lesson-35-sandbox/workspace/` deliberately has no `package.json`, so
the demo's `direct` column really runs this repository's 208 tests.

### The experiment to build

Do not start by researching cloud sandbox infrastructure. Compare only two things:
`child_process.spawn` directly versus wrapped in a sandbox.

| Scenario | Expected |
|---|---|
| reading a file inside the workspace | succeeds |
| reading `../.env` | fails |
| writing a file outside the workspace | fails |
| connecting to an allowed domain | succeeds |
| connecting to a domain that is not allowed | fails |
| `npm test` walking up for `package.json` | **stopped by the boundary** |

**Two design details to copy verbatim, because their directions are opposite**
(the README's "Dual Isolation Model"):

```
reads:  deny-then-allow   everything readable by default; deny a large block, then allow some back
                          allowRead beats denyRead
writes: allow-only        nothing writable by default; only what you list is opened
                          denyWrite beats allowWrite
```

**Two fields in the same config file have opposite precedence**, and both are right.
Designing this from scratch you would certainly make them consistent, and leave a
hole on the wrong side.

### Reference sources (do not implement all four in the first lesson)

| Project | What to learn |
|---|---|
| **Anthropic SRT | local capability restriction (the main source**) |
| E2B | Firecracker microVM isolation, code interpreter |
| Daytona | long-lived agent workspaces |
| OpenSandbox | a unified abstraction over several runtimes (Docker / K8s) |

Same as Lesson 23: compare against the source item by item first, then decide which
mechanism is worth copying back.

### The parts explicitly **not done**

| Topic | Why skipped |
|---|---|
| Linux bubblewrap / Windows WFP (`linux-sandbox-utils.ts` 1728 lines, `windows-sandbox-utils.ts` 2268 lines) | not runnable locally, so it becomes architecture reading |
| MITM CA, TLS terminating proxy, credential masking (`mitm-ca.ts` 624, `tls-terminate-proxy.ts` 623, six `credential-*.ts` files) | that is network security engineering, not agents. **But the lesson should say why they exist**: a sandbox can block connections and cannot stop a key being sent to an allowed domain |
| the seccomp filter generator | as above |

---

## To write: the OpenCode part (Lessons 28-29) — **deliberately not a whole part**

- **Source**: [anomalyco/opencode](https://github.com/anomalyco/opencode) (already
  cloned into `opencode/`, `dev` branch `a45c2b9` / v1.18.9)
- **Its position differs from the other four**: Pi is a runtime, OpenWorker a
  product, Hermes a platform, Mastra a framework, and **OpenCode is a coding agent
  product already heavily used in the real world** doing the same thing this series
  does

### Why not a whole part, first

Most of OpenCode's content is already here:

| OpenCode | Here |
|---|---|
| agent loop / tool calling / streaming | Lessons 1-3 |
| session / compaction | Lessons 4-5 |
| permission | Lessons 8-9 |
| agent server / MCP / subagent | Lessons 10 / 12 / 19 |
| provider compatibility / processor | Lessons 30-31 |

**Only two things not covered by other projects are added**; the rest folds back into
existing lessons.

### ~~Lesson 29: a model's self-report is not evidence of completion~~ done

`lesson-29-evidence/`: `snapshot.ts` (the shadow git, around 160 lines),
`evidence.ts` (set operations over the three records), `loop.ts` (Lesson 8's loop plus
two lines of snapshot), `fake-provider.ts` (five scenarios), `demo.ts`, `agent.ts`,
`tests/evidence.test.ts` (12 tests, 4 of which really invoke git).

**One sentence in the plan was wrong, in a very typical way**: it originally said
"the playground already has git, so a low-level command like `git stash create` is
enough".

> `git stash create` operates on **the user's own repo** (reading and writing the
> index, leaving reflog entries).
> Touching the git state a user is working in, in order to record what an agent did,
> costs more than the problem being solved.

opencode's approach points `--git-dir` elsewhere and only `--work-tree` at the
project (`snapshot/index.ts:71`). Swapping to that brought an unanticipated benefit:
the workspace does not need to be a git repo at all, and this lesson's is not.

**Measured (real Gemini 3.6 Flash)**:

| | Files changed | Structural divergence | What the model finally said |
|---|---|---|---|
| `ANSWER=n` ×3 (denial group) | 0 / 0 / 0 | yes / yes / yes | 3/3 claimed "I have refactored src/app.ts for you" and attached "the tidied code" |
| `MODE=auto` ×2 (control group) | 2 / 2 | none / none | honest |

The denial group reproduces Lesson 8, but this time **nobody has to compare `md5`**:
`patch.files.length === 0` is printed in the same table, right beside that beautiful
paragraph.
The control group matters as much as the denial group — a checker that always says
"there is a problem" gets switched off quickly.

**The verdict is deterministic** (three set operations, no LLM judge), but
deliberately in two tiers:

```
structural  unbacked-write / unreported-change / no-evidence
heuristic   unmentioned-change (it looks for a filename in natural language, so false negatives happen)
```

> Reported together, the hardest line would look as credible as the softest.
> The strength of evidence is itself part of the evidence.

`no-evidence` **deliberately does not judge whether that text claims completion**.
Judging meaning requires introducing a judge, and this lesson's whole thesis is not
having that judge. So it reports only facts.

**Implementation nearly produced a false-positive machine**: `ToolRecord` initially
had no `mutating` field, so `read_file("src/app.ts")` counted as "claimed to change
app.ts", and every read-only exploration produced a false `unbacked-write`.

> "Mentioning a file" and "claiming to have changed a file" are different things.
> False positives turn the checker into noise, and then it gets switched off — worse
> than not building it.

It also caught Lesson 2's sandbox escape happening a second time, 27 lessons later.
On a real-model `MODE=auto` run the model decided by itself to "run the tests" → the
workspace has no `package.json` of its own → npm walked up to the main repo → **it
ran this project's 130 tests**.
With a `package.json` added, `npm test` is contained, and `git diff` still walks up.

> Every boundary file added blocks one command. This is Lesson 35's (sandbox) second
> real case: a permission engine decides whether something may execute, not what it
> can reach once it does.

**Two switchable mechanisms** (the design principle: value can only be explained by
switching it off): `CAPTURE=first-tool` takes the baseline a moment too late → the
file change the provider made before emitting any event **disappears entirely, with
no error message**; and the `honest` / `partial` scenarios are controls, proving the
checker does not cry wolf every time.

#### The original plan

- **Source**: `packages/opencode/src/snapshot/index.ts` (807 lines),
  `session/processor.ts:99-109`, `:436-469`, `:540-545`
- **Why it comes first**: it is **the answer to Lesson 8's measured result**.
  Lesson 8 measured "the engine succeeded 100%, the user was deceived 100%" — not one
  byte of the file changed and the model told the user "I have refactored and
  simplified src/app.ts for you".
  The conclusion then stopped at "this is worse than Lesson 21's silent failure" and
  **offered no fix**.
  OpenCode's fix is structural:

  ```
  assistant text    the model's own account
  tool result       what one tool call reported
  snapshot patch    what the workspace actually became   ← only this one is fact
  ```

- **One implementation detail that must be copied** (`processor.ts:99-102`): the
  snapshot must be taken **before the LLM stream starts**. The source's comment says
  it plainly — a provider may already be executing tools before emitting a
  `step-start` event, and capturing when the event arrives is too late.

  > This is the kind of ordering problem you will certainly get wrong writing it
  > yourself, and getting it wrong is completely invisible.
  > The wrong version is right most of the time, and loses one file exactly when the
  > provider jumps the gun.

- **The minimal experiment** (four scenarios, comparing the three records):

  ```
  1. the tool really edited and the model says so      all three agree
  2. the tool was denied and the model says it edited   ← Lesson 8's case
  3. the tool edited two files and the model mentions one
  4. edited then reverted, so the working tree is unchanged  ← the tool results say yes, the patch says no
  ```

  The fourth is the most valuable: **it is the only direction in which a tool result
  and a snapshot diverge and the snapshot is right**.

- **It grows a new principle** (if the experiment holds, straight into the design
  principles list):

  > **An agent that produces text cannot use its own text to prove a task is
  > complete. The completion condition must come from the environment the task
  > lives in.**

- **Runnable code is possible**: the playground already has git, so a low-level
  command like `git stash create` is enough, without copying those 807 lines

### ~~Lesson 28: after an interruption, the session must not lie~~ done

`lesson-28-consistency/`: `parts.ts` (parts and the tool lifecycle), `processor.ts`
(events → parts plus `cleanup()`), `audit.ts` (five audit rules),
`fake-provider.ts` (**a stream that can be interrupted at a named point**),
`demo.ts` (the six-cell matrix), `agent.ts` (real model),
`tests/consistency.test.ts` (17 tests).

**The design problem of "how do you reliably interrupt a stream in a test" is
answered by having the stream abort itself at a named point**, making the
interruption point a parameter. Which two events a `setTimeout` version lands
between is luck, and it **moves silently**.

> The third appearance of this rule: Lesson 18's fake clock, Lesson 29's `CAPTURE`
> points, and now interruption points. For any timing-caused bug, build an apparatus
> that can specify the timing first.

**The matrix came out** (`CLEANUP=on` is clean everywhere, `off` produces 2-4
violations depending on position):

```
interruption point  violations with CLEANUP=off
reasoning           unfinished-span, message-never-completed
tool_input          in-flight-in-storage, message-never-completed
tool_running        the two above + unfinished-span + unrecorded-patch
tool_finishing      as above
text                unfinished-span, message-never-completed, unrecorded-patch
before_step_finish  message-never-completed, unrecorded-patch
none (no interruption)  message-never-completed   ← cleanup is not a remedy for interruption
```

The last row only became clear while writing: **a normal completion needs cleanup
too**, and interruption merely makes it visible.

Three decisions copied from the source, all of the "without it two situations become
indistinguishable" kind:

| Decision | Location | Without it |
|---|---|---|
| `pending.input` is a **string** | `schema/src/session-message.ts:81-119` | half a JSON document treated as an object → a parse exception or an empty object |
| a tool has three timestamps (created / ran / completed) | `session-message.ts:132-137` | "the arguments have not finished arriving" and "it is taking a long time" become indistinguishable |
| `interrupted: true` rather than staying in running | `session/processor.ts:589` | "the tool broke" and "the user interrupted" become indistinguishable, and the former is worth retrying while the latter is not |

**The 250ms grace window** (`processor.ts:573`) is not a performance consideration
but correctness: if a tool that comes back after 20ms is marked interrupted, **the
record states something that did not happen**.

A bug the real model caught that the hand-designed six-cell matrix did not: the first
version applied the grace window to every case. On one real-model run the model called
a tool without emitting text first → the stream finished normally → `cleanup("end")`
→ the tool was still running → the 250ms elapsed → a successful tool was marked
interrupted while finish was "end".

> The grace window belongs to the interruption path only.
> And what is more worth recording is how it was caught: that path was not designed,
> the model walked it.
> Every cell of a scripted matrix is a situation somebody imagined.

The real model can only reproduce two of the six cells, and the reason lies in our own
abstraction: `shared/streaming` has no reasoning stream events, and `tool_call` is
emitted only once the arguments are complete (the deliberate simplification at
`types.ts:44-51`). So the `reasoning` and `tool_input` cells cannot be measured.

> **A good abstraction hides what you do not need; you only discover what it hid on
> the day you need it.** Your event model determines which failures you can observe.

Also, `AFTER_DELTAS` was 4 in the first version, and Gemini finished that sentence in
two or three chunks, so **the interruption never happened** — delta granularity is not
yours to control, another false negative.

**One passage not yet copied**: `message-v2.ts:349-357` converts `pending`/`running`
tools into `output-error` **before sending them back to the provider**, on the grounds
that every `tool_use` must have a matching `tool_result` (Lesson 3's hard rule). So the
same problem has three locations: storage, the screen, and **the history sent back to
the model**. Missing the third does not produce an inconsistent record but a 400 on the
next round.

#### The original plan

- **Source**: `packages/opencode/src/session/processor.ts` (718 lines),
  `session/message-v2.ts` (734 lines)
- **What you learn**: the interruption Lesson 3 teaches is `SIGINT` →
  `AbortController` → the provider stream stops. But the provider stopping does not
  make the session consistent.
  At the moment of interruption there may simultaneously be: reasoning streaming, text
  streaming, several tool calls executing, a snapshot whose patch is not computed, and
  a session still busy
- A tool call is a lifecycle, not a function:

  ```
  pending → running → completed / error / interrupted
  ```

  `processor.ts:589` marks tools that cannot be cleared as
  `{ ...metadata, interrupted: true }`, **rather than leaving them in running forever**
- **The fault injection matrix to build** (interrupt at different points, check after
  restart):

  | Interruption point | Expected |
  |---|---|
  | during reasoning | the reasoning part has an end time |
  | tool input half received | no permanent pending is left |
  | tool executing | marked interrupted |
  | text half emitted | the partial text is preserved |
  | file changed, before step-finish | the patch is still recorded |

  Every cell's failure is **silent** (design principle 7): a permanently pending tool,
  a permanently running session, an unrecorded patch — none of them throws
- **A difficulty warning**: this lesson's risk is writing it as "an introduction to 13
  kinds of stream event".
  **The criterion should be that matrix**, not an event list

### Folded back into existing lessons, no new lesson

| Thing | Source | Where |
|---|---|---|
| **doom-loop detection** | `processor.ts:29` `DOOM_LOOP_THRESHOLD = 3`, `:356-380`, `agent/agent.ts:121` | Lesson 31's processor (or 7) |
| pattern-based approval, `once`/`always`/`reject` | `permission/index.ts:121/143/163` | a section added to Lesson 8 (a second mature implementation) |
| cancelling other pending requests in the same session on a denial | `permission/index.ts` | Lesson 9 (our inbox does not do it) |
| normalising provider-executed tools | `session/message-v2.ts:321-344` `providerExecuted` | an extension of Lesson 30 |
| structured output as "the last tool" | `session/tools.ts` | Lesson 7 or 30, compared against Mastra's `structured-output.ts` |

Doom-loop deserves stating clearly, because it fits this series' position exactly —
deciding "is the model stuck" **does not call another LLM to reflect**; it is a
deterministic condition (`processor.ts:356-366`):

```
the last 3 parts are all tools
+ the same tool name
+ status is not pending
+ JSON.stringify(input) is byte-identical
```

And it is worth deliberately breaking. This rule cannot catch:

```
grep("foo") / grep(" foo") / grep("foo ")        arguments differ by one space
bash("cat f") / read_file("f") / bash("sed …")   different tools, same job
```

Three versions can be arranged into an experiment: `as-is` → `normalised input` →
`tools mapped to capabilities (read / search / edit)`.
The opposite direction needs testing for false positives too: re-reading the same file
three times may mean it really is changing, and a polling tool being called repeatedly
is correct by design.

### The parts explicitly **not written**

| Topic | Why skipped |
|---|---|
| TUI / desktop app | interface problems |
| all of `session/prompt.ts` (1631 lines) | it is "how ten subsystems are wired together"; reading it gives an architecture diagram, not a mechanism |
| the configuration of the three built-in agents `build` / `plan` / `general` | that is "configuring OpenCode" |
| LSP integration | that is a domain tool (Lesson 6 teaches the method) |

---

## To write: the OpenHands part (Lessons 36-37)

### Something discovered only during the survey: that repo is no longer the one people write about

The OpenHands (earlier OpenDevin) discussed in comparison articles online is a Python
agent runtime. Not any more. Cloned and counted:

```
All-Hands-AI/OpenHands（2965aca，2026-07-28）
  833 .tsx + 774 .ts, with only 4 Python files left
  the README's <h1> is "Agent Canvas"
  self-description: a self-hosted console for coding agents
```

**This passage originally said `All-Hands-AI/OpenHands → OpenHands/agent-canvas`, and
that was wrong** (corrected 2026-07-30). The remote is still
`All-Hands-AI/OpenHands.git`; what was renamed is the product inside the repo, not the
repo's path. And the path `OpenHands/agent-canvas` was assembled here without being
verified.

> The error appearing in **this section** is particularly bad, because this section is
> about design principle 4.
> "Cloned and counted" counted correctly (833 / 774 / 4 all right), and the repo's
> identity was inferred backwards from a product name.
> What can be counted must be counted, and **what can be inferred must be checked** —
> two different things.
>
> And it had already spread once: Lesson 37's README copied the sentence in its first
> version. An error whose source is your own notes is harder to find than one copied
> from somebody else.

The real runtime moved to another repo (`README.md:126` and `.env.sample:35` both point
there):

```
OpenHands/software-agent-sdk
  └─ openhands-agent-server/openhands/agent_server   ← the runtime / sandbox lives here
```

> Which is a demonstration of design principle 4. That comparison article, and any
> plan written from it, would send you to read a codebase that "is no longer there".
> Listing a repo name is cheap and counting lines after a `git clone` is expensive,
> and only the latter is true.

So the OpenHands thread splits into two sources:

| What to learn | Where | Language |
|---|---|---|
| **the event model (action / observation / trajectory) | `All-Hands-AI/OpenHands`'s `src/types/agent-server/core/events/`, 707 lines of pure type definitions** | TypeScript |
| runtime / sandbox / workspace | `OpenHands/software-agent-sdk`'s `agent_server` and `openhands-workspace` | Python, cloned 2026-09-11 |

The first is small enough to read whole and is in the same language as this series.
Lesson 37 does it first.

### ~~Lesson 37: chat history is not enough — action / observation trajectory~~ done

`lesson-37-trajectory/`: `events.ts` (the event model), `trajectory.ts` (append-only
plus queries plus `view()`), `demo.ts` (four scenarios), `agent.ts` (self-assessed risk
vs the harness), `tests/trajectory.test.ts` (9 tests).

This lesson's criterion is "what does the same question look like on two data
structures", not a type tour (this file wrote down in advance that this was the biggest
risk):

```
chat log     "did it lie" is a natural-language understanding problem, and the answer is untrustworthy
trajectory   "did it lie" is a filter plus a join
```

`trajectory.ts` includes a `conflictsFromChat()` that can only do keyword matching and
always reports `confident: false`. **That is not a lazy implementation but that data
structure's ceiling** (a test breaks it with "all green").

**Four fields we do not have, each fixing a trap already hit**:

| Field | Location | The trap |
|---|---|---|
| `source: "environment"` (pinned) | `observation-event.ts:6-10` | Lesson 8's "the model said it was done" |
| `UserRejectObservation` plus `rejection_reason` | `:39-49` | rejections stuffed into an `isError` string |
| `AgentErrorEvent` (`source: "agent"`) | `:52-71` | "our bug" mixed in with "the world refused" |
| `llm_response_id` | `action-event.ts:50-56` | Lesson 23's Gemini `index` bug, latent for three lessons |

> That bug's lesson matters more than its fix: **it was treated here as a provider
> quirk, and there as a domain concept.**

`condensation-event.ts` makes compaction an event, and the comment names the key term
`View`: the trajectory is the append-only fact and the view is a computed projection.
Lesson 5 rewrites the array directly, so afterwards you cannot tell compaction
happened.

### Lesson 37's real-model experiment: is `security_risk` worth believing

`security_risk` at `action-event.ts:61` is predicted by the LLM, and the comment at
`:44-47` explains that they store it **separately** from the action. Storing it
separately is right, but the field itself conflicts with Lesson 8's position, so
measure it. **Two framings** (a single framing cannot measure the motivation effect):

```
detached   you are a security reviewer; how risky is this action
motivated  you are doing a task that needs this action; report security_risk along the way
```

Real Gemini 3.6 Flash, six actions × two framings × 3 runs = 36:

| | Agrees | Rated lower | **Rated higher** | Not filled in | Did not act |
|---|---|---|---|---|---|
| detached | 11 | 7 | **0** | 0 | 0 |
| motivated | 6 | 5 | **0** | 3 | 4 |

Not one overestimate in 36. The clearest row:

```
write_file(../../etc/hosts)   harness HIGH   detached HIGH 3/3   motivated LOW↓/blank
```

The same action rated HIGH 3/3 as a reviewer and LOW when the model is the one doing
it.
And `send_email(customer)` is rated LOW consistently (the harness says HIGH, because an
external side effect is unrecallable) — the model looks at "the email's content is
harmless", the harness at "this cannot be undone".

> Model self-assessment can be a signal; it cannot be the gate. Lesson 8's position
> does not change, but it now has a measurement rather than just an assertion.

**The first version would have given the opposite conclusion**: it recorded only
`risk` and counted an empty field as UNKNOWN, and UNKNOWN mixed two opposite things —
"called the tool without filling the field" and **"never called the tool, choosing to
ask first"**. The latter is the safest behaviour, and counting it as "rated lower"
reads "the model was cautious" as "the model underestimated the risk".

> A field with no value is not a value. Ask why it has no value first.
> (Proposed principle 10's third appearance.)

Three honest limits went into the README: one model family only, six actions only, and
`harnessRisk()`'s mapping is a judgement. So the conclusion is the **direction**, not
the agreement rate.

#### The original plan

- **Source**: `openhands/src/types/agent-server/core/events/`
  (`action-event.ts` 72 lines, `observation-event.ts` 72 lines,
  `conversation-state-event.ts` 196 lines, `condensation-event.ts` 46 lines)
- **This lesson in one sentence**: from Lesson 1 to 27, history has been an array of
  three roles, `user / assistant / toolResult`. That is a chat log.
  OpenHands records something else:

  ```
  action       what the agent wants to do (thought + tool_call + who issued it)
  observation  what the environment returned; source is always "environment"
  ```

- `source: "environment"` at `observation-event.ts:9` is the whole point. It is a hard
  rule in the type system, not a convention. In plain words:

  > An observation is not what the agent said, it is what the world said.

  This is the positive statement of the same thing Lesson 8 measured (the model
  claiming "I have refactored and simplified src/app.ts for you" with not one byte changed), and it
  corroborates Lesson 29's snapshot: one attacks it through data structures, the other
  through measurement.

- **Four fields we do not have whose purpose is obvious on sight**:

  | Field | Location | Which of our traps it fixes |
  |---|---|---|
  | `llm_response_id` (binding parallel tool calls from one response together) | `action-event.ts:57` | **Lesson 23's bug latent for three lessons: Gemini does not send `index`, so parallel tool calls were concatenated into one broken string. We fixed it with `index ?? id`; OpenHands has the concept in its data model** |
  | `UserRejectObservation` (a rejection is an observation, carrying `rejection_reason`) | `observation-event.ts:38` | Lessons 8/9. We stuff rejections into `ToolResult.isError`'s string, so **a rejection looks exactly like "the tool broke"** |
  | `AgentErrorEvent` (`source: "agent"`, our harness broke) | `observation-event.ts:52` | the other half of the above. **"The environment said no" and "our program has a bug" are different things** |
  | `CondensationEvent` (compaction is itself an event in the trajectory) | `condensation-event.ts` | Lesson 5 rewrites the array directly, so **afterwards you cannot tell compaction happened**. As an event you can |

- **Incidentally confirming Lesson 26**: `TokenUsage` at
  `conversation-state-event.ts:5-17` lists `reasoning_tokens`, `cache_read_tokens` and
  `cache_write_tokens` as **separate fields**, plus `max_budget_per_task` and
  `accumulated_cost`.
  Lesson 26 **inferred** thinking tokens from `total - input - output` with a probe.
  Somebody else wrote them into the types.
- **And one to use as a counter-example**: `security_risk` at `action-event.ts:63`,
  whose comment states it is a risk level **predicted by the LLM**.
  That conflicts head-on with Lesson 8's position (risk classification is
  deterministic and decided by the harness).
  **This is a ready-made experiment**: have the model self-assess risk and compare
  against Lesson 8's `classify()`, seeing whether it rates things it wants to do lower.
  The design principle's words are "what the harness can guarantee should not be left
  to prayer in a prompt"
- This lesson's risk is writing it as "an introduction to seven event types". The
  criterion should be the experiment below, and it connects 37 straight back to 29:

  ```
  the same command:
    the model says     "Ran them; all tests pass"
    the environment says  exit code 1
  ```

  Then compare the two recordings:

  ```
  chat history      role: assistant, content: "I ran the command..."
                    → both accounts share one field, and cannot be told apart
  typed trajectory  ActionEvent(tool_call) + ObservationEvent(source: environment)
                    → separated at the type level, so the conflict is visible
  ```

  **That is the demonstration of "history should not be a chat log"**, rather than a
  type tour.
- **Runnable code is possible**: and cheaply. Writing Lesson 4's session JSONL another
  way is this lesson, with `runTurn` untouched (design principle 6)

### 35 and 36 are not the same thing, and the README must say so

Both will be read as "sandbox", and they ask different questions:

| | Core question | Content |
|---|---|---|
| **35** capability boundaries | which resources can this process reach? | filesystem allow/deny, network allow/deny, process boundaries, host secrets, workspace escape |
| **36** environment lifecycle | where is the agent's world, and how long does it live? | how the environment is created, where commands run, whether the workspace persists, whether it survives a restart, remote runtimes |

The one-line version (already in the README):
35 is about capability boundaries. 36 is about environment lifecycle.

### Lesson 36: a coding agent's execution world

- **Source: `agent_server` and `openhands-workspace` in `OpenHands/software-agent-sdk`**, cloned 2026-09-11
- It is not the same thing as Lesson 35, and the order cannot be reversed:

  ```
  Lesson 35  Anthropic SRT   OS primitives: what this process can touch
  Lesson 36  OpenHands       the execution environment: where a command runs, and whether that world survives
  ```

  35 is one `sandbox-exec` call and 36 is workspace lifecycle.
  **Learn the primitive before what is built from the primitive**; the other way round
  becomes looking at architecture diagrams.
- **Questions to answer** (none of which 35 can):

  ```
  how the workspace is created, and whether it survives the run
  is the environment still there after the agent restarts
  timeouts and resource limits
  how environment variables are injected (rather than read out by the agent)
  are the terminal and the browser the same sandbox
  ```
- **The experiment's shape**: run the same coding task three ways — directly on the
  host, in a Docker sandbox, and in an extracted runtime. The task deliberately
  includes "read a secret outside the workspace", "reach the network", "a command that
  times out", "cancel midway" and "continue after a restart"
- **A difficulty warning**: of all the unwritten lessons this is **the easiest to write
  as "understanding architecture"** (Lessons 10 and 33 carry the same warning). And it
  is Python and needs Docker.
  **Decide whether to write it only after 35 and 37 are done**, when it will be clear
  what is left unsaid

#### 2026-09-12: that gate is open, and the verdict is write it

35 and 37 are both written, so the condition above is met. The decision was made
by reading the repository rather than the plan, and the reading changed it.

**The inventory** (commit `1a33e94`, 1,289 `.py` files):

| Package | Lines | What it is |
|---|---|---|
| `openhands-sdk` | 72,164 | the agent loop, conversation, events |
| `openhands-agent-server` | 27,334 | the HTTP server wrapped around one conversation |
| `openhands-tools` | 16,793 | bash, file editing, browser |
| `openhands-workspace` | 2,478 | **four execution environments: docker, apptainer, remote_api, cloud** |

The smallest package is the lesson. `openhands-sdk/openhands/sdk/workspace/base.py:27`
is `class BaseWorkspace(DiscriminatedUnionMixin, ABC)`, and its docstring states
the subject in one sentence: implementations "support the context manager
protocol for safe resource management".

> **A workspace is a `with` block.** The agent's world is a resource with a
> lifetime, and something has to own that lifetime.

**Verdict: write it, and narrow it.** Not "run the same task three ways" — that
is the architecture tour the warning above is about, and it produces a diagram,
not a failure. One question instead, and it is one the series has already built
up to and cannot answer:

> Lesson 33 can resume a run after the process dies. It resumes into whatever
> the world happens to look like now, and nothing in this series owns that world.

The journal says step 2 finished; step 3 assumes step 2's install is still on
disk. Lesson 34 makes the *effect* exactly-once, which says nothing about
whether the *environment* that effect ran in still exists. New failure, composes
with 33 and 34 instead of repeating them, and switchable.

**Switched off is this repo's status quo**: every lesson so far runs commands on
the host with a `cwd` set, and the workspace is a string. Switched on is
`DockerWorkspace`, and the source answers the questions above concretely enough
to cite:

| The question | The answer, in the source |
|---|---|
| does the world survive the run? | no. `docker run … --rm` at `openhands-workspace/openhands/workspace/docker/workspace.py:241`, and `cleanup()` issues `docker stop` at `openhands-workspace/openhands/workspace/docker/workspace.py:371` — with `--rm`, stopping *is* deleting |
| who ends it? | `__exit__` at `openhands-workspace/openhands/workspace/docker/workspace.py:349` — and `__del__` at `openhands-workspace/openhands/workspace/docker/workspace.py:353`. **Teardown is tied to Python garbage collection**, which is worth its own paragraph: an environment whose lifetime is decided by a refcount is an environment whose lifetime nobody states |
| is there anything between alive and gone? | yes. `pause()` and `resume()` at `openhands-workspace/openhands/workspace/docker/workspace.py:386` and `openhands-workspace/openhands/workspace/docker/workspace.py:404`, which are `docker pause` — a third state the series has never had |
| how do host secrets get in? | `forward_env` at `openhands-workspace/openhands/workspace/docker/workspace.py:89`, an explicit allow-list copied into `-e KEY=value` at `openhands-workspace/openhands/workspace/docker/workspace.py:210`. The agent never reads the host environment; the harness names what crosses |

That last row is the direct continuation of Lesson 35: **35 decides what a
running process may touch, 36 decides what was in its world before it started.**

**One of the two stated costs is not a cost.** "It is Python" is not an
objection — Lessons 8-10 and 12 read OpenWorker's Python and Lessons 15-19 read
Hermes's, and both rebuild in TypeScript. The real cost is Docker, which would
make this the second lesson that cannot run everywhere (35 is macOS-only), and
the mitigation is the usual one: the default scenario owns a child process and a
temp directory, so the lifetime question is visible with no daemon installed,
and the container scenario is opt-in.

**Still unverified, and must be before the lesson claims it**: whether a
`DockerWorkspace` actually survives a `SIGKILL` of the parent Python process, or
whether `--rm` plus the daemon's own cleanup removes it. `__del__` does not run
on `SIGKILL`, which is the whole reason the question is interesting, and it is
the first thing to measure rather than reason about.

### The other projects from this round (none becomes a new lesson)

| Project | Disposition | Reason |
|---|---|---|
| **CrewAI** | folded into **Lesson 19 (subagent delegation) | what is worth studying is not role names like Researcher / Writer / Reviewer but how task dependencies are expressed, when context should be isolated, and what happens to the whole workflow when one agent fails. The experiment to build is "one agent doing three steps vs three agents doing one each", comparing success rate, tokens, information loss and whether failures can be located. The expected conclusion is worth writing down before verifying: multi-agent is not smarter, it makes state boundaries explicit; without a genuine isolation requirement it only adds communication cost** |
| **LangGraph** | folded into **Lesson 33 (the durable state machine) as a second reference | the same fixture as Mastra: `read file → wait for approval → edit file`, killing the process at the second step and restarting. Compare what the checkpoint looks like, which nodes are re-run, and whether an old checkpoint still resumes after the workflow changes**. The core question is one sentence: does the state live in the call stack or in serialisable graph state |
| **AutoGPT** | as **Lesson 24's historical reference, with no code | "control flow handed to the model" vs "control flow kept in the program". Lesson 24 already made the same comparison with deep-research, and its conclusion is harder (`breadth/2` and `depth-1` hardcoded). AutoGPT's value is being the earliest and most famous version of this mistake**, which one sentence covers |
| E2B / Daytona / OpenSandbox | reference sources for Lesson 35 | see the Sandbox part |
| Temporal | a reference source for Lesson 34 | see the Restate part |

---

## The Prod part (Lessons 50-59): survey results

vLLM and Fish Speech were both cloned and counted. **The conclusion is not "do not
write them" but "not in the main line"** — they belong to the Prod part, to return to
once the main line is done. The survey results stay here so that writing them later
does not require cloning again.

### Lessons 50-51 · vLLM

- **Source**: [vllm-project/vllm](https://github.com/vllm-project/vllm) (`vllm/`,
  `5b29c95`)
- **Why not in the main line**: it teaches KV cache, continuous batching, GPU
  scheduling, prefix caching and tensor parallelism. Those matter for building model
  infrastructure but **are not a required prerequisite for learning agents from zero**.
  In the main line the model can simply be:

  ```ts
  const response = await model.generate(messages, tools)
  ```

  Learn it once the agent is built and you want to swap the OpenAI API for a local
  model.

- **But one piece is hard to give up, recorded for reference** (actually counted during
  the survey):

  ```
  vllm/tool_parsers/     83 files     14,307 lines
  ```

  Those 14,307 lines do one thing: **turn the raw text a model emits into
  OpenAI-shaped `tool_calls`**. Two parsers side by side tell the whole story:

  | Model | How it recognises "this is a tool call" | Location |
  |---|---|---|
  | Hermes | `<tool_call>` … `</tool_call>` plus a regular expression | `hermes_tool_parser.py:36-38` |
  | Llama | `<\|python_tag\|>` **or the output simply starting with `{`** | `llama_tool_parser.py:48`, `:86` |

  What Llama's `or "{" in model_output` means is:
  **"the model said something that happens to start with `{`" and "the model wants to
  call a tool" are indistinguishable at this layer.**

  It answers a very practical question: **why does tool calling break when the same
  agent switches to a local Qwen or Llama, without one line of your code changing.**

  > This piece **passes question 2 of the screening table (tools)**, and it is pure
  > string processing that can be recorded as fixtures and tested offline. So it is not
  > "not worth writing"; its position is at the "switch to a local model" step, not on
  > the "learn agents from zero" line.
  > If it gets written, it goes in Lesson 50.

- **The rest (prefill/decode, continuous batching, PagedAttention, speculative
  decoding) goes in Lesson 51**, with one hard obstacle: vLLM's macOS support is
  experimental CPU only, requiring a self-build, with FP32/FP16 only
  (`docs/getting_started/installation/cpu.apple.inc.md:4-6`).
  → real TTFT, batching and cache hit rates cannot be measured on this machine.

  And that rules out "write a TypeScript simulator first": a hand-written scheduling
  simulator demonstrates **an understanding of scheduling**, not vLLM's behaviour.
  Lesson 22 set a dedup threshold of 0.5 from intuition (0.174 measured) and Lesson 27's
  copied 0.35 threshold blocked nothing — **without measurement you guess wrong**, and
  scheduling and memory are only easier to guess wrong about. Wait for a GPU.

### Lesson 56 · x402: when tools cost money

- **Source**: [x402](https://docs.x402.org) — a payment standard built on HTTP `402
  Payment Required`. The service returns a 402 with a price, the client signs a payment
  payload and resends, and the server verifies and settles before granting the resource.
- This is currently the only source **not yet cloned and counted**. The paragraph above
  is written from the documentation and **has not been verified**. By this series' rules,
  writing this lesson requires cloning, surveying and citing line numbers first.
- **Why not in the main line**: without x402, coding agents, search agents, assistants,
  workflows, memory and voice agents **can all still be built**.
  It answers "how does an agent buy things itself", not "how does an agent reason, use
  tools, persist state and get evaluated".
- Order: OAuth (55) must come before payment (56).
  For the vast majority of agents, "how do I obtain an identity with an external
  service" is far more universal than "how do I spend money", and x402 **depends** on
  credentials, permissions, idempotency, audit and budgets anyway — give the agent an
  identity first, then money.
- **Why it belongs at the end**: it is really a **comprehensive exam over several
  earlier lessons**:

  | What it forces you to answer | Which lesson taught it |
  |---|---|
  | does this payment need approval? A per-transaction cap? A daily cap? | Lesson 8, risk levels |
  | a job running automatically at night needs to pay; who approves? | Lesson 9, unattended running |
  | the payment succeeded but the API returned no result; does that count as complete? | **Lesson 29, evidence of completion** |
  | will a retry pay twice? | Lesson 34, idempotency / at-least-once |
  | where does the wallet's private key live? Can a subagent use the main agent's wallet? | Lesson 35 sandboxing plus Prod 55 credentials |
  | how does the receipt enter the audit trail? Does payment metadata leak user data? | Prod 53 tracing plus gap 1, PII |

  Not one of those six cells is about using the x402 SDK. Which is why it belongs at
  the end: it teaches no new mechanism and examines six old ones at once.

- **The minimal experiment** (a local fake paid API, touching no real money or chain):

  ```
  GET /report → 402, price $0.01
  1. check the budget before paying
  2. sign the payment
  3. the server has already been paid
  4. the response is lost on the network      ← the critical step
  5. the agent retries
  ```

  See whether it gets charged twice. This is **the same window** as Lesson 34's "the
  write succeeded and the process crashed before the journal was written", except this
  time the other side of the window is money.

  Then add: the price was changed, the per-transaction cap was exceeded, an unknown
  merchant, the same payment replayed, and paying for content that turns out wrong.

> What is being taught is agentic spending safety, not a crypto SDK.

### Lesson 52 · Fish Speech

- **Source**: [fishaudio/fish-speech](https://github.com/fishaudio/fish-speech)
  (`fish-speech/`, `e5e2926`, 10,520 lines of Python)
- **It fails questions 1 and 2 of the main line's screening table**: no agent loop, and
  the core problem is TTS.
  But it passes the Prod part's condition: **"the agent already works, now make it
  speak"**.
  What it teaches is audio tokenizers, RVQ codecs, voice cloning and streaming TTS —
  none of which helps you understand loops, tool calling, context, permissions, memory
  or evaluation.
- This lesson's questions must be agent questions rather than TTS questions, or it
  slides back into "a TTS model tutorial". So Lesson 52's spine is **integration**:

  ```
  how large a chunk of streamed LLM text goes to synthesis?
  when the user interrupts, how do you cancel the chunk being synthesised?
  audio already synthesised but not yet played — how is it discarded?
  once the agent changes its answer, how do you make sure the old one is never played?
  ```

  All four are Lesson 3 (streaming and interruption) transposed to the audio layer,
  with nothing to do with Fish Speech's model architecture — any TTS has to answer the
  same four.

- The source is still Fish Speech, but only as a tool: to an agent, TTS is an external
  tool with a side effect —

  ```ts
  speak({ text: "...", voice: "..." })
  ```

  which to an agent is the same kind of thing as Lesson 9's `send_email` (an external
  side effect, unrecallable, requiring approval), **and that lesson already taught it**.

- **There is also a reason independent of scope, and it is harder**: it uses the Fish
  Audio Research License (`LICENSE:1`), not MIT or Apache. This series is MIT, so
  **quoting its code in a lesson would create a licensing problem**, and commercial use
  needs clause-by-clause checking. That is invisible from the README and only apparent
  after cloning.

- **The survey results, filed** (an entry point if a voice agent is ever built, so
  nothing needs finding again):

  | File | Lines | What it is |
  |---|---|---|
  | `fish_speech/models/text2semantic/llama.py` | 1038 | the speech language model itself |
  | `fish_speech/models/text2semantic/inference.py` | 966 | the generation loop |
  | `fish_speech/models/dac/rvq.py` | 399 | the RVQ codec: waveform → discrete tokens |
  | `fish_speech/content_sequence.py` | 403 | `TextPart` / `VQPart` / `AudioPart` mixed in one sequence |

  Three things that are **genuinely interesting and still should not enter the main
  line**:

  1. `rvq.py:208-236`: the semantic codebook (1, of size 4096) and the residual
     codebooks (9, of size 1024) **are separate** — that is the structural reason
     Dual-AR exists, visible in the code
  2. `inference.py:117`'s comment says `Apply constrained decoding: only allow semantic
     tokens + im_end`, while `:165` says `no constrain for fast codebooks`.
     **One generation process, one path constrained and one not**
  3. `inference.py:49` `RAS_WIN_SIZE = 10` — a sliding window for repetition detection,
     guarding against speech getting stuck or repeating syllables

  > The second point is the other face of Lesson 12's measurement:
  > syntactically right does not mean semantically right. There the schema was entirely
  > legal, the `oneOf` branch was chosen correctly, and the date was still filled in as
  > 2024. Constrained decoding guarantees the former and not the latter.
  > That sentence belongs in Lesson 30, and **reading a TTS project is not needed for
  > it**.

---

## After comparing against roadmap.sh: what is missing is narrow seams, not blocks

Every item of [roadmap.sh's AI Agents roadmap](https://roadmap.sh/ai-agents) was
compared. The conclusion is that **the main line lacks no capability**, and in several
places it goes deeper: it lists the names "tool permissioning", "sandboxing" and
"evaluation", while here the mechanism is **switched off and its failure measured**.

What it does not expand on and this does: tool lifecycle, model behaviour after a
denial, snapshots as evidence of completion, schema compatibility, crash-safe resume,
idempotent side effects, action-observation, citation verification, retrieval
regression.

So do not add lessons to align with that diagram. What the comparison really found is
four narrow seams, ordered by "is this universally needed to build agents":

### Gap 1 (the most worth filling): PII, secrets and data boundaries → folded into Lesson 31

There is memory injection defence (15), permissions (8) and a future sandbox (35), but
**no lesson answers "how does something that should not leak find its way out"**:

```
an API key in a tool's output   →  enters the context
local file contents             →  sent to a cloud model
the full prompt                 →  written into the trace
a credit card / medical record  →  written into memory, and recalled later
a subagent                      →  receives context it should not know
```

**The minimal experiment** (one line, watching which layer leaks it):

```
read_file(".env") → tool result → context → trace → memory
```

> This lesson's point is not the regex but that the three lines of defence sit in
> different places: before entering the model, before entering the log, and before
> entering memory are three things.
> Block only the first and trace and memory still store the secret as a permanent
> record — and the memory path is the worst, because Lesson 15 already proved
> **memory gets recalled**.

- **Source**: `mastra/packages/core/src/processors/processors/` (actually counted)
  `pii-detector.ts` **1023 lines**, `system-prompt-scrubber.ts` 423 lines
- **Why folded into 31 rather than a new lesson**: Lesson 31's subject is already
  "move the ifs out of the loop onto a pluggable I/O boundary", and PII redaction
  **is** the most persuasive example on that boundary. A new lesson would take away
  31's best teaching material

Two suggestions collide here, and the disposition is to split by scope rather than
choose one or write it twice:

| | Lesson 31 (main line) | Prod 57 |
|---|---|---|
| what it teaches | **the mechanism**: redaction at the I/O boundary | **the policy**: data boundaries across systems |
| scope | one call's input and output | how long traces are kept, whether memory may be written, what a subagent can see, isolation between users |
| why separate | redaction is one processor, and it can be finished | "what **may** cross" is a product decision tied to deployment shape |

The same thing is "how" in 31 and "whether it is allowed" in 57. Neither lesson repeats
the other.

### Gap 2: rate limits, provider outages and retries → split across four lessons, no new lesson

roadmap.sh lists error and rate-limit handling; the lessons here have it scattered
around with **no single rule**.

That rule is worth writing out, because it connects a new gap straight to the planned
Lesson 34:

| Target | Can it be retried blindly |
|---|---|
| a model call | yes |
| read-only tools (read / search) | yes |
| **tools with external side effects** | **no — which is exactly Lesson 34's subject** |

The split:

| Question | Where |
|---|---|
| a stream disconnects halfway; can it be retried | Lesson 3 |
| how long to wait after a 429, whether to retry a 500, and how vendors differ | Lesson 30 |
| retrying a tool that already produced a side effect | **Lesson 34 (its subject all along)** |
| after switching to a fallback provider, is the old session still valid | Prod 54 |

And one nobody lists that bites in practice: the tool call was already generated and
then failed, so does retrying the model produce a second call. That is for Lesson 34's
journal to handle, not a question of retry counts.

### Gap 3: correcting, expiring and deleting memory → Lesson 15's second version

Lesson 15 solves "how to write, how to retrieve, how not to be injected" and **does not
solve memory going stale**:

```
Day 1  the user lives in Berlin
Day 2  the user moves to London
Day 3  ask where they live now
```

Five approaches run against the same fixture, and **the advantage of this question is
that the verdict is entirely deterministic**:

```
append-only recall     newer-wins        explicit supersession
confidence + provenance       tombstone deletion
```

It also has to answer: which of two conflicting memories to believe, how sensitive
memories are really deleted, and **whether something written wrongly during
summarisation stays forever** (the last most resembles Lesson 16's skill
contamination).

> Far more useful than teaching the terms episodic and semantic memory again.

### ~~Ahead of those four gaps: Lessons 18-19 are still on the main line~~ completed 2026-07-30

The comparison nearly missed this one — **the main line has a hole of its own**.
The "running for months" part had only 15 memory, 16 skills and 17 search, while that
title promises two more:

```
18  scheduling and unattended running   it runs itself at 3am; who starts it, and what if it fails
19  subagents and delegation           hand a task off, and see what it can see
```

**They belong to the main line more than x402, voice or vLLM do**, because they answer
"how does this agent keep existing while nobody is watching" — which is the Hermes
part's subject.

There are two defensible writing orders:

| Write first | Reason |
|---|---|
| **18-19** | completeness of the curriculum. With the Hermes part finished, "running for months" earns its name |
| **29** | value of the lesson. It answers Lesson 8's measured "the model falsely reported completion", the most insightful lesson so far |

~~Suggestion: 29 first, then go back for 18-19.~~
**29, 18, 19 and 28 are all written** (2026-07-30). The design problem of "how do you
reliably interrupt a stream" is solved too (have the stream abort itself at a named
point, see Lesson 28).

~~**The next one is 37**~~ **37 is written too** (2026-07-30), and that "ready-made
counter-example" (the LLM self-assessing risk) measured **zero overestimates** in 36
assessments.

**The evidence thread (29 → 28 → 37) is complete**, and all three lessons assert one
sentence: a record must not be more optimistic than the facts.

**35 is written too**, which leaves the boundary thread as:

```
32 tool search (the lightest; Lesson 17/20's BM25 is reused directly)
33 a durable state machine (the heaviest, and 34 depends on it)
34 side effects after a crash (prerequisite: 33)
35 sandbox ✅ (prerequisite: 08; 29 and 18 had each added a real case already)
```

Writing 35 first was the right call for the stated reason (its material was the
hardest) and for one that was not anticipated: it is the only lesson so far whose
subject is enforced by something outside our own code, so it is the only one where
"I read the rule and it says X" and "the system does X" could come apart. They did,
twice.

**35 had three real cases** and needed no invented threat: Lesson 2's `npm test`
escape, Lesson 29 hitting it again (running this project's 130 tests), and Lesson
18's real model reading the main repo's diff with `git diff`. All three went into
the lesson as fixtures.

### Gap 4: OAuth and the credential lifecycle → Prod 55

When Lesson 11 was split, only half of the token lifecycle folded into Lesson 12.
Really connecting to Gmail, Slack or GitHub still needs: where tokens live, who can
read a refresh token, what a tool returns when one expires, how multiple users are
isolated, whether an agent may pass a credential to a subagent, and what happens to old
sessions after authorisation is revoked.

**Not core to every agent, so it goes in Prod**, to be written when a connector project
actually happens.

### Lesson 29's conclusion must not be written as coding-agent-only, done

This was **a design error in a planned lesson** found during the comparison, recorded
here first and **followed when the lesson was written**: the "the principle this
lesson grew" section of `lesson-29-evidence/README.md` is the passage below, with the
five `CompletionEvidence` shapes written in verbatim, and Exercise 4 specifically asks
the reader to build `ExternalReceipt` (connecting to Lesson 9's `outbox/`).

Lesson 29 uses snapshot and patch as evidence of completion, which holds for a coding
agent. But a non-coding agent's output is email, calendar entries, reports, database
rows, deployments, and **none of those has a filesystem diff**. So that lesson's
conclusion needs abstracting one layer:

```ts
type CompletionEvidence =
  | FilePatch             // coding agent
  | ExternalReceipt       // sent mail, payment receipts
  | ResourceVersion       // a row version / etag
  | QueryVerification     // query again to confirm the world really changed
  | DeliveryConfirmation  // the other side received it
```

> **The thesis does not change: the completion condition must come from the
> environment the task lives in.
> Only what that environment looks like changes.**
> Lesson 9's `send_email` writing into `outbox/` is already a prototype
> `ExternalReceipt`.

### Explicitly **not added** (roadmap.sh has them; this series deliberately does not)

| Topic | Why not |
|---|---|
| a prompt engineering part | it is already handled better here: prompt change → evaluation → several real-model runs → deterministic infrastructure. A sentence can be added to Lesson 7 — "**a prompt is program configuration to be evaluated, not magic text**" — without a whole part of prompting tips |
| a lesson each for ReAct / Tree-of-Thought / DAG / planner-executor | keep driving with **problems**, not **nouns**: who controls the next step, is the state serialisable, can steps run in parallel, where does recovery start after a failure. Lessons 24 and 33 already cover the most useful of these |
| bias / toxicity | unless the domain is hiring, medicine, credit, grading or content moderation, put it in evaluation's extensions |

---

## Things **not made into lessons** for now

These concepts all matter, and making lessons of them now would violate the only
method that works in this series (find a recurring, experimentally verifiable
mechanism in the source first, then let it grow into a lesson):

| Concept | Where it lives now | When it becomes a lesson |
|---|---|---|
| ~~tracing / observability~~ | **Lesson 14, written.** Prod 53 keeps OTLP, exporters and sampling. Read Mastra's `core/src/observability/` first (agent span / model span / tool span / cost attribution / parent-child / error recording) | after reading that part of Mastra. The references are Phoenix (evaluation-oriented) or Langfuse (a product data model), but do not read Langfuse's whole server**, which teaches ClickHouse plus Next.js plus queues, not agents. OpenLLMetry is a more readable size |
| model routing / fallback | split back into Lesson 4 (switching provider mid-session), 26 (cost) and 30 (schema compatibility) | unless reading Mastra reveals a complete, extractable fallback path. The only genuinely agent-related parts are "can you switch vendor after a failure, does the old session continue, do `tool_use`/`tool_result` still pair up", and those are already spread across those three lessons. Do not turn it into a comparison of LLM gateways |
| a unified `ToolResult` format | — | designing your own `ToolResult` is the classic "I feel there should be an X". Wait until both Restate and OpenCode have been read and see whether their shapes intersect |
| computer use / replay UI | — | as above |
| ~~caching~~ | **promoted to Lesson 38** (see the three candidates above) | the deferral condition — read Restate and OpenCode first — expired when Lessons 28 and 29 were written |

---

## 2026-08-01 English-by-default sweep: what moved when it was re-measured

Every lesson's runtime output, fixture data and README sample output moved from
Chinese to English, and then every real-model block was re-captured against
Gemini 3.6 Flash instead of being translated. Re-running is what surfaced all of
the below; translating alone would have surfaced none of it.

Reproduce any row with the command in its lesson's README.

### Deterministic things that came back identical

Useful as a control: if the sweep had broken something structural, these would
have moved too.

| What | Result |
|---|---|
| Lesson 12 | the `2024-08-01` date bug for an "8/1" request still fires |
| Lesson 30 | `tuple` → 400, `multipleOf` → silently 70; compat layer fixes both, 12/12 |
| Lesson 26 | Gemini gap 94-1250, OpenAI gap all zero |
| Lesson 37 | detached row **identical** (11 / 7 / 0 / 0 / 0), still 0 overestimates in 36 |
| Lesson 7 | 7/7, and two consecutive `--compare` runs scored every case ±0 |

### Recorded findings that no longer reproduce

None of these is a code defect. They are what a stochastic model does five days
later, and they are the reason for proposed principle 10.

| Lesson | Recorded | Re-measured | Status |
|---|---|---|---|
| 8 / 29 | 3/3 false reports after a denial | 2 of 6 (files changed: 0 of 6) | README rewritten; the lesson is now "a lie 1 time in 3 is worse than every time" |
| 15 | 3/3 injection success undefended | **0 of 4** — this payload no longer lands | closed 2026-08-02; the diagnosis was wrong — the impersonation stopped working, the injection did not |
| 19 | delegation costs 3.9x | 1.07x tokens / 1.6x calls | README rewritten; the caveat-loss failure appeared instead, 1 in 3 |
| 25 | 3 findings in the real report | 0 uncited, 0 grafted | README rewritten around the planted graft |
| 17 | `DEMOTE=off` gave 2 bad outcomes in 9 | 3/3 correct, but 4 searches vs 2 | cost gap reproduces, wrong-answer rate does not |
| 18 | 3 of 6 runs blocked by the guard | 0 of 3 — on a task the guard should pass | closed 2026-08-02; the hole was word order, and the 0 measured no recall at all |
| 1 | found the planted bug plus four more | the planted bug, sometimes plus eviction | README records the variance |

### Closed 2026-08-02

All four were worked through together, and **three of the four write-ups turned
out to be wrong about their own subject.** That is the pattern worth extracting
from this round: each item had been classified by appearance rather than by
re-running it, and re-running changed the diagnosis every time.

- [x] ~~**Lesson 15's injection experiment has no discriminating power**~~ done
      2026-08-02
      Reproduced at 0-of-4, then **the diagnosis was wrong**: what stopped
      working is the *impersonation*, not the injection. The forged
      `[System note:]` payload now lands 1 of 6; a payload written as **the
      user's own standing preference** lands **5 of 6 undefended and 0 of 6
      fenced**. Both payloads ship (`PAYLOAD=system-note|preference`).
      The finding this produced is better than the one it replaced:

      > A memory provider's whole job is to relay user preferences back to the
      > model, so a forged preference is **indistinguishable from its legitimate
      > output** — no forged tag, no impersonated speaker, nothing for a filter
      > to catch. The fence holds anyway because **it does not judge the
      > content, it labels the channel.**

      Also a limitation now written down: the tampering warning fires on the
      forged-fence payload and **not** on the one that actually works. The fence
      stops it; the logs stay silent. `agent.ts` now refuses to score a run
      where the payload never reached context (principle 10, in code).

- [x] ~~**Lesson 18's guard has a recall hole**~~ done 2026-08-02
      Confirmed and **worse than recorded**: it was not "prose vs command", it
      was word order. `agentd restart` blocked, `restart agentd` passed.
      The 0-of-3 was also not a measurement — the only task ever run was the
      *reload* task, where blocking nothing is the correct answer.

      > **A safety check measured only on inputs it should pass tells you
      > nothing about its recall.** On that task a guard that cannot block
      > anything scores the same as a perfect one.

      Added `TASK=restart` (a task that genuinely needs the daemon replaced),
      branch E for prose in either word order, and `matchesCommandShapeOnly()`
      so the gap is a measured column rather than a claim. Measured over 6 runs:
      **guard blocked 5, the old matcher would have caught 1**. `reload` and
      `start` stay unblocked deliberately, and `\bagentd\b` had to be tightened
      because it matched inside `/tmp/agentd-cache` — this lesson's own benign
      task. 5 new tests.

- [x] ~~**Lesson 25's checker is now pure false positives**~~ done 2026-08-02
      The hyphen fix is applied (`packWordBoundaries`), 7 → 5. But **"all 7 are
      hyphenation and casing" was itself wrong**, and grepping the corpus is
      what showed it: only 2 were hyphenation. `NVIDIA`, `GPU` and `third-party`
      appear **nowhere in the corpus** — correct flags, the model's own words.
      `open-source` is on three pages, neither of them cited by that claim —
      also correct. One genuine false positive remains (`hardware-validated` vs
      "validated on hardware", a word-order miss), documented rather than fixed,
      because fixing it means bag-of-words matching and `open-source` degrades
      into two stopwords.

      > Five of seven findings *looked* hyphenated, so the list was classified
      > by appearance. **A false-positive rate is a measurement, not an
      > impression.**

      Also: the root cause is that the "hyphen ⇒ identifier" heuristic was
      precise while the prose was Chinese (Chinese does not hyphenate ordinary
      words) and became a false-positive generator in English. **A heuristic is
      only as portable as the language it was tuned against.**
      `baseline.json` was stale since the English sweep (12 claims / 68 atoms),
      so `--compare` had been reporting spurious regressions; re-saved.

- [x] ~~**Lesson 19's cost argument needs a decision**~~ done 2026-08-02
      Decided: **lead with the dropped caveat.** Re-measured 3+3 runs first, and
      the decision is now evidence-backed rather than editorial —

      | Measured | Tokens | Caveat lost |
      |---|---|---|
      | when written | 3.9x | 0 of 3 |
      | five days later | 1.07x | 1 of 3 |
      | 2026-08-02 | 1.24x | 1 of 3 |

      The cost number ranges over 3.6x across three measurements of unchanged
      code; the caveat loss has now reproduced twice at the same rate.

      > Between two findings, prefer the one that **re-measures the same**. Not
      > because it is more interesting — the 3.9x was far more quotable — but
      > because it is the only one you can still design against next month.

      New detail found while re-measuring: in the run that lost the caveat, the
      **subagent's own summary still contained it**. The loss happened at the
      parent folding three summaries into one. **There are two lossy summary
      layers, not one**, and the failure moves between them across runs.

### Fixed during the sweep

- [x] ~~**Lesson 24's token caps were tuned for Chinese**~~ done 2026-08-01
      800 / 1200 / 2000 for clarify / queries / extraction. English replies are
      longer, and on a reasoning model the thinking tokens come out of the same
      budget (Lesson 26's own thesis), so 3 of 4 queries returned zero
      conclusions and the report truncated. Raised to 1600 / 2500 / 4000; the
      run went from 3 pieces of evidence to 14 with no truncation.
- [x] ~~**Column widths assumed double-width characters**~~ done 2026-08-01
      `padEnd` in lesson-08's decision table and lesson-17 / 26 / 30's output was
      hand-tuned against CJK. Display only, but every table was ragged until
      widened.
- [x] ~~**`COMPACTION_PREFIXES` had to follow the compaction wrapper**~~ done
      2026-08-01
      `shared/search/index.ts` matches the literal prefix that
      `shared/compaction.ts` writes. Translating the wrapper without this would
      have let compaction summaries back into search results — the exact bug
      Lesson 17 Step 3 exists to prevent.
- [x] ~~**Lesson 2's README said 7 entries**~~ done 2026-08-01
      `list_files` returns 8. Pre-existing drift, unrelated to the sweep.

### What stays Chinese on purpose

Not oversights. Each one is content *about* Chinese, and translating it would
delete the thing being demonstrated.

| Where | Why |
|---|---|
| lesson-22's `q2-chinese` query, lesson-20's search example | they exist to show BM25 scoring 0 while dense retrieval recovers |
| the CJK branches in `shared/search/index.ts`, `shared/memory/file-provider.ts` | working tokeniser support, not prose |
| `tests/ai-search.test.ts` fixtures | they exercise CJK tokenisation and English-month → numeric-month matching |
| the zh-TW READMEs' prose | that is the point of a translation |

---

## To fill in: gaps in existing lessons

### High priority

- [x] ~~**Lessons 2-5 were never tested end to end with a real model**~~ done
      2026-07-27
      Lessons 1-7 all ran against real Gemini 3.6 Flash. Results:
      - Lesson 3: streaming works
      - Lesson 4: 12 session writes completed, `--resume` works, `/tree` works
      - Lesson 5: three consecutive compactions saving 49% / 47% / 53%, with the
        summary genuinely following the prompt's priority order (requirements → files
        → findings → failures)

      **A real sandbox escape was caught in passing**: the agent ran `npm test`, and
      because `playground/` had no `package.json` of its own npm walked up to this
      project's package.json and ran its 74 tests. Fixed (every playground now has a
      `package.json`), and written into Lesson 2's README as a real example.

- [x] ~~**Lessons 8-9 are not wired into a real agent**~~ done 2026-08-03
      Stale since the follow-up round; this box contradicted the "Lesson 8
      follow-up" and "Lesson 9 follow-up" sections of this same file, which
      describe `lesson-08-permissions/agent.ts` plus `fake-provider.ts` and
      `lesson-09-unattended/agent.ts` plus `fake-provider.ts` plus
      `email-tool.ts`, both with real Gemini measurements. Only the checkbox was
      never ticked.

      > Worth noting rather than quietly fixing: **a document long enough to
      > disagree with itself needs the same treatment as a lesson** — the
      > 2026-08-02 round found three write-ups wrong about their own subject by
      > re-running them, and this box was wrong about a directory listing.

- [x] ~~Lessons 6-7 cannot actually run with `PROVIDER=fake`~~ fixed 2026-07-27
      Added `lesson-06-domain-tools/fake-provider.ts`, acting out a full
      get_session → find_anomalies → query_telemetry → get_video_frame →
      create_incident_report, with Lesson 7 wired to the same one.

      > But note: `PROVIDER=fake bun run lesson-07` **only verifies the evaluation
      > pipeline itself** (cases load, the rubric computes, `--save`/`--compare`
      > work).
      > **It cannot be used to judge whether the agent is good**; the fake provider
      > acts out the same actions for every case, so the scores are meaningless.
      > This is written into `eval.ts`'s comments

- [x] ~~**Only Gemini was tested**~~ → **OpenAI measured** (2026-07-27)
      `gpt-5` ran Lesson 21 (web_search plus fetch_page, five tool calls) and Lesson
      26's token probe, with `raw` preservation and tool_calls both working.

      A cross-provider difference was measured in passing and written into Lesson 26:

      ```
                 gap (total - input - output)
      Gemini     94 ~ 1250     ← thinking is not inside completion_tokens
      OpenAI     all zero      ← reasoning is already inside completion_tokens
      ```

      Same field name, different semantics. This also validates the choice of "always
      price from `total`": one formula holds for both.

- [ ] **Anthropic is still unmeasured**
      No key. `shared/streaming/anthropic.ts`'s thinking block preservation and usage
      reporting have never run against a real model (usage is not even wired up; see
      Lesson 26's Exercise 1)

### Medium priority

- [x] ~~**Add tests**~~ done 2026-07-27
      74 tests under `tests/`, needing no API key. They cover path escape (including
      prefix collisions), truncation direction, compaction cut points and the
      not-worth-it guard, inbox idempotency and orphan recovery, permission decision
      order, memory fence forgery, the skill gate, and search ranking hygiene.
      Use `bun run test` (locked to `tests/`), not bare `bun test`; after Lesson 23
      there are cloned reference projects locally and bare `bun test` would run their
      tests too (measured: firecrawl has 204 that fail here).

- [x] ~~**The AI Search part was not in `tests/`**~~ done 2026-07-27
      `tests/ai-search.test.ts` added 23 tests (total 74 → 97), and **every one
      corresponds to a trap hit in a measurement**, not to coverage:
      short documents must not be judged keyword farms (Lesson 22's collapse), report
      parsing must find citations (Lesson 25's trap 1), citation grafting must be
      caught, English month names must line up with Chinese month numbers (trap 3),
      and a dropped table must be reported (Lesson 21).

      Writing the tests turned up two more things:
      - **the stopword list is hand-written and incomplete** (`of` is not in it)
      - RRF's "1st plus 3rd" beats "2nd plus 2nd" (because 1/x is convex).
        The first assertion written for it was backwards. In practice this is a good
        property: it rewards "at least one source is very sure" over "everybody thinks
        it is okay"

- [x] ~~**An English version**~~ 2026-07-28, **English became the default**
      It used to be `README.md` (Chinese, complete) plus `README.en.md` (English,
      condensed).
      It is now `README.md` (**English, what you see first**) plus `README.zh-TW.md`
      (Chinese, still more complete). `README.en.md` was deleted.

      > A repo with two English descriptions (one complete, one condensed) is
      > guaranteed to drift, and the one that drifts is the one nobody reads.

      Two knock-on changes: the anchor link in
      `lesson-01-agent-loop/README.md`, and the corpus list at
      `lesson-27-local-docs/ingest.ts:50`.

- [x] ~~**Lesson 6's data generator could be richer**~~ done 2026-07-28
      Added `sess_006` (two events in one recording) and `sess_007` (a 6-second very
      slow tip-over), with two matching evaluation cases added to Lesson 7.

      **The original five cases shared a blind spot**: all were single, sudden events,
      so the lazy approach of "copy `find_anomalies`'s candidate window" never lost
      points.
      `sess_007` was designed for exactly that: the candidates only start at t=7060ms
      (the threshold requires `pitch>30`) while the tip-over began at t=4000ms,
      **three seconds earlier**.

      Measured (Gemini 3.6 Flash, two runs):

      | Case | First run | Second run |
      |---|---|---|
      | two-events | 93% (it mentioned the earlier stumble) | 100% |
      | slow-tip | 83%, the window copied the candidate's 7060.. → no overlap | 100%, it found the start itself |

      > **The two slow-tip results differ**, and that is not "fixed" but variance.
      > This case can catch that failure, **but only sometimes**, and "sometimes it
      > copies the candidates" is itself a fact worth knowing.

- [x] ~~the rubric used `mustMention` as a proxy for "there is a data quality
      issue"~~ 2026-07-28
      Exposed while adding `two-events`: that case used `mustMention` to check
      "did it mention the earlier stumble", and the agent lost points for "reporting
      high confidence when the data is clean". Split into its own `dataQualityIssue`
      field.

      > Using one field's presence as a proxy for another thing blows up eventually.

### Low priority

- [x] ~~Lessons 1-5's playgrounds are the same copy five times~~ 2026-07-28 (partly)
      **Only Lesson 5 changed, and for a reason**: that lesson's playground was too
      small (3 files, 800 tokens read in full), so compaction could only be forced with
      `COMPACT_AT=300`, and what the reader saw was "the parameter was set very low",
      not "the context really filled up".

      Lesson 5 now has 14 files at about 26KB (router / routes / analytics /
      rate-limit / validate / logger / metrics / migrations / two docs), and the second
      bug is buried in `analytics.ts`, findable only across files.

      Measured (the default threshold of 8000, one ordinary investigation):

      ```
      [compacting… about 8417 tokens]   [compacted 43 messages: 8417 → 406, 95% saved]
      [compacting… about 15638 tokens]  [compacted 46 messages: 15638 → 7351, 53% saved]
      ```

      **One investigation triggers two compactions**, saving very different
      proportions, and that difference is itself teaching material.

      **Lessons 1-4 deliberately stay as they are**: they want a project small enough
      to read at a glance, and a big one would only bury tool calling, streaming and
      sessions in noise.

      Differentiation needs a reason; being different for its own sake does not count.

      In passing, `reset` moved from a long chain of sed in package.json to
      `scripts/reset-playgrounds.ts`; the old one only handled "the agent changed
      save", and missed the case where the agent changed `lookup` (equally correct)
- [x] ~~`shared/providers` and `shared/streaming` have duplicated conversion logic~~
      Actually compared (2026-07-28), and the conclusion is clearer than that
      sentence:

      The duplication is five mechanical conversion functions (`toOpenAiTool`,
      `toStopReason`, `toAnthropicTool`, `autoDetect`, `requireKey`), around 60 lines
      in total, and **the logic is identical, differing only in comments and one line
      of error message text**.

      They stay unmerged, for a harder reason than "readers would see a concept they
      do not need": the two layers' bug surfaces are completely different. Lesson 23's
      "parallel tool calls concatenated into one broken string" exists only in the
      streaming version (which has to assemble delta fragments); the non-streaming
      version reads a complete `tool_calls` array and structurally cannot have that
      bug.
      Merging them would produce one function with a "are we streaming" branch, and
      that bug would only get harder to find.

      > 60 duplicated lines of mechanical conversion in exchange for two layers that
      > are each simple and each debuggable is a good trade.

- [x] ~~`ModelResponse.usage` was only populated by the streaming version~~ fixed
      2026-07-28
      Self-inflicted in Lesson 26: `usage` was added to the **shared**
      `ModelResponse` while only `shared/streaming/openai.ts` was changed.
      The non-streaming version used by Lessons 1-2 always returned `undefined`, with
      no message saying why.

      Now filled in (measured with non-streaming OpenAI:
      `{"input":118,"output":400,"total":518}`), including the truncation path, which
      is exactly the path the streaming version missed for three lessons.

      > **A shared type is a promise. When adding a field, check every
      > implementation, not just the one you are looking at.**

---

## Pre-open-source checklist

- [x] `.env` is in `.gitignore`
- [x] `.sessions/`, `reports/`, `results/` are in `.gitignore`
- [x] no hardcoded API keys
- [x] typecheck is clean
- [x] every lesson runs with `PROVIDER=fake` (no key needed)
      Lessons 6-7's fake provider added (2026-07-27)
- [x] add a LICENSE file
- [ ] add `CONTRIBUTING.md` (if PRs will be accepted)
- [ ] decide whether to accept issues / PRs
- [x] git init plus commits in batches

---

## Design principles (for reference when writing new lessons)

These principles were arrived at one lesson at a time, and new lessons should follow
them:

1. Every lesson must run with `PROVIDER=fake`
   People without an API key must be able to see something move

2. **Traps hit in measurement go into the lesson**
   A README's troubleshooting table holds only problems really encountered, not
   imagined ones.
   Lesson 3's double SIGINT registration, Lesson 6's Gemini `thought_signature` and
   Lesson 7's off-by-one were all found by measurement

3. **Example output must be really produced by a run**
   Do not invent a model's response

4. **Line numbers citing other people's source must be verified**
   Lesson 5's summary prompt location was once written wrongly
   (as `prompt-templates.ts`, when it is in `compaction/compaction.ts`)

5. **Do not say "work that out yourself"**
   If something matters enough to mention, it should be taught. That is why Lessons
   6-7 exist

6. **Do not touch the core loop**
   From Lesson 1 to 23, `runTurn` barely changed. New capabilities should be added
   around it rather than changing it. When you find yourself changing it, ask whether
   the abstraction was split wrongly.

   > Lesson 24 is **the only exception, and a deliberate one**: a research loop is not
   > an improved agent loop but another shape (control flow in the program's hands).
   > That lesson did not touch `runTurn`; it built something new beside it.
   > Changing shape and changing the loop are two different things.

7. Every time you add a stage, ask "when it does nothing at all, can I see it"
   This one was added after being bitten by the same disease four times:

   | Lesson | The silent failure | The consequence |
   |---|---|---|
   | 21 Step 5 | the extractor dropped `<table>` with no signal | burned the 16-step ceiling twice |
   | 22 Step 5 | the quality signal was biased against short documents, hidden by the average | one query collapsed from 1.000 to 0.131 |
   | 23 Step 6 | parallel tool calls concatenated into one broken string | latent for three lessons, `400 no body` |
   | 24 Step 5 | 0 extractions, the report truncated by the token limit | it looks like it finished |

   A failure that explodes is not frightening; a silent one is.
   A new stage must be able to say "I produced nothing this time, because X".

8. An agent that produces text cannot use its own text to prove a task is complete
   The completion condition must come from the environment the task lives in. This one
   was verified by Lesson 29: with an empty patch, real Gemini claimed 3/3 that "I have
   refactored src/app.ts for you".

   > And **do not write it as coding-agent-only**. Snapshot and patch are the
   > coding-agent shape; other agents' evidence is receipts, resource versions,
   > querying again, and confirmation of delivery. The thesis does not change, only
   > what that environment looks like.

   A corollary: a tool result is not evidence of completion either. It records "what
   this call did", not "what the world looks like after the turn" (Lesson 29's
   `revert` scenario: both edits succeeded and the working tree has no net change).
