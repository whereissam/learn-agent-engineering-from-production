/**
 * Lesson 4 - session persistence
 *
 * The new things:
 *   - the conversation is stored in a JSONL file and survives a restart
 *   - /resume continues the previous conversation
 *   - /rewind goes back and asks again (creating a branch)
 *
 * Run:
 *   bun run lesson-04-sessions/agent.ts              start a new session
 *   bun run lesson-04-sessions/agent.ts --resume     continue the most recent one
 */

import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { LineReader } from "../shared/repl.ts";
import { Session } from "../shared/session/session.ts";
import { selectStreamingProvider } from "../shared/streaming/index.ts";
import type { Message, StreamingProvider, ToolResult } from "../shared/streaming/types.ts";
import {
	type ApprovalRequest,
	editFileTool,
	listFilesTool,
	readFileTool,
	runCommandTool,
	type ToolContext,
	ToolRegistry,
	writeFileTool,
} from "../shared/tools/index.ts";

const ROOT = resolve(import.meta.dirname, "playground");
const SESSION_DIR = resolve(import.meta.dirname, ".sessions");
const MAX_TOKENS = 16000;
const MAX_STEPS = 25;

const SYSTEM_PROMPT = `You are a coding agent working in a small TypeScript project.

Available tools: list_files, read_file, write_file, edit_file, run_command.

Always read a file before editing it. After changing code, run the tests to verify.
Answer in the same language the user writes in.`;

const registry = new ToolRegistry([
	listFilesTool,
	readFileTool,
	writeFileTool,
	editFileTool,
	runCommandTool,
]);

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;

const AUTO_APPROVE = process.env.AUTO_APPROVE === "1";
const alwaysAllow = new Set<string>();

let currentRun: AbortController | undefined;

function handleInterrupt(): void {
	if (currentRun && !currentRun.signal.aborted) {
		currentRun.abort();
		return;
	}
	console.log(dim("\n再見。"));
	process.exit(0);
}

// ─────────────────────────────────────────────────────────────
// Agent loop
//
// The difference from Lesson 3: besides pushing into the array, every message is also await session.append()'d.
// That is all "persistence" is: one more file write.
// ─────────────────────────────────────────────────────────────

async function runTurn(
	provider: StreamingProvider,
	session: Session,
	ctx: ToolContext,
	signal: AbortSignal,
): Promise<void> {
	for (let step = 0; step < MAX_STEPS; step++) {
		// Every turn re-reads the messages from the session.
		// So after /rewind it automatically uses the new branch's content.
		const messages = session.messages();

		let response: Awaited<ReturnType<StreamingProvider["call"]>> | undefined;
		let streamError: { message: string; aborted: boolean } | undefined;
		let partialText = "";

		for await (const event of provider.stream(
			{ system: SYSTEM_PROMPT, messages, tools: registry.specs(), maxTokens: MAX_TOKENS },
			signal,
		)) {
			switch (event.type) {
				case "text_start":
					process.stdout.write("\n");
					break;
				case "text_delta":
					partialText += event.delta;
					process.stdout.write(event.delta);
					break;
				case "text_end":
					process.stdout.write("\n");
					break;
				case "tool_call":
					console.log(dim(`  → ${event.name}(${summarizeArgs(event.args)})`));
					break;
				case "done":
					response = event.response;
					break;
				case "error":
					streamError = { message: event.message, aborted: event.aborted };
					break;
			}
		}

		if (streamError) {
			if (streamError.aborted) {
				console.log(yellow("\n\n[已中斷]"));
				if (partialText.trim()) {
						// Messages produced by an interruption must be persisted too, or after a restart the history disagrees with the screen
					await session.append({
						role: "assistant",
						blocks: [{ type: "text", text: partialText }],
						raw: { role: "assistant", content: partialText },
					});
					await session.append({
						role: "user",
						text: "[你上一則回覆被我中斷了。等我的下一個指示，不要自己接續。]",
					});
				}
				return;
			}
			console.log(red(`\n[串流失敗] ${streamError.message}`));
			return;
		}

		if (!response) {
			console.log(red("\n[串流沒有正常結束]"));
			return;
		}

		await session.append({
			role: "assistant",
			blocks: response.blocks,
			raw: response.raw,
		});

		if (response.stopReason === "refusal") {
			console.log(red("\n[模型拒絕了這個請求]"));
			return;
		}
		if (response.stopReason === "max_tokens") {
			console.log(red(`\n[輸出撞到 ${MAX_TOKENS} token 上限]`));
			return;
		}

		const toolCalls = response.blocks.filter((b) => b.type === "toolCall");
		if (toolCalls.length === 0) return;

		const results: ToolResult[] = [];
		let abortedDuringTools = false;

		for (const call of toolCalls) {
			if (abortedDuringTools || signal.aborted) {
				abortedDuringTools = true;
				results.push({
					toolCallId: call.id,
					toolName: call.name,
					content: "Cancelled: the user interrupted before this tool ran.",
					isError: true,
				});
				continue;
			}
			try {
				const content = await registry.execute(call.name, call.args, ctx);
				results.push({ toolCallId: call.id, toolName: call.name, content });
				console.log(dim(`  ${green("✓")} ${firstLine(content)}`));
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				results.push({ toolCallId: call.id, toolName: call.name, content: message, isError: true });
				console.log(`  ${red("✗")} ${red(firstLine(message))}`);
			}
		}

		await session.append({ role: "toolResult", results });

		if (abortedDuringTools || signal.aborted) {
			console.log(yellow("\n[已中斷]"));
			await session.append({
				role: "user",
				text: "[我中斷了你的工具執行。等我的下一個指示。]",
			});
			return;
		}
	}

	console.log(red(`\n[已達 ${MAX_STEPS} 步上限。輸入「繼續」讓它接著做。]`));
}

