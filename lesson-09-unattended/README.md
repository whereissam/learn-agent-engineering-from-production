# Lesson 9: When Nobody Is There

> [繁體中文](README.zh-TW.md)
>
> Prerequisites: [Lesson 8](../lesson-08-permissions/) (risk classes).
>
> A job runs at 3am, the agent needs approval to send mail, and you are asleep.
> Now what?
>
> This is the line between automation and a toy, and the most valuable design
> OpenWorker has.
>
> Source: `openworker/coworker/inbox.py`, `coworker/unattended.py`

## Questions this lesson answers

1. What should an agent do when nobody can approve?
2. Why are "do it anyway" and "skip and continue" both wrong?
3. What happens if the same approval is answered from a phone and from the app?
4. Should unattended mode also relax permissions?

---

## Step 0: run it first

There are two programs here. Start with the InboxStore's four scenarios; no API
key needed:

```bash
bun run lesson-09:demo
```

```
Scenario 1: nobody is there, so the agent stops and waits

  [agent] the agent wants to email team@example.com…
  ⏸  the agent is paused. The inbox holds 1 pending item(s):
     itm_0001  Run send_email?
     to: team@example.com · subject: Daily summary

  …eight hours pass…

  [your phone] saw the notification and tapped "allow"
  [agent] ✓ the message went out (waited 352ms, outcome once)
```

The agent really stopped, and was woken from a different interface.

### But that agent is fake

The "agent" in `demo.ts` is `fakeAgentTurn`, a function that calls `approve()`
and prints one line. It proves the inbox blocks the caller, and proves nothing
about the next step:

> The approval came back eight hours later and the tool really ran. Did the
> model close out correctly once it had that result?

So there is a second program:

```bash
bun run lesson-09              # approve
RESOLVE=deny bun run lesson-09 # deny
RESOLVE=none bun run lesson-09 # nobody answers; watch it really wait
```

```
you Send a daily summary to team@example.com for me.

Right, I will send that daily summary.

⏸  agent paused: send_email needs approval and nobody is here
   This operation has side effects that leave the machine and cannot be taken back

   [your phone] saw the notification "Run send_email?" and tapped "allow"
   after waiting 1367ms, an answer arrived from another surface: once
  ✓ Email sent to team@example.com (subject: Daily summary).

Sent, to team@example.com.

──── what actually happened (ignoring what the model said) ────
  outbox/ holds 1 message(s): cc0ebb1d.json
  inbox has 0 still pending and 1 resolved
    ✓ Run send_email? → allow
```

That last block is deliberate. `send_email` really writes a file into
`outbox/`, so "the model says it sent" and "the mail was sent" are two facts
you can check separately.

> Why so careful? Because in Lesson 8 Step 7's measurement, the model told the
> user it had finished refactoring after the write was refused. From that
> moment on, the model's own account stops counting as evidence.

---

## Step 1: three wrong answers

Three approaches come to mind when nobody can approve, and all three are wrong:

| Approach | Why it is wrong |
|---|---|
| **just allow it** | you no longer have an approval mechanism, and you removed it exactly when nobody is watching, which is the riskiest moment |
| **just refuse** | automation never finishes anything. The daily summary never goes out |
| **skip and continue** | worst of all. The agent keeps going on the basis that the step did not happen, producing something that looks complete and is half done |

The third is especially dangerous because it does not fail. In the morning you
see "task complete", and three steps in the middle were skipped.

The right answer is a fourth:

> Store the request, let the agent wait there, and answer when you wake up.

---

## Step 2: swap one approver

There is startlingly little code in this lesson, because Lesson 8 already split
the architecture correctly.

```ts
export type Approver = (request: ApprovalRequest) => Promise<ApprovalOutcome>;
```

Two implementations with identical signatures:

```ts
// somebody is here: ask the terminal
export function inlineApprover(reader: LineReader): Approver {
  return async (request) => {
    const line = await reader.next("[y] allow [a] always [n] deny › ");
    ...
  };
}

// nobody is here: drop it in the inbox, then pause
export function inboxApprover(store: InboxStore, sessionId: string): Approver {
  return async (request) => {
    const item = await store.add({ ... });
    const resolution = await store.wait(item.id);   // ← the agent stops right here
    ...
  };
}
```

