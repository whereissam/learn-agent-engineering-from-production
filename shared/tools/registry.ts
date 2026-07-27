/**
 * 工具註冊表。
 *
 * Lesson 1 的 executeTool 是一串 if/else，只有一個工具時還好。
 * 到了四個工具就會變成一坨。這裡把「定義」跟「執行」綁在一起：
 * 一個工具 = 一個物件。
 *
 * 對照 Pi：packages/agent/src/types.ts:380 的 AgentTool
 *          ， 同樣把 name/description/parameters/execute 綁成一個物件。
 */

import type { ToolSpec } from "../providers/types.ts";

/** 執行工具時可以用到的東西。 */
export interface ToolContext {
	/** sandbox 根目錄。所有路徑都必須在這底下。 */
	root: string;
	/**
	 * 要求使用者批准一個有副作用的操作。
	 * 回傳 false 代表使用者拒絕，工具就不該執行。
	 */
	approve(request: ApprovalRequest): Promise<boolean>;
	/** 讓工具在執行過程中回報進度（例如 shell 指令的即時輸出）。 */
	log(line: string): void;
}

export interface ApprovalRequest {
	/** 工具名稱，例如 "write_file" */
	toolName: string;
	/** 一句話說明「即將發生什麼」，給人看的。 */
	summary: string;
	/** 選填：詳細內容，例如 diff 或完整指令。 */
	detail?: string;
}

export interface Tool extends ToolSpec {
	/**
	 * 這個工具會不會改變外部狀態？
	 *
	 * 只讀的工具（read/list/grep）可以放心自動執行。
	 * 會寫入或執行指令的工具應該先問過使用者，這就是 Claude Code
	 * 每次要改你的檔案時跳出來問的那個東西。
	 */
	readonly mutating: boolean;

	/**
	 * 真正執行。
	 *
	 * 契約（跟 Lesson 1 一樣）：成功 return 字串，失敗 throw。
	 * loop 會把 throw 統一包成 isError 的結果送回模型。
	 */
	execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string>;
}

export class ToolRegistry {
	private readonly tools = new Map<string, Tool>();

	constructor(tools: Tool[] = []) {
		for (const tool of tools) this.register(tool);
	}

	register(tool: Tool): void {
		if (this.tools.has(tool.name)) {
			throw new Error(`Duplicate tool name: ${tool.name}`);
		}
		this.tools.set(tool.name, tool);
	}

	/** 送給模型的工具清單（只有 spec，沒有 execute）。 */
	specs(): ToolSpec[] {
		return [...this.tools.values()].map(({ name, description, parameters }) => ({
			name,
			description,
			parameters,
		}));
	}

	get(name: string): Tool {
		const tool = this.tools.get(name);
		if (!tool) {
			// 模型有時候會幻想出不存在的工具名。這不是 crash，
			// 是一個要回報給模型的普通錯誤，它看到之後會改用真的有的工具。
			const available = [...this.tools.keys()].join(", ");
			throw new Error(`Unknown tool "${name}". Available tools: ${available}`);
		}
		return tool;
	}

	/**
	 * 執行一個工具呼叫，含批准流程。
	 *
	 * 注意批准是在「registry 這一層」做，不是在每個工具裡各做一次，
	 * 這樣才不會有某個工具忘記問。
	 */
	async execute(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
		const tool = this.get(name);

		if (tool.mutating) {
			const approved = await ctx.approve({
				toolName: name,
				summary: describeCall(name, args),
			});
			if (!approved) {
				// 被拒絕不是 crash，是一個正常的結果。
				// 一定要告訴模型「是使用者拒絕的」，它才不會傻傻重試同一件事。
				throw new Error(
					"The user declined this action. Do not retry it. " +
						"Ask what they would like to do instead.",
				);
			}
		}

		return await tool.execute(args, ctx);
	}
}

function describeCall(name: string, args: Record<string, unknown>): string {
	const parts = Object.entries(args)
		.map(([key, value]) => {
			const text = typeof value === "string" ? value : JSON.stringify(value);
			// 長參數（例如整個檔案內容）在摘要裡只顯示開頭
			const short = text.length > 60 ? `${text.slice(0, 60)}…` : text;
			return `${key}=${short}`;
		})
		.join("  ");
	return `${name}  ${parts}`;
}
