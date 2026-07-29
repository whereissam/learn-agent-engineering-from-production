/**
 * Lesson 10 - Agent server
 *
 * Lesson 3 的 agent 住在終端機裡：`runTurn` 一邊跑一邊 `process.stdout.write`。
 * 這一課把它拆成兩個進程：
 *
 *     client (UI)  ──HTTP POST──▶  server  ──▶  provider
 *                  ◀───  SSE  ───  server
 *
 * 核心 loop 沒有改（設計原則 6）。改的只有一件事：
 *
 *     process.stdout.write(delta)   →   emit({ type: "text_delta", delta })
 *
 * 但光是這一個改動，就逼出四個原本不存在的問題：
 *   1. 同一個 session 有兩個視窗在看，事件要送給誰？
 *   2. 中斷從哪裡進來？（終端機有 SIGINT，瀏覽器沒有）
 *   3. UI 關掉的時候，正在跑的 turn 該死還是該活？
 *   4. UI 重新連上來的時候，斷線期間的事件去哪了？
 *
 * 第 4 題是這課的重點，而且它是一個**安靜的失敗**（設計原則 7）：
 * 沒有錯誤、沒有例外，只是使用者的畫面少了一段，而且永遠補不回來。
 *
 * 執行：
 *   bun run lesson-10-agent-server/server.ts          # 修好的版本
 *   NAIVE=1 bun run lesson-10-agent-server/server.ts  # 會掉事件的版本
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { selectStreamingProvider } from "../shared/streaming/index.ts";
import type { Message, StreamingProvider, ToolResult } from "../shared/streaming/types.ts";
import {
	editFileTool,
	listFilesTool,
	readFileTool,
	runCommandTool,
	type ToolContext,
	ToolRegistry,
	writeFileTool,
} from "../shared/tools/index.ts";

const ROOT = resolve(import.meta.dirname, "playground");
const SESSION_DIR = resolve(import.meta.dirname, "sessions");
const PORT = Number(process.env.PORT ?? 7010);
const MAX_TOKENS = 16000;
const MAX_STEPS = 25;

/**
 * NAIVE=1 會關掉這一課後半段做的兩件事：
 *   - 重連時重送狀態
 *   - turn 中途存檔（checkpoint）
 *
 * 留著這個開關是為了讓「掉事件」可以被示範出來，而不是用講的。
 */
const NAIVE = process.env.NAIVE === "1";

const SYSTEM_PROMPT = `You are a coding agent working in a small TypeScript project.

Available tools: list_files, read_file, write_file, edit_file, run_command.

Working rules:
- Explore with list_files before guessing at file names.
- Always read_file before you edit it.
- After changing code, run the tests with run_command to verify.

Answer in the same language the user writes in.`;

const registry = new ToolRegistry([
	listFilesTool,
	readFileTool,
	writeFileTool,
	editFileTool,
	runCommandTool,
]);

// ─────────────────────────────────────────────────────────────
// 事件
//
// 這份型別就是「server 跟 UI 之間的契約」。它比 StreamEvent 多了幾種，
// 多出來的全部都是**因為有第二個進程才需要的**：
//
//   ready / state   ← 重連時要有辦法把 UI 補回正確畫面
//   turn_start      ← UI 要知道什麼時候該把輸入框變灰
//   turn_done       ← 以及什麼時候變回來
//   input_rejected  ← 上行的請求可能被拒絕（終端機不會有這種事）
// ─────────────────────────────────────────────────────────────

export type ServerEvent =
	/** 連上來的第一則。只送給這一個 client。 */
	| { type: "ready"; sessionId: string; provider: string; model: string; naive: boolean }
	/**
	 * 目前的完整狀態。**這是重連正確性的關鍵，不是事件重播。**
	 * 見 README Step 4。
	 */
	| { type: "state"; messages: Message[]; running: boolean }
	| { type: "turn_start"; text: string }
	| { type: "text_start" }
	| { type: "text_delta"; delta: string }
	| { type: "text_end" }
	| { type: "tool_call"; id: string; name: string; args: Record<string, unknown> }
	| { type: "tool_result"; id: string; name: string; content: string; isError: boolean }
	/** 一次「模型回應 + 它的工具結果」跑完了。這是一個 checkpoint。 */
	| { type: "iteration_end"; step: number }
	| { type: "interrupted"; where: "stream" | "tools" }
	| { type: "turn_done"; reason: "end" | "aborted" | "error" | "max_steps"; message?: string }
	| { type: "input_rejected"; error: string };