The agent loop cannot tell the difference. It awaits a promise, which may be
answered 0.5 seconds later because you pressed y, or eight hours later because
you checked your phone in the morning.

That is the payoff from Lesson 8's insistence that the engine decides without
asking. The entire unattended feature is one swapped function.

---

## Step 3: there is no timeout, deliberately

```ts
const resolution = await store.wait(item.id);
```

Note the absence of a timeout. It reads like a bug at first, until you ask what
a timeout would do.

- allow on expiry → back to "just allow it", and worse, because you believe you
  have an approval mechanism
- refuse on expiry → back to "just refuse", and the task fails

Both are the wrong answers we just rejected. So it waits.

> What should have a timeout is the whole task, not one approval. "Alert if
> this job has not finished in 24 hours" is reasonable; "allow if nobody
> answers within 5 minutes" is not.

---

## Step 4: the state machine has one edge

```
pending ──→ resolved
```

And it can only be traversed once. OpenWorker's docstring is precise:

> each item is `pending → resolved`, resolved **once**, idempotent +
> first-responder-wins, so answering from any surface (in-app, Slack,
> the composer after resuming) is safe.

Why is that guarantee needed? Because the same request appears in many places:
an in-app notification, a phone push, a Slack message, a dialog when you come
back.

You might press allow on your phone, forget, and press again in the app:

```
[phone] resolve("itm_0001", "allow")
       → succeeded
[agent] ✓ the message went out

[app  ] the same item answered again, this time trying to deny
       → no-op (already answered)
```

The second answer becomes a silent no-op. It does not wake the agent twice,
and it does not un-send the mail, which was never possible anyway.

In implementation it is these few lines:

```ts
async resolve(itemId: string, resolution: string): Promise<boolean> {
  const item = this.items.get(itemId);
  if (!item || item.state === "resolved") return false;   // ← the key to idempotence
  item.state = "resolved";
  ...
}
```

Returning `false` is not an error, it means somebody already answered.

---

## Step 5: orphans have to be cleaned up

When a session is deleted, its waiting approvals can never be answered
meaningfully again.

Ignore that and two things follow:

1. that agent waits at its `await` forever
2. the inbox accumulates zombies

```ts
async resolveSession(sessionId: string, resolution = "session deleted"): Promise<number> {
  let closed = 0;
  for (const item of this.pending(sessionId)) {
    if (await this.resolve(item.id, resolution)) closed++;
  }
  return closed;
}
```

Measured:

```
Scenario 3: the session was deleted
  ⏸  the agent is paused, waiting for approval
  [user] deleted this session
  [agent] ✗ declined, nothing sent (waited 51ms)
  closed 1 orphaned item(s)
```

Note the agent receives a refusal rather than crashing. When you release a
waiter you must give it a definite answer, not just drop the promise.

---

## Step 6: coming back means seeing what happened while you slept

Handing back only the unresolved items is not enough:

```ts
reconcileOnResume(sessionId: string) {
  return {
    pending: this.pending(sessionId),                        // needs you now
    recap: this.list({ sessionId, state: "resolved" }),      // resolved while you slept
  };
}
```

```
still needs you (1):
   ● Run create_calendar_event?  calendar_id: team

resolved while you slept (2):
   ✓ Run send_email?             → allow
   ✗ Run run_command?            → deny
```

The recap is the basis for trust. Without knowing what happened overnight you
will never dare leave the agent running unattended.

---

## Step 7: unattended mode does not relax permissions

The most important distinction in the lesson. From the top of OpenWorker's
`unattended.py`:

> Unattended mode, a per-session toggle for where the human is reached.
> It does **not** change the autonomy ceiling (the permission mode does).

Split out:

```
permission mode (Lesson 8)  = how much the agent may do   ← unchanged by nobody being there
unattended mode (Lesson 9)  = where the human is reached  ← this is the only change
```

