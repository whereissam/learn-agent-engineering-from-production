/**
 * MCP client。
 *
 * Against `openworker/coworker/mcp/client.py` (158 lines) and
 * `mastra/packages/mcp/src/client/`. The two have the same shape,
 * because MCP has only one shape.
 *
 * The biggest difference from tools you wrote yourself (Lesson 2) is **not** the protocol but trust:
 *
 *   your own tools   in your process, written by you, throwing errors you recognise
 *   MCP tools        in somebody else's process, written by somebody else, possibly never answering
 *
 * So half the code in this file handles "what if it misbehaves".
 */

import { spawn, type ChildProcess } from "node:child_process";

const PROTOCOL_VERSION = "2025-06-18";

/**
 * A timeout on every request.
 *
 * Why there must be one: an MCP server is **somebody else's process**. It can crash, it can hang,
 * it can never answer. Without a timeout, one broken server stops the whole agent.
 *
 * Note Lesson 9's inbox deliberately has **no** timeout. The criterion is the same:
 * is there a safe default behaviour after a timeout?
 *   - the inbox waits for a human decision, and neither allowing nor denying is safe → none
 *   - MCP waits for a tool result, and a timeout means treating it as failed → set one
 */
const CONNECT_TIMEOUT_MS = Number(process.env.MCP_CONNECT_TIMEOUT_MS ?? 5000);
const CALL_TIMEOUT_MS = Number(process.env.MCP_CALL_TIMEOUT_MS ?? 10_000);

export interface McpServerDef {
	name: string;
	command: string;
	args: string[];
	env?: Record<string, string>;
	/** Allow only these tools. Omitted = all of them. */
	includeTools?: string[];
	/** Block these tools. */
	excludeTools?: string[];
}

export interface McpToolDef {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
}

interface Pending {
	resolve: (value: unknown) => void;
	reject: (error: Error) => void;
	timer: ReturnType<typeof setTimeout>;
}

export class McpConnection {
	readonly serverName: string;
	private readonly child: ChildProcess;
	private readonly pending = new Map<number, Pending>();
	private nextId = 1;
	private buffer = "";
	private closed = false;

	private constructor(def: McpServerDef, child: ChildProcess) {
		this.serverName = def.name;
		this.child = child;

		child.stdout?.on("data", (chunk: Buffer) => this.onData(chunk));

			// A server's stderr is not a protocol channel, and it must not be discarded either:
			// most reasons for "the MCP server stopped working" are written there.
		child.stderr?.on("data", (chunk: Buffer) => {
			for (const line of chunk.toString("utf8").split("\n")) {
				if (line.trim()) this.onLog?.(`[${this.serverName}] ${line.trim()}`);
			}
		});

			// When the process dies, wake every pending request,
			// or they wait out a timeout that serves no purpose.
		child.on("exit", (code) => {
			this.closed = true;
			this.failAll(new Error(`MCP server "${this.serverName}" exited (code ${code})`));
		});
	}

		/** A line of stderr arrived from the server. */
	onLog?: (line: string) => void;

	/**
		 * Connect to one server and complete the handshake.
	 *
		 * **This function failing is normal**, and the caller must survive it (see the failure isolation in agent.ts).
	 */
	static async connect(def: McpServerDef): Promise<McpConnection> {
		const child = spawn(def.command, def.args, {
			env: { ...process.env, ...def.env },
			stdio: ["pipe", "pipe", "pipe"],
		});

		const connection = new McpConnection(def, child);

		try {
			await connection.request(
				"initialize",
				{
					protocolVersion: PROTOCOL_VERSION,
					capabilities: {},
					clientInfo: { name: "agent-lessons", version: "1.0.0" },
				},
				CONNECT_TIMEOUT_MS,
			);
		} catch (error) {
			connection.close();
			throw error;
		}

			// The handshake's third step is a notification with no response.
		connection.notify("notifications/initialized", {});
		return connection;
	}

