/**
 * A minimal macOS sandbox, in the shape Anthropic's sandbox-runtime uses.
 *
 * Lesson 8's permission engine answers "may this command run".
 * This file answers the question that begins **after** the answer is yes:
 * once the command is running, what can that process reach?
 *
 * The whole mechanism is one binary that macOS already ships:
 *
 *     /usr/bin/sandbox-exec -p <profile> /bin/bash -c <command>
 *
 * `<profile>` is a Seatbelt (SBPL) policy — an s-expression list of allow and
 * deny rules the kernel enforces on every syscall the process makes. There is
 * nothing to install and nothing to daemonise; the rules are handed to the
 * kernel at exec time and cannot be revoked, argued with, or prompted around by
 * the process they govern.
 *
 * Source: `sandbox-runtime/src/sandbox/macos-sandbox-utils.ts` (1090 lines,
 * commit 295f0e1). Everything here is a shrunk version of something in that
 * file, and each shrink is named where it happens.
 *
 * ⚠️ `sandbox-exec` has been marked deprecated in its own man page for years and
 * is still what macOS itself uses everywhere. Treat that the way SRT does: it is
 * the only local primitive available, so use it and keep a second line of
 * defence.
 */

import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

/**
 * Read restrictions, **deny-then-allow**.
 *
 * Everything on the disk is readable by default. You deny a broad region and
 * then allow specific paths back inside it, and the allow wins.
 *
 * Mirrors `FsReadRestrictionConfig` (`sandbox-schemas.ts:16`), whose fields are
 * called `denyOnly` / `allowWithinDeny` — the names alone say the shape.
 */
export interface ReadRules {
	deny: string[];
	/** Allowed back inside a denied region. Beats `deny`. */
	allowBack?: string[];
}

/**
 * Write restrictions, **allow-only**.
 *
 * Nothing is writable by default. Only listed paths open, minus exceptions.
 *
 * Mirrors `FsWriteRestrictionConfig` (`sandbox-schemas.ts:33`): `allowOnly` /
 * `denyWithinAllow`.
 *
 * **The precedence is the opposite way round from reads, and both are right.**
 * Read Step 2 of the README before you decide that is an inconsistency worth
 * tidying up.
 */
export interface WriteRules {
	allow: string[];
	/** Denied back inside an allowed region. Beats `allow`. */
	denyBack?: string[];
}

export interface SandboxConfig {
	read?: ReadRules;
	write?: WriteRules;

	/** No rule at all = no network. This is allow-only like writes. */
	network?: {
		/** Everything. Only useful as a control. */
		all?: boolean;
		/** Loopback ports the process may connect to and bind. */
		localPorts?: number[];
	};

	/**
	 * Emit the rules that stop `mv` being used to walk a file out of a denied
	 * region into a readable one (`macos-sandbox-utils.ts:150`).
	 *
	 * Switch it off and the demo's scenario 7 prints the secret. This is the
	 * mechanism most worth switching off in this lesson, because the hole it
	 * leaves is not a missing rule — it is a rule that looks complete.
	 *
	 * Default on.
	 */
	blockMoves?: boolean;

	/**
	 * Emit the mandatory write denies — `.zshrc`, `.git/hooks`, `.mcp.json` and
	 * friends (`sandbox-utils.ts:11`, `macGetMandatoryDenyPatterns` at
	 * `macos-sandbox-utils.ts:66`).
	 *
	 * These are denied **inside** whatever you allowed, because "the agent may
	 * write to its project" and "the agent may write the file that runs next
	 * time a shell opens" have to be different permissions.
	 *
	 * Default on.
	 */
	mandatoryDenies?: boolean;

	/**
	 * **Not in SRT.** Also deny *writes* to any read-denied path that happens to
	 * sit inside a write-allowed root.
	 *
	 * SRT builds `denyWithinAllow` from `filesystem.denyWrite` alone
	 * (`sandbox-manager.ts:1071-1086`), so a path listed only in `denyRead` and
	 * living inside an `allowWrite` root can still be renamed — and reading a
	 * file you have moved is not a read of the denied path any more. Step 6 of
	 * the README measures it both ways.
	 *
	 * Default on, i.e. this port is deliberately stricter than its source. Turn
	 * it off to get SRT's behaviour back.
	 */
	sealReadDenies?: boolean;
}