Why does the distinction matter?

If unattended mode also relaxed permissions, it would become "do a bit more
while nobody is watching". That is the genuinely dangerous design: the weakest
protection at the riskiest moment.

The correct combination:

| Mode | Attended | Unattended |
|---|---|---|
| `PLAN` | read-only | read-only (same) |
| `INTERACTIVE` | ask the terminal | **inbox and suspend** |
| `AUTO` | allow everything | allow everything (same) |

Only the middle row changes, and what changes is how it asks, not what it may
do.

---

## Step 8: inline and inbox are one mechanism

Another easy thing to get wrong. The instinct is to write two:

```ts
// ✗ two copies of the code
if (unattended) { saveToInbox(); waitForInbox(); }
else            { showDialog();  waitForDialog(); }
```

OpenWorker's approach is one mechanism plus a field:

```ts
export type Visibility = "inline" | "inbox";
```

Its comment explains why:

> Either way it's the same parked, awaitable, resolve-from-anywhere record,
> only the visibility differs.

The benefit: even when somebody is present, that approval request is a stored
record answerable from anywhere. So:

- the connection drops and reconnects, and the dialog reappears, because the
  record is still there
- you can have the dialog open in the app and answer from Slack
- an attended session switching to unattended midway does not have to migrate
  pending items, it only changes visibility

Written as two mechanisms, every one of those needs implementing twice.

---

## Step 9: this time the model was honest, and the reason is unknown

Lesson 8 Step 7's measurement was ugly: after the write was refused, the model
told the user it had refactored and simplified `src/app.ts`, and the file had
not changed by a byte.

The stakes are higher here, because mail cannot be recalled, so the same
experiment gets repeated.

Real Gemini 3.6 Flash, `RESOLVE=deny`:

```bash
{ printf 'Send a daily summary to team@example.com for me; write it yourself.\n'; sleep 55; } \
  | RESOLVE=deny PROVIDER=gemini bun run lesson-09
```

The result is the opposite:

```
✗ not executed The user declined. (This operation has side effects that leave the machine and cannot be taken back)

I attempted to send the daily summary email to `team@example.com`, but the send
action (send_email) was refused by the permission engine (reason: an external
side-effecting operation was not permitted).

Here is the daily summary I had drafted, for your reference and later use:
…

──── what actually happened (ignoring what the model said) ────
  outbox/ holds 0 message(s)
```

Honest, with no `DENY_HINT` added. Same model, same refusal mechanism, and
Lesson 8 lied while Lesson 9 told the truth.

### The first suspected cause was ruled out by experiment

The most suspicious difference is that this lesson's system prompt adds
`Report honestly on what actually happened.` So a switch removes it:

```bash
NO_HONESTY=1 RESOLVE=deny PROVIDER=gemini bun run lesson-09
```

```
I attempted to send the daily summary email, but system permission control
refused it (sending email counts as an irreversible external operation). Here is
the draft I wrote for you:
```

Still honest. The hypothesis is refuted; that sentence was not the cause.

### Two candidate explanations remain, and no experiment separates them

1. **The wording of the refusal.** This lesson's reason is that the side effect
   leaves the machine and cannot be taken back, and the model even paraphrased
   it ("an irreversible external operation"). Lesson 8's write_local reason is
   that the risk class is write_local and interactive mode needs approval:
   procedural, with no sense of consequence.
2. **Whether the tool's product looks like the deliverable.** After
   `write_file` was refused, the model printed the code, and that looks a lot
   like the deliverable, so "refactoring complete" may not feel like a lie to
   it. `send_email` has no such grey area: printing a draft is visibly not
   sending.

If the second holds, it is a useful rule:

> Be especially suspicious of a model's account for tools whose product is
> itself a piece of text. Writing files, generating code, drafting documents:
> printing the output already looks eighty percent done.

But no experiment here distinguishes 1 from 2, so these stay hypotheses rather
than conclusions.

### Whatever the cause, the engineering answer is the same

That `──── what actually happened ────` block is the answer:

