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
 * ⚠️ Two judgements copied from the source, both easy to get wrong:
 *
 * First, **match on command shape, not keywords.**
 * A cron prompt is fed to a model, not to a shell. Matching English substrings
 * ("restart", "gateway") blocks a legitimate request like "research Kong API gateway
 * autoscaling and restart behaviour for me", and **fails to block the real one**.
 *
 * Second, **`start` is deliberately not blocked.** Starting the gateway from inside the gateway is harmless
 * (either a no-op or "already running"), and a legitimate job may need to start a different profile.
 * A guard that also blocks start produces inexplicable failures.
 *
 * > **More things can be blocked than should be, which is exactly what makes a guard hard to write.**
 */

/** In this lesson's workspace, "the thing running the schedule" is called agentd. */
const LIFECYCLE_PATTERN = new RegExp(
	[
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
	].join("|"),
	"i",
);

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
