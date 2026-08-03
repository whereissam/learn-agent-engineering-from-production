/**
 * Lesson 12 - MCP tools wired into the agent loop
 *
 * Three servers, two of them broken. That is deliberate:
 * **MCP's most important engineering problem is not the protocol but that somebody else's process is out of your control.**
 *
 *   fleet    fine
 *   ghost    hangs at the handshake and never answers (the hardest kind: no error, only silence)
 *   rubble   dies on startup
 *
 * Run:
 *   bun run lesson-12                       # the scripted provider, no key
 *   PROVIDER=gemini bun run lesson-12       # a real model
 *   MODE=auto bun run lesson-12             # see whether MCP tools are still gated in AUTO mode
 *   COLLIDE=1 bun run lesson-12             # the collision caused by name truncation (README Step 4)
 */

import { LineReader } from "../shared/repl.ts";
import {
	classify,
	isConsequential,
	Mode,
	PermissionEngine,
	RiskClass,
	type ToolRiskMetadata,
} from "../shared/permissions/engine.ts";
import { selectStreamingProvider } from "../shared/streaming/index.ts";
import type {
	Message,
	StreamingProvider,
	ToolResult,
	ToolSpec,
} from "../shared/streaming/types.ts";
import { McpConnection, type McpServerDef, toolName } from "./client.ts";
import { mcpFakeProvider } from "./fake-provider.ts";

const SELF = new URL("server.ts", import.meta.url).pathname;
const MODE = (process.env.MODE?.toLowerCase() as Mode | undefined) ?? Mode.INTERACTIVE;
const ANSWER = process.env.ANSWER?.toLowerCase();
const COLLIDE = process.env.COLLIDE === "1";
/** Put today's date in the system prompt. Off by default so Step 6's experiment can run. */
const TODAY = process.env.TODAY === "1";

/**
 * Server configuration.
 *
 * The shape deliberately matches Claude Desktop's / Cursor's / Codex's `mcpServers`,
 * because openworker's config.py specifically notes that it is **paste-compatible**:
 * the user already has a configuration and must be able to paste it straight in.
 */
const SERVERS: McpServerDef[] = [
	{
		/**
			 * With COLLIDE=1, use a very long server name.
		 *
			 * 47 characters sounds absurd, and an internal platform's MCP server name looking like
			 * that is entirely unremarkable (the `mcp__` prefix plus the `__` separator eat 7,
			 * leaving under 10 of the 64-character budget for the tool name).
		 */
		name: COLLIDE ? "acme-internal-platform-tools-production-cluster" : "fleet",
		command: process.execPath,
		args: [SELF],
		env: COLLIDE ? { SERVER_NAME: "fleet", EXTRA_TOOLS: "1" } : { SERVER_NAME: "fleet" },
	},
	{
		name: "ghost",
		command: process.execPath,
		args: [SELF],
		env: { SERVER_NAME: "ghost", FAIL_MODE: "hang" },
	},
	{
		name: "rubble",
		command: process.execPath,
		args: [SELF],
		env: { SERVER_NAME: "rubble", FAIL_MODE: "crash-on-start" },
	},
];


const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;

interface LoadedTool {
	spec: ToolSpec;
	server: string;
	remoteName: string;
	connection: McpConnection;
}

/**
 * Connect to every server and collect tools.
 *
 * **One dying must not affect the others.** This is the most practical line in the lesson,
 * because a user's mcp.json will eventually contain a broken server (a package update,
 * an expired token, a renamed command), and the agent must start normally when it does.
 *
 * Against `_serve` in client.py: a connection failure sets the exception on that future,
 * and the caller catches it and skips that server.
 */
