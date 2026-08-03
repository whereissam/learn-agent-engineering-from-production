/**
 * The permission engine.
 *
 * The most important sentence about this file comes from OpenWorker's
 * permissions.py docstring:
 *
 *   > The engine only *decides*; the turn engine routes `needs_user` decisions
 *   > to a surface for approval and records the outcome.
 *
 * The engine decides. It does not ask.
 *
 * Lesson 2 mixed those together: the registry saw `mutating` and called
 * ctx.approve() on the spot, welding the decision to one way of asking.
 *
 * Splitting them buys three things:
 *   - one rule set, asked at a terminal, in a GUI dialog, or parked in an
 *     inbox when nobody is there
 *   - decisions testable on their own, with no fake user to mock
 *   - decisions recordable in an audit log: what was allowed, under which rule
 *
 * Lesson 9 rests entirely on that split. Unattended mode changes where the
 * question goes and touches nothing in here.
 *
 * Source: openworker/coworker/permissions.py
 */

import { isAbsolute, relative, resolve } from "node:path";
import { classify, isConsequential, RiskClass, type RiskOverrides, type ToolRiskMetadata } from "./risk.ts";

/**
 * The mode sets the ceiling on autonomy.
 *
 * Mode and risk are independent dimensions:
 *   risk  how dangerous this operation is    (a property of the tool)
 *   mode  how much autonomy the user grants  (a property of the session)
 *
 * A decision is the intersection of the two.
 */
export enum Mode {
	/** Read-only. Anything with a side effect is denied outright, never asked. */
	PLAN = "plan",

	/** The default. Reads pass, everything else asks. */
	INTERACTIVE = "interactive",

	/** Everything passes. Note that path limits still apply; see evaluate below. */
	AUTO = "auto",

	/** interactive, plus tools the config file auto-allows. */
	CUSTOM = "custom",
}

/** Read-only modes. A constant because OpenWorker has two of them (discuss / plan). */
const READ_ONLY_MODES = new Set<Mode>([Mode.PLAN]);

/**
 * A decision. It is data, not an action.
 *
 * `reason` is not a debug string. It goes into the audit log, and it is shown
 * in the approval prompt so the user knows why they are being asked.
 */
export interface Decision {
	allowed: boolean;
	reason: string;
	/** true = the engine cannot decide alone; ask a human. */
	needsUser: boolean;
	/** If a standing rule allowed it, which one. */
	rule?: string;
}

/** A root directory. `writable` is separate because you may want the agent to read a directory but not change it. */
export interface Root {
	path: string;
	writable: boolean;
}

export interface PermissionEngineOptions {
	workspaceRoot: string;
	mode?: Mode;
	/** Command prefixes that need no approval, e.g. "git status", "ls". */
	allowedCommands?: string[];
	/** Tools auto-allowed in CUSTOM mode. */
	autoAllowTools?: string[];
	/** Multiple roots. Omitted means only workspaceRoot is writable. */
	roots?: Root[];
	riskOverrides?: RiskOverrides;
}

/**
 * Shell metacharacters, which turn one allowed command into several.
 *
 * This is exercise 5 of Lesson 2, and OpenWorker actually does it.
 *
 * Why it matters: put "ls" on the allowlist and the model sends
 *
 *   ls; rm -rf ~
 *
 * The prefix check passes (it does start with "ls") while two commands run.
 * Any metacharacter cancels the auto-allow and falls back to asking.
 *
 * Covers chaining (; & && ||), pipes (|), redirection (> <),
 * command substitution (` $(), grouping ((), and newlines.
 */
const SHELL_OPERATORS = [";", "&", "|", ">", "<", "`", "$(", "(", "\n", "\r"];

export function hasShellOperators(command: string): boolean {
	return SHELL_OPERATORS.some((op) => command.includes(op));
}

export class PermissionEngine {
	readonly workspaceRoot: string;
	mode: Mode;

	private readonly allowedCommands: string[];
	private readonly autoAllowTools: Set<string>;
	private readonly riskOverrides?: RiskOverrides;
	private roots: Root[];

	/** Tools and commands the user chose "always allow" for, this session. */
	private readonly sessionAllowTools = new Set<string>();
	private readonly sessionAllowCommands = new Set<string>();

