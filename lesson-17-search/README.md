# Lesson 17: Cross-Session Search

> [繁體中文](README.zh-TW.md)
>
> Prerequisites: [Lesson 4](../lesson-04-sessions/) (session persistence),
> [Lesson 15](../lesson-15-memory/) (long-term memory).
>
> Memory records facts, skills record procedures, and this lesson handles a
> third thing: "how did I do this last time?"
>
> Source: `hermes-agent/tools/session_search_tool.py` (1120 lines)

## Questions this lesson answers

1. How do three query modes fit into one tool?
2. Why is there no LLM here at all? (The original plan was wrong.)
3. How does a scheduled job bury the user's own conversations?
4. How does search drag back everything Lesson 5's compaction removed?

---

## Step 0: run it first

Five scenarios covering ranking, demotion, bookends and source filtering. No API
key needed, and the ranker in this lesson will never contain an LLM (Step 1
explains why):

```bash
bun run lesson-17
```

What happens downstream when ranking breaks needs a real model to answer. The
model sits outside the ranker, which does not contradict the sentence above:

```bash
DEMOTE=off PROVIDER=gemini bun run lesson-17:agent
```

The measurements are in Step 3.5, and the result is more complicated than
expected.

---

## Step 1: what the original plan got wrong

`docs/TODO.md` described this lesson like this:

> Hermes uses SQLite FTS5 plus LLM summarisation in a two-stage design, the
> same pattern as Lesson 6's `find_anomalies`.

Reading the source showed that is wrong. `session_search_tool.py`'s docstring:

> All three modes operate on the SQLite session DB via the FTS5 index...
> **No LLM calls anywhere** - every shape returns actual messages from the DB.

And the History note says the summariser was removed:

> PR #20238 (JabberELF) seeded a fast/summary dual-mode split; ...
> This module merges all of that into a single calling shape with
> no mode parameter, **no summary LLM path**, and explicit scroll support.

They tried the summarisation route and took it out.

### Why no LLM is needed

Because the thing calling this tool is already a model.

You do not need a second LLM to judge whether a stretch of history is relevant.
Hand the model the raw messages and it judges for itself. A summarisation layer
in between only spends money, adds latency, adds a place to go wrong, and loses
detail.

### The difference from Lesson 6

The contrast is worth thinking through:

| | Who narrows | Who judges | Why |
|---|---|---|---|
| Lesson 6 `find_anomalies` | rules | the model | that model is the agent doing the judging |
| Lesson 17 `session_search` | rules | the model | the results were always meant for the agent |

The two are the same principle: rules handle recall, the model handles
precision. The only difference is that Lesson 6 also computed statistics,
because a model cannot do arithmetic over 600 samples. That is unnecessary here,
since messages are already text and can be handed over directly.

The test is:

> Are you narrowing the field for the model, or making the decision for it?
>
> The first is worth a layer, the second is not.

---

## Step 2: three modes, one tool

Hermes's `session_search` has no mode parameter and infers from the arguments:

```
① DISCOVERY  you give a query                          → find relevant sessions
② SCROLL     you give session_id + around_message_id   → page around a known position
③ BROWSE     you give nothing                          → list the most recent sessions
```

Why not three tools? Because they return the same kind of thing (messages
inside sessions) through different entrances. Three tools would lengthen the
model's tool list and make it likelier to pick the wrong one.

> Consistent with Lesson 6's tool design principle: the number of tools should
> match the number of capabilities, not the number of argument combinations.

### SCROLL's pagination is worth copying

Not an offset, but re-anchoring:

> To scroll forward / backward, re-anchor on the last / first message id
> of the returned window.

The benefit is that a message inserted in the middle cannot cause a skip or a
duplicate. (With offsets, one insertion shifts every page.)

---

## Step 3: recall blindness (real bug #19434)

The most valuable part of this lesson, because it is a trap you will certainly
hit if you skip it.

