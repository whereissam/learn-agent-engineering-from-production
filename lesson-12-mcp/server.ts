/**
 * A real MCP server (stdio plus JSON-RPC 2.0, zero dependencies).
 *
 * Why write one rather than connecting to an existing one:
 *
 *   1. **the lesson must run offline** (design principle 1). Somebody else's server needs a network,
 *      needs that package, and needs its version not to have changed
 *   2. more importantly: **writing one is how you learn how small MCP is**.
 *      This whole file is under 200 lines and is already a legal MCP server
 *
 * The protocol is three methods:
 *
 *   initialize                 the handshake, exchanging versions and capabilities
 *   tools/list                 which tools you have
 *   tools/call                 run one
 *
 * Messages are newline-delimited JSON-RPC 2.0 over stdin/stdout.
 * **So a server must never `console.log`**; that pollutes the protocol channel.
 * It is the first trap when writing an MCP server, so every debug output below goes to stderr.
 *
 * Run (usually not by hand; a client spawns it):
 *   bun run lesson-12-mcp/server.ts
 */

const PROTOCOL_VERSION = "2025-06-18";

/** `SERVER_NAME` lets one file play two different servers (see agent.ts's name collision demonstration). */
const SERVER_NAME = process.env.SERVER_NAME ?? "fleet";

/** `FAIL_MODE` exists to demonstrate failure isolation; a real server has nothing like it. */
const FAIL_MODE = process.env.FAIL_MODE ?? "";

interface McpTool {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
}

const TOOLS: McpTool[] = [
	{
		name: "list_robots",
		description: "List robots in the fleet, optionally filtered by status.",
		inputSchema: {
			type: "object",
			properties: {
				status: {
					type: "string",
					enum: ["active", "charging", "maintenance"],
					description: "Only return robots in this status",
				},
			},
		},
	},
	{
		name: "get_robot",
		description: "Get one robot's current telemetry snapshot.",
		inputSchema: {
			type: "object",
			properties: { robot_id: { type: "string", description: "e.g. R-204" } },
			required: ["robot_id"],
		},
	},
	{
		/**
			 * ⚠️ This tool exists for two reasons, both deliberate:
		 *
			 * 1. it has an **external side effect** (scheduling maintenance notifies people on site), so the
			 *    permission engine should intercept it as EXTERNAL (Lesson 8)
			 * 2. its schema is **deliberately awkward**: `notes` is `["string","null"]`,
			 *    and `window` is a oneOf. Both are entirely legal JSON Schema,
			 *    and every model provider accepts them differently (the seed of Lesson 30)
		 *
			 * The point: **you did not write this schema.** The MCP server is somebody else's,
			 * and you take what you are given. Which is why a compatibility layer is not optional.
		 */
		name: "schedule_maintenance",
		description: "Schedule a maintenance window for a robot. Notifies the on-site team.",
		inputSchema: {
			type: "object",
			properties: {
				robot_id: { type: "string" },
				window: {
					oneOf: [
						{ type: "string", description: "ISO 8601 interval" },
						{
							type: "object",
							properties: { start: { type: "string" }, hours: { type: "number" } },
							required: ["start", "hours"],
						},
					],
				},
				notes: { type: ["string", "null"], description: "Optional free-text note" },
			},
			required: ["robot_id", "window"],
		},
	},
];

/**
 * `EXTRA_TOOLS=1` adds two more tools **whose names share a prefix**.
 *
 * Not for padding: once `mcp__<server>__<tool>` is truncated to 64 characters,
 * a long server name leaves only a few characters for the tool name,
 * so "two tools sharing a prefix" truncate to the same name.
 *
 * This is the most common collision shape in reality, far more common than "two servers with the same tool name",
 * because tools on one server routinely share verb prefixes.
 */
const EXTRA_TOOLS: McpTool[] =
	process.env.EXTRA_TOOLS === "1"
		? [
				{
					name: "create_incident_report",
					description: "Create a full incident report for a robot event.",
					inputSchema: {
						type: "object",
						properties: { robot_id: { type: "string" } },
						required: ["robot_id"],
					},
				},
				{
					name: "create_incident_summary",
					description: "Create a one-paragraph summary of a robot event.",
					inputSchema: {
						type: "object",
						properties: { robot_id: { type: "string" } },
						required: ["robot_id"],
					},
				},
			]
		: [];

