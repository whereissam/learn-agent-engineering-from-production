# Lesson 25: Citations and Evaluation

> [繁體中文](README.zh-TW.md)
>
> Prerequisites: [Lesson 7](../lesson-07-evaluation/) (deterministic scoring),
> [Lesson 24](../lesson-24-research-loop/) (the evidence research produces).
>
> The last lesson of the AI Search main line (26 and 27 are follow-ups). What it
> catches is a mistake that **looks entirely compliant**.

## Questions this lesson answers

1. Every sentence in the report carries a URL — how do you know that page really
   says it?
2. This sounds like a semantic judgement; why not use an LLM as the judge?
3. How much does a crude deterministic check catch? What does it miss?

---

## Step 0: a real mistake

Take a sentence from a report Lesson 24 actually produced (`fixtures.ts` holds
the whole thing, verbatim) and move one citation:

```markdown
* **Kinematic Foot Sliding**: Deploying `humanoid-mimic` 0.7 on the Unitree G1
  causes foot sliding during fast footwork … A practical workaround requires
  slowing trajectory playback speed to 0.8x
  (https://technews.example.com/2026/07/humanoid-robot-funding-round)
```

The URL is real and the page was really fetched. **It is a funding announcement
that never mentions foot sliding, playback speed, or 0.8x.**

This is **citation grafting**:

```text
the URL is real
the page really was fetched (Lesson 24 already blocks invented URLs)
the content is real
and this page does not support this sentence
```

It is more dangerous than a wholesale hallucination, because **every layer of
checking lets it through**. You click, see a genuine technical article, and
believe the whole sentence.

---

## Step 1: why not use an LLM as the judge

"Is this sentence supported by this page" sounds exactly like a semantic
judgement, and having a model score it feels natural. But Lesson 7's principle
holds here too:

> Scoring must be deterministic, or you cannot answer "did that change make
> things worse".

If the judge itself drifts, `--compare` becomes meaningless — you cannot tell
whether the system regressed or the judge is in a different mood today. Lesson 22
Step 5's "average rose while one query collapsed" was caught precisely by
deterministic scoring.

So this lesson uses a very crude method:

```text
1. pull checkable "atoms" out of the sentence: numbers, versions, dates, identifiers, licence names
2. look for those atoms in the body of every cited source
3. a source where not one atom is found  → that citation is grafted
4. an atom found in no source at all     → that number was invented or altered
```

It checks no semantics, only whether these specific things are present.

---

## Step 2: run it

```bash
bun run lesson-25
```

Four reports: one is Lesson 24's real output, three are **deliberately corrupted**
versions of it (the corruptions are written in `fixtures.ts` so you can check them
yourself).

```
Lesson 24's real output, not a word changed
  claims 16  uncited 0  atoms 100  unsupported 7  grafted 0  unknown 0

number drift        planted: 0.8x → 0.5x, 18 ms → 8 ms, 50 Hz → 120 Hz
  claims 16  uncited 0  atoms 100  unsupported 9  grafted 1
  ✓ unsupported 9 ≥ 3

citation grafting   planted: the joint-index line gains a cooking site; the foot-sliding line gets a funding story
  claims 16  uncited 0  atoms 100  unsupported 8  grafted 2
  ✓ grafted 2 ≥ 2

bare assertions     planted: citations stripped from every other line
  claims 16  uncited 7  atoms 100  unsupported 44  grafted 0
  ✓ uncited 7 ≥ 5
```

All three corrupted versions are caught. But **the first one is the interesting
part**.

---

## Step 3: what the checker found in the real output

```bash
bun run lesson-25 -- --show real
```

The real report has 16 claims and 100 atoms, and the headline number is a
surprise:

```
claims 16  uncited 0  atoms 100  unsupported 5  grafted 0  unknown 0
```