/**
 * Files that must not be writable even inside an allowed directory, because
 * writing them is deferred code execution.
 *
 * Copied from `sandbox-utils.ts:11` (`DANGEROUS_FILES`). Not exhaustive and not
 * claimed to be — the interesting property is that every entry is a file whose
 * *contents get executed by something else later*, not a file that is secret.
 */
export const DANGEROUS_FILES = [
	".gitconfig",
	".gitmodules",
	".bashrc",
	".bash_profile",
	".zshrc",
	".zprofile",
	".profile",
	".ripgreprc",
	".mcp.json",
] as const;

/** Directories with the same property. `.git/hooks` is the sharp one. */
export const DANGEROUS_DIRECTORIES = [".git/hooks", ".vscode", ".idea"] as const;

// ─────────────────────────────────────────────────────────────
// Building the profile
// ─────────────────────────────────────────────────────────────

/**
 * Turn a glob into an SBPL regex, which is what a Seatbelt `(regex …)` filter
 * takes. A shrunk `globToRegex` (`sandbox-utils.ts:784`); this version
 * understands a doubled star followed by a slash, a bare doubled star, and a
 * single star.
 *
 * SRT does this with placeholder substrings and three passes. One pass over the
 * characters is both shorter and immune to the failure that cost an hour here:
 * a placeholder that survives into the output produces a regex matching
 * nothing, and **a rule that matches nothing looks exactly like a rule that
 * matched and allowed**. The first version emitted a deny whose regex could
 * never fire, and the demo printed `appended` with that deny sitting in the
 * profile four lines above. Design principle 7, inside the sandbox itself.
 */
export function globToRegex(pattern: string): string {
	let out = "^";
	for (let i = 0; i < pattern.length; i++) {
		const char = pattern[i] as string;
		if (char === "*" && pattern[i + 1] === "*") {
			if (pattern[i + 2] === "/") {
				out += "(.*/)?"; // zero or more directories
				i += 2;
			} else {
				out += ".*"; // anything, slashes included
				i += 1;
			}
		} else if (char === "*") {
			out += "[^/]*"; // anything within one path segment
		} else if (".^$+?{}()|[]\\".includes(char)) {
			out += `\\${char}`;
		} else {
			out += char;
		}
	}
	return `${out}$`;
}

const hasGlob = (pattern: string): boolean => /[*?[\]]/.test(pattern);

/**
 * Absolute, symlink-resolved paths only.
 *
 * This line is not tidiness. On macOS `/tmp` is a symlink to `/private/tmp`, and
 * the kernel matches on the **resolved** path: a rule written about `/tmp`
 * matches nothing at all, silently. A shrunk `normalizePathForSandbox`
 * (`sandbox-utils.ts:314`).
 */
export function normalizePath(pattern: string, cwd = process.cwd()): string {
	const absolute = isAbsolute(pattern) ? pattern : resolve(cwd, pattern);
	if (hasGlob(absolute)) return absolute;
	try {
		return realpathSync(absolute);
	} catch {
		// The path does not exist yet. A rule about it is still worth emitting —
		// a deny on a not-yet-created path is exactly how you stop it being
		// created.
		return absolute;
	}
}

const quote = (value: string): string => JSON.stringify(value);

/** `(op (subpath …))` for a literal path, `(op (regex …))` for a glob. */
function filter(pattern: string): string {
	return hasGlob(pattern)
		? `(regex ${quote(globToRegex(pattern))})`
		: `(subpath ${quote(pattern)})`;
}

/**
 * The rules that stop `mv` from relocating a protected file.
 *
 * A shrunk `generateMoveBlockingRules` (`macos-sandbox-utils.ts:150`). SRT also
 * walks every ancestor directory, to stop the *parent* being renamed out from
 * under the rule; this version blocks the path itself, which is enough for the
 * demo and is stated as a limit in the README rather than pretended away.
 */
function moveBlockingRules(patterns: string[]): string[] {
	return patterns.flatMap((pattern) => [
		`(deny file-write-unlink ${filter(pattern)})`,
		`(deny file-write-create ${filter(pattern)})`,
	]);
}

/** Is `path` inside any of `roots`? Literal paths only; globs never match. */
function within(path: string, roots: string[]): boolean {
	if (hasGlob(path)) return false;
	return roots.some((root) => !hasGlob(root) && (path === root || path.startsWith(`${root}/`)));
}