const ROBOTS = [
	{ id: "R-204", status: "maintenance", battery: 41, sample_rate_hz: 100 },
	{ id: "R-118", status: "active", battery: 88, sample_rate_hz: 50 },
	{ id: "R-330", status: "charging", battery: 12, sample_rate_hz: 50 },
];

const ALL_TOOLS = [...TOOLS, ...EXTRA_TOOLS];

function callTool(name: string, args: Record<string, unknown>): { text: string; isError: boolean } {
	if (name === "create_incident_report") {
		return { text: `Full incident report created for ${String(args.robot_id)}.`, isError: false };
	}
	if (name === "create_incident_summary") {
		return { text: `One-paragraph summary created for ${String(args.robot_id)}.`, isError: false };
	}
	switch (name) {
		case "list_robots": {
			const status = args.status as string | undefined;
			const rows = status ? ROBOTS.filter((r) => r.status === status) : ROBOTS;
			return {
				text: rows.map((r) => `${r.id}  ${r.status}  battery ${r.battery}%`).join("\n"),
				isError: false,
			};
		}
		case "get_robot": {
			const robot = ROBOTS.find((r) => r.id === args.robot_id);
			if (!robot) return { text: `No such robot: ${String(args.robot_id)}`, isError: true };
			return { text: JSON.stringify(robot, null, 2), isError: false };
		}
		case "schedule_maintenance":
			return {
				text: `Maintenance scheduled for ${String(args.robot_id)}. On-site team notified.`,
				isError: false,
			};
		default:
			return { text: `Unknown tool: ${name}`, isError: true };
	}
}

// ─────────────────────────────────────────────────────────────
// JSON-RPC
// ─────────────────────────────────────────────────────────────

function send(message: unknown): void {
	process.stdout.write(`${JSON.stringify(message)}\n`);
}

function reply(id: unknown, result: unknown): void {
	send({ jsonrpc: "2.0", id, result });
}

function replyError(id: unknown, code: number, message: string): void {
	send({ jsonrpc: "2.0", id, error: { code, message } });
}

async function handle(message: {
	id?: unknown;
	method?: string;
	params?: Record<string, unknown>;
}): Promise<void> {
	const { id, method, params } = message;

		// A notification (no id) needs no reply.
	if (id === undefined) return;

	switch (method) {
		case "initialize":
				// FAIL_MODE=hang: accept the connection and never answer the handshake.
				// The hardest kind of breakage to handle, because there is no error, only silence.
			if (FAIL_MODE === "hang") return;
			reply(id, {
				protocolVersion: PROTOCOL_VERSION,
				capabilities: { tools: {} },
				serverInfo: { name: SERVER_NAME, version: "1.0.0" },
			});
			return;

		case "tools/list":
			if (FAIL_MODE === "list-error") {
				replyError(id, -32603, "internal error while listing tools");
				return;
			}
			reply(id, { tools: ALL_TOOLS });
			return;

		case "tools/call": {
			const name = String(params?.name ?? "");
			const args = (params?.arguments as Record<string, unknown>) ?? {};

			if (FAIL_MODE === "slow") {
				await new Promise((r) => setTimeout(r, 30_000));
			}

			const { text, isError } = callTool(name, args);
				// Note a tool error is a **normal response** with `isError: true`, not a JSON-RPC error.
				// A protocol-level error (no such method) and a tool-level error (robot not found) are different things,
				// and mixing them leaves the agent unable to tell "retry" from "try another way".
			reply(id, { content: [{ type: "text", text }], isError });
			return;
		}

		default:
			replyError(id, -32601, `Method not found: ${String(method)}`);
	}
}

// ─────────────────────────────────────────────────────────────

if (FAIL_MODE === "crash-on-start") {
	process.stderr.write("simulated startup crash\n");
	process.exit(1);
}

let buffer = "";
process.stdin.on("data", (chunk: Buffer) => {
	buffer += chunk.toString("utf8");
	let newline = buffer.indexOf("\n");
	while (newline !== -1) {
		const line = buffer.slice(0, newline).trim();
		buffer = buffer.slice(newline + 1);
		newline = buffer.indexOf("\n");
		if (!line) continue;
		try {
			void handle(JSON.parse(line));
		} catch {
			process.stderr.write(`bad JSON: ${line}\n`);
		}
	}
});

process.stdin.on("end", () => process.exit(0));