	/**
	 * Task-level standing rules: { tool: allowed targets }.
	 *
	 * Unlike sessionAllowTools, these are bound to a specific target.
	 * "Allow send_email" is dangerous; "allow send_email to team@example.com"
	 * is not. Lesson 9 uses this.
	 */
	private readonly taskRules = new Map<string, Set<string>>();

	constructor(options: PermissionEngineOptions) {
		this.workspaceRoot = resolve(options.workspaceRoot);
		this.mode = options.mode ?? Mode.INTERACTIVE;
		this.allowedCommands = options.allowedCommands ?? [];
		this.autoAllowTools = new Set(options.autoAllowTools ?? []);
		this.riskOverrides = options.riskOverrides;
		this.roots = options.roots ?? [{ path: this.workspaceRoot, writable: true }];
	}

	/**
	 * Decide what to do with one tool call.
	 *
	 * The order of the checks is deliberate; each one narrows the field. Get
	 * the order wrong and you have a security hole, so every block below says
	 * why it sits where it does.
	 */
	evaluate(
		toolName: string,
		args: Record<string, unknown>,
		metadata?: ToolRiskMetadata,
	): Decision {
		const risk = classify(toolName, metadata, this.riskOverrides);
		const consequential = isConsequential(risk);
		const isConnector = metadata?.category === "connector";

		// ── 1. Read-only mode ──────────────────────────────
		// Checked first. The user said look-but-do-not-touch; no exceptions.
		if (READ_ONLY_MODES.has(this.mode) && consequential) {
			return {
				allowed: false,
				reason: `${this.mode} mode is read-only`,
				needsUser: false, // Not "go ask"; a flat refusal.
			};
		}

		// ── 2. Path limits ─────────────────────────────────
		//
		// This sits before the AUTO check on purpose.
		//
		// AUTO means "stop asking me", not "help yourself to the machine".
		// A sandbox boundary must not be reachable through an autonomy setting.
		if (risk === RiskClass.WRITE_LOCAL) {
			const path = args.path;
			if (typeof path === "string" && !this.underWritableRoot(path)) {
				return {
					allowed: false,
					reason: `Path is outside the writable directory: ${path}`,
					needsUser: false, // A hard boundary: asking must not unlock it.
				};
			}
		}

		// ── 3. Pure reads ──────────────────────────────────
		if (!consequential) {
			return { allowed: true, reason: "low risk", needsUser: false };
		}

		// ── 4. AUTO mode ───────────────────────────────────
		// Reaching here means the path check already passed.
		if (this.mode === Mode.AUTO) {
			return { allowed: true, reason: "full access", needsUser: false };
		}

		// ── 5. Command allowlist ───────────────────────────
		if (risk === RiskClass.EXEC) {
			const command = String(args.command ?? "");
			if (this.commandAllowed(command)) {
				return { allowed: true, reason: "command is on the allowlist", needsUser: false };
			}
			if (command && this.sessionAllowCommands.has(command)) {
				return { allowed: true, reason: "command already allowed this session", needsUser: false };
			}
		}

		// ── 6. Tools allowed for this session ──────────────
		//
		// Note `!isConnector`: connector tools (Slack, Gmail, ...) cannot be
		// unlocked by "always allow this tool".
		//
		// "Allow send_slack_message" means allow messages to any channel.
		// The user pressing "always" meant that channel, not the whole company.
		if (this.sessionAllowTools.has(toolName) && !isConnector) {
			return { allowed: true, reason: "tool already allowed this session", needsUser: false };
		}

		// ── 7. Target-bound standing rules ─────────────────
		//
		// Connectors are deliberately not excluded here: the rule is pinned
		// to one target, and that pinning is what makes it safe.
		const targets = this.taskRules.get(toolName);
		if (targets) {
			const target = standingRuleTarget(toolName, args, metadata, this.riskOverrides);
			if (target && targets.has(target)) {
				const rule = `${toolName} → ${target}`;
				return { allowed: true, reason: `matches a saved rule: ${rule}`, needsUser: false, rule };
			}
		}

		// ── 8. CUSTOM mode config ──────────────────────────
		if (this.mode === Mode.CUSTOM && this.autoAllowTools.has(toolName)) {
			return { allowed: true, reason: "auto-allowed by config", needsUser: false };
		}

		// ── 9. Nothing matched → ask ───────────────────────
		//
		// The reason must say why. "Approval required" is not a reason.
		//
		// This came out of wiring the engine into a real agent loop
		// (Lesson 8's agent.ts): the denial text is the model's only channel for
		// finding out what happened. It cannot see your config file or the red
		// ✗ in the terminal. Told only "approval required" it cannot work out
		//
		// which approach would be accepted, so it guesses — and guessing looks
		return { allowed: false, reason: this.whyAsk(toolName, args, risk), needsUser: true };
	}