Hermes's comment:

> Cron jobs run on a schedule and accumulate large volumes of repetitive
> vocabulary (recurring project names, dates, "session", summaries);
> under bare BM25 they dominate the top-N FTS rows and starve out the
> user's own interactive sessions, producing **"recall blindness"** where
> only cron sessions surface.

### Why it happens

A BM25 score is IDF (how rare the term is) times TF (how often it occurs in this
document).

A scheduled summary runs daily and uses the same words every time
("telemetry", "sample rate", "session"), so its TF is high. A user's natural
conversation mentions them once or twice.

The result: the user searches for something they said, and the top results are
all the robot's daily reports.

Measured, with 12 scheduled sessions and 1 real conversation:

```
❌ every source weighted equally:
  1. cron         daily telemetry summary 1              score=4.3
  2. cron         daily telemetry summary 2              score=4.3
  3. cron         daily telemetry summary 3              score=4.3
  → the top hit is cron (recall blindness) ✗

✅ cron down-weighted to 0.25:
  1. interactive  fixing the telemetry sample-rate bug   score=2.9
  2. interactive  a very long debugging conversation     score=2.0
  3. cron         daily telemetry summary 1              score=1.1
  → the top hit is interactive ✓
```

### Demote, do not exclude

```ts
const SOURCE_WEIGHT: Record<SessionSource, number> = {
  interactive: 1.0,
  cron: 0.25,      // ← down-weighted, not excluded
  subagent: 0,
  tool: 0,
};
```

Hermes's reasoning:

> **Demoting - not excluding** - keeps cron content reachable when it's the
> only match, while interactive sessions always win when both match.

The trade-off is worth remembering:

- exclude → the information is gone. When the user genuinely wants that daily
  report, they cannot find it
- demote → it only ranks lower. When both match, the human conversation always
  wins, and the report is still there

### Scan wide, then rank

```ts
const SCAN_LIMIT = 300;
```

Hermes also uses 300, and the reason is:

> The interactive vs automation split only helps if **enough rows are in
> hand** to find interactive matches buried under a wall of cron hits.

Take the top 10 and then rank, and those 10 may all be cron, in which case
demotion cannot help because the user's conversation never entered the candidate
set.

---

## Step 3.5: how much does it hurt when an agent uses it (measured)

To be clear, because it is this lesson's position: the ranker contains no LLM
and should not. The experiment below changes not one line of ranking; the model
sits outside, as an agent that has `search_sessions` as a tool.

Step 3 proved with deterministic scores that ranking breaks. But ranking is an
intermediate product, and the real question is what comes next:

> What does an agent do once it has a pile of cron summaries?

```bash
PROVIDER=gemini bun run lesson-17:agent              # with demotion
DEMOTE=off PROVIDER=gemini bun run lesson-17:agent   # without it
```

The question is "have I looked into the telemetry sample rate problem before,
and what was the conclusion?" The correct answer exists only in that one
interactive conversation (the sample rate was hardcoded and should be read from
metadata); all 12 cron summaries say the sample rate is normal with no
anomalies. So whatever the model answers directly reflects which side it
retrieved. The verdict is string comparison, no LLM judge.

### The first three runs led to a wrong reading

In the first three `DEMOTE=off` runs, the model twice answered confidently that
the sample rate was normal with no anomalies. Clean, tidy, and exactly the
evidence for recall blindness causing wrong answers.

Then more runs changed the picture completely.

| `DEMOTE=off` (9 runs) | Count |
|---|---|
| kept changing keywords and eventually found it | 4-5 |
| hit the step ceiling and gave no answer at all | 2 |
| answered "all normal" from the cron summaries | 2 |

| `DEMOTE=on` (8 runs) | Count |
|---|---|
| found it | **8** |

### So what does demotion buy

Not right versus wrong, but reliability and cost:

