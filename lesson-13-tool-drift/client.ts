/**
 * The smallest MCP client that can re-list.
 *
 * Lesson 12 built the full version — timeouts, a broken-server entry, crash
 * isolation, namespacing. This one keeps only what the experiment needs and adds
 * the one thing Lesson 12 never exercised: calling `tools/list` **twice**.
 *
 * That is the whole reason this file exists. A client that lists once at startup
 * cannot observe drift, and so cannot be attacked this way — but it also cannot
 * see a legitimately updated tool, which is why real clients re-list and why the
 * MCP capability `tools: { listChanged: true }` exists at all
 * (`mastra/packages/mcp/src/client/client.ts:286`).
 */

import { type ChildProcess, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { ToolDescriptor } from "./pin.ts";

const REQUEST_TIMEOUT_MS = 5000;

interface Pending {
	resolve(value: unknown): void;
	reject(error: Error): void;
	timer: NodeJS.Timeout;
}

export class McpConnection {
	private child: ChildProcess | undefined;
	private pending = new Map<number, Pending>();
	private nextId = 1;

	constructor(
		readonly serverName: string,
		private command: string,
		private args: string[],
		private env: Record<string, string> = {},
	) {}

	async connect(): Promise<void> {
		this.child = spawn(this.command, this.args, {
			stdio: ["pipe", "pipe", "pipe"],
			env: { ...process.env, ...this.env },
		});

		const stdout = this.child.stdout;
		if (!stdout) throw new Error("server has no stdout");

		createInterface({ input: stdout }).on("line", (line) => {
			if (!line.trim()) return;
			let message: { id?: number; result?: unknown; error?: { message?: string } };
			try {
				message = JSON.parse(line);
			} catch {
				return;
			}
			if (message.id === undefined) return;
			const pending = this.pending.get(message.id);
			if (!pending) return;
			this.pending.delete(message.id);
			clearTimeout(pending.timer);
			if (message.error) pending.reject(new Error(message.error.message ?? "server error"));
			else pending.resolve(message.result);
		});

		await this.request("initialize", { protocolVersion: "2024-11-05", capabilities: {} });
		this.notify("notifications/initialized", {});
	}

	private notify(method: string, params: Record<string, unknown>): void {
		this.child?.stdin?.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
	}

	private request(method: string, params: Record<string, unknown>): Promise<unknown> {
		const id = this.nextId++;
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`${method} timed out`));
			}, REQUEST_TIMEOUT_MS);
			this.pending.set(id, { resolve, reject, timer });
			this.child?.stdin?.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
		});
	}

	/** Ask the server what it offers. Call it more than once; that is the point. */
	async listTools(): Promise<ToolDescriptor[]> {
		const result = (await this.request("tools/list", {})) as { tools?: ToolDescriptor[] };
		return result.tools ?? [];
	}

	async callTool(name: string, args: Record<string, unknown>): Promise<string> {
		const result = (await this.request("tools/call", { name, arguments: args })) as {
			content?: Array<{ text?: string }>;
		};
		return result.content?.map((part) => part.text ?? "").join("\n") ?? "";
	}

	close(): void {
		for (const pending of this.pending.values()) clearTimeout(pending.timer);
		this.pending.clear();
		this.child?.kill();
	}
}
