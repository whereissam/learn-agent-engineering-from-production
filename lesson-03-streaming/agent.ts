/**
 * Lesson 3 - Streaming 與中斷
 *
 * 兩個新東西：
 *   1. 文字逐字印出來，不用等整段講完
 *   2. Ctrl+C 可以喊停，而且停完之後對話還能繼續
 *
 * 第 2 點比看起來難很多。中斷可能發生在三個不同的時機，
 * 每一個都會讓對話歷史處於不同的半殘狀態。見 README。
 *
 * 執行：bun run lesson-03-streaming/agent.ts
 */

import { resolve } from "node:path";
import { LineReader } from "../shared/repl.ts";
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
const MAX_TOKENS = 16000;
const MAX_STEPS = 25;

const SYSTEM_PROMPT = `You are a coding agent working in a small TypeScript project.

Available tools: list_files, read_file, write_file, edit_file, run_command.

Working rules:
- Explore with list_files before guessing at file names.
- Always read_file before you edit it.
- After changing code, run the tests with run_command to verify.
- If the user declines an action, do not retry it.

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

const AUTO_APPROVE = process.env.AUTO_APPROVE === "1";
const alwaysAllow = new Set<string>();

// ─────────────────────────────────────────────────────────────
// 中斷控制
//
// 每一輪對話建立一個新的 AbortController。Ctrl+C 觸發 abort，
// 訊號會傳給「正在跑的模型請求」跟「正在跑的工具」。
// ─────────────────────────────────────────────────────────────

let currentRun: AbortController | undefined;

function handleInterrupt(): void {
	if (currentRun && !currentRun.signal.aborted) {
		// 有東西在跑 → 中斷它，但不要結束程式
		currentRun.abort();
		return;
	}
	// 閒著的時候按 Ctrl+C → 真的離開
	console.log(dim("\n再見。"));
	process.exit(0);
}

/**
 * 中斷訊號要從「兩個地方」接。
 *
 * - rl.on("SIGINT")：stdin 是終端機、而且 readline 正在等你輸入時，
 *   readline 會攔截 SIGINT，process 層根本收不到。
 * - process.on("SIGINT")：其他所有情況，尤其是 runTurn 執行期間
 *   （readline 沒在等輸入），以及 stdin 不是 TTY 的時候（管線、CI）。
 *
 * 只裝其中一個都會有 Ctrl+C 沒反應的情境。這是實測出來的，
 * 我第一版只裝了 rl 那個，結果串流中按 Ctrl+C 完全沒用。
 */
function installSigintHandler(reader: LineReader): void {
	reader.raw.on("SIGINT", handleInterrupt);
	process.on("SIGINT", handleInterrupt);
}

// ─────────────────────────────────────────────────────────────
// Agent loop
// ─────────────────────────────────────────────────────────────

interface TurnOutcome {
	aborted: boolean;
}

async function runTurn(
	provider: StreamingProvider,
	messages: Message[],
	ctx: ToolContext,
	signal: AbortSignal,
): Promise<TurnOutcome> {
	for (let step = 0; step < MAX_STEPS; step++) {
		// ── 1. 串流模型回應 ──────────────────────────────────
		//
		// 一邊印字，一邊累積。中斷的話，累積到的部分仍然有效。
		let printedText = false;
		let response: Awaited<ReturnType<StreamingProvider["call"]>> | undefined;
		let streamError: { message: string; aborted: boolean } | undefined;
		let partialText = "";

		for await (const event of provider.stream(
			{ system: SYSTEM_PROMPT, messages, tools: registry.specs(), maxTokens: MAX_TOKENS },
			signal,
		)) {
			switch (event.type) {
				case "text_start":
					if (!printedText) {
						process.stdout.write("\n");
						printedText = true;
					}
					break;

				case "text_delta":
					partialText += event.delta;
					// 這一行就是「打字機效果」的全部。
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

		// ── 2. 處理串流失敗 / 中斷 ──────────────────────────
		//
		// 這是整課最重要的一段。
		if (streamError) {
			if (streamError.aborted) {
				console.log(yellow("\n\n[已中斷]"));

				// 中斷點 A：模型講到一半。
				//
				// 已經印出去的文字，使用者「看過了」。如果我們把它丟掉，
				// 對話歷史就跟使用者看到的畫面對不上，之後模型會說出
				// 前後矛盾的話。
				//
				// 所以：有講出東西就存起來，並且標記它是被截斷的。
				if (partialText.trim()) {
					messages.push({
						role: "assistant",
						blocks: [{ type: "text", text: partialText }],
						raw: { role: "assistant", content: partialText },
					});
					messages.push({
						role: "user",
						text: "[你上一則回覆被我中斷了。等我的下一個指示，不要自己接續。]",
					});
				}
				// 什麼都還沒講就被中斷 → 歷史沒被弄髒，什麼都不用做。
				return { aborted: true };
			}

			console.log(red(`\n[串流失敗] ${streamError.message}`));
			return { aborted: false };
		}

		if (!response) {
			console.log(red("\n[串流沒有正常結束]"));
			return { aborted: false };
		}

		// ── 3. 正常路徑，跟 Lesson 1-2 一樣 ─────────────────
		messages.push({ role: "assistant", blocks: response.blocks, raw: response.raw });

		if (response.stopReason === "refusal") {
			console.log(red("\n[模型拒絕了這個請求]"));
			return { aborted: false };
		}
		if (response.stopReason === "max_tokens") {
			console.log(red(`\n[輸出撞到 ${MAX_TOKENS} token 上限]`));
			return { aborted: false };
		}

		const toolCalls = response.blocks.filter((b) => b.type === "toolCall");
		if (toolCalls.length === 0) return { aborted: false };

		// ── 4. 執行工具 ─────────────────────────────────────
		//
		// 中斷點 B：工具跑到一半。
		//
		// 這裡有個硬性規則：**每一個 tool call 都必須有一則對應的結果**，
		// 否則下一次請求會被 API 打回 400。
		//
		// 所以就算中途被中斷，剩下沒跑的工具也要補上「已取消」的結果。
		const results: ToolResult[] = [];
		let abortedDuringTools = false;

		for (const call of toolCalls) {
			if (abortedDuringTools || signal.aborted) {
				// 已經中斷了 → 補一則取消結果，不要真的執行
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
				results.push({
					toolCallId: call.id,
					toolName: call.name,
					content: message,
					isError: true,
				});
				console.log(`  ${red("✗")} ${red(firstLine(message))}`);
			}
		}

		// 補完所有結果「之後」才 push，歷史永遠保持在合法狀態。
		messages.push({ role: "toolResult", results });

		if (abortedDuringTools || signal.aborted) {
			console.log(yellow("\n[已中斷]"));
			// 中斷點 C：工具結果已經補齊了，歷史是合法的。
			// 加一則使用者訊息說明狀況，模型下一輪才知道發生什麼事。
			messages.push({
				role: "user",
				text: "[我中斷了你的工具執行。等我的下一個指示。]",
			});
			return { aborted: true };
		}
	}

	console.log(red(`\n[已達 ${MAX_STEPS} 步上限。輸入「繼續」讓它接著做。]`));
	return { aborted: false };
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
	return line.length > 100 ? `${line.slice(0, 100)}…` : line;
}

// ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
	const provider = selectStreamingProvider();
	const messages: Message[] = [];
	const reader = new LineReader();

	installSigintHandler(reader);

	const ctx: ToolContext = {
		root: ROOT,
		approve: createApprover(reader),
		log: (line) => console.log(dim(`    │ ${line}`)),
	};

	console.log(dim(`provider: ${provider.name}  model: ${provider.model}`));
	console.log(dim("生成中按 Ctrl+C 可以中斷；閒置時按 Ctrl+C 離開\n"));

	try {
		while (true) {
			const line = await reader.next("\x1b[36m> \x1b[0m");
			if (line === null) break; // stdin 結束
			const input = line.trim();
			if (!input) continue;
			if (input === "/exit") break;

			messages.push({ role: "user", text: input });

			// 每一輪一個新的 controller。中斷是「這一輪」的事，
			// 不會影響下一輪。
			currentRun = new AbortController();
			try {
				await runTurn(provider, messages, ctx, currentRun.signal);
			} finally {
				currentRun = undefined;
			}
			console.log();
		}
	} finally {
		reader.close();
	}
}

try {
	await main();
} catch (error) {
	console.error(`\n${error instanceof Error ? error.message : String(error)}`);
	process.exit(1);
}