// ─────────────────────────────────────────────────────────────
// Session
// ─────────────────────────────────────────────────────────────

interface Session {
	id: string;
	messages: Message[];
	/**
	 * 一個 session 一個 provider。
	 *
	 * 不是效能考量，`fakeStreamingProvider` 內部有個 `step` 計數器，
	 * 兩個 session 共用一個實例的話，B 的第一句話會拿到 A 的第三段劇本。
	 * 真實 provider 沒有這個狀態，但「session 之間不共用可變狀態」
	 * 這條規則要一開始就守住，不然之後加快取、加 rate limit 都會踩到。
	 */
	provider: StreamingProvider;
	/** 正在看這個 session 的所有連線。可能是 0 個（UI 關掉了），也可能是 3 個。 */
	clients: Set<(event: ServerEvent) => void>;
	running: boolean;
	/** 只有在 running 的時候有值。中斷就是 abort 它，跟 Lesson 3 一模一樣。 */
	controller?: AbortController;
}

const sessions = new Map<string, Session>();

function getSession(id: string): Session {
	let session = sessions.get(id);
	if (!session) {
		session = {
			id,
			messages: load(id),
			provider: selectStreamingProvider(),
			clients: new Set(),
			running: false,
		};
		sessions.set(id, session);
	}
	return session;
}

/**
 * 送給「所有正在看這個 session 的連線」，**包含剛剛送出訊息的那一個**。
 *
 * 直覺上會想讓送訊息的那個 client 自己把訊息畫上去（樂觀更新），
 * 但那樣一來畫面就有兩個來源：一個是自己畫的，一個是 server 推的。
 * 第二個視窗打開的那一刻，兩邊就會不一致。
 *
 * **一個畫面只能有一個真相來源。** client 送出去之後什麼都不畫，
 * 等事件回來再畫，兩個視窗自然就同步了。
 *
 * 對照 openworker/coworker/server/app.py:1721 的註解，寫的是同一件事。
 */
function broadcast(session: Session, event: ServerEvent): void {
	for (const send of session.clients) send(event);
}

/**
 * 哪些事件是 checkpoint：收到它的時候要把 session 存到硬碟。
 *
 * 為什麼不是每個事件都存？因為 text_delta 一秒鐘有幾十個，
 * 而且它們**不是狀態**，它們是狀態變化的過程。存過程沒有意義，
 * 存結果才有。
 *
 * 對照 openworker/coworker/server/app.py:1702 的 `_CHECKPOINTS`，
 * 那邊列的是 turn_start / permission_required / directory_requested /
 * plan_proposed / iteration_end。形狀一樣：**要嘛是一段完成了，
 * 要嘛是停下來等人。**
 */
const CHECKPOINTS: ReadonlySet<ServerEvent["type"]> = new Set([
	"turn_start",
	"iteration_end",
	"turn_done",
]);

function emit(session: Session, event: ServerEvent): void {
	broadcast(session, event);
	if (!NAIVE && CHECKPOINTS.has(event.type)) save(session);
}

// ─────────────────────────────────────────────────────────────
// 持久化
//
// 刻意做成最笨的形式（一個 session 一個 JSON 檔）。
// 重點不是儲存格式，是「什麼時候存」。
// ─────────────────────────────────────────────────────────────

function sessionPath(id: string): string {
	return resolve(SESSION_DIR, `${id}.json`);
}

function save(session: Session): void {
	mkdirSync(SESSION_DIR, { recursive: true });
	writeFileSync(sessionPath(session.id), JSON.stringify(session.messages, null, 2));
}

function load(id: string): Message[] {
	try {
		return JSON.parse(readFileSync(sessionPath(id), "utf8")) as Message[];
	} catch {
		return [];
	}
}

// ─────────────────────────────────────────────────────────────
// Agent loop
//
// 跟 lesson-03-streaming/agent.ts 的 runTurn 逐行對照，只有兩類差異：
//
//   1. 每一個 process.stdout.write / console.log → emit(session, {...})
//   2. approve 直接回 false（批准要走上行訊息，那是 Lesson 8-9 的事，
//      這課先不做，見 README「這課刻意不做的事」）
//
// 中斷、歷史修復、工具結果補齊的邏輯**一個字都沒動**。
// 這就是設計原則 6 想保護的東西：換一個外殼不應該碰到核心。
// ─────────────────────────────────────────────────────────────