**Zero uncited sentences and zero grafted citations.** Every factual sentence
carries a source, and every source cited genuinely supports the sentence attached
to it. That is not what the first version of this lesson measured, and it is the
honest result of re-running it.

### The residue, and how it was misread once already

Before the hyphen fix below, that line read `unsupported 7`, and this README
said all seven were the checker's fault:

```
✗ Two open-source software projects include motion retargeting pipelines for t
    no source found: open-source
✗ * **License & Compatibility**: Released under an MIT license, version 0.7 ad
    no source found: hardware-validated
✗ * **Runtime & Hardware Specs**: Running on an NVIDIA RTX 4070 GPU, the pipel
    no source found: NVIDIA, GPU
✗ * **Backbone Weights Licensing**: While the `humanoid-mimic` codebase is MIT
    no source found: MIT-licensed
✗ * **Outdated Benchmarks**: A third-party review of seven motion retargeting 
    no source found: third-party, out-of-the-box
```

Seven findings, five of them visibly hyphenated, and the conclusion written down
at the time was "hyphenation and casing, all seven". **Grepping the corpus says
otherwise.** Only two of the seven were hyphenation:

| atom | what the corpus actually contains | verdict |
|---|---|---|
| `MIT-licensed` | "The project stays MIT licensed" | ✅ **fixed by the hyphen rule** |
| `out-of-the-box` | "…works out of the box" | ✅ **fixed by the hyphen rule** |
| `NVIDIA`, `GPU` | neither string appears **anywhere in the corpus** | correct flag |
| `third-party` | absent from the corpus in any spelling | correct flag |
| `open-source` | present on three pages — but **not on either page this claim cites** | correct flag |
| `hardware-validated` | "validated on hardware" — same words, reversed | still a false positive |

> The misreading is the most useful thing in this step, and it is Trap 3 arriving
> one layer further out. Five of seven findings *looked* hyphenated, so the list
> got classified by appearance instead of by checking. Two actually were.
>
> **A false-positive rate is a measurement, not an impression.** Eyeballing the
> output of a checker is the same mistake as eyeballing the output of a model.

### The fix, and what it does not fix

Identifier normalisation stripped whitespace but not hyphens, so `open-source`
could never match "open source". Both sides now go through the same packing
(`packWordBoundaries` in `verify.ts`), and a hyphen is a word boundary exactly
as a space is.

Why this only surfaced now is worth more than the fix. When the surrounding prose
was Chinese, a hyphenated Latin token really *was* an identifier — `Apache-2.0`,
`humanoid-mimic`, `left_knee` — because ordinary Chinese words are not
hyphenated. English hyphenates ordinary adjectives too.

> **A heuristic is only as portable as the language it was tuned against.**
> Nothing about the rule was wrong; what changed was the text it runs on.

After the fix the residue is 5, and it is no longer noise:

```
3 correct flags     NVIDIA, GPU, third-party — words no source ever uses
1 correct by design open-source — on three corpus pages, neither of them cited here
1 false positive    hardware-validated vs "validated on hardware"
```

The last one is a **word-order** miss, not a hyphenation one, and fixing it means
matching bags of words instead of strings — which starts down the road to
semantics that Step 2 refuses to take. It stays, documented.

And the three correct flags are the quiet finding: the model wrote "an NVIDIA RTX
4070 GPU" where its source said "an RTX 4070", and "a third-party review" where
its source said nothing of the kind. Nothing is false, and nothing is sourced
either. That kind of small completion is the most common way a report distorts,
and it is nearly impossible to find by manual spot-checking.

---

## Step 4: three traps, all on the evaluation side

The part of this lesson most worth keeping is the **three times the evaluation
itself was wrong**. A broken evaluation is more dangerous than a broken system,
because it sends you to fix something that is not broken.

### Trap 1: the sentence-splitter's placeholders broke, so every citation went empty

The first version of `splitSentences` replaced URLs with placeholders, split, and
then restored them. The placeholder was written wrongly (a character that should
have been whitespace was something else), so **no URL was ever restored**.

