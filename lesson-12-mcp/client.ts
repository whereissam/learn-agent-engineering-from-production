/**
 * MCP client。
 *
 * 對照 `openworker/coworker/mcp/client.py`（158 行）跟
 * `mastra/packages/mcp/src/client/`。兩份的形狀一樣，
 * 因為 MCP 的形狀就這麼一個。
 *
 * 跟自己寫的工具（Lesson 2）最大的差別**不是**協定，是信任：
 *
 *   自己寫的工具   在你的進程裡、你寫的、會 throw 你認得的錯
 *   MCP 工具       在別人的進程裡、別人寫的、可能永遠不回應
 *
 * 所以這個檔案裡有一半的程式碼在處理「它不乖怎麼辦」。
 */

import { spawn, type ChildProcess } from "node:child_process";

const PROTOCOL_VERSION = "2025-06-18";

/**
 * 每一個請求的逾時。
 *
 * 為什麼一定要有：MCP server 是**別人的進程**。它可以當掉、可以卡住、
 * 可以永遠不回你。沒有逾時的話，一個壞掉的 server 會讓整個 agent 停住。
 *
 * 對照 Lesson 9 的 inbox 刻意**沒有**逾時。判準是同一條：
 * 逾時之後有沒有安全的預設行為？
 *   - inbox 等的是人的決定，逾時之後放行或拒絕都不安全 → 不設
 *   - MCP 等的是一個工具結果，逾時就當它失敗 → 要設
 */
const CONNECT_TIMEOUT_MS = Number(process.env.MCP_CONNECT_TIMEOUT_MS ?? 5000);
const CALL_TIMEOUT_MS = Number(process.env.MCP_CALL_TIMEOUT_MS ?? 10_000);

export interface McpServerDef {
	name: string;
	command: string;
	args: string[];
	env?: Record<string, string>;
	/** 只允許這些工具。省略 = 全部。 */
	includeTools?: string[];
	/** 擋掉這些工具。 */
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

		// server 的 stderr 不是協定通道，但也不該直接丟掉：
		// 大部分「MCP server 不動了」的原因都寫在這裡。
		child.stderr?.on("data", (chunk: Buffer) => {
			for (const line of chunk.toString("utf8").split("\n")) {
				if (line.trim()) this.onLog?.(`[${this.serverName}] ${line.trim()}`);
			}
		});

		// 進程死掉的時候要把所有等待中的請求叫醒，
		// 不然它們會一直等到逾時，而那個逾時是沒必要的。
		child.on("exit", (code) => {
			this.closed = true;
			this.failAll(new Error(`MCP server "${this.serverName}" 結束了（code ${code}）`));
		});
	}

	/** 收到 server 的 stderr 一行。 */
	onLog?: (line: string) => void;

	/**
	 * 連上一台 server 並完成握手。
	 *
	 * **這個函式失敗是正常的**，呼叫端必須能承受（見 agent.ts 的失敗隔離）。
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

		// 握手的第三步是一個通知，沒有回應。
		connection.notify("notifications/initialized", {});
		return connection;
	}

	async listTools(def: McpServerDef): Promise<McpToolDef[]> {
		const result = (await this.request("tools/list", {}, CONNECT_TIMEOUT_MS)) as {
			tools?: McpToolDef[];
		};
		let tools = result.tools ?? [];

		// ── per-tool 控制 ────────────────────────────────────
		//
		// 為什麼需要：一台 MCP server 可能給你 40 個工具，其中你只要 2 個。
		// 全部收下來的話，索引成本每一輪都在燒（Lesson 16 Step 1），
		// 而且多出來的 38 個都是攻擊面。
		//
		// 對照 openworker/coworker/mcp/tools.py 的 `_filtered`。
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

		// 把 content 陣列壓成一段字串。
		// 非文字的區塊（圖片、resource）用一個佔位符描述，
		// 因為模型看得懂「這裡有一張圖」比看到一坨 base64 有用。
		// 對照 client.py 的 `_result_payload`。
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

	// ── JSON-RPC 底層 ────────────────────────────────────────

	private request(method: string, params: unknown, timeoutMs: number): Promise<unknown> {
		if (this.closed) return Promise.reject(new Error("connection closed"));

		const id = this.nextId++;
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`${method} 逾時（${timeoutMs}ms）`));
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
				continue; // server 吐了非 JSON，通常是它自己 console.log 了
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
// 命名
// ─────────────────────────────────────────────────────────────

/** OpenAI 的 function name 規則：`[A-Za-z0-9_-]{1,64}`。 */
const MAX_TOOL_NAME = 64;
const ILLEGAL = /[^a-zA-Z0-9_-]/g;

/**
 * `mcp__<server>__<tool>`，消毒過而且截斷到 64 字。
 *
 * 對照 openworker/coworker/mcp/tools.py 的 `tool_name`（同樣的規則、
 * 同樣的上限）。
 *
 * ⚠️ **截斷會造成碰撞**，而 openworker 那份跟我們這份都沒有處理。
 * 兩台 server 名字很長又有同名工具的時候，第二個會覆蓋第一個，
 * 而且**沒有任何警告**。見 README Step 4 跟練習 2。
 */
export function toolName(server: string, tool: string): string {
	const full = `mcp__${server.replace(ILLEGAL, "_")}__${tool.replace(ILLEGAL, "_")}`;
	return full.length > MAX_TOOL_NAME ? full.slice(0, MAX_TOOL_NAME) : full;
}
