/**
 * Lesson 20: 最小的 search agent
 *
 * 這一課的 `runTurn` 跟 Lesson 6 一模一樣，Lesson 6 的又跟 Lesson 3 一樣。
 * 換掉的還是那兩樣東西：**工具**和 **system prompt**。
 *
 *   Lesson 3   read_file / write_file / bash      → coding agent
 *   Lesson 6   query_telemetry / find_anomalies   → 事故分析 agent
 *   Lesson 20  web_search                          → search agent
 *
 * 一整個 AI Search 篇要開始了，但起手式不是什麼新架構，
 * 是一個只有一個工具的 loop。**先看清楚缺什麼，再去補。**
 *
 * 執行：
 *   bun run lesson-20                     用真模型
 *   PROVIDER=fake bun run lesson-20       不需要金鑰，跑一段寫死的軌跡
 */

import { resolve } from "node:path";
import { LineReader } from "../shared/repl.ts";
import { selectStreamingProvider } from "../shared/streaming/index.ts";
import type { Message, StreamingProvider, ToolResult } from "../shared/streaming/types.ts";
import {
	type ApprovalRequest,
	type ToolContext,
	ToolRegistry,
} from "../shared/tools/index.ts";
import { fakeSearchProvider } from "./fake-provider.ts";
import { webSearchTool } from "./tools/search.ts";

const MAX_TOKENS = 8000;
const MAX_STEPS = 12;

/**
 * 這一課的 system prompt 有一半在講「不知道的時候怎麼辦」。
 *
 * 因為 search agent 最大的風險不是找不到資料，是**找到一半就開始腦補**。
 * 模型手上只有 snippet，但它讀起來很像完整答案，於是它會很自然地
 * 把 snippet 當成整頁的結論講出來。
 *
 * 注意規則 4：這是 Lesson 6 「有結論就要有證據」的搜尋版。
 * 差別是這裡多了一級「查不到」——因為在搜尋的世界裡，
 * 「我只看到 snippet，沒辦法確認」本身就是一個正確答案。
 */
const SYSTEM_PROMPT = `You are a research assistant. You answer questions using web search.

## Your only tool
web_search returns ranked results: title, URL, publication date, and a short snippet.
You cannot open pages in this session. Snippets are all you get.

## Rules
1. Search before you answer. Do not answer from memory: these pages are not in your
   training data, and the user is asking about what is on the web.
2. The index is keyword-based and English-only. Turn the user's question into English
   keyword queries. If a query returns nothing, try different words rather than giving up.
3. One query is rarely enough. A good search session uses several queries that attack the
   question from different angles (project name, capability, robot model, license).
4. Label every claim you make:
   - CONFIRMED: a snippet you retrieved literally says it. Quote the URL.
   - UNVERIFIED: it looks likely from a title or a partial snippet, but no snippet states it.
   Never present UNVERIFIED as fact. "I could not verify this from snippets alone" is a
   correct and useful answer.
5. Prefer primary sources (project repository, official docs, release notes) over roundup
   articles. Check the publication date: in a fast-moving area a listicle from last year is
   often wrong.
6. If two sources disagree, say so explicitly and give both URLs. Do not silently pick one.

Answer in the same language the user writes in.`;

const registry = new ToolRegistry([webSearchTool]);

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;

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
// Agent loop: 跟 Lesson 3 / Lesson 6 完全相同，一行都沒改
// ─────────────────────────────────────────────────────────────

