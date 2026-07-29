/**
 * Lesson 12 - MCP 工具接進 agent loop
 *
 * 三台 server，其中兩台是壞的。這是刻意的：
 * **MCP 最重要的工程問題不是協定，是「別人的進程不受你控制」。**
 *
 *   fleet    正常
 *   ghost    握手就卡住，永遠不回（最難處理的一種：沒有錯誤，只有沉默）
 *   rubble   啟動就掛掉
 *
 * 執行：
 *   bun run lesson-12                       # 腳本 provider，不用 key
 *   PROVIDER=gemini bun run lesson-12       # 真模型
 *   MODE=auto bun run lesson-12             # 看 AUTO 模式下 MCP 工具還會不會被問
 *   COLLIDE=1 bun run lesson-12             # 名稱截斷造成的碰撞（README Step 4）
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
/** 把今天的日期放進 system prompt。預設關閉是為了讓 Step 6 的實驗跑得出來。 */
const TODAY = process.env.TODAY === "1";

/**
 * server 設定。
 *
 * 形狀刻意跟 Claude Desktop / Cursor / Codex 的 `mcpServers` 一樣，
 * 因為 openworker 的 config.py 特別註明它是 **paste-compatible** 的：
 * 使用者已經有一份設定了，要能直接貼過來。
 */
const SERVERS: McpServerDef[] = [
	{
		/**
		 * COLLIDE=1 時換成一個很長的 server 名字。
		 *
		 * 47 個字元聽起來很誇張，但內部平台的 MCP server 名字長這樣
		 * 一點都不奇怪（`mcp__` 前綴 + `__` 分隔就吃掉 7 個，
		 * 64 字的預算剩下不到 10 個字給工具名字）。
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
 * 連上所有 server，收集工具。
 *
 * **一台掛掉不能影響其他台。** 這是這一課最實際的一條，
 * 因為使用者的 mcp.json 裡遲早會有一台是壞的（套件更新、
 * token 過期、指令改名），而那時候 agent 必須照常啟動。
 *
 * 對照 client.py 的 `_serve`：連線失敗會設進那個 future 的 exception，
 * 呼叫端 catch 之後跳過那一台。
 */
async function loadTools(): Promise<{ tools: Map<string, LoadedTool>; report: string[] }> {
	const tools = new Map<string, LoadedTool>();
	const report: string[] = [];

	// 平行連，不要一台一台等。ghost 那台會吃掉整個逾時，
	// 序列連的話啟動時間會變成所有壞掉 server 的逾時總和。
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
		report.push(`  ${green("✓")} ${def.name}  ${dim(`${list.length} 個工具`)}`);

		for (const tool of list) {
			const name = toolName(def.name, tool.name);

			// ⚠️ 碰撞偵測。openworker 那份沒有做，我們做了，
			// 因為靜靜覆蓋掉一個工具是最難查的那種 bug。
			const existing = tools.get(name);
			if (existing) {
				report.push(
					`    ${red("⚠ 名稱碰撞")} ${name}`,
				);
				report.push(
					dim(`      ${existing.server}/${existing.remoteName} 會被 ${def.name}/${tool.name} 蓋掉`),
				);
			}

			tools.set(name, {
				spec: {
					name,
					description: tool.description,
					// ⚠️ schema **原封不動**傳給模型。
					// 這是 openworker `_openai_schema` 的做法（註解寫 "for fidelity"），
					// 而它正是 Lesson 30 要處理的問題：這份 schema 不是你寫的，
					// 而每家 provider 能吃的 JSON Schema 子集都不一樣。
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
	console.log(bold("\n連線 MCP server"));
	const started = Date.now();
	const { tools, report } = await loadTools();
	for (const line of report) console.log(line);
	console.log(dim(`  （${Date.now() - started}ms，壞掉的兩台沒有拖垮啟動）`));

	if (tools.size === 0) {
		console.log(red("\n一個工具都沒載到，結束。"));
		return;
	}

	const specs = [...tools.values()].map((t) => t.spec);

	/**
	 * ⚠️ **所有 MCP 工具預設都是 EXTERNAL 風險。**
	 *
	 * 理由很簡單：你不知道它會做什麼。工具描述是**別人寫的**,
	 * 它說「list robots」不代表它只是列出機器人。
	 *
	 * 這正是 Lesson 8 `risk.ts:128` 那條規則存在的原因：
	 *   `if (metadata?.requiresApproval) return RiskClass.EXTERNAL;`
	 *
	 * 使用者可以用 riskOverrides 個別放寬（「這台我信任」），
	 * 但預設必須保守。
	 */
	const metadata: ToolRiskMetadata = { requiresApproval: true, category: "mcp" };

	const engine = new PermissionEngine({
		workspaceRoot: new URL(".", import.meta.url).pathname,
		mode: MODE,
	});

	console.log(bold("\n載到的工具"));
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

	console.log(dim(`\nprovider: ${provider.name}  模式: ${engine.mode}\n`));

	const runTurn = async (): Promise<void> => {
		for (let step = 0; step < 10; step++) {
			let response: Awaited<ReturnType<StreamingProvider["call"]>> | undefined;
			let failure: string | undefined;

			for await (const event of provider.stream({
				system:
					"You are an agent operating a robot fleet through MCP tools. " +
					"Use the tools to answer. Report honestly on what actually happened." +
					// ⚠️ `TODAY=1` 才會加上今天的日期。
					//
					// 這個開關是實測逼出來的：不加的時候，模型把「8/1」
					// 填成 **2024**-08-01（三次全部），因為它只能用訓練資料的先驗。
					// 而那個參數會被送進一個**有外部副作用、收不回來**的 MCP 工具。
					// 見 README Step 6。
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
				console.log(red(`\n[串流失敗] ${failure ?? "沒有正常結束"}`));
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
						console.log(`\n${yellow("┌ 需要批准")}`);
						console.log(`${yellow("│")} ${tool.server}/${tool.remoteName}`);
						console.log(`${yellow("│")} ${dim(JSON.stringify(call.args))}`);
						console.log(`${yellow("│")} ${dim(decision.reason)}`);
						console.log(yellow("└"));

						let approved: boolean;
						if (ANSWER) {
							console.log(dim(`  （ANSWER=${ANSWER}，自動回答）`));
							approved = ANSWER.startsWith("y");
						} else {
							const line = await reader.next(
								`  ${yellow("[y]")} 允許  ${yellow("[n]")} 拒絕 › `,
							);
							approved = line !== null && line.trim().toLowerCase().startsWith("y");
						}
						if (!approved) denial = `使用者拒絕了。（${decision.reason}）`;
					}
				}

				if (denial) {
					results.push({
						toolCallId: call.id,
						toolName: call.name,
						content: `Denied by the permission engine: ${denial}`,
						isError: true,
					});
					console.log(`  ${red("✗ 擋下來了")} ${dim(denial)}`);
					continue;
				}

				try {
					// 注意送出去的是 **remoteName**，不是我們加了前綴的名字。
					// 前綴是給模型用的命名空間，server 那邊不認得它。
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
			const prompt = "哪些機器人在維修中？順便幫 R-204 排一個維修時段。";
			console.log(`${cyan("你")} ${prompt}`);
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