async function runTurn(session: Session, signal: AbortSignal): Promise<void> {
	const ctx: ToolContext = {
		root: ROOT,
		approve: async () => false,
		log: () => {},
	};

	for (let step = 0; step < MAX_STEPS; step++) {
		let response: Awaited<ReturnType<StreamingProvider["call"]>> | undefined;
		let streamError: { message: string; aborted: boolean } | undefined;
		let partialText = "";

		for await (const event of session.provider.stream(
			{
				system: SYSTEM_PROMPT,
				messages: session.messages,
				tools: registry.specs(),
				maxTokens: MAX_TOKENS,
			},
			signal,
		)) {
			switch (event.type) {
				case "text_start":
					emit(session, { type: "text_start" });
					break;
				case "text_delta":
					partialText += event.delta;
					emit(session, { type: "text_delta", delta: event.delta });
					break;
				case "text_end":
					emit(session, { type: "text_end" });
					break;
				case "tool_call":
					emit(session, {
						type: "tool_call",
						id: event.id,
						name: event.name,
						args: event.args,
					});
					break;
				case "done":
					response = event.response;
					break;
				case "error":
					streamError = { message: event.message, aborted: event.aborted };
					break;
			}
		}

		// 中斷點 A：模型講到一半（跟 Lesson 3 相同）
		if (streamError) {
			if (streamError.aborted) {
				emit(session, { type: "interrupted", where: "stream" });
				if (partialText.trim()) {
					session.messages.push({
						role: "assistant",
						blocks: [{ type: "text", text: partialText }],
						raw: { role: "assistant", content: partialText },
					});
					session.messages.push({
						role: "user",
						text: "[你上一則回覆被我中斷了。等我的下一個指示，不要自己接續。]",
					});
				}
				emit(session, { type: "turn_done", reason: "aborted" });
				return;
			}
			emit(session, { type: "turn_done", reason: "error", message: streamError.message });
			return;
		}

		if (!response) {
			emit(session, { type: "turn_done", reason: "error", message: "串流沒有正常結束" });
			return;
		}

		session.messages.push({ role: "assistant", blocks: response.blocks, raw: response.raw });

		if (response.stopReason === "refusal" || response.stopReason === "max_tokens") {
			emit(session, { type: "turn_done", reason: "error", message: response.stopReason });
			return;
		}

		const toolCalls = response.blocks.filter((b) => b.type === "toolCall");
		if (toolCalls.length === 0) {
			emit(session, { type: "turn_done", reason: "end" });
			return;
		}

		// 中斷點 B：工具跑到一半（跟 Lesson 3 相同）
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
				emit(session, {
					type: "tool_result",
					id: call.id,
					name: call.name,
					content: firstLine(content),
					isError: false,
				});
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				results.push({
					toolCallId: call.id,
					toolName: call.name,
					content: message,
					isError: true,
				});
				emit(session, {
					type: "tool_result",
					id: call.id,
					name: call.name,
					content: firstLine(message),
					isError: true,
				});
			}
		}

		session.messages.push({ role: "toolResult", results });

		// 中斷點 C：工具結果補齊了才停（跟 Lesson 3 相同）
		if (abortedDuringTools || signal.aborted) {
			emit(session, { type: "interrupted", where: "tools" });
			session.messages.push({
				role: "user",
				text: "[我中斷了你的工具執行。等我的下一個指示。]",
			});
			emit(session, { type: "turn_done", reason: "aborted" });
			return;
		}

		// 一輪完整跑完 = checkpoint。crash 在這之後就不會吃掉這一段。
		emit(session, { type: "iteration_end", step });
	}

	emit(session, { type: "turn_done", reason: "max_steps" });
}