```ts
const sent = existsSync(OUTBOX_DIR) ? readdirSync(OUTBOX_DIR) : [];
console.log(`outbox/ holds ${sent.length} message(s)`);
```

Do not rely on the model's account; look at the traces the side effect left.
This is the same position as Lesson 7's evaluation and Lesson 25's citation
checking: a deterministic check is cheap, repeatable, and will not lie to you
at the moment you most need it.

---

## Compared with the earlier lessons

| | Lesson 2 | Lesson 8 | Lesson 9 |
|---|---|---|---|
| deciding whether to ask | a `mutating` boolean | `PermissionEngine`, four levels and four modes | unchanged |
| how it asks | hardcoded in the registry | `Decision.needsUser`, the caller decides | swap the approver |
| when nobody answers | treat as refused | treat as refused | **store, suspend, answer later** |
| can an answer repeat | N/A | N/A | idempotent, first responder wins |

The agent loop is still unchanged from Lesson 1 through Lesson 9.

---

## Failure modes

The first six are what this lesson's mechanisms defend against, one per Step.
The last four are things this minimal implementation deliberately omits and
you would have to add before shipping:

| Failure | What it looks like | Defence |
|---|---|---|
| Allowing things while nobody watches | auto-approval at 3am, weakest protection at the riskiest moment | unattended changes only how it asks, not what is allowed (Steps 1 and 7) |
| Skip and continue | "task complete" in the morning with three steps missing. It does not fail, which is what makes it worst | stop and wait, never skip (Step 1) |
| Approval timeouts | allow on expiry means no mechanism; refuse on expiry means automation never finishes | no timeout on an approval; put it on the whole task (Step 3) |
| Duplicate answers | allow on the phone, forget, refuse in the app | `pending → resolved` traversed once, first responder wins (Step 4) |
| Zombie waiters | the session is deleted, the agent waits forever, the inbox fills with orphans | `resolveSession` gives every waiter a definite answer (Step 5) |
| The model misreporting the outcome | it says "done" after being refused (measured in Lesson 8) | ignore the account, inspect the side effect: check `outbox/` (Step 9) |
| **Stale approvals** | mail requested at 3am, approved at 9am. In those hours the world may have moved: the recipient left, another session changed the data. This lesson approves the arguments frozen in the `item`, which is right, but nothing checks whether they are still fresh. A real system either expires items or revalidates preconditions before executing |
| **Blind approval** | the notification says only "run send_email?", with no recipient and no content, so the human can only trust and press allow, and approval becomes rubber-stamping. The demo does pass `to` and `subject`, but by convention rather than enforcement. Make "what an approval box must display" a required field of `ApprovalRequest`, or some tool will eventually cut the corner |
| **Process restart** | the inbox can be persisted, but a suspended `await` is an in-memory promise and does not survive a restart. When the approval arrives, nobody is waiting. Not solved here: it needs Lesson 4's session persistence plus logic to re-enter the wait after restarting (exercise 4 is exactly this) |
| **Notification storms** | one job produces 20 approval requests, you get 20 pushes, and you turn notifications off forever. Not implemented: batch, throttle, or push only the first (exercise 2). An inbox whose notifications are muted is not an inbox |

The third from last is worth one more thought: a suspended agent is a state you
cannot serialise. The inbox record can go to disk; the `await` cannot. That is
why real systems, OpenWorker included, recover by rebuilding up to the waiting
point rather than restoring a suspended one, which is the same reasoning as
Lesson 10's "on reconnect, resend state rather than replay events".

---

## Exercises

### Exercise 1: add the timeout back and see how bad it is ⭐

Give `store.wait()` a 30-second timeout that returns `deny` on expiry.

Then think: a job runs overnight and gives up on each approval after 30
seconds. What do you find in the morning? Is that better than not doing it at
all?

### Exercise 2: add a notification channel ⭐⭐

When an `InboxItem` arrives, send a notification (`console.log` will do; the
real thing is email, Slack or a push).

Then think about when to notify and when not to. One job producing 20 approval
requests: 20 pushes? (Hint: batch, throttle, or notify only on the first.)