// ─────────────────────────────────────────────────────────────
// Built-in commands
// ─────────────────────────────────────────────────────────────

async function handleCommand(input: string, session: Session): Promise<boolean> {
	const [command, ...rest] = input.split(/\s+/);

	switch (command) {
		case "/history": {
			const records = session.branch();
			if (records.length === 0) {
				console.log(dim("  (這條分支還沒有內容)"));
				return true;
			}
			for (const record of records) {
				if ("type" in record) {
					console.log(dim(`  ${record.id}  [meta] ${record.kind}`));
					continue;
				}
				const { message } = record;
				const preview =
					message.role === "user"
						? message.text
						: message.role === "assistant"
							? (message.blocks.find((b) => b.type === "text")?.text ??
								`(${message.blocks.length} blocks)`)
							: `${message.results.length} tool result(s)`;
				console.log(
					`  ${cyan(record.id)}  ${message.role.padEnd(10)}  ${dim(firstLine(preview))}`,
				);
			}
			return true;
		}

		case "/rewind": {
			const target = rest[0];
			if (!target) {
				console.log(dim("  用法：/rewind <entry-id>   （用 /history 看 id）"));
				return true;
			}
			try {
				session.rewindTo(target);
				console.log(
					dim(`  已退回 ${target}。接下來的訊息會長出一條新分支，舊的分支還在檔案裡。`),
				);
			} catch (error) {
				console.log(red(`  ${(error as Error).message}`));
			}
			return true;
		}

		case "/tree": {
				// Print every record in the file, including abandoned branches.
			const all = session.all();
			const onBranch = new Set(session.branch().map((r) => r.id));
			console.log(dim(`  檔案裡共 ${all.length} 筆記錄，目前分支上有 ${onBranch.size} 筆`));
			for (const record of all) {
				const marker = onBranch.has(record.id) ? green("●") : dim("○");
				const role = "type" in record ? `[meta] ${record.kind}` : record.message.role;
				console.log(`  ${marker} ${cyan(record.id)} ← ${dim(record.parentId ?? "root")}  ${role}`);
			}
			console.log(dim(`  ● = 目前分支   ○ = 已放棄的分支（還在檔案裡，沒有刪除）`));
			return true;
		}

		case "/file":
			console.log(dim(`  ${session.file}`));
			console.log(dim(`  ${session.size} 筆記錄`));
			return true;

		default:
			return false;
	}
}