```
DEMOTE=on   2-5 searches (usually about 3), 8/8 answered correctly
DEMOTE=off  4-6 searches, and three different outcomes, two of them bad
```

Re-measured later on the same model, three runs each, the cost gap is the part
that reproduces cleanly:

```
DEMOTE=on   2 / 2 / 2 searches   3/3 found the real conversation
DEMOTE=off  3 / 4 / 4 searches   3/3 found the real conversation
```

**Demotion halved the number of searches.** In that later sample neither arm
answered wrongly, so treat the "two of them bad" row above as what nine runs
found once, not as a rate you should expect today.

Without demotion the agent compensates for the ranking by brute-forcing
keywords, getting steadily more specific: `telemetry` → `sample rate` → `sampling` →
`50Hz` → `go2-c` → `meta.sample_rate_hz`. Most of the time it does find it.

> The model will paper over your bad infrastructure, and you pay for it, and it
> is not guaranteed to work every time.
>
> The rest of this lesson (demotion, bookends, source filtering) is what saves
> that money.

Both failure shapes are ugly:

- hit the step ceiling: the user waits a long time and gets nothing
- answered from cron summaries: the user gets a confident wrong sentence, with
  no way to know the real conversation was never retrieved

### A methodological lesson: three runs is not enough

The first three results were clean, easy to write up, and happened to support a
dramatic conclusion. That is a reason to run more, not fewer.