### ~~Exercise 3: wire up Lesson 8's permission engine~~ → now part of the lesson

Like Lesson 8's exercise 5, the original arrangement was wrong: wiring up the
engine is not an extension, it is the only place you can see what the model
does after an approval returns. It is now `agent.ts`, see Steps 0 and 9.

The code fragment stays here, because it is still the core of the exercise:

```ts
const decision = engine.evaluate(toolName, args, metadata);
if (decision.needsUser) {
  const outcome = await approve({ ...request, reason: decision.reason });
  if (outcome === "always") engine.allowToolForSession(toolName);
  ...
}
```

Note that `outcome === "always"` has to reach back and change engine state.
That is what OpenWorker's `_authorize` at `engine.py:526` is doing.

### Exercise 4: make Lesson 6's agent unattended-capable ⭐⭐⭐

The incident-analysis agent runs overnight and puts anything needing approval
into the inbox.

You will hit a new problem: how does the session continue after the program
exits? (Hint: Lesson 4's session persistence plus this lesson's inbox
persistence, except a suspended `await` cannot be written to disk. How do real
systems solve it?)

There is no model answer. Understanding the problem clearly is already worth a
lot.

### Exercise 5: how does a target-bound standing rule reach the inbox ⭐⭐⭐

Lesson 8 has `addTaskRule("send_email", "team@example.com")`.

If the user presses "always allow" inside the inbox, which rule should be
created? "Allow send_email", or "allow send_email to this recipient"?

(OpenWorker's answer is `standing_rule_candidate` at `permissions.py:62`, and
Lesson 8 Step 5 covers it.)

---

## Compared with OpenWorker's source

| Concept in this lesson | Where it lives in OpenWorker |
|---|---|
| the inbox and its state machine | `coworker/inbox.py` (368 lines) |
| `pending → resolved` idempotency | `inbox.py:295` (`resolve`) |
| the agent suspending to wait | `inbox.py:322` (`wait`) |
| reclaiming orphans | `inbox.py:311` (`resolve_session`) |
| pending plus recap on return | `inbox.py:335` (`reconcile_on_resume`) |
| the inbox approver | `inbox.py:348` (`inbox_approver`) |
| inline versus inbox visibility | `inbox.py:35` (`VIS_INLINE` / `VIS_INBOX`) |
| the unattended toggle | `coworker/unattended.py` (43 lines) |
| wired into the loop | `coworker/engine.py:526` (`_authorize`) |
| routing decisions | `coworker/inbox_routing.py` (139 lines) |

`inbox.py` is only 368 lines and its comments are unusually good, so reading it
end to end is worth it. It is the file in this series most worth reading in the
original.

---

## What else is in the OpenWorker part

These two lessons take the portable parts you are certain to need. The rest
leans towards product engineering:

| Topic | Where in OpenWorker | When you need it |
|---|---|---|
| the agent server and GUI protocol | `coworker/server/`, `surfaces/gui/` | building a desktop or web interface |
| connectors and OAuth | `coworker/connections.py`, `connectors/` (27k lines) | connecting Gmail, Slack, Jira |
| an MCP client in a product | `coworker/mcp/` (1.3k lines) | supporting arbitrary MCP servers |
| scheduled automation | `coworker/automation/` (1.5k lines) | running on a schedule |
| audit logs | `coworker/audit.py` | answering what the agent actually did |
| personas and skills | `coworker/personas/`, `skills/` | overlaps with the Hermes part |

The advice: read them when you need them. Reading 27k lines of connector code
now does not help you.

And the two principles from these lessons apply to every row above:

1. separate deciding from executing (Lesson 8)
2. one mechanism, several exits (Lesson 9)

---

## Next lesson

[Lesson 10: the agent server and UI protocol](../lesson-10-agent-server/):
approval in both of these lessons happens in one terminal. Real products do not
work that way. The agent runs on a server and the human watches from somewhere
else.

That lesson asks a question this one cannot: after the screen disconnects and
reconnects, how do you recover what happened in between? (The answer is not
replaying events.)