	async listTools(def: McpServerDef): Promise<McpToolDef[]> {
		const result = (await this.request("tools/list", {}, CONNECT_TIMEOUT_MS)) as {
			tools?: McpToolDef[];
		};
		let tools = result.tools ?? [];

			// ── per-tool control ──────────────────────────────────
		//
			// Why it is needed: one MCP server may offer 40 tools when you want 2.
			// Taking them all burns indexing cost every turn (Lesson 16 Step 1),
			// and the extra 38 are all attack surface.
		//
			// Against `_filtered` in openworker/coworker/mcp/tools.py.
		if (def.includeTools) {
			const allow = new Set(def.includeTools);
			tools = tools.filter((tool) => allow.has(tool.name));
		}
		if (def.excludeTools) {
			const block = new Set(def.excludeTools);
			tools = tools.filter((tool) => !block.has(tool.name));
		}
		return tools;
	}

	async callTool(name: string, args: Record<string, unknown>): Promise<string> {
		const result = (await this.request(
			"tools/call",
			{ name, arguments: args },
			CALL_TIMEOUT_MS,
		)) as { content?: Array<{ type: string; text?: string }>; isError?: boolean };

			// Flatten the content array into one string.
			// Non-text blocks (images, resources) become a placeholder description,
			// because a model finds "there is an image here" more useful than a blob of base64.
			// Against `_result_payload` in client.py.
		const text = (result.content ?? [])
			.map((block) => block.text ?? `[${block.type}]`)
			.join("\n");

		if (result.isError) throw new Error(text || "MCP tool error");
		return text;
	}

	close(): void {
		if (this.closed) return;
		this.closed = true;
		this.child.kill();
		this.failAll(new Error("connection closed"));
	}

		// ── the JSON-RPC layer ────────────────────────────────────

	private request(method: string, params: unknown, timeoutMs: number): Promise<unknown> {
		if (this.closed) return Promise.reject(new Error("connection closed"));

		const id = this.nextId++;
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`${method} timed out (${timeoutMs}ms)`));
			}, timeoutMs);

			this.pending.set(id, { resolve, reject, timer });
			this.child.stdin?.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
		});
	}

	private notify(method: string, params: unknown): void {
		this.child.stdin?.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
	}

	private onData(chunk: Buffer): void {
		this.buffer += chunk.toString("utf8");
		let newline = this.buffer.indexOf("\n");
		while (newline !== -1) {
			const line = this.buffer.slice(0, newline).trim();
			this.buffer = this.buffer.slice(newline + 1);
			newline = this.buffer.indexOf("\n");
			if (!line) continue;

			let message: { id?: number; result?: unknown; error?: { message?: string } };
			try {
				message = JSON.parse(line);
			} catch {
				continue; // the server emitted non-JSON, usually its own console.log
			}

			if (message.id === undefined) continue;
			const waiting = this.pending.get(message.id);
			if (!waiting) continue;

			clearTimeout(waiting.timer);
			this.pending.delete(message.id);
			if (message.error) waiting.reject(new Error(message.error.message ?? "MCP error"));
			else waiting.resolve(message.result);
		}
	}

	private failAll(error: Error): void {
		for (const waiting of this.pending.values()) {
			clearTimeout(waiting.timer);
			waiting.reject(error);
		}
		this.pending.clear();
	}
}

// ─────────────────────────────────────────────────────────────
// Naming
// ─────────────────────────────────────────────────────────────

/** OpenAI's function name rule: `[A-Za-z0-9_-]{1,64}`. */
const MAX_TOOL_NAME = 64;
const ILLEGAL = /[^a-zA-Z0-9_-]/g;

/**
 * `mcp__<server>__<tool>`, sanitised and truncated to 64 characters.
 *
 * Against `tool_name` in openworker/coworker/mcp/tools.py (the same rule and the same limit).
 *
 * ⚠️ **Truncation causes collisions**, and neither openworker's version nor this one handles it.
 * When two servers have long names and a tool name in common, the second overwrites the first
 * **with no warning at all**. See README Step 4 and Exercise 2.
 */
export function toolName(server: string, tool: string): string {
	const full = `mcp__${server.replace(ILLEGAL, "_")}__${tool.replace(ILLEGAL, "_")}`;
	return full.length > MAX_TOOL_NAME ? full.slice(0, MAX_TOOL_NAME) : full;
}
