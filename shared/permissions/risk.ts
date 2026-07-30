/**
 * Risk classes.
 *
 * Lesson 2 decided whether to ask the user with one boolean:
 *
 *   readonly mutating: boolean;
 *
 * Too coarse. Writing a file into the working directory and emailing a
 * customer are both mutating, but one is reversible and the other is not.
 *
 * OpenWorker replaces that boolean with four levels, and the first line of
 * its risk.py docstring names the design shift:
 *
 *   > This replaces the hardcoded WRITE_TOOLS / SHELL_TOOL name sets the
 *   > permission engine used to carry inline: risk is now a declared property
 *   > a single classify reads.
 *
 * Risk moves from "a list hardcoded inside the permission engine" to "a
 * property the tool declares". Adding a tool no longer means editing the
 * engine, and the engine no longer has to recognise every tool.
 *
 * Source: openworker/coworker/risk.py
 */

/** Four levels. The order matters: later is more dangerous. */
export enum RiskClass {
	/** No side effects. Always allowed, never asks. */
	READ = "read",

	/** Changes something in the working directory. Reversible, but must stay inside the allowed paths. */
	WRITE_LOCAL = "write_local",

	/** Runs a command. You do not know what it will do, so ask. */
	EXEC = "exec",

	/**
	 * Side effects that leave the machine: email, messages, someone else's
	 * API, someone else's data.
	 *
	 * The most dangerous level, because it cannot be taken back. You can
	 * restore a file; you cannot unsend a mail.
	 *
	 * Lesson 9 uses one more property of this level: it decides whether an
	 * unattended run must stop and wait for a human.
	 */
	EXTERNAL = "external",
}

/** A tool may declare its own risk. Without it, the rules below infer one. */
export interface ToolRiskMetadata {
	/** Declared by the tool. Wins over inference. */
	risk?: RiskClass;
	/** Generic flag, e.g. carried by MCP tools. True means treat as EXTERNAL. */
	requiresApproval?: boolean;
	/** Tool category, e.g. "connector". Feeds Lesson 9's standing rules. */
	category?: string;
}

/**
 * Local overrides by the user.
 *
 * Needed because a default has to be conservative, and a conservative
 * default is annoying. MCP tools all default to EXTERNAL (you cannot know
 * what they do), but a user with one read-only MCP tool should not have to
 * approve it every single time.
 *
 * Overrides let the user say "I trust this one" without changing defaults.
 */
export type RiskOverrides = (toolName: string) => RiskClass | undefined;

/**
 * Fixed classes for the built-in tools.
 *
 * This is data, not ifs scattered through the codebase. To find out which
 * tools write files, read the table.
 */
const BASE: Record<string, RiskClass> = {
	// Read-only
	read_file: RiskClass.READ,
	list_files: RiskClass.READ,
	grep: RiskClass.READ,

	// Touches local files
	write_file: RiskClass.WRITE_LOCAL,
	edit_file: RiskClass.WRITE_LOCAL,
	delete_file: RiskClass.WRITE_LOCAL,

	// Runs commands
	run_command: RiskClass.EXEC,

	// Side effects leave the machine
	send_email: RiskClass.EXTERNAL,
	post_slack_message: RiskClass.EXTERNAL,
	create_calendar_event: RiskClass.EXTERNAL,
	create_github_issue: RiskClass.EXTERNAL,
};

/**
 * The effective risk of one tool call.
 *
 * Precedence, matching OpenWorker's classify:
 *   1. the user's local override
 *   2. the built-in name table
 *   3. what the tool's metadata declares
 *   4. metadata.requiresApproval → EXTERNAL
 *   5. nothing → READ
 *
 * That last line is worth arguing about. Defaulting to READ means
 * defaulting to allowed, which looks like it contradicts Lesson 2's
 * default-deny. The two defaults answer different questions:
 *
 *   here      how dangerous is this tool? unknown → assume harmless
 *   Lesson 2  what if the user never answers? unknown → assume denied
 *
 * If your tool set includes untrusted sources (arbitrary MCP servers, say),
 * change the last line to EXTERNAL. OpenWorker does exactly that, via
 * metadata.requiresApproval.
 */
export function classify(
	toolName: string,
	metadata?: ToolRiskMetadata,
	overrides?: RiskOverrides,
): RiskClass {
	const override = overrides?.(toolName);
	if (override !== undefined) return override;

	const base = BASE[toolName];
	if (base !== undefined) return base;

	if (metadata?.risk !== undefined) return metadata.risk;
	if (metadata?.requiresApproval) return RiskClass.EXTERNAL;

	return RiskClass.READ;
}

/**
 * Anything but a pure read needs the permission engine to look at it.
 *
 * A small function so callers do not have to remember "everything except
 * READ gets checked".
 */
export function isConsequential(risk: RiskClass): boolean {
	return risk !== RiskClass.READ;
}

/** Register a risk class for one tool (for your own domain tools). */
export function declareRisk(toolName: string, risk: RiskClass): void {
	BASE[toolName] = risk;
}