// ─────────────────────────────────────────────────────────────
// 一個 session 一次只能跑一輪
//
// 為什麼需要這個：終端機是同步的，你打完 enter 才會有下一個 prompt。
// HTTP 不是。使用者可以連按兩次送出，兩個視窗也可以同時送。
// 兩個 turn 同時改同一個 messages 陣列，歷史就爛了。
//
// 對照 app.py:1744：claim 要在「排程 task 之前」做完，
// 註解寫「Keeping the claim outside prevents two back-to-back frames
// from both starting」，如果先開 task 再檢查，兩個請求會同時通過。
// ─────────────────────────────────────────────────────────────

function tryMarkRunning(session: Session): boolean {
	if (session.running) return false;
	session.running = true;
	return true;
}

function startTurn(session: Session, text: string): void {
	session.messages.push({ role: "user", text });
	emit(session, { type: "turn_start", text });

	const controller = new AbortController();
	session.controller = controller;

	// 刻意不 await。HTTP 請求要立刻回，turn 在背景跑，
	// 進度靠 SSE 推。**turn 的生命週期跟送出它的那個請求無關**，
	// 這正是「agent 不能住在 UI 進程裡」的核心。
	void runTurn(session, controller.signal)
		.catch((error: unknown) => {
			emit(session, {
				type: "turn_done",
				reason: "error",
				message: error instanceof Error ? error.message : String(error),
			});
		})
		.finally(() => {
			session.running = false;
			session.controller = undefined;
			if (!NAIVE) save(session);
		});
}

// ─────────────────────────────────────────────────────────────
// HTTP
// ─────────────────────────────────────────────────────────────

/**
 * 一個開在 localhost 的 server，**使用者瀏覽的任何網站都打得到它**。
 *
 * evil.example.com 的一段 JavaScript 可以 fetch("http://127.0.0.1:7010/…")，
 * 而這個 server 手上有 shell 工具。CORS 擋得住讀回應，
 * 但擋不住請求送達，而「送達」就足夠讓 agent 開始跑東西了。
 *
 * 所以 origin 要當成白名單來檢查，不是當成 CORS 標頭來設定。
 * 沒有 Origin 標頭的（curl、原生 client、測試）放行，
 * 這個閘門針對的是瀏覽器，而瀏覽器一定會帶 Origin 且無法偽造。
 *
 * 對照 openworker/coworker/server/app.py:26-46，理由寫得比我這裡更完整。
 */
const ALLOWED_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

function originAllowed(origin: string | undefined): boolean {
	return origin === undefined || ALLOWED_ORIGIN.test(origin);
}

/** 上行請求的粗暴上限。loopback 是不認證的，任何本機程序都打得到。 */
const RATE_LIMIT_COUNT = 30;
const RATE_LIMIT_WINDOW_MS = 10_000;
const inbound: number[] = [];

function rateLimited(): boolean {
	const now = Date.now();
	while (inbound.length > 0 && now - (inbound[0] ?? 0) > RATE_LIMIT_WINDOW_MS) inbound.shift();
	if (inbound.length >= RATE_LIMIT_COUNT) return true;
	inbound.push(now);
	return false;
}

const MAX_TEXT_CHARS = 200_000;

function json(res: ServerResponse, status: number, body: unknown): void {
	const payload = JSON.stringify(body);
	res.writeHead(status, { "content-type": "application/json" });
	res.end(payload);
}

async function readBody(req: IncomingMessage): Promise<string> {
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of req) {
		size += (chunk as Buffer).length;
		if (size > 1_000_000) throw new Error("Request body too large");
		chunks.push(chunk as Buffer);
	}
	return Buffer.concat(chunks).toString("utf8");
}

/**
 * SSE：server → client 的單向事件流。
 *
 * 為什麼是 SSE 而不是 WebSocket？因為這課只需要單向推送，
 * 上行的東西（送訊息、中斷）用普通的 POST 就夠了，而 SSE
 * 是純文字、可以用 curl 看、不需要任何依賴。
 *
 * OpenWorker 用的是 WebSocket，理由在 README Step 5：
 * 它的上行不只有這兩種，還有批准、目錄授權、計畫確認、提問回覆
 * （app.py:1767 之後那一串 `elif kind == …`）。
 * 上行一旦變成一個協定，就該用雙向通道。
 */