> Deterministic things (Step 3's scores) need one run. Non-deterministic things
> (model behaviour) will give you a convincing-looking illusion after three.

This connects back to Lesson 7: the reason an evaluation set needs several cases
and a `--compare` is that single-point observation is completely unreliable
here.

---

## Step 4: the compaction summary loop (real bug #43175)

The second trap, and it emerges from the interaction between earlier lessons.

Lesson 5's compaction produces a summary, and that summary lives in the session
as an ordinary message (our `compact()` pushes a user message).

So search finds it. The consequence:

```
1. an old session is compacted, producing a long summary
2. a new session searches history and finds that summary
3. the summary is pushed into the new session's context
4. the new session grows and is compacted in turn…
```

Search dragged back exactly what Lesson 5 worked to remove.

Hermes's words:

> They must be excluded from discovery bookends to avoid **re-introducing
> huge compaction payloads into fresh sessions** via session_search.

The fix is recognising and excluding them:

```ts
const COMPACTION_PREFIXES = [
  "[CONTEXT COMPACTION",
  "[CONTEXT SUMMARY]:",
  "[The following is a summary of the earlier part of this conversation",   // ← the prefix Lesson 5 uses
];
```

> This is also why Lesson 5's summary message needs a fixed prefix. At the time
> it looked like a way to tell the model this was a summary; now it is a
> machine-recognisable marker.
>
> Adding a marker is cheap. Not having one is expensive.

---

## Step 5: bookends give you your bearings

Handing back only the matching sentence is not enough. You do not know what that
session was about or how it concluded.

So every result carries three sections:

```
the start of the session (what this conversation was about):
  [user] something looks wrong with our telemetry sample-rate setting
  [assistant] Let me look at the config. sample_rate_hz is hardcoded to 50

around the hit (what actually happened):
  [user] right, but the go2-c unit actually runs at 100Hz
  [assistant] Found it. config.ts hardcodes the sample rate…    ← the hit
  [user] did you test it

the end of the session (what the conclusion was):
  [user] did you test it
  [assistant] Ran bun test: 5 pass, 0 fail.
```

Together, the model knows what happened last time without paging through
anything.

This is the "one tool call should give enough information" principle, which
Lesson 6 also covered: rather than making the model call three tools to
assemble context, give it the context once.

---

## Step 6: some sources should never appear

```ts
const HIDDEN_SOURCES = new Set(["subagent", "tool"]);
```

Hermes's reasoning: sessions from subagents and third-party integrations are not
part of the user's conversation history.

What the user wants to find is how *they* did something last time, not what some
subagent did internally.

This differs from demoting cron: cron is something the user knows exists,
because they scheduled it. A subagent is an implementation detail.

> The distinction is worth working through for your own system: which sessions
> does the user recognise? Only those belong in the history.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Chinese is not found | word segmentation | this lesson splits character by character; Hermes loads the FTS5 CJK extension |
| Every result is an automated job | no source demotion | see Step 3 |
| Compaction summaries appear in results | the prefixes are not excluded | see Step 4 |
| One sentence with no comprehensible context | no bookends | see Step 5 |

---

## Exercises

### Exercise 1: turn demotion off ⭐

The demo already has a `disableSourceWeighting` switch. Vary the number of cron
sessions (12 → 3 → 50) and watch the ranking change.

How many cron sessions does it take to bury one real conversation? The number is
smaller than you think.

### Exercise 2: connect it to Lesson 4's real sessions ⭐⭐

The data is currently hardcoded. Read from
`lesson-04-sessions/.sessions/*.jsonl` instead.

You will hit a problem: the JSONL has no source field. How do you supply one?
(Hint: Lesson 4's `appendMeta` exists for exactly this.)

### Exercise 3: add time decay ⭐⭐

Only relevance counts today, not recency. Add a time weight: should a
conversation from three months ago rank below one from last week?

Then think: when is the older one actually more important? (Hint: "why did we
design it this way originally?")

### ~~Exercise 4: make it a tool for the agent~~ → now part of the lesson

See `agent.ts` in Step 3.5.

What remains worth doing is the tool description. The current one is "Search the
user's past conversation sessions by keyword". Try writing it badly, or omitting
it, and see whether the model still reaches for the tool. (Same question as
Lesson 16 Step 2.5 from the other side: a tool description is also a routing
signal.)

### Exercise 5: find your own recall blindness ⭐⭐⭐

If you already have a pile of agent sessions, run this:

- is there a category of session that occupies every search result?
- is that category something the user recognises? Demote it, or hide it?

### Exercise 6: is two-stage ever worth it ⭐⭐⭐

Hermes removed the LLM summarisation path. Under what circumstances would it be
worth having?

Consider: 100,000 messages in a session, a search returning 50 candidates, each
with plus or minus 5 messages of context. That is 500 messages into the context.

At that point, do you need summarisation or better ranking? Why?

---

## Compared with Hermes's source

| Concept in this lesson | Where it lives in Hermes |
|---|---|
| the full description of the three modes | the docstring at the top of `tools/session_search_tool.py` |
| hidden sources | `session_search_tool.py:38` (`_HIDDEN_SESSION_SOURCES`) |
| demoted sources and recall blindness | `session_search_tool.py:50` (`_DEMOTED_SESSION_SOURCES`) |
| the reason for the scan limit | `session_search_tool.py:52` (`_DISCOVER_SCAN_LIMIT`) |
| excluding compaction summaries | `session_search_tool.py:58` (`_COMPACTION_PREFIXES`) |
| the FTS5 schema and CJK | `hermes_state.py` (10850 lines; search for `fts5`) |
| the query length cap | `hermes_state.py:280` (`MAX_FTS5_QUERY_CHARS`) |
| FTS5 corruption detection | around `hermes_state.py:837` |

The 30-line docstring at the top of `session_search_tool.py` is worth reading
whole. It lays out the three modes, the design trade-offs, and the evolution
(which PR added what, and why it was later removed). It is a good example of
technical writing.

---

## Next lesson

[Lesson 18: scheduling and unattended execution](../lesson-18-scheduling/)

Memory, skills and cross-session search all answer how to retrieve things the
agent itself produced. The Hermes part has two more, and they answer the other
half of "running for months": how it keeps existing when nobody is watching.

Lesson 18 is scheduling, and this lesson set it up: those 12 cron sessions
burying the user's conversation came from somewhere, and Lesson 18 is where they
come from.