async function loadTools(): Promise<{ tools: Map<string, LoadedTool>; report: string[] }> {
	const tools = new Map<string, LoadedTool>();
	const report: string[] = [];

	// Connect in parallel rather than one at a time. The ghost server eats a whole timeout,
	// and connecting serially would make startup the sum of every broken server's timeout.
	const results = await Promise.allSettled(
		SERVERS.map(async (def) => {
			const connection = await McpConnection.connect(def);
			connection.onLog = (line) => report.push(dim(`    ${line}`));
			const list = await connection.listTools(def);
			return { def, connection, list };
		}),
	);

	for (const [i, result] of results.entries()) {
		const def = SERVERS[i] as McpServerDef;

		if (result.status === "rejected") {
			const message = result.reason instanceof Error ? result.reason.message : String(result.reason);
			report.push(`  ${red("✗")} ${def.name}  ${dim(message)}`);
			continue;
		}

		const { connection, list } = result.value;
		report.push(`  ${green("✓")} ${def.name}  ${dim(`${list.length} tools`)}`);

		for (const tool of list) {
			const name = toolName(def.name, tool.name);

				// ⚠️ Collision detection. openworker's version does not do this and this does,
				// because silently overwriting a tool is the hardest kind of bug to find.
			const existing = tools.get(name);
			if (existing) {
				report.push(
					`    ${red("⚠ name collision")} ${name}`,
				);
				report.push(
					dim(`      ${existing.server}/${existing.remoteName} would be shadowed by ${def.name}/${tool.name}`),
				);
			}

			tools.set(name, {
				spec: {
					name,
					description: tool.description,
						// ⚠️ The schema is passed to the model **verbatim**.
						// That is openworker's `_openai_schema` approach (its comment says "for fidelity"),
						// and it is exactly the problem Lesson 30 handles: you did not write this schema,
						// and every provider accepts a different subset of JSON Schema.
					parameters: tool.inputSchema,
				},
				server: def.name,
				remoteName: tool.name,
				connection,
			});
		}
	}

	return { tools, report };
}

// ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
	console.log(bold("\nConnecting to MCP servers"));
	const started = Date.now();
	const { tools, report } = await loadTools();
	for (const line of report) console.log(line);
	console.log(dim(`  (${Date.now() - started}ms; the two broken ones did not hold up startup)`));

	if (tools.size === 0) {
		console.log(red("\nNot a single tool loaded. Stopping."));
		return;
	}

	const specs = [...tools.values()].map((t) => t.spec);

	/**
		 * ⚠️ **Every MCP tool defaults to EXTERNAL risk.**
	 *
		 * The reason is simple: you do not know what it will do. The tool description was **written by
		 * somebody else**, and "list robots" does not mean it only lists robots.
	 *
		 * Which is why the rule at Lesson 8's `risk.ts:128` exists:
	 *   `if (metadata?.requiresApproval) return RiskClass.EXTERNAL;`
	 *
		 * A user can relax individual ones with riskOverrides ("I trust this server"),
		 * and the default must be conservative.
	 */
	const metadata: ToolRiskMetadata = { requiresApproval: true, category: "mcp" };

	const engine = new PermissionEngine({
		workspaceRoot: new URL(".", import.meta.url).pathname,
		mode: MODE,
	});

	console.log(bold("\nTools loaded"));
	for (const [name, tool] of tools) {
		const risk = classify(name, metadata);
		console.log(
			`  ${name}  ${risk === RiskClass.EXTERNAL ? red(`[${risk}]`) : dim(`[${risk}]`)}` +
				dim(`  ← ${tool.server}/${tool.remoteName}`),
		);
	}

	const provider = process.env.PROVIDER ? selectStreamingProvider() : mcpFakeProvider();
	const reader = new LineReader();
	const messages: Message[] = [];

	console.log(dim(`\nprovider: ${provider.name}  mode: ${engine.mode}\n`));

	const runTurn = async (): Promise<void> => {
		for (let step = 0; step < 10; step++) {
			let response: Awaited<ReturnType<StreamingProvider["call"]>> | undefined;
			let failure: string | undefined;

			for await (const event of provider.stream({
				system:
					"You are an agent operating a robot fleet through MCP tools. " +
					"Use the tools to answer. Report honestly on what actually happened." +
						// ⚠️ Today's date is added only with `TODAY=1`.
					//
						// This switch was forced out by measurement: without it, the model filled "8/1" in as
						// **2024**-08-01 (all three runs), because all it had were training-data priors.
						// And that argument goes into an MCP tool with an **external, unrecallable** side effect.
						// See README Step 6.
					(TODAY ? `\n\nToday's date is ${new Date().toISOString().slice(0, 10)}.` : ""),
				messages,
				tools: specs,
				maxTokens: 2000,
			})) {
				if (event.type === "text_delta") process.stdout.write(event.delta);
				else if (event.type === "text_end") process.stdout.write("\n");
				else if (event.type === "done") response = event.response;
				else if (event.type === "error") failure = event.message;
			}

			if (failure || !response) {
				console.log(red(`\n[stream failed] ${failure ?? "did not end cleanly"}`));
				return;
			}

			messages.push({ role: "assistant", blocks: response.blocks, raw: response.raw });
			const calls = response.blocks.filter((b) => b.type === "toolCall");
			if (calls.length === 0) return;

			const results: ToolResult[] = [];

			for (const call of calls) {
				const tool = tools.get(call.name);
				if (!tool) {
					results.push({
						toolCallId: call.id,
						toolName: call.name,
						content: `Unknown tool: ${call.name}`,
						isError: true,
					});
					continue;
				}

				const risk = classify(call.name, metadata);
				const decision = engine.evaluate(call.name, call.args, metadata);
				console.log(dim(`  → ${call.name}  [${risk}]`));

				let denial: string | undefined;
				if (isConsequential(risk) || !decision.allowed) {
					if (!decision.allowed && !decision.needsUser) {
						denial = decision.reason;
					} else if (decision.needsUser) {
						console.log(`\n${yellow("┌ approval needed")}`);
						console.log(`${yellow("│")} ${tool.server}/${tool.remoteName}`);
						console.log(`${yellow("│")} ${dim(JSON.stringify(call.args))}`);
						console.log(`${yellow("│")} ${dim(decision.reason)}`);
						console.log(yellow("└"));

						let approved: boolean;
						if (ANSWER) {
							console.log(dim(`  (ANSWER=${ANSWER}, answered automatically)`));
							approved = ANSWER.startsWith("y");
						} else {
							const line = await reader.next(
								`  ${yellow("[y]")} allow  ${yellow("[n]")} deny › `,
							);
							approved = line !== null && line.trim().toLowerCase().startsWith("y");
						}
						if (!approved) denial = `The user declined. (${decision.reason})`;
					}
				}

				if (denial) {
					results.push({
						toolCallId: call.id,
						toolName: call.name,
						content: `Denied by the permission engine: ${denial}`,
						isError: true,
					});
					console.log(`  ${red("✗ blocked")} ${dim(denial)}`);
					continue;
				}

				try {
						// Note what is sent is the **remoteName**, not the prefixed name we added.
						// The prefix is a namespace for the model; the server does not recognise it.
					const content = await tool.connection.callTool(tool.remoteName, call.args);
					results.push({ toolCallId: call.id, toolName: call.name, content });
					console.log(dim(`  ${green("✓")} ${content.split("\n")[0] ?? ""}`));
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					results.push({
						toolCallId: call.id,
						toolName: call.name,
						content: message,
						isError: true,
					});
					console.log(`  ${red("✗")} ${red(message)}`);
				}
			}

			messages.push({ role: "toolResult", results });
		}
	};

	try {
		if (!process.env.PROVIDER) {
			const prompt = "Which robots are under maintenance? And book a maintenance slot for R-204 while you are at it.";
			console.log(`${cyan("you")} ${prompt}`);
			messages.push({ role: "user", text: prompt });
			await runTurn();
		} else {
			while (true) {
				const line = await reader.next(`\n${cyan("> ")}`);
				if (line === null) break;
				const input = line.trim();
				if (!input) continue;
				if (input === "/exit") break;
				messages.push({ role: "user", text: input });
				await runTurn();
			}
		}
	} finally {
		reader.close();
		for (const tool of new Set([...tools.values()].map((t) => t.connection))) tool.close();
	}
}

await main();