Result:

```
claims 12  uncited 12  atoms 82  unsupported 82  grafted 0
```

Every claim "has no citation" and every atom "has no source". And the program
raised nothing; all four reports "completed".

Looking only at "did it complete", Lesson 24's report would have looked
catastrophically bad.

The fix is not fixing the placeholder but **removing placeholders entirely** —
`。！？` never appear inside a URL, and an ASCII `.` only splits when followed by
whitespace, which never happens after a dot inside a URL. One less mechanism is
one less thing that can break.

### Trap 2: the source the evaluation reads is not the source the agent read

After that fix, the joint-mapping claim was judged:

```
no source found: 7, 9, 3, 17, 15, left_hip_pitch, left_knee, rad/s
```

But those numbers are **plainly on the page**.

The cause: Lesson 21's `fetcher.ts` returns a **dynamically generated long
document** for `unitree.com/g1/developer` (that SDK migration guide), while the
evaluation read the short version straight from `corpus/index.json`.

```text
what the agent read   ≠   what the answer is checked against
```

So **correct citations were judged hallucinated**. The fix is making the
evaluation go through exactly the same `fetchPage` plus `extractMain` path as
`runQuery`.

> The evaluation's sources must be the same sources the system actually saw.
> That sounds trivial, and it is the most expensive line in this lesson.

### Trap 3: normalisation glued adjacent numbers together

Two false positives remained: the `6` in "June 2026" and the `2004` in
"Apache License… January 2004".

The sources are English (`released June 2026`), so month conversion turned
`june → 6`, and then all whitespace was removed to make comparison easier:

```text
"released June 2026"  →  "released 6 2026"  →  "released62026"
atom 6 requires "no digit either side"  →  a 2 follows it  →  judged unsupported
```

The fix: **numbers and identifiers need different normalisation**. Identifiers
drop whitespace (so `Apache-2.0` equals `Apache - 2.0`), while numbers keep a
single space as a boundary.

With all three traps fixed, the real report went from "14 unsourced" to "5".

At the time that was written down as "and the remaining 5 are all genuine
problems". Step 3 is what happens when somebody actually checks that claim
against the corpus a month later — the residue is again 5, composed differently,
and one of them is still the checker's fault. **Three traps found is not a reason
to stop looking for the fourth.**

---

## Step 5: what this method cannot catch (stated up front)

| Catches | Misses |
|---|---|
| citing a source that does not say it | all atoms present but the causality reversed |
| numbers altered or invented | subjective sentences with no atoms, like "A is better than B" |
| factual sentences with no citation at all | the source says "unsupported" and the report says "supported" |
| citing a URL that does not exist | quoting out of context (the citation exists, the context is opposite) |

The last cell deserves particular care: finding all of a sentence's atoms does not
make the sentence true.

So why is it worth doing?

> Better a deterministic check that catches 70% of problems than an LLM judge
> claiming 95% whose results differ every run.

And it is cheap (no model), reproducible, CI-able, and regression-testable. The
remaining 30% needs manual spot-checking — but the scope of that checking has been
narrowed to the sentences whose atoms all line up.

---

## Step 6: regression comparison

Same shape as Lesson 7:

```bash
bun run lesson-25 -- --save      # save a baseline
bun run lesson-25 -- --compare   # compare after every later change
```

```
compared against the baseline
  ✓ every metric matches the baseline
```

Run this after changing Lesson 24's prompt, switching models, or adjusting
breadth. A worse metric is stated outright, along with which report and which
metric.

Without this step, all you have is "feels like it got better".

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Lesson 20's corpus not found` | the corpus is not generated | `bun run lesson-20:corpus` |
| every claim reads "no citation" | the report format is not "URLs in parentheses at the end of a sentence" | change `URL_PATTERN` and footnote parsing in `report.ts` |
| correct citations judged as grafted | the evaluation reads different sources from the system | see Step 4, trap 2 |
| `No baseline yet` | `--save` has never run | `bun run lesson-25 -- --save` |