function mandatoryDenyPatterns(): string[] {
	return [
		...DANGEROUS_FILES.map((name) => `**/${name}`),
		...DANGEROUS_DIRECTORIES.map((name) => `**/${name}/**`),
	];
}

/**
 * The profile itself.
 *
 * Exported separately from `run()` so it can be asserted on in a test without
 * spawning anything — a profile is a string, and a string is testable.
 */
export function buildProfile(config: SandboxConfig, cwd = process.cwd()): string {
	const {
		read,
		write,
		network,
		blockMoves = true,
		mandatoryDenies = true,
		sealReadDenies = true,
	} = config;

	const lines: string[] = [
		"(version 1)",
		"(deny default)",
		"",
		"; The floor. Without these the shell cannot even start:",
		"; process-fork missing gives `/bin/bash: fork: Operation not permitted`.",
		"(allow process-exec)",
		"(allow process-fork)",
		"(allow process-info* (target same-sandbox))",
		"(allow signal (target same-sandbox))",
		"(allow sysctl-read)",
		"(allow mach-lookup (global-name \"com.apple.system.opendirectoryd.libinfo\"))",
		"(allow file-ioctl (literal \"/dev/null\") (literal \"/dev/tty\"))",
		"",
	];

	// ── reads: allow everything, then carve out ──────────────
	//
	// The order of the next four sections is copied from SRT and is not
	// cosmetic. Seatbelt resolves conflicts by last match wins, so "which
	// section runs last" *is* the precedence rule. `generateSandboxProfile`
	// emits reads before writes (`macos-sandbox-utils.ts:753-759`) and its
	// comment at `:349` says so explicitly: the write section's re-denies have
	// to land after the read section's re-allows.
	lines.push("; Reads: deny-then-allow. Later rules win, so the allow-backs go last.");
	lines.push("(allow file-read*)");
	const readDenied = (read?.deny ?? []).map((p) => normalizePath(p, cwd));
	for (const pattern of readDenied) {
		lines.push(`(deny file-read* ${filter(pattern)})`);
	}
	const allowedBack = (read?.allowBack ?? []).map((p) => normalizePath(p, cwd));
	for (const pattern of allowedBack) {
		lines.push(`(allow file-read* ${filter(pattern)})`);
	}

	// Re-emit any deny that a broader allow-back has just swallowed.
	//
	// `deny /Users/me/project-parent` then `allow /Users/me/project-parent/ws`
	// re-opens `…/ws/.secrets`, because last match wins and the allow is last.
	// SRT emits exactly this fix and explains why at `macos-sandbox-utils.ts:310`.
	//
	// It was left out of the first version of this file and the hole was real: the
	// enclosing policy in `agent.ts` looked strictly stronger than the enumerating
	// one and was the only one of the two that leaked `.secrets/` to a plain `cat`.
	// Every individual rule in it was correct. **The order was the bug**, and
	// nothing about the config makes the order visible.
	for (const pattern of readDenied) {
		if (hasGlob(pattern)) continue; // nesting of regex-vs-subpath is not decidable here
		if (allowedBack.some((allowed) => pattern.startsWith(`${allowed}/`))) {
			lines.push(`(deny file-read* ${filter(pattern)})`);
		}
	}

	// Metadata on directories has to survive the deny, or `realpath()` cannot
	// walk through a denied directory to reach an allowed one below it and the
	// dynamic linker aborts before your command ever runs
	// (`macos-sandbox-utils.ts:327`).
	if (readDenied.length > 0) lines.push("(allow file-read-metadata (vnode-type DIRECTORY))");

	const writeAllowed = (write?.allow ?? []).map((p) => normalizePath(p, cwd));

	// A read deny that can be stepped around with `mv` is not a read deny: move
	// the file into a readable directory and read it there. Neither half of that
	// breaks a rule.
	if (blockMoves && readDenied.length > 0) {
		lines.push("");
		lines.push("; Moving a file is a way of reading it. Block the rename too.");
		lines.push(...moveBlockingRules(readDenied));

		// …but that just denied deletion inside the agent's own project, if the
		// denied region happens to sit there. So re-allow the two operations by
		// name for the write-allowed roots.
		//
		// This re-allow is necessary because a specific `(deny file-write-unlink)`
		// is **not** lifted by a later wildcard `(allow file-write*)` — measured,
		// README Step 4. It is also the exact line that opens the hole Step 6
		// measures, and SRT's comment at `:349` says which later section is meant
		// to close it again.
		for (const pattern of writeAllowed) {
			lines.push(`(allow file-write-unlink ${filter(pattern)})`);
			lines.push(`(allow file-write-create ${filter(pattern)})`);
		}
	}
	lines.push("");

	// ── writes: deny everything, then open ───────────────────
	lines.push("; Writes: allow-only. Nothing is writable until it is listed.");
	if (write === undefined) {
		lines.push("(allow file-write*)");
	} else {
		for (const pattern of writeAllowed) {
			lines.push(`(allow file-write* ${filter(pattern)})`);
		}

		const writeDenied = [
			...(write.denyBack ?? []).map((p) => normalizePath(p, cwd)),
			...(mandatoryDenies ? mandatoryDenyPatterns() : []),
			// Not in SRT. See `sealReadDenies`.
			...(sealReadDenies ? readDenied.filter((p) => within(p, writeAllowed)) : []),
		];
		for (const pattern of writeDenied) {
			lines.push(`(deny file-write* ${filter(pattern)})`);
		}
		// Last, so these re-denies beat the read section's re-allows above.
		if (blockMoves) lines.push(...moveBlockingRules(writeDenied));
	}
	lines.push("");

	// ── network: allow-only, and it can only count to loopback ──
	lines.push("; Network: allow-only. See README Step 5 for what cannot be said here.");
	if (network?.all) {
		lines.push("(allow network*)");
	} else {
		for (const port of network?.localPorts ?? []) {
			lines.push(`(allow network-bind (local ip "localhost:${port}"))`);
			lines.push(`(allow network-inbound (local ip "localhost:${port}"))`);
			lines.push(`(allow network-outbound (remote ip "localhost:${port}"))`);
		}
	}

	return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────
// Running something under it
// ─────────────────────────────────────────────────────────────

export interface RunResult {
	stdout: string;
	code: number | null;
	/** Whether the profile itself failed to compile. */
	profileRejected: boolean;
}

export interface RunOptions {
	cwd: string;
	/** No config = run it directly, with no sandbox at all. The control group. */
	config?: SandboxConfig;
	timeoutMs?: number;
	env?: Record<string, string>;
}

/**
 * Run one command, with or without the sandbox.
 *
 * Note the argv array: the profile is passed as **one argument**, not
 * interpolated into a shell string. SRT has to quote it
 * (`macos-sandbox-utils.ts:941`) because it returns a command string for
 * something else to run later; here nothing is being quoted, so nothing can be
 * unquoted.
 */
export function run(command: string, options: RunOptions): Promise<RunResult> {
	const { cwd, config, timeoutMs = 30_000, env } = options;

	const argv = config
		? [
				"/usr/bin/sandbox-exec",
				"-p",
				buildProfile(config, cwd),
				"/bin/bash",
				"-c",
				command,
			]
		: ["/bin/bash", "-c", command];

	return new Promise((resolveRun) => {
		const child = spawn(argv[0] as string, argv.slice(1), {
			cwd,
			env: {
				PATH: process.env.PATH ?? "",
				HOME: process.env.HOME ?? "",
				LANG: "en_US.UTF-8",
				...env,
			},
		});

		let output = "";
		let timedOut = false;
		const timer = setTimeout(() => {
			timedOut = true;
			child.kill("SIGKILL");
		}, timeoutMs);

		const collect = (chunk: Buffer) => {
			output += chunk.toString();
		};
		child.stdout.on("data", collect);
		child.stderr.on("data", collect);

		child.on("error", (error) => {
			clearTimeout(timer);
			resolveRun({ stdout: `${output}\n${error.message}`, code: null, profileRejected: false });
		});

		child.on("close", (code) => {
			clearTimeout(timer);
			const text = timedOut ? `${output}\n[timed out after ${timeoutMs}ms]` : output;
			resolveRun({
				stdout: text.trim(),
				code,
				// sandbox-exec exits 65 and says so on stderr when the *policy* is
				// malformed — a different failure from the command being denied,
				// and one you want to see loudly. Step 5 turns this into a finding.
				profileRejected: code === 65 && /sandbox-exec:/.test(text),
			});
		});
	});
}

/** True when the kernel refused rather than the command failing on its own. */
export function wasDenied(result: RunResult): boolean {
	return (
		result.code !== 0 &&
		/Operation not permitted|not permitted|Permission denied/i.test(result.stdout)
	);
}
