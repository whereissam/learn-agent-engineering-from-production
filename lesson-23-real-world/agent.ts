/**
 * Lesson 23: 對照真實原始碼
 *
 * 這個檔案跟 `lesson-22-retrieval/agent.ts` **只差一個東西：SYSTEM_PROMPT**。
 * 工具一樣、loop 一樣（從 Lesson 3 到現在都一樣）、檢索管線一樣。
 *
 * 改的那幾行是從真實專案抄來的，而且每一條都標了出處：
 *
 *   gpt-researcher/gpt_researcher/prompts.py:250    不要用搜尋運算子
 *   deep-research/src/deep-research.ts:54           一次生 N 條，彼此不相似
 *   deep-research/src/deep-research.ts:66           每條 query 要附研究目標
 *   gpt-researcher/.../query_processing.py:108      先搜一次，再用結果生子問題
 *
 * 為什麼值得單獨開一課做這件事？因為 Lesson 20-22 是我們自己從零推導的，
 * 推導出來的東西有些**他們早就有一行程式碼在擋**。看到那一行的當下，
 * 你才會知道自己踩的坑不是自己笨，是這個領域公認的坑。
 *
 * 實測結果在 README Step 5（改 prompt 之前 vs 之後）。
 *
 * 執行：
 *   bun run lesson-23                     用真模型
 *   bun run lesson-23:check               驗證這一課引用的行號還對不對
 */

import { resolve } from "node:path";
import { webSearchTool } from "../lesson-22-retrieval/tools/search.ts";
import { LineReader } from "../shared/repl.ts";
import { selectStreamingProvider } from "../shared/streaming/index.ts";
import type { Message, StreamingProvider, ToolResult } from "../shared/streaming/types.ts";
import {
	type ApprovalRequest,
	type ToolContext,
	ToolRegistry,
} from "../shared/tools/index.ts";
import { fakeRetrievalProvider } from "../lesson-22-retrieval/fake-provider.ts";
import { fetchPageTool } from "../lesson-21-crawl/tools/fetch.ts";

const MAX_TOKENS = 8000;
const MAX_STEPS = 16;

/**
 * 跟 Lesson 20 比，規則 4 是這一課真正改動的地方。
 *
 * Lesson 20 的 CONFIRMED 只能代表「某個 snippet 這樣說」，
 * 因為那時候沒有工具可以再往下確認。現在有了，所以標籤要分三級，
 * 而且「只有 snippet 支持」必須是一個**看得出來的**狀態。
 *
 * 注意規則 6：抓不到的頁面要說出來。這是 Lesson 6「工具要報告資料品質」
 * 的另一面——**agent 也要報告自己的資料品質**。
 */
const SYSTEM_PROMPT = `You are a research assistant. You search the web, read pages, and answer
with citations.

## Your tools
- web_search: ranked results with title, URL and publication date. Ranking is hybrid
  (keyword + semantic), deduplicated and quality-adjusted, so the top results are usually
  worth reading. Natural language queries in any language work.
- fetch_page: opens one URL and returns its actual text, boilerplate removed. Long pages come
  in chunks; the result tells you which chunk you got and how many exist.

## How to search (borrowed from production research agents)
A. Write each query as a plain natural language phrase. Do NOT use search operator syntax
   such as site:, filetype:, inurl:, intitle:, OR, AND, or NOT. These operators are not
   universally supported and return empty or misleading results on many backends.
   [gpt-researcher/gpt_researcher/prompts.py:250]
B. Plan 3-4 distinct queries up front and make sure each one is unique and not similar to
   the others. Do not issue near-duplicate queries one at a time.
   [deep-research/src/deep-research.ts:54]
C. For each query, know what you are trying to learn from it before you run it. If you
   cannot say what a query would tell you that you do not already know, do not run it.
   [deep-research/src/deep-research.ts:66, the researchGoal field]
D. Do not search for project or product names you remember from training. This index only
   contains what it contains: search by capability and by what the page would say, then
   read what comes back.

## Rules
1. Search first, then READ. A snippet is the passage that best matched your query, so it can
   omit or contradict what the page concludes. Never build an answer out of snippets alone.
2. Before you state anything that matters (does X support Y, what licence, is it maintained,
   which version), fetch the page that would say so.
3. Label every claim:
   - CONFIRMED: you fetched the page and its text states this. Give the URL.
   - SNIPPET-ONLY: a search snippet says it but you did not open the page.
   - UNVERIFIED: neither. Say so plainly instead of guessing.
4. If a page has several chunks, keep reading until you have what you need, or say which part
   you read. Do not describe a whole document from its first chunk.
5. Prefer primary sources (repository, official docs, release notes) over roundup articles.
   The search result tells you today's date and how old each page is: use it. A page from
   last year about a fast-moving topic is a warning sign, not a citation.
6. If a page cannot be read (robots.txt, 403, JavaScript-only), say so in your answer and name
   the URL. "Could not be read" is information, not an absence of information. Never turn a
   failed fetch into "the page does not mention it".
7. If two sources disagree, give both URLs and say which one you trust and why (recency,
   primary vs secondary, first-hand experience).

Answer in the same language the user writes in.`;

const registry = new ToolRegistry([webSearchTool, fetchPageTool]);

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
// Agent loop: 跟 Lesson 3 / 6 / 20 / 21 完全相同，一行都沒改
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

function selectProvider(): StreamingProvider {
	if (process.env.PROVIDER?.toLowerCase() === "fake") return fakeRetrievalProvider();
	return selectStreamingProvider();
}

async function main(): Promise<void> {
	const provider = selectProvider();
	const messages: Message[] = [];
	const reader = new LineReader();
	reader.raw.on("SIGINT", handleInterrupt);
	process.on("SIGINT", handleInterrupt);

	const ctx: ToolContext = {
		root: resolve(import.meta.dirname, "../lesson-20-search-agent/corpus"),
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

if (import.meta.main) {
	try {
		await main();
	} catch (error) {
		console.error(`\n${error instanceof Error ? error.message : String(error)}`);
		process.exit(1);
	}
}