export async function runTurn(
	provider: StreamingProvider,
	messages: Message[],
	ctx: ToolContext,
	signal: AbortSignal,
	quiet = false,
): Promise<void> {
	for (let step = 0; step < MAX_STEPS; step++) {
		let response: Awaited<ReturnType<StreamingProvider["call"]>> | undefined;
		let streamError: { message: string; aborted: boolean } | undefined;
		let partialText = "";

		for await (const event of provider.stream(
			{ system: SYSTEM_PROMPT, messages, tools: registry.specs(), maxTokens: MAX_TOKENS },
			signal,
		)) {
			switch (event.type) {
				case "text_start":
					if (!quiet) process.stdout.write("\n");
					break;
				case "text_delta":
					partialText += event.delta;
					if (!quiet) process.stdout.write(event.delta);
					break;
				case "text_end":
					if (!quiet) process.stdout.write("\n");
					break;
				case "tool_call":
					if (!quiet) console.log(dim(`  → ${event.name}(${summarizeArgs(event.args)})`));
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
				if (!quiet) console.log(yellow("\n\n[已中斷]"));
				if (partialText.trim()) {
					messages.push({
						role: "assistant",
						blocks: [{ type: "text", text: partialText }],
						raw: { role: "assistant", content: partialText },
					});
					messages.push({
						role: "user",
						text: "[你上一則回覆被我中斷了。等我的下一個指示。]",
					});
				}
				return;
			}
			if (!quiet) console.log(red(`\n[串流失敗] ${streamError.message}`));
			throw new Error(streamError.message);
		}

		if (!response) throw new Error("Stream ended without a response");

		messages.push({ role: "assistant", blocks: response.blocks, raw: response.raw });

		if (response.stopReason === "refusal") {
			if (!quiet) console.log(red("\n[模型拒絕了這個請求]"));
			return;
		}
		if (response.stopReason === "max_tokens") {
			if (!quiet) console.log(red(`\n[輸出撞到 ${MAX_TOKENS} token 上限]`));
			return;
		}

		const toolCalls = response.blocks.filter((b) => b.type === "toolCall");
		if (toolCalls.length === 0) return;

		const results: ToolResult[] = [];
		for (const call of toolCalls) {
			if (signal.aborted) {
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
				if (!quiet) console.log(dim(`  ${green("✓")} ${firstLine(content)}`));
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				results.push({ toolCallId: call.id, toolName: call.name, content: message, isError: true });
				if (!quiet) console.log(`  ${red("✗")} ${red(firstLine(message))}`);
			}
		}

		messages.push({ role: "toolResult", results });

		if (signal.aborted) {
			if (!quiet) console.log(yellow("\n[已中斷]"));
			return;
		}
	}

	if (!quiet) console.log(red(`\n[已達 ${MAX_STEPS} 步上限]`));
}

export { registry, SYSTEM_PROMPT };

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
			return `${key}=${text.length > 60 ? `${text.slice(0, 60)}…` : text}`;
		})
		.join(" ");
}

function firstLine(text: string): string {
	const line = text.split("\n")[0] ?? "";
	return line.length > 90 ? `${line.slice(0, 90)}…` : line;
}

/**
 * 這一課有自己的 fake provider。
 *
 * `shared/streaming/fake.ts` 那個是寫給 Lesson 1-5 的 coding agent 用的，
 * 它會去呼叫 list_files / read_file，在這裡只會得到「Unknown tool」。
 *
 * 設計原則 1 說每一課都要能不用金鑰跑起來，所以這一課自備一段
 * 寫死的軌跡。它演的不是「模型有多聰明」，剛好相反——
 * 它演的是**只靠 snippet 回答會錯成什麼樣子**。
 */
function selectProvider(): StreamingProvider {
	if (process.env.PROVIDER?.toLowerCase() === "fake") return fakeSearchProvider();
	return selectStreamingProvider();
}

async function main(): Promise<void> {
	const provider = selectProvider();
	const messages: Message[] = [];
	const reader = new LineReader();
	reader.raw.on("SIGINT", handleInterrupt);
	process.on("SIGINT", handleInterrupt);

	const ctx: ToolContext = {
		// 這一課沒有檔案沙箱，工具只讀自己的語料
		root: resolve(import.meta.dirname, "corpus"),
		approve: createApprover(reader),
		log: (line) => console.log(dim(`    │ ${line}`)),
	};

	console.log(dim(`provider: ${provider.name}  model: ${provider.model}`));
	console.log(dim(`tools:    ${registry.specs().map((t) => t.name).join(", ")}`));
	console.log(
		dim("試試看：有哪些 open source 專案可以把影片動作 retarget 到 Unitree G1？\n"),
	);

	try {
		while (true) {
			const line = await reader.next("\x1b[36m> \x1b[0m");
			if (line === null) break;
			const input = line.trim();
			if (!input) continue;
			if (input === "/exit") break;

			messages.push({ role: "user", text: input });
			currentRun = new AbortController();
			try {
				await runTurn(provider, messages, ctx, currentRun.signal);
			} catch (error) {
				console.log(red(`\n[錯誤] ${(error as Error).message}`));
			} finally {
				currentRun = undefined;
			}
			console.log();
		}
	} finally {
		reader.close();
	}
}

// 之後的課會把這個 agent 當成模組 import，那時不該啟動 REPL
if (import.meta.main) {
	try {
		await main();
	} catch (error) {
		console.error(`\n${error instanceof Error ? error.message : String(error)}`);
		process.exit(1);
	}
}
