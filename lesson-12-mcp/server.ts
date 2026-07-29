/**
 * 一個真的 MCP server（stdio + JSON-RPC 2.0，零依賴）。
 *
 * 為什麼要自己寫一個，而不是接一個現成的：
 *
 *   1. **課程要能離線跑**（設計原則 1）。接別人的 server 就要有網路、
 *      要有那個套件、還要祈禱它的版本沒變
 *   2. 更重要的：**自己寫過一次才知道 MCP 到底有多小**。
 *      這整個檔案不到 200 行，而它已經是一個合法的 MCP server 了
 *
 * 協定就是三個方法：
 *
 *   initialize                 握手，交換版本與能力
 *   tools/list                 你有哪些工具
 *   tools/call                 跑一個
 *
 * 訊息是換行分隔的 JSON-RPC 2.0，走 stdin/stdout。
 * **所以 server 絕對不能 `console.log`**，那會污染協定通道。
 * 這是自己寫 MCP server 第一個會踩的坑，所以下面所有除錯輸出都走 stderr。
 *
 * 執行（通常不會手動跑，是被 client spawn 的）：
 *   bun run lesson-12-mcp/server.ts
 */

const PROTOCOL_VERSION = "2025-06-18";

/** `SERVER_NAME` 讓同一個檔案可以扮演兩台不同的 server（見 agent.ts 的命名衝突示範）。 */
const SERVER_NAME = process.env.SERVER_NAME ?? "fleet";

/** `FAIL_MODE` 是用來示範失敗隔離的，真的 server 不會有這種東西。 */
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
		 * ⚠️ 這個工具存在的目的有兩個，兩個都是刻意的：
		 *
		 * 1. 它有**外部副作用**（排維修會通知現場人員），所以權限引擎
		 *    應該把它當 EXTERNAL 攔下來（Lesson 8）
		 * 2. 它的 schema **故意寫得很難搞**：`notes` 是 `["string","null"]`,
		 *    `window` 是 oneOf。這兩種在 JSON Schema 裡完全合法，
		 *    但每家模型 provider 的接受度都不一樣（Lesson 30 的引子）
		 *
		 * 重點在於：**這個 schema 不是你寫的。** MCP server 是別人的,
		 * 你只能照收。這就是為什麼相容層不是可選的。
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
 * `EXTRA_TOOLS=1` 多開兩個工具，**它們的名字前綴一樣**。
 *
 * 這不是為了湊數：`mcp__<server>__<tool>` 截斷到 64 字之後，
 * server 名字一長，工具名字就只剩幾個字元，
 * 於是「前綴相同的兩個工具」會被截成同一個名字。
 *
 * 這是現實中最容易踩到的碰撞形狀，比「兩台 server 同名工具」常見得多，
 * 因為同一台 server 的工具本來就常常共用動詞前綴。
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

	// 通知（沒有 id）不需要回覆。
	if (id === undefined) return;

	switch (method) {
		case "initialize":
			// FAIL_MODE=hang：接受連線但永遠不回握手。
			// 這是最難處理的一種壞掉方式，因為它沒有錯誤，只有沉默。
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
			// 注意工具的錯誤是 `isError: true` **的正常回應**，不是 JSON-RPC error。
			// 協定層的錯誤（方法不存在）跟工具層的錯誤（機器人找不到）是兩件事，
			// 混在一起的話 agent 會分不出「該重試」和「該換做法」。
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
