/**
 * Lesson 10 - Agent server
 *
 * Lesson 3's agent lives in the terminal: `runTurn` runs and writes to `process.stdout` as it goes.
 * This lesson splits it into two processes:
 *
 *     client (UI)  ──HTTP POST──▶  server  ──▶  provider
 *                  ◀───  SSE  ───  server
 *
 * The core loop did not change (design principle 6). Only one thing did:
 *
 *     process.stdout.write(delta)   →   emit({ type: "text_delta", delta })
 *
 * And that single change forces out four problems that did not exist before:
 *   1. two windows are watching the same session, so who does an event go to?
 *   2. where does an interruption come from? (a terminal has SIGINT, a browser does not)
 *   3. when the UI closes, should a running turn die or live?
 *   4. when the UI reconnects, where did the events from the gap go?
 *
 * The fourth is this lesson's point, and it is a *silent* failure (design principle 7):
 * no error, no exception, just a missing passage on the user's screen that never comes back.
 *
 * Run:
 *   bun run lesson-10-agent-server/server.ts          # the fixed version
 *   NAIVE=1 bun run lesson-10-agent-server/server.ts  # the version that loses events
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
 * NAIVE=1 switches off the two things the second half of this lesson adds:
 *   - resending state on reconnect
 *   - checkpointing mid-turn
 *
 * The switch exists so that losing events can be demonstrated rather than described.
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
// Events
//
// This type is the contract between the server and the UI. It has several members
// StreamEvent does not, and every extra one exists *because there is a second process*:
//
//   ready / state   ← a reconnect needs a way to restore the UI to the right screen
//   turn_start      ← the UI needs to know when to grey the input box out
//   turn_done       ← and when to bring it back
//   input_rejected  ← an upstream request can be refused (a terminal never has this)
// ─────────────────────────────────────────────────────────────

export type ServerEvent =
	/** The first message on connect. Sent only to this one client. */
	| { type: "ready"; sessionId: string; provider: string; model: string; naive: boolean }
	/**
	 * The current complete state. **This is the key to reconnect correctness, not event replay.**
	 * See README Step 4.
	 */
	| { type: "state"; messages: Message[]; running: boolean }
	| { type: "turn_start"; text: string }
	| { type: "text_start" }
	| { type: "text_delta"; delta: string }
	| { type: "text_end" }
	| { type: "tool_call"; id: string; name: string; args: Record<string, unknown> }
	| { type: "tool_result"; id: string; name: string; content: string; isError: boolean }
	/** One "model response plus its tool results" finished. This is a checkpoint. */
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
	 * One provider per session.
	 *
	 * Not for performance: `fakeStreamingProvider` has a `step` counter inside, so two
	 * sessions sharing one instance would give B's first sentence A's third scripted passage.
	 * A real provider has no such state, but the rule "sessions share no mutable state"
	 * has to be held from the start, or caching and rate limiting will trip over it later.
	 */
	provider: StreamingProvider;
	/** Every connection watching this session. Possibly 0 (the UI closed), possibly 3. */
	clients: Set<(event: ServerEvent) => void>;
	running: boolean;
	/** Only set while running. Interrupting means aborting it, exactly as in Lesson 3. */
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
 * Send to every connection watching this session, **including the one that just sent the message**.
 *
 * The intuition is to let the sending client paint its own message (an optimistic update),
 * but then the screen has two sources: one painted locally and one pushed by the server.
 * The moment a second window opens, the two disagree.
 *
 * **A screen may have only one source of truth.** The client paints nothing on send and
 * waits for the event to come back, and two windows stay in sync by construction.
 *
 * The comment at openworker/coworker/server/app.py:1721 says the same thing.
 */
function broadcast(session: Session, event: ServerEvent): void {
	for (const send of session.clients) send(event);
}

