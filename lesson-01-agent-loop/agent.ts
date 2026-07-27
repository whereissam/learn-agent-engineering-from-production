/**
 * Lesson 1 - 最小可運行的 agent loop
 *
 * 這個檔案就是一個 AI agent。沒有框架，沒有 provider SDK ，
 * 它只認識 ../shared/providers/types.ts 定義的中立介面。
 *
 * 對照 Pi：packages/agent/src/agent-loop.ts 的 runLoop()（第 155-275 行）
 *
 * 執行：bun run lesson-01-agent-loop/agent.ts
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { selectProvider } from "../shared/providers/index.ts";
import type { Message, Provider, ToolResult, ToolSpec } from "../shared/providers/types.ts";

// ─────────────────────────────────────────────────────────────
// 設定
// ─────────────────────────────────────────────────────────────

/** agent 只能讀這個資料夾底下的東西。這就是最原始的 sandbox。 */
const ROOT = resolve(import.meta.dirname, "playground");

const MAX_TOKENS = 16000;

const SYSTEM_PROMPT = `You are a coding agent exploring a small project.

You can read files with the read_file tool. Paths are relative to the project root.
If you don't know where to look, start by reading README.md.
Always read a file before making claims about it - never guess at its contents.
Answer in the same language the user writes in.`;

// ─────────────────────────────────────────────────────────────
// 工具定義
//
// description 不是註解，是 prompt 的一部分。模型只靠 name + description
// + parameters 決定要不要呼叫、以及怎麼填參數。寫得爛，模型就用得爛。
//
// 對照 Pi：packages/agent/src/harness/tools/read.ts:50
// ─────────────────────────────────────────────────────────────

const readFileTool: ToolSpec = {
	name: "read_file",
	description:
		"Read the full contents of a text file in the project. " +
		"Use this before answering any question about what the code does.",
	parameters: {
		type: "object",
		properties: {
			path: {
				type: "string",
				description: "File path relative to the project root, e.g. 'src/server.ts'",
			},
		},
		required: ["path"],
	},
};

const TOOLS: ToolSpec[] = [readFileTool];

// ─────────────────────────────────────────────────────────────
// 工具執行
//
// 契約：成功就 return 字串，失敗就 throw。
// 不要把錯誤訊息偽裝成正常結果回傳 ， 下面的 loop 會統一把 throw 包成
// isError 的結果送回模型，模型看到後才知道要換個做法。
//
// 對照 Pi：types.ts:388 「Throw on failure instead of encoding errors in content.」
// ─────────────────────────────────────────────────────────────

async function executeTool(name: string, args: Record<string, unknown>): Promise<string> {
	if (name !== "read_file") {
		throw new Error(`Unknown tool: ${name}`);
	}

	const path = args.path;
	if (typeof path !== "string") {
		throw new Error("read_file requires a string 'path' argument");
	}

	const target = resolve(ROOT, path);

	// args 是模型產生的，一律當成不可信輸入。
	// 少了這三行，模型寫 "../../../.ssh/id_rsa" 你就乖乖讀給它了。
	if (target !== ROOT && !target.startsWith(`${ROOT}/`)) {
		throw new Error(`Path escapes the project root: ${path}`);
	}

	return await readFile(target, "utf8");
}

// ─────────────────────────────────────────────────────────────
// Agent loop ， 這 50 行就是「AI agent」的全部
// ─────────────────────────────────────────────────────────────

async function runTurn(provider: Provider, messages: Message[]): Promise<void> {
	while (true) {
		// 1. 呼叫模型。整個 agent 只有這一個地方跟 LLM 講話。
		const response = await provider.call({
			system: SYSTEM_PROMPT,
			messages,
			tools: TOOLS,
			maxTokens: MAX_TOKENS,
		});

		// 2. 把模型的回覆推回歷史。blocks 給我們讀，raw 給 provider 之後傳回去。
		messages.push({ role: "assistant", blocks: response.blocks, raw: response.raw });

		// 3. 先看 stopReason，再讀內容。
		//    被拒絕或被截斷時，blocks 可能是空的或半截的。
		if (response.stopReason === "refusal") {
			console.log("\n[模型拒絕了這個請求]");
			return;
		}
		if (response.stopReason === "max_tokens") {
			console.log(`\n[輸出撞到 ${MAX_TOKENS} token 上限，這一輪的結果不可信]`);
			return;
		}

		// 4. 印出模型說了什麼、想呼叫什麼工具。
		for (const block of response.blocks) {
			if (block.type === "text") {
				console.log(`\n${block.text}`);
			} else {
				console.log(dim(`  → ${block.name}(${JSON.stringify(block.args)})`));
			}
		}

		// 5. 沒有 tool call 了 → 這一輪結束，把控制權還給使用者。
		//
		//    注意這裡是看「有沒有 tool call」，不是看 stopReason === "tool_use"。
		//    stopReason 是 provider 的說法，blocks 是事實。以事實為準。
		const toolCalls = response.blocks.filter((b) => b.type === "toolCall");
		if (toolCalls.length === 0) {
			return;
		}

		// 6. 執行所有工具。一則 assistant 訊息裡可能有多個 tool call
		//    （模型會平行呼叫），全部執行完再一起送回去。
		const results: ToolResult[] = [];
		for (const call of toolCalls) {
			try {
				results.push({
					toolCallId: call.id,
					toolName: call.name,
					content: await executeTool(call.name, call.args),
				});
			} catch (error) {
				// 失敗的工具也一定要回一則結果，不能靜靜丟掉。
				// 少了對應的 tool result，下一次請求會直接被 API 打回 400。
				const message = error instanceof Error ? error.message : String(error);
				results.push({
					toolCallId: call.id,
					toolName: call.name,
					content: message,
					isError: true,
				});
				console.log(`  \x1b[31m✗ ${message}\x1b[0m`);
			}
		}

		messages.push({ role: "toolResult", results });

		// 7. 回到步驟 1，讓模型看到工具結果後繼續。
	}
}

// ─────────────────────────────────────────────────────────────
// REPL
// ─────────────────────────────────────────────────────────────

function dim(text: string): string {
	return `\x1b[2m${text}\x1b[0m`;
}

async function main(): Promise<void> {
	const provider = selectProvider();

	// messages 就是「session」。它只活在記憶體裡，程式一關就沒了。
	// Lesson 4 會把它存到磁碟。
	const messages: Message[] = [];

	const rl = createInterface({ input: process.stdin, output: process.stdout });

	console.log(dim(`provider: ${provider.name}  model: ${provider.model}`));
	console.log(dim("輸入問題，/exit 或 Ctrl+C 離開\n"));

	try {
		while (true) {
			let input: string;
			try {
				input = (await rl.question("\x1b[36m> \x1b[0m")).trim();
			} catch {
				break; // stdin 關掉了（Ctrl+D，或用管線餵輸入）
			}
			if (!input) continue;
			if (input === "/exit") break;

			messages.push({ role: "user", text: input });
			await runTurn(provider, messages);
			console.log();
		}
	} finally {
		rl.close();
	}
}

// 設定錯誤（例如沒有 API key）就好好講一句話，不要噴一整串 stack trace。
try {
	await main();
} catch (error) {
	console.error(`\n${error instanceof Error ? error.message : String(error)}`);
	process.exit(1);
}