// ─────────────────────────────────────────────────────────────

function createApprover(reader: LineReader) {
	return async (request: ApprovalRequest): Promise<boolean> => {
		if (AUTO_APPROVE || alwaysAllow.has(request.toolName)) return true;
		console.log(`\n${yellow("┌ 需要批准")}`);
		console.log(`${yellow("│")} ${request.summary}`);
		console.log(yellow("└"));
		const line = await reader.next(
			`  ${yellow("[y]")} 允許  ${yellow("[a]")} 都允許  ${yellow("[n]")} 拒絕 › `,
		);
		if (line === null) {
			console.log(dim("  (沒有輸入可讀，視為拒絕)"));
			return false;
		}
		const answer = line.trim().toLowerCase();
		if (answer === "a") {
			alwaysAllow.add(request.toolName);
			return true;
		}
		return answer === "y" || answer === "yes";
	};
}

function summarizeArgs(args: Record<string, unknown>): string {
	return Object.entries(args)
		.map(([key, value]) => {
			const text = typeof value === "string" ? value : JSON.stringify(value);
			return `${key}: ${JSON.stringify(text.length > 50 ? `${text.slice(0, 50)}…` : text)}`;
		})
		.join(", ");
}

function firstLine(text: string): string {
	const line = text.split("\n")[0] ?? "";
	return line.length > 80 ? `${line.slice(0, 80)}…` : line;
}

/** Find the most recently modified session file. */
async function findLatestSession(): Promise<string | undefined> {
	try {
		const files = (await readdir(SESSION_DIR)).filter((f) => f.endsWith(".jsonl")).sort();
		const last = files.at(-1);
		return last ? join(SESSION_DIR, last) : undefined;
	} catch {
		return undefined;
	}
}

// ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
	const provider = selectStreamingProvider();

	// --resume continues the most recent one; otherwise start a new one
	const wantResume = process.argv.includes("--resume");
	let session: Session;

	if (wantResume) {
		const latest = await findLatestSession();
		if (!latest) {
			console.log(dim("找不到可以續跑的 session，開一個新的。"));
			session = await Session.create(newSessionPath());
		} else {
			session = await Session.load(latest);
			console.log(dim(`續跑 ${latest}（${session.size} 筆記錄）`));
		}
	} else {
		session = await Session.create(newSessionPath());
	}

	const reader = new LineReader();
	reader.raw.on("SIGINT", handleInterrupt);
	process.on("SIGINT", handleInterrupt);

	const ctx: ToolContext = {
		root: ROOT,
		approve: createApprover(reader),
		log: (line) => console.log(dim(`    │ ${line}`)),
	};

	console.log(dim(`provider: ${provider.name}  model: ${provider.model}`));
	console.log(dim(`session:  ${session.file}`));
	console.log(dim("指令：/history  /tree  /rewind <id>  /file  /exit\n"));

	try {
		while (true) {
			const line = await reader.next("\x1b[36m> \x1b[0m");
			if (line === null) break; // stdin 結束
			const input = line.trim();
			if (!input) continue;
			if (input === "/exit") break;

			if (input.startsWith("/")) {
				const handled = await handleCommand(input, session);
				if (handled) {
					console.log();
					continue;
				}
				console.log(dim(`  未知的指令：${input}`));
				console.log();
				continue;
			}

			await session.append({ role: "user", text: input });

			currentRun = new AbortController();
			try {
				await runTurn(provider, session, ctx, currentRun.signal);
			} finally {
				currentRun = undefined;
			}
			console.log();
		}
	} finally {
		reader.close();
	}
}

function newSessionPath(): string {
	// A timestamped filename means sorting equals chronological order
	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	return join(SESSION_DIR, `${stamp}.jsonl`);
}

try {
	await main();
} catch (error) {
	console.error(`\n${error instanceof Error ? error.message : String(error)}`);
	process.exit(1);
}