	/** Why this call needs a human. Read by the model and by the approval box. */
	private whyAsk(toolName: string, args: Record<string, unknown>, risk: RiskClass): string {
		if (risk === RiskClass.EXEC) {
			const command = String(args.command ?? "");
			// Prefix fooled the allowlist but metacharacters are present. Worth
			// spelling out: the model may be trying to slip past the list (Lesson 8 Step 4).
			if (hasShellOperators(command) && this.prefixAllowed(command)) {
				return "The command starts with an allowlisted binary but contains shell metacharacters, which means it can run a second command";
			}
			return `Command is not on the allowlist: ${this.allowedCommands.join(" / ") || "(the list is empty)"}`;
		}
		if (risk === RiskClass.EXTERNAL) {
			return "This operation has side effects that leave the machine and cannot be taken back";
		}
		return `Risk level ${risk}; ${this.mode} mode requires user approval`;
	}

	// ── session / task memory ────────────────────────────

	allowToolForSession(toolName: string): void {
		this.sessionAllowTools.add(toolName);
	}

	allowCommandForSession(command: string): void {
		if (command) this.sessionAllowCommands.add(command);
	}

	/** Add a target-bound standing rule. */
	addTaskRule(toolName: string, target: string): void {
		const existing = this.taskRules.get(toolName) ?? new Set<string>();
		existing.add(target);
		this.taskRules.set(toolName, existing);
	}

	setRoots(roots: Root[]): void {
		this.roots = roots;
	}

	// ── internals ────────────────────────────────────────

	private commandAllowed(command: string): boolean {
		const trimmed = command.trim();
		if (!trimmed) return false;

		// Metacharacters block the auto-allow, however clean the prefix.
		if (hasShellOperators(trimmed)) return false;

		return this.prefixAllowed(trimmed);
	}

	/**
	 * Prefix only; metacharacters not considered.
	 *
	 * Split out so `whyAsk` can tell two refusals apart: "this command is not
	 * on the list at all" versus "the prefix is on the list but
	 * metacharacters break it". To the model those are different messages.
	 */
	private prefixAllowed(command: string): boolean {
		const trimmed = command.trim();
		return this.allowedCommands.some(
			(prefix) => trimmed === prefix || trimmed.startsWith(`${prefix} `),
		);
	}

	private underWritableRoot(path: string): boolean {
		const candidate = isAbsolute(path) ? resolve(path) : resolve(this.workspaceRoot, path);
		return this.roots.some((root) => {
			if (!root.writable) return false;
			const rel = relative(resolve(root.path), candidate);
			// Empty = the directory itself; leading .. = escaped outside it.
			return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
		});
	}
}

/**
 * Can this call become a target-bound standing rule?
 *
 * Three conditions, following OpenWorker's standing_rule_candidate:
 *   1. EXTERNAL risk only. exec and write_local always ask.
 *   2. the tool must have a "target" argument
 *   3. this call must actually name a target
 *
 * The reason for the first condition is practical: a shell command has no
 * target to bind to. "Allow run_command running X" is nearly as dangerous as
 * "allow run_command", because next time X can look completely different. So
 * shell keeps asking.
 */
const TARGET_ARG: Record<string, string> = {
	send_email: "to",
	post_slack_message: "channel",
	create_calendar_event: "calendar_id",
	create_github_issue: "repo",
};

export function standingRuleTarget(
	toolName: string,
	args: Record<string, unknown>,
	metadata?: ToolRiskMetadata,
	overrides?: RiskOverrides,
): string | undefined {
	if (classify(toolName, metadata, overrides) !== RiskClass.EXTERNAL) return undefined;

	const argName = TARGET_ARG[toolName];
	if (!argName) return undefined;

	const value = String(args[argName] ?? "").trim();
	return value || undefined;
}

export { RiskClass, classify, isConsequential };
export type { RiskOverrides, ToolRiskMetadata };