---

## Exercises

### Exercise 1: wire Lesson 24's output in ⭐⭐

The fixtures are hardcoded. Read Lesson 24's actual report instead (add a `--json`
output to `demo.ts`, or just write it to a file).

Then: run the same question three times and see how far the metrics differ across
the three reports. That tells you Lesson 24's stability, which is something
nothing has measured so far.

### Exercise 2: add an "opposite context" check ⭐⭐⭐

Step 5 says it cannot catch "the source says unsupported, the report says
supported".

Devise a deterministic method. Hint: the presence of negations (not, no longer,
deprecated, no longer, unmaintained) in the source versus in the claim makes a crude but
useful signal.

Work out its false-positive rate first, then decide whether to build it.

### Exercise 3: make it a gate in Lesson 24 ⭐⭐

Right now it evaluates after the fact. Change it: after `writeReport` produces the
report, **verify first**, and strip a grafted citation before output.

To think about: stripping the citation turns that sentence into a bare assertion —
is that worse? Or should the whole sentence go? Who decides?

### Exercise 4: run it on a different domain ⭐⭐⭐

This is the real homework. Feed in an AI-generated report from your own domain
(just put the source bodies into the corpus map).

You will probably find three things:

1. Atom extraction needs tuning (your domain has its own identifier formats)
2. There will be more false positives than here (real sources are messier than this
   corpus)
3. **It will still catch things** — usually the kind you would not find in ten
   readings

### Exercise 5: kill the last false positive, or decide not to ⭐⭐⭐

Step 3's residue is down to one: `hardware-validated` against a source that says
"validated on hardware". Same words, reversed, so string matching cannot see it.

The obvious fix is to match a hyphenated identifier as an unordered bag of its
parts. Try it — then measure what it costs. `open-source` becomes `open` +
`source`, both of which are stopword-grade English, and the atom stops
discriminating at all.

The exercise is not the code. It is deciding, with numbers in hand, whether
removing one false positive is worth the false negatives it buys, and then
writing that decision down next to the rule.

---

## Compared with the sources

| Concept in this lesson | Reference |
|---|---|
| deterministic rubric, `--save` / `--compare` | this series' [Lesson 7](../lesson-07-evaluation/) |
| evidence bound to sources | this series' `Learning.sources` in `lesson-24-research-loop/state.ts` |
| writing a long report without losing citations | `gpt-researcher/gpt_researcher/actions/report_generation.py` (309 lines) |

> None of the four real projects (deep-research, gpt-researcher, firecrawl,
> crawl4ai) **has citation verification**. They produce citations, but not one of
> them goes back to check the citations hold. That is not a knock on them — this
> is something only someone inside the domain can do, because only you know what
> your sources look like and which errors your users care about.

---

## The AI Search part ends here

Six lessons, from "one agent plus one search tool" to "a measurable research
pipeline":

```text
20  what search returns is a snippet, not a page; the query decides which face you see
21  the body is only half the page; extraction failure is silent
22  BM25 + dense + fusion + dedup + signals; the mean score will lie to you
23  how real projects do it; copying it back exposed a bug latent for three lessons
24  the control flow is taken back from the model; the budget is computed, not discovered by crashing into it
25  citations have to be verified; the evaluation itself can be wrong
```

Every lesson has a measurement record, and **every lesson's conclusion differs
from the prediction made before the work started**. Those differences are what
this part is actually about.

---

## Next lesson

[Lesson 26: cost and budget](../lesson-26-cost/): none of these six lessons ever
measured money. gpt-researcher threads a `cost_callback` through **every** LLM
call; here there is not one.

That lesson measures something counter-intuitive: `total` is far larger than
`input + output`, and the difference not only costs money but eats into your
`maxTokens` allowance.