/**
 * Which events are checkpoints: on receiving one, persist the session to disk.
 *
 * Why not persist every event? Because text_delta arrives dozens of times a second,
 * and those are **not state**; they are the process of state changing. Persisting a
 * process is pointless; persisting a result is not.
 *
 * Against `_CHECKPOINTS` at openworker/coworker/server/app.py:1702, which lists
 * turn_start / permission_required / directory_requested / plan_proposed /
 * iteration_end. The same shape: **either a stage completed, or it stopped to wait
 * for a person.**
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
// Persistence
//
// Deliberately the dumbest possible form (one JSON file per session).
// The point is not the storage format but *when* to store.
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
// Compared line by line against lesson-03-streaming/agent.ts's runTurn, there are only
// two kinds of difference:
//   1. every process.stdout.write / console.log → emit(session, {...})
//   2. approve returns false directly (approval travels upstream, which is Lessons 8-9;
//      not done here, see the README's "what this lesson deliberately leaves out")
//
// The interruption, history repair and tool-result completion logic is **untouched**.
// That is what design principle 6 protects: a new shell should not touch the core.
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

		// Interruption point A: the model is mid-sentence (as in Lesson 3)
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
						text: "[I interrupted your last reply. Wait for my next instruction; do not resume on your own.]",
					});
				}
				emit(session, { type: "turn_done", reason: "aborted" });
				return;
			}
			emit(session, { type: "turn_done", reason: "error", message: streamError.message });
			return;
		}

		if (!response) {
			emit(session, { type: "turn_done", reason: "error", message: "the stream did not end cleanly" });
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

		// Interruption point B: a tool is mid-execution (as in Lesson 3)
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

		// Interruption point C: stopped only after tool results are completed (as in Lesson 3)
		if (abortedDuringTools || signal.aborted) {
			emit(session, { type: "interrupted", where: "tools" });
			session.messages.push({
				role: "user",
				text: "[I interrupted your tool execution. Wait for my next instruction.]",
			});
			emit(session, { type: "turn_done", reason: "aborted" });
			return;
		}

		// A full turn completed = a checkpoint. A crash after this cannot eat this passage.
		emit(session, { type: "iteration_end", step });
	}

	emit(session, { type: "turn_done", reason: "max_steps" });
}

// ─────────────────────────────────────────────────────────────
// One turn at a time per session
//
// Why this is needed: a terminal is synchronous; the next prompt only appears after enter.
// HTTP is not. A user can press send twice, and two windows can send at once.
// Two turns mutating the same messages array corrupts the history.
//
// Against app.py:1744: the claim must complete *before* scheduling the task; the comment
// says "Keeping the claim outside prevents two back-to-back frames from both starting".
// Open the task first and check afterwards, and two requests both get through.
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

		// Deliberately not awaited. The HTTP request returns immediately and the turn runs in
		// the background, with progress pushed over SSE. **A turn's lifetime is unrelated to
		// the request that started it**, which is the core of "an agent cannot live in the UI process".
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
 * A server listening on localhost is **reachable from any website the user browses**.
 *
 * A piece of JavaScript on evil.example.com can fetch("http://127.0.0.1:7010/…"),
 * and this server holds shell tools. CORS blocks reading the response but does not
 * block the request arriving, and arriving is enough to start the agent running.
 *
 * So origin must be checked as an allowlist, not configured as a CORS header.
 * Requests with no Origin header (curl, native clients, tests) are allowed through;
 * this gate targets browsers, and a browser always sends an unforgeable Origin.
 *
 * openworker/coworker/server/app.py:26-46 states the reasoning more completely.
 */
const ALLOWED_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

function originAllowed(origin: string | undefined): boolean {
	return origin === undefined || ALLOWED_ORIGIN.test(origin);
}

/** A crude cap on upstream requests. Loopback is unauthenticated; any local process can reach it. */
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
 * SSE: a one-way event stream from server to client.
 *
 * Why SSE rather than WebSocket? Because this lesson only needs one-way push; upstream
 * things (sending a message, interrupting) fit in an ordinary POST, and SSE is plain
 * text, inspectable with curl, and needs no dependency.
 *
 * OpenWorker uses WebSocket, and the reason is in README Step 5: its upstream is not
 * just those two but also approval, directory authorisation, plan confirmation and
 * question replies (the chain of `elif kind == …` after app.py:1767).
 * Once upstream becomes a protocol, it deserves a bidirectional channel.
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

	// ── this if is the whole point of the lesson ──────────────
	//
	// The NAIVE version sends nothing on connect and waits for the next event. That looks
	// reasonable, because an "event stream" sounds like it should start from now.
	//
	// But that is not how the user thinks. They closed the window and reopened it expecting
	// **the conversation**, not "events from now on". What the model said during those
	// thirty seconds is permanently gone in the NAIVE version, with no error and no warning.
	//
	// The fix is not "buffer the events and replay them" (which requires deciding how big
	// the buffer is, when it expires, and which entry to replay from), but:
	// **reconnect = fetch the state again**. Events notify of state changes; state is the truth.
	if (!NAIVE) {
		send({ type: "state", messages: session.messages, running: session.running });
	}

	const keepAlive = setInterval(() => res.write(": ping\n\n"), 15_000);

	const cleanup = (): void => {
		clearInterval(keepAlive);
		session.clients.delete(send);
			// Note there is **no** abort here. Closing the UI does not mean stopping the work;
			// that is the user's decision, not the window's. See README Step 1.
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
				// Interruption is Lesson 3's three lines, with the signal source changed from SIGINT to HTTP.
			if (!session.controller || session.controller.signal.aborted) {
				json(res, 409, { error: "no turn is running" });
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
				json(res, 400, { error: "text must be a non-empty string" });
				return;
			}
			if (text.length > MAX_TEXT_CHARS) {
				json(res, 413, { error: "text is too long" });
				return;
			}

				// The claim must complete before the turn opens, with no await in between.
			if (!tryMarkRunning(session)) {
				broadcast(session, {
					type: "input_rejected",
					error: "This session is already running a turn. Wait for it, or interrupt it first.",
				});
				json(res, 409, { error: "already running" });
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
	if (NAIVE) console.log(yellow("NAIVE=1: no state replay on reconnect, and no mid-turn persistence"));
	console.log(dim(`In another terminal, run: bun run lesson-10:client`));
});
