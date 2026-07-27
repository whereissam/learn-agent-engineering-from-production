/**
 * run_command ， 讓 agent 執行 shell 指令。
 *
 * 這是威力最大、也最危險的工具。加上它之後，你的 agent 突然什麼都能做了：
 * 跑測試、裝套件、git commit……以及 rm -rf。
 *
 * 所以這個工具有三層防護：
 *   1. mutating: true      → registry 一定會先問使用者
 *   2. cwd 鎖在 root       → 指令的工作目錄跑不出沙箱
 *   3. timeout             → 卡住的指令不會讓 agent 永遠掛著
 *
 * 這三層都不夠強。真正要跑不受信任的指令，要用 Docker 或 micro-VM。
 * Pi 的做法是把整個執行環境抽象成 ExecutionEnv 介面，
 * 見 packages/agent/src/harness/types.ts:373。
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

		// shell 輸出保留「結尾」，錯誤訊息和最終結果都在後面。
		const { text } = truncateTail(stdout);

		if (timedOut) {
			return `[timed out after ${timeout}ms - the command was killed]\n\n${text}`;
		}

		// 非 0 的 exit code 不是 throw，是一個「正常的失敗結果」。
		// 測試沒過本來就是有用的資訊，模型需要看到完整輸出才能修。
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
			cwd, // ← 工作目錄鎖在沙箱裡
			shell: true,
			// 不要繼承整個 process.env。API key 就在裡面，
			// 不需要讓每一個 agent 跑的指令都看得到。
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

		// stdout 跟 stderr 合併，順序才會跟你在終端機看到的一樣
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
