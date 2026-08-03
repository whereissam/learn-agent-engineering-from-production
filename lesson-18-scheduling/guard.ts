/**
 * The class of job blocked at creation time: **one that kills the thing running the schedule**.
 *
 * Not a hypothetical threat but a real Hermes issue (`cron/lifecycle_guard.py`'s docstring
 * cites #30719), and its causal chain is worth reading in full:
 *
 *   the agent scheduled a "restart the gateway" job
 *   → the job fires and the gateway dies
 *   → the supervisor (launchd KeepAlive / systemd Restart=) revives it
 *   → auto-resume picks that session back up
 *   → that turn re-runs the same logic
 *   → it schedules again / restarts again… a round every ~10 seconds, until a human intervenes
 *
 * **Every link is a correct design on its own**: scheduling, a supervisor restarting a dead process,
 * resuming after an interruption — all three are features you want.
 * The loop is their **product**.
 *
 * ⚠️ Three judgements, two copied from the source and one measured here. All easy to get wrong:
 *
 * First, **the target must be named.** Matching bare English verbs ("restart", "stop")
 * blocks a legitimate request like "research Kong API gateway autoscaling and restart
 * behaviour for me". Every branch below requires `agentd` to appear.
 *
 * Second, **`start` is deliberately not blocked.** Starting the gateway from inside the gateway is harmless
 * (either a no-op or "already running"), and a legitimate job may need to start a different profile.
 * A guard that also blocks start produces inexplicable failures.
 *
 * Third — and this one cost a measured 0-of-3 — **matching command shape alone is not enough.**
 * The first version of this guard read the job prompt as if it were shell text, so it caught
 * `agentd restart` and missed everything else:
 *
 *     "agentd restart"                              blocked
 *     "restart agentd"                              **passed**   ← same words, other order
 *     "restart the agentd daemon so config reloads" **passed**
 *     "bounce agentd"                               **passed**
 *
 * A cron prompt is not handed to a shell. It is handed to **a future agent turn**, which will
 * turn the sentence into whatever command it likes. Reading it as shell text checks the one
 * form the model is least likely to write.
 *
 * > **A guard must parse its actual input, not the input it wishes it had.**
 * > This one sat in front of natural language and matched CLI syntax for as long as
 * > the model happened to emit CLI syntax.
 *
 * > **More things can be blocked than should be, which is exactly what makes a guard hard to write.**
 */

/**
 * Verbs that end the process. **`reload` and `start` are deliberately absent.**
 *
 * A reload (SIGHUP) re-reads config without the process dying, so it breaks no link in the
 * chain above — and blocking it is the same false positive as the `pkill -HUP agentd` one
 * this lesson already measured. Blocking what merely *sounds* dangerous is how a guard
 * loses the reader's trust.
 */
const KILLING_VERB =
	String.raw`(?:restarts?|restarting|relaunch(?:es|ing)?|reboots?|rebooting|bounce[sd]?|bouncing|respawns?|kickstarts?|terminates?|terminating|shut(?:s|ting)?\s*down|stops?|stopping|kills?|killing)`;

/**
 * The daemon itself, and **not a path or identifier that merely starts with its name.**
 *
 * Without the lookarounds, this lesson's own benign task — "clear old files out of
 * `/tmp/agentd-cache`, then stop" — is falsely blocked, because `\bagentd\b` happily
 * matches inside `agentd-cache`.
 */
const AGENTD = String.raw`(?<![\w/-])agentd(?![\w-])`;

/** In this lesson's workspace, "the thing running the schedule" is called agentd. */
const COMMAND_SHAPE_BRANCHES = [
	// A: restart / stop aimed straight at agentd — the classic one.
	String.raw`(?:agentd\s+(?:restart|stop))`,
	// B: launchctl against agentd's label. The agentd identifier must appear,
	//    or it would block unrelated services.
	String.raw`(?:launchctl\s+(?:kickstart|unload|load|stop|restart)\b[^\n]*\bagentd)`,
	// C: systemctl against agentd's unit.
	String.raw`(?:systemctl\s+(?:-\S+\s+)*(?:restart|stop|start)\b[^\n]*\bagentd)`,
	// D: pkill / kill against the process. Both word orders, because real cases show both.
	String.raw`(?:p?kill\b[^\n]*\bagentd)`,
	String.raw`(?:p?kill\b[^\n]*\bagent\b[^\n]*\bd(?:aemon)?\b)`,
];

// E: prose, both word orders. This is the branch that closes the recall hole.
//    The window is bounded so that two unrelated clauses in one long prompt
//    ("restart the build box; also tail agentd's log") do not join up by accident.
const PROSE_BRANCHES = [
	String.raw`(?:\b${KILLING_VERB}\b[^\n]{0,40}?${AGENTD})`,
	String.raw`(?:${AGENTD}[^\n]{0,40}?\b${KILLING_VERB}\b)`,
];

const LIFECYCLE_PATTERN = new RegExp([...COMMAND_SHAPE_BRANCHES, ...PROSE_BRANCHES].join("|"), "i");

export class LifecycleBlocked extends Error {
	constructor(message: string) {
		super(message);
		this.name = "LifecycleBlocked";
	}
}

export function containsLifecycleCommand(text: string): boolean {
	if (!text) return false;
	return LIFECYCLE_PATTERN.test(text);
}

/**
 * Branches A-D only: the guard as it was before the prose branch existed.
 *
 * **This is not a fallback and must never gate anything.** It exists so `agent.ts` can report
 * "what the shape-only matcher would have caught" in the same run as the real one, turning
 * the recall gap into a measured column instead of a claim in a README.
 *
 * Keeping a superseded rule around purely to measure its successor is cheap here and worth
 * the habit: without it, "we closed a recall hole" is untestable once the hole is closed.
 */
const SHAPE_ONLY_PATTERN = new RegExp(COMMAND_SHAPE_BRANCHES.join("|"), "i");

export function matchesCommandShapeOnly(text: string): boolean {
	if (!text) return false;
	return SHAPE_ONLY_PATTERN.test(text);
}

/**
 * Checked before a job is created. The prompt and the script **must be read together**,
 * or splitting the command in two gets around it.
 */
export function checkLifecycle(prompt: string, script?: string): void {
	const combined = script ? `${prompt}\n${script}` : prompt;
	if (!containsLifecycleCommand(combined)) return;

	// The error message must state **why** and **what to do instead**.
	// This text becomes the tool result back in the model's hands (Lesson 8's lesson:
	// it is the model's only source of information); "not allowed" alone just makes it rephrase and retry.
	throw new LifecycleBlocked(
		"Blocked: this scheduled job contains a command that stops or restarts " +
			"the agent daemon (agentd). Scheduling it would create a restart loop: " +
			"the job kills the daemon, the supervisor revives it, auto-resume replays " +
			"the same turn, and the job fires again. " +
			"If you need to restart the daemon, do it from a shell outside it — " +
			"a scheduled job is never the right place.",
	);
}
