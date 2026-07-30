/**
 * The tool registry.
 *
 * Lesson 1's executeTool is a chain of if/else, which is fine with one tool.
 * At four tools it becomes a mess. This binds "definition" and "execution" together:
 * one tool = one object.
 *
 * Against Pi: AgentTool at packages/agent/src/types.ts:380
 *             — the same binding of name/description/parameters/execute into one object.
 */

import type { ToolSpec } from "../providers/types.ts";

/** What is available while executing a tool. */
export interface ToolContext {
	/** The sandbox root. Every path must stay beneath it. */
	root: string;
	/**
		 * Ask the user to approve an operation with side effects.
		 * Returning false means the user refused and the tool must not execute.
	 */
	approve(request: ApprovalRequest): Promise<boolean>;
	/** Let a tool report progress while executing (a shell command's live output, say). */
	log(line: string): void;
}

export interface ApprovalRequest {
	/** The tool's name, "write_file" for example */
	toolName: string;
	/** One sentence about what is **about to happen**, for humans. */
	summary: string;
	/** Optional: the details, a diff or the full command for example. */
	detail?: string;
}

export interface Tool extends ToolSpec {
	/**
		 * Does this tool change external state?
	 *
		 * Read-only tools (read/list/grep) can safely run automatically.
		 * Tools that write or run commands should ask the user first, which is the thing Claude Code
		 * pops up every time it wants to change your files.
	 */
	readonly mutating: boolean;

	/**
		 * The actual execution.
	 *
		 * The contract (as in Lesson 1): return a string on success, throw on failure.
		 * The loop wraps a throw into an isError result and sends it back to the model.
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

		/** The tool list sent to the model (specs only, no execute). */
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
				// Models sometimes hallucinate a tool name that does not exist. That is not a crash
				// but an ordinary error to report back, after which it uses a tool that does exist.
			const available = [...this.tools.keys()].join(", ");
			throw new Error(`Unknown tool "${name}". Available tools: ${available}`);
		}
		return tool;
	}

	/**
		 * Execute one tool call, including the approval flow.
	 *
		 * Note approval happens **at the registry layer** rather than separately inside every tool,
		 * so no tool can forget to ask.
	 */
	async execute(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
		const tool = this.get(name);

		if (tool.mutating) {
			const approved = await ctx.approve({
				toolName: name,
				summary: describeCall(name, args),
			});
			if (!approved) {
					// A refusal is not a crash but a normal result.
					// The model must be told **the user refused**, or it will blindly retry the same thing.
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
				// Long arguments (a whole file's contents, say) show only their opening in the summary
			const short = text.length > 60 ? `${text.slice(0, 60)}…` : text;
			return `${key}=${short}`;
		})
		.join("  ");
	return `${name}  ${parts}`;
}