function openStream(req: IncomingMessage, res: ServerResponse, session: Session): void {
	res.writeHead(200, {
		"content-type": "text/event-stream",
		"cache-control": "no-cache",
		connection: "keep-alive",
	});

	const send = (event: ServerEvent): void => {
		res.write(`data: ${JSON.stringify(event)}\n\n`);
	};

	session.clients.add(send);

	send({
		type: "ready",
		sessionId: session.id,
		provider: session.provider.name,
		model: session.provider.model,
		naive: NAIVE,
	});

	// ── 這課的重點就是這個 if ───────────────────────────────
	//
	// NAIVE 版本連上來之後什麼都不送，等下一個事件。看起來很合理，
	// 因為「事件流」聽起來就該從現在開始。
	//
	// 但使用者不是這樣想的。他關掉視窗再打開，期待看到的是
	// **對話**，不是「從現在開始的事件」。斷線那三十秒模型講的話，
	// 在 NAIVE 版本裡是永久消失的，沒有錯誤、沒有警告。
	//
	// 修法不是「把事件存起來重播」（那要決定 buffer 多大、多久過期、
	// 重播到哪一則），而是：**重連 = 重新拿一次狀態**。
	// 事件是狀態變化的通知，狀態才是真相。
	if (!NAIVE) {
		send({ type: "state", messages: session.messages, running: session.running });
	}

	const keepAlive = setInterval(() => res.write(": ping\n\n"), 15_000);

	const cleanup = (): void => {
		clearInterval(keepAlive);
		session.clients.delete(send);
		// 注意這裡**沒有** abort。UI 關掉不代表要停止工作，
		// 那是使用者的決定，不是視窗的。見 README Step 1。
	};
	req.on("close", cleanup);
	res.on("close", cleanup);
}

const server = createServer((req, res) => {
	void (async () => {
		if (!originAllowed(req.headers.origin)) {
			json(res, 403, { error: "Origin not allowed" });
			return;
		}

		const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
		const match = /^\/session\/([A-Za-z0-9_-]{1,64})(\/[a-z]+)?$/.exec(url.pathname);
		if (!match) {
			json(res, 404, { error: "Not found" });
			return;
		}

		const session = getSession(match[1] as string);
		const action = match[2] ?? "";

		if (req.method === "GET" && action === "/events") {
			openStream(req, res, session);
			return;
		}

		if (req.method === "GET" && action === "") {
			json(res, 200, { messages: session.messages, running: session.running });
			return;
		}

		if (req.method !== "POST") {
			json(res, 405, { error: "Method not allowed" });
			return;
		}

		if (rateLimited()) {
			json(res, 429, { error: "Too many requests" });
			return;
		}

		if (action === "/interrupt") {
			// 中斷就是 Lesson 3 的那三行，只是訊號來源從 SIGINT 換成 HTTP。
			if (!session.controller || session.controller.signal.aborted) {
				json(res, 409, { error: "沒有正在跑的 turn" });
				return;
			}
			session.controller.abort();
			json(res, 202, { ok: true });
			return;
		}

		if (action === "/message") {
			let text: unknown;
			try {
				text = (JSON.parse(await readBody(req)) as { text?: unknown }).text;
			} catch {
				json(res, 400, { error: "Invalid JSON" });
				return;
			}
			if (typeof text !== "string" || text.trim() === "") {
				json(res, 400, { error: "text 必須是非空字串" });
				return;
			}
			if (text.length > MAX_TEXT_CHARS) {
				json(res, 413, { error: "text 太長" });
				return;
			}

			// claim 一定要在開 turn 之前做完，而且中間不能有 await。
			if (!tryMarkRunning(session)) {
				broadcast(session, {
					type: "input_rejected",
					error: "這個 session 正在跑一輪。等它跑完，或先中斷它。",
				});
				json(res, 409, { error: "已經在跑了" });
				return;
			}

			startTurn(session, text);
			json(res, 202, { ok: true });
			return;
		}

		json(res, 404, { error: "Not found" });
	})();
});

function firstLine(text: string): string {
	const line = text.split("\n")[0] ?? "";
	return line.length > 100 ? `${line.slice(0, 100)}…` : line;
}

server.listen(PORT, "127.0.0.1", () => {
	const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
	const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
	console.log(dim(`agent server → http://127.0.0.1:${PORT}`));
	if (NAIVE) console.log(yellow("NAIVE=1：重連不重送狀態、turn 中途不存檔"));
	console.log(dim(`另開一個終端機跑：bun run lesson-10:client`));
});
