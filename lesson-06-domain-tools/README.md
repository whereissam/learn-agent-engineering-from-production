# Lesson 6: Domain Tools

> [繁體中文](README.zh-TW.md)
>
> Prerequisites: [Lesson 3](../lesson-03-streaming/) (streaming).
>
> This is layer 3. The first five lessons built the engine; this one starts on
> making the engine useful in a domain of your own.

## Questions this lesson answers

1. Why not just hand the agent `read_file` and let it work the data out?
2. Which work belongs to code, and which to the model?
3. How should a tool's error messages read, so the model can recover?
4. How do you force the model to cite evidence for a conclusion?

---

## No robotics knowledge required

This lesson uses incident analysis for a quadruped robot as its domain. You do
not need to know anything about robots. Three signals are enough:

| Signal | In plain terms |
|---|---|
| `imu_pitch_deg` | how far the body tilts forwards or back. Normal walking is 0-5 degrees |
| `foot_contact` | whether each of the four feet is on the ground |
| `joint_torque_max` | how hard the joints are pushing. Normal walking is 15-25 Nm |

And the central judgement in the whole lesson is common sense:

> A fall means every foot left the ground and it could not get up.
> A crouch means the feet stayed down.

The pitch looks similar in both (a big forward tilt), while `foot_contact` is
completely different. One signal separating two situations that look alike is
what domain knowledge typically looks like.

> The same shape appears in your domain: an abandoned cart versus a shopper
> still browsing, a ranking drop versus seasonal variation.

The data is synthetic, generated from a fixed random seed, so a hundred runs
are identical. There are seven sessions, one per evaluation case in Lesson 7:

| session | What it is | What it tests |
|---|---|---|
| `sess_001` | a real fall | can it be detected |
| `sess_002` | a fast crouch | false alarm? (`foot_contact` is the key) |
| `sess_003` | an external collision | can the cause be distinguished |
| `sess_004` | a sampling gap | does it know what it does not know |
| `sess_005` | a video clock offset | is the trap noticed |
| `sess_006` | two events in one recording | does it report only the worst |
| `sess_007` | a very slow tip-over (6 seconds) | the candidate window arrives late; is it copied blindly |

The last two were added later. The original five shared a shape, one sudden
event per session, and real telemetry does not look like that. `sess_007` is
worth studying: `find_anomalies` only starts producing candidates at
t=7060ms, because the threshold needs `pitch>30`, while the tip-over began at
t=4000ms. The candidate is three seconds late.

```bash
bun run lesson-06:data
```

---

## Step 0: run it first

```bash
bun run lesson-06
```

```
> 分析 sess_002 發生了什麼事，寫報告
```

The trajectory it actually produced, Gemini 3.6 Flash:

```
→ get_session(sess_002)            檢查資料品質
→ find_anomalies(sess_002)         找候選區間
→ query_telemetry(0..12000)        看全域
→ query_telemetry(5000..6500)      放大異常區間
→ query_telemetry(6500..12000)     看事後有沒有恢復
→ query_telemetry(0..5000)         看事前的基準
→ get_video_frame(5620)            交叉驗證
→ list_sessions()
→ compare_sessions(sess_001, sess_002)   跟真的跌倒比對
→ create_incident_report(...)
```

And the report:

```json
{
  "classification": "near_miss",
  "confidence": "high",
  "window_start_ms": 5360,
  "evidence": [
    "在 t=5620ms 處 imu_pitch_deg 達到峰值 37.70°（常規行走為 0-5°）",
    "在 t=5580ms 處 joint_torque_max 達到峰值 51.36 Nm（常規行走為 15-25 Nm）",
    "全過程無足部離地（airborne samples 為 0，視頻畫面 t=5620ms 確認 4/4 足部著地）",
    "imu_accel_z 在 9.40..10.20 m/s² 之間，排除外部強衝擊碰撞",
    "t>6500ms 後恢復正常行走"
  ]
}
```

Note that it did not call this a fall. A pitch spiking to 37 degrees looks
exactly like one, so it checked `foot_contact`, found the feet never left the
ground, and classified it as a near miss.

That is what a domain tool does: it builds "which signal to look at" into the
tool.

---

## Step 1: the loop did not change at all

The most important point first. Compare `runTurn` in
`lesson-06-domain-tools/agent.ts` with Lesson 3's: they are the same.

Two things changed:

```diff
- const registry = new ToolRegistry([readFileTool, writeFileTool, editFileTool, ...]);
+ const registry = new ToolRegistry([listSessionsTool, getSessionTool, queryTelemetryTool, ...]);

- const SYSTEM_PROMPT = "You are a coding agent...";
+ const SYSTEM_PROMPT = "You are an incident analyst for a quadruped robot fleet...";
```

New tools plus a new prompt equals a new domain. The engine stays put.

That also answers a common question: "I want an agent for domain X, which
framework should I use?" Usually you do not need a new framework, you need new
tools.

---

## Step 2: whatever code can compute, do not ask the model to

The first principle of domain tool design.

Suppose the model only has `read_file`. To analyse one session it must:

```
讀進 600 筆 JSON 樣本（100KB）
→ 自己在腦內找最大值
→ 自己算平均
→ 自己判斷哪段異常
```

Three problems:

| Problem | Consequence |
|---|---|
| **token explosion** | one session is 100KB; five of them fill the context |
| **unreliable arithmetic** | LLMs make numerical mistakes, confidently |
| **not reproducible** | ask twice about the same data and the peak may differ |

So `query_telemetry` does not return raw samples, it returns a statistical
summary:

```
imu_pitch_deg      min=  -2.31  max=  37.70  mean=   5.42  peak@5620ms
joint_torque_max   min=  11.02  max=  51.36  mean=  22.15  peak@5580ms

foot_contact: at least one foot on the ground for the entire window
```

600 samples compressed into 8 lines, and `max=37.70` is computed by
code, so it is always right.

> The division of labour: code computes, the model interprets. The model is
> good at "37 degrees with the feet still down, so this is not a fall", not at
> "which of these 600 numbers is largest".

---

## Step 3: tools propose candidates, the model concludes

`find_anomalies` sweeps the session with hardcoded thresholds:

```ts
if (Math.abs(s.imu_pitch_deg) > 30) hits.push({ ... });
if (s.imu_accel_z > 15) hits.push({ ... });
if (s.foot_contact.every((c) => !c)) hits.push({ ... });
```

But its description is carefully worded:

```
Returns candidate windows with the signal that triggered them.
These are CANDIDATES, not conclusions: you must inspect each one
to decide what actually happened.
```

The split is deliberate:

```
確定性的規則  →  負責 recall（不要漏掉任何可疑的地方）
模型          →  負責 precision（判斷哪些是真的）
```

The other way round (asking the model to sweep all the data itself) is both
expensive and unstable. A rule-based scan is O(n) and free; the model only
looks at a few candidate windows.

The pattern generalises: log analysis, anomaly detection, code review,
security scanning. Narrow the field with something cheap and deterministic,
then let the model judge.

---

## Step 4: tools must volunteer data-quality problems

`get_session` carries something that looks redundant:

```ts
const gaps = findGaps(samples, meta.sample_rate_hz);

if (gaps.length > 0) {
  lines.push("DATA QUALITY WARNING: sampling gaps detected");
  for (const gap of gaps) {
    lines.push(`  no samples between t=${gap.start_ms}ms and t=${gap.end_ms}ms`);
  }
  lines.push("  Do not draw conclusions about what happened inside these windows.");
}
```

Why say it unprompted?

Because the model does not spontaneously distrust its data. If the tool says
nothing, the model naturally assumes the data is complete and then draws
conclusions about a stretch of time with no data in it.

This is one of the most common sources of hallucinated conclusions:

> The model is not making things up; the tool failed to tell the truth.

`sess_004` exists for this, with three seconds missing in the middle. Try it:

```
> 分析 sess_004
```

Good behaviour reports `inconclusive` and notes the hole in the caveats. Bad
behaviour invents a story about those three seconds. Lesson 7 turns this into
a formal evaluation case.

Likewise `sess_005`, whose video timestamps run 2300ms ahead of the telemetry.
`get_video_frame` converts automatically instead of asking the model to:

```ts
const videoT = t + meta.video_offset_ms;
```

Complexity you can absorb in a tool should not be left to the model. Every
conversion the model is expected to remember is a place it will eventually
forget.

---

## Step 5: an error message is prompt for the model

Compare these:

```ts
// ✗ 沒用的錯誤
throw new Error("No data");

// ✓ 模型可以據此行動的錯誤
throw new Error(
  `No samples between t=${start}ms and t=${end}ms. ` +
  `This session has data from t=${first}ms to t=${last}ms. ` +
  "Either the window is outside the recording, or it falls inside a sampling gap " +
  "(call get_session to check).",
);
```

The second carries three things:

1. what happened (no data in this window)
2. what is actually true (the data spans 0..12000)
3. what to do next (call get_session to check)

Given the first, the model can only guess. Given the second, it corrects the
query.

The same principle applies to session ids:

```ts
throw new Error(
  `Invalid session_id "${sessionId}". Expected the form sess_001. ` +
    "Call list_sessions to see valid ids.",
);
```

Every error message should tell the model what to do next.

---

## Step 6: use a schema to force structure

`create_incident_report` is not "write some text to a file". Its parameters
have structure:

```ts
classification: { type: "string", enum: ["fall", "near_miss", "external_collision", "nominal", "inconclusive"] },
confidence:     { type: "string", enum: ["high", "medium", "low"] },
evidence:       { type: "array", items: { type: "string" } },
caveats:        { type: "array", items: { type: "string" } },
```

Given only `write_file`, the model writes prose. Prose cannot be:

- checked programmatically (which Lesson 7's evaluation needs)
- stored in a database or fed to a dashboard
- guaranteed to cite any evidence at all

And the classification is an enum, not free text. Otherwise you get a dozen
phrasings of "probably a fall" and "slight instability", and nothing
downstream can count them.

### Enforce rules in code, do not beg in the prompt

```ts
if (classification !== "nominal" && evidence.length === 0) {
  throw new Error(
    `A "${classification}" classification requires at least one evidence entry. ` +
      "Go back and query the telemetry, then cite the specific numbers you found.",
  );
}
```

Write "please cite evidence" in the system prompt and the model complies most
of the time. Check it in the tool and it complies every time, because
otherwise the tool fails and it has to try again.

> Whatever the harness can guarantee should not be left to the prompt to pray
> for.

---

## Step 7: a trap found in practice (Gemini's `thought_signature`)

The first time this lesson ran against a real model, the second request
returned `400 status code (no body)`, with no error message and no clue.

The cause: Gemini attaches a `thought_signature` to a tool call, and it must
be sent back untouched on the next turn.

```json
{
  "extra_content": { "google": { "thought_signature": "EswCCskCARFNMg..." } },
  "id": "cY8cifxX",
  "type": "function",
  "function": { "name": "get_session", "arguments": "..." }
}
```

The streaming provider dropped `extra_content` while rebuilding the message,
hence the 400.

This is the same thing as Lesson 1's `raw` field. That example was Anthropic's
thinking blocks needing to go back verbatim; now there is a second, Gemini's
thought signature.

The fix is to keep provider-specific fields while accumulating tool call
fragments:

```ts
for (const [key, value] of Object.entries(call)) {
  if (key === "index" || key === "id" || key === "type" || key === "function") continue;
  existing.extra = { ...existing.extra, [key]: value };
}
```

The lesson: a neutral abstraction can never cover every provider's internal
fields. Preserve what you do not recognise instead of discarding it.

(The non-streaming version never had this problem, because it stores the API's
whole message object in `raw`. The bug was introduced by rebuilding messages
in the streaming version.)

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Session sess_XXX not found` | mistyped id | ask the agent which sessions exist |
| No `data/sessions/` | the data was never generated | `bun run lesson-06-domain-tools/data/generate.ts` |
| `400 status code (no body)` (Gemini) | a tool call's `extra_content` was dropped | see Step 7, already fixed |
| The model calls sess_002 a fall | the prompt does not stress foot contact | see the discriminator section of `SYSTEM_PROMPT` |
| The report is vague | evidence is not enforced | see Step 6 |

---

## Exercises

### Exercise 1: turn a good tool into a bad one ⭐

Change `query_telemetry` to return raw JSON samples with no statistics, then
ask the same question.

Watch: how much does token usage differ? Is the peak the model computes
correct? Do two runs agree?

This exercise conveys the value of layer 3 better than any argument.

### Exercise 2: remove the data-quality warning ⭐

Comment out `get_session`'s gap warning, then ask about `sess_004`, which has
a three-second hole.

Watch whether the model invents a story about those three seconds. That is the
cost of a tool that does not tell the truth.

### Exercise 3: add a `get_robot_history` tool ⭐⭐

Past incidents for the same robot, so the agent can answer "does this robot
fall over a lot?"

Think: should that tool return raw records or a statistical summary? (Recall
Step 2.)

### Exercise 4: switch to a domain of your own ⭐⭐⭐

This is the real assignment. Pick a domain you know and design 5 to 7 tools.
For SEO, say:

```text
get_page_metrics(url, date_range)
find_traffic_drops(site, threshold)
compare_serp_position(keyword, before, after)
get_page_content(url)
create_seo_report(...)
```

Ask yourself four questions:

1. Which computations should finish inside the tool? (Do not make the model
   average things.)
2. Which tools are mutating and need approval?
3. Does every error message tell the model what to do next?
4. Does the final output have a schema, and can it be checked by code?

### Exercise 5: find your own "foot contact" signal ⭐⭐⭐

The core of this lesson is that one signal separates two situations that look
alike.

Find that signal in your domain, write it into the discriminator section of
the system prompt, and make sure a tool can fetch it.

This is usually the most valuable thing a domain expert knows, and the hardest
thing to learn automatically from data.

---

## Compared with Pi's source

Pi is a coding agent and has no domain tools. But the shape of a tool is
shared:

| Concept in this lesson | Where it lives in Pi |
|---|---|
| the Tool interface | `packages/agent/src/types.ts:380` (`AgentTool`) |
| separating content from details | `types.ts:355` (`AgentToolResult`) |
| output truncation | `harness/utils/truncate.ts` |
| the execution-environment abstraction | `harness/types.ts:373` (`ExecutionEnv`) |

One field of `AgentToolResult` deserves attention:

```ts
export interface AgentToolResult<T> {
  content: (TextContent | ImageContent)[];   // → 給模型看的
  details: T;                                // → 給 UI / log 的，模型看不到
}
```

The tools in this lesson return only strings, which is to say only `content`.
A real product uses `details` to hand structured data to the UI for charts
while giving the model a compact textual conclusion. One tool call, two
consumers, two formats.

---

## Next lesson

[Lesson 7: Evaluation](../lesson-07-evaluation/): you now have an agent that
analyses incidents. But is it any good? Does swapping models make it better or
worse? Did that prompt change regress anything?

Without evaluation you are tuning prompts on vibes. The next lesson deals with
that.
