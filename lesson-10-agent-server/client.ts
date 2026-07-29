/**
 * Lesson 10 - 終端機 client
 *
 * 這是「GUI」。它長得像終端機，但它跟一個 Tauri 視窗、一個 React 頁面
 * 做的事完全一樣：
 *
 *   1. 連上事件流
 *   2. 把收到的事件畫成畫面
 *   3. 把使用者的動作變成上行請求
 *
 * 它**不知道** agent loop 長什麼樣，不 import 任何 provider 或 tool。
 * 這就是重點：UI 只認識事件型別，不認識 agent。
 *
 * 執行：
 *   bun run lesson-10-agent-server/client.ts            # session "main"
 *   bun run lesson-10-agent-server/client.ts demo-2     # 換一個 session
 *
 * 指令：
 *   /interrupt   中斷正在跑的 turn（Ctrl+C 也可以）
 *   /exit        離開 client（server 上的 turn 會繼續跑）
 */

import { LineReader } from "../shared/repl.ts";
import type { ServerEvent } from "./server.ts";
import type { Message } from "../shared/streaming/types.ts";

const PORT = Number(process.env.PORT ?? 7010);
const BASE = `http://127.0.0.1:${PORT}`;
const SESSION = process.argv[2] ?? "main";

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;

let running = false;

// ─────────────────────────────────────────────────────────────
// 收事件 → 畫畫面
// ─────────────────────────────────────────────────────────────

function render(event: ServerEvent): void {
	switch (event.type) {
		case "ready":
			console.log(
				dim(`已連上 session ${event.sessionId}  provider: ${event.provider}  model: ${event.model}`),
			);
			if (event.naive) console.log(yellow("server 跑在 NAIVE 模式：重連不會補畫面"));
			break;

		// ── 重連的關鍵 ────────────────────────────────────
		//
		// 收到 state 就把畫面整個重畫。這比「接續播放」簡單得多，
		// 而且不會有「我到底漏了哪幾則」這種問題，因為根本不需要知道。
		case "state":
			if (event.messages.length > 0) {
				console.log(dim("─── 這個 session 目前的內容 ───"));
				for (const line of transcript(event.messages)) console.log(line);
				console.log(dim("──────────────────────────────"));
			}
			running = event.running;
			if (running) console.log(yellow("（有一輪正在跑，接下來的事件會即時進來）"));
			break;

		case "turn_start":
			running = true;
			console.log(`\n${cyan("你")} ${event.text}`);
			break;

		case "text_start":
			process.stdout.write("\n");
			break;
		case "text_delta":
			process.stdout.write(event.delta);
			break;
		case "text_end":
			process.stdout.write("\n");
			break;

		case "tool_call":
			console.log(dim(`  → ${event.name}(${summarize(event.args)})`));
			break;
		case "tool_result":
			console.log(
				event.isError
					? `  ${red("✗")} ${red(event.content)}`
					: dim(`  ${green("✓")} ${event.content}`),
			);
			break;

		case "iteration_end":
			break;

		case "interrupted":
			console.log(yellow(`\n[已中斷：${event.where === "stream" ? "模型講到一半" : "工具跑到一半"}]`));
			break;

		case "turn_done":
			running = false;
			if (event.reason === "error") console.log(red(`\n[失敗] ${event.message ?? ""}`));
			if (event.reason === "max_steps") console.log(red("\n[撞到步數上限]"));
			process.stdout.write("\n");
			break;

		case "input_rejected":
			console.log(red(`\n[被拒絕] ${event.error}`));
			break;
	}
}

/** 把 message 陣列畫成人看得懂的文字。GUI 裡這段就是渲染器。 */
function transcript(messages: Message[]): string[] {
	const lines: string[] = [];
	for (const message of messages) {
		if (message.role === "user") {
			lines.push(`${cyan("你")} ${message.text}`);
		} else if (message.role === "assistant") {
			for (const block of message.blocks) {
				if (block.type === "text") lines.push(block.text);
				else lines.push(dim(`  → ${block.name}(${summarize(block.args)})`));
			}
		} else {
			for (const result of message.results) {
				lines.push(dim(`  ${result.isError ? red("✗") : green("✓")} ${first(result.content)}`));
			}
		}
	}
	return lines;
}

function summarize(args: Record<string, unknown>): string {
	return Object.entries(args)
		.map(([k, v]) => `${k}: ${JSON.stringify(String(typeof v === "string" ? v : JSON.stringify(v)).slice(0, 50))}`)
		.join(", ");
}

function first(text: string): string {
	const line = text.split("\n")[0] ?? "";
	return line.length > 80 ? `${line.slice(0, 80)}…` : line;
}

// ─────────────────────────────────────────────────────────────
// SSE
//
// 手寫的 parser，因為 Node 沒有內建 EventSource，而這段只有十幾行。
// 真實的 GUI 會用 EventSource 或 WebSocket，行為一樣。
// ─────────────────────────────────────────────────────────────

async function listen(signal: AbortSignal): Promise<void> {
	const response = await fetch(`${BASE}/session/${SESSION}/events`, { signal });
	if (!response.body) throw new Error("事件流沒有 body");

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true });

		let boundary = buffer.indexOf("\n\n");
		while (boundary !== -1) {
			const chunk = buffer.slice(0, boundary);
			buffer = buffer.slice(boundary + 2);
			const line = chunk.split("\n").find((l) => l.startsWith("data: "));
			if (line) render(JSON.parse(line.slice(6)) as ServerEvent);
			boundary = buffer.indexOf("\n\n");
		}
	}
}

// ─────────────────────────────────────────────────────────────
// 上行
// ─────────────────────────────────────────────────────────────

async function post(action: string, body?: unknown): Promise<void> {
	const response = await fetch(`${BASE}/session/${SESSION}/${action}`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body ?? {}),
	});
	if (!response.ok) {
		const detail = (await response.json().catch(() => ({}))) as { error?: string };
		console.log(red(`[${response.status}] ${detail.error ?? response.statusText}`));
	}
}

// ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
	const reader = new LineReader();
	const streamAbort = new AbortController();

	/**
	 * Ctrl+C 在這裡的意思**不是**「殺掉程式」，而是「中斷 server 上的 turn」。
	 *
	 * 這是 Lesson 3 那個 handleInterrupt 的分散式版本：一樣的分岔
	 * （有東西在跑就中斷，閒著才離開），只是中斷要跨進程送過去。
	 */
	const onInterrupt = (): void => {
		if (running) {
			void post("interrupt");
			return;
		}
		console.log(dim("\n再見。（server 還活著）"));
		streamAbort.abort();
		reader.close();
		process.exit(0);
	};
	reader.raw.on("SIGINT", onInterrupt);
	process.on("SIGINT", onInterrupt);

	listen(streamAbort.signal).catch((error: unknown) => {
		if (streamAbort.signal.aborted) return;
		console.log(red(`\n[事件流斷了] ${error instanceof Error ? error.message : String(error)}`));
		console.log(dim("server 沒開？先跑 bun run lesson-10"));
		process.exit(1);
	});

	try {
		while (true) {
			const line = await reader.next(`\x1b[36m> \x1b[0m`);
			if (line === null) break;
			const input = line.trim();
			if (!input) continue;
			if (input === "/exit") break;
			if (input === "/interrupt") {
				await post("interrupt");
				continue;
			}
			// 送出去之後**什麼都不畫**。等 turn_start 事件回來才畫。
			// 這樣第二個視窗看到的東西才會跟這裡一樣。
			await post("message", { text: input });
		}
	} finally {
		streamAbort.abort();
		reader.close();
	}
}

await main();
