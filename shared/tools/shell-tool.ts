/**
 * run_command — letting the agent run shell commands.
 *
 * The most powerful and most dangerous tool. With it, your agent can suddenly do anything:
 * run tests, install packages, git commit… and rm -rf.
 *
 * So this tool has three layers of protection:
 *   1. mutating: true      → the registry always asks the user first
 *   2. cwd locked to root  → the command's working directory cannot leave the sandbox
 *   3. a timeout           → a stuck command cannot hang the agent forever
 *
 * None of the three is strong enough. Running genuinely untrusted commands needs Docker or a micro-VM.
 * Pi abstracts the whole execution environment into an ExecutionEnv interface;
 * see packages/agent/src/harness/types.ts:373.
 */

import { spawn } from "node:child_process";
import type { Tool } from "./registry.ts";
import { truncateTail } from "./truncate.ts";

const DEFAULT_TIMEOUT_MS = 30_000;

export const runCommandTool: Tool = {
	name: "run_command",
	mutating: true,
	description:
		"Run a shell command in the project root and return its combined stdout and stderr. " +
		"Use this for running tests, builds, git, and other tooling. " +
		"The command runs with a timeout; long-running servers will be killed.",
	parameters: {
		type: "object",
		properties: {
			command: { type: "string", description: "The shell command to run" },
			timeout_ms: {
				type: "number",
				description: `Timeout in milliseconds. Default ${DEFAULT_TIMEOUT_MS}.`,
			},
		},
		required: ["command"],
	},

	async execute(args, ctx) {
		const { command } = args;
		if (typeof command !== "string" || command.trim() === "") {
			throw new Error("command must be a non-empty string");
		}

		const timeout =
			typeof args.timeout_ms === "number" && args.timeout_ms > 0
				? Math.min(args.timeout_ms, 120_000)
				: DEFAULT_TIMEOUT_MS;

		const { stdout, code, timedOut } = await run(command, ctx.root, timeout, (line) => ctx.log(line));

			// Shell output keeps the **end**; error messages and final results are at the bottom.
		const { text } = truncateTail(stdout);

		if (timedOut) {
			return `[timed out after ${timeout}ms - the command was killed]\n\n${text}`;
		}

			// A non-zero exit code is not a throw but a **normal failure result**.
			// Failing tests are useful information, and the model needs the full output to fix them.
		const status = code === 0 ? "exit 0" : `exit ${code}`;
		return `[${status}]\n\n${text || "(no output)"}`;
	},
};

interface RunResult {
	stdout: string;
	code: number | null;
	timedOut: boolean;
}

function run(
	command: string,
	cwd: string,
	timeoutMs: number,
	onLine: (line: string) => void,
): Promise<RunResult> {
	return new Promise((resolveRun) => {
		const child = spawn(command, {
			cwd, // ← working directory pinned inside the sandbox
			shell: true,
				// Do not inherit the whole process.env. API keys are in there,
				// and every command the agent runs does not need to see them.
			env: {
				PATH: process.env.PATH ?? "",
				HOME: process.env.HOME ?? "",
				LANG: process.env.LANG ?? "en_US.UTF-8",
			},
		});

		let output = "";
		let timedOut = false;

		const timer = setTimeout(() => {
			timedOut = true;
			child.kill("SIGKILL");
		}, timeoutMs);

			// stdout and stderr are merged, so the order matches what you see in a terminal
		const collect = (chunk: Buffer) => {
			const text = chunk.toString();
			output += text;
			for (const line of text.split("\n")) {
				if (line.trim()) onLine(line);
			}
		};

		child.stdout.on("data", collect);
		child.stderr.on("data", collect);

		child.on("error", (error) => {
			clearTimeout(timer);
			output += `\n${error.message}`;
			resolveRun({ stdout: output, code: null, timedOut });
		});

		child.on("close", (code) => {
			clearTimeout(timer);
			resolveRun({ stdout: output, code, timedOut });
		});
	});
}
