/**
 * Delegation: handing something to a subagent that **cannot see your context**.
 *
 * The top of Hermes's `tools/delegate_tool.py` (3697 lines) states the contract clearly:
 *
 *   > Each child gets:
 *   >   - A fresh conversation (no parent history)
 *   >   - Its own task_id (own terminal session, file ops cache)
 *   >   - The parent's toolsets, with child-only blocked tools stripped
 *   >   - A focused system prompt built from the delegated goal + context
 *   >
 *   > The parent's context only sees the delegation call and the summary
 *   > result, never the child's intermediate tool calls or reasoning.
 *
 * **The last sentence is the mechanism's purpose and its cost.**
 * The parent's context does not get flooded by the child's ten tool calls;
 * in exchange the parent **sees only the summary**, and what is not in the summary is gone.
 *
 * So delegation is not "more brains thinking together". It is an **information boundary**,
 * and both sides pay: this side saves context, that side loses detail.
 */

import type {
	Message,
	ModelResponse,
	StreamingProvider,
	ToolResult,
	ToolSpec,
} from "../shared/streaming/types.ts";

/**
 * Tools a subagent may never use.
 *
 * Copied directly from `tools/delegate_tool.py:46-54`, reasons included,
 * because those five comment lines are half this lesson's content:
 *
 *   delegate_task  no recursive delegation
 *   clarify        no user interaction
 *   memory         no writes to shared MEMORY.md
 *   send_message   no cross-platform side effects
 *   cronjob        no scheduling more work in the parent's name
 *
 * ⚠️ **The five reasons are five different things, not five examples of one rule**:
 *
 *   delegate_task  resources (it expands exponentially)
 *   clarify        the channel (there is no user on the child's side at all)
 *   memory         shared state (if anyone can write it, the isolation is fake)
 *   send_message   external side effects (unrecallable, and the parent does not know)
 *   cronjob        identity (scheduling future work in the parent's name)
 *
 * The last is the easiest to miss. It is not about what happens now
 * but **whose name something later happens under**.
 */
export const BLOCKED_FOR_CHILDREN = new Set([
	"delegate_task",
	"clarify",
	"memory",
	"send_message",
	"cronjob",
]);

export interface DelegationRequest {
	/** What the subagent should do. */
	goal: string;
	/** The background the parent chose to pass along. **This is the information boundary.** */
	context?: string;
}

export interface ChildResult {
	goal: string;
	/** **All** the parent gets back. */
	summary: string;
	steps: number;
	toolCalls: string[];
	usage: { input: number; output: number; total: number };
	/** Tools the subagent tried to use and was blocked from. */
	blockedAttempts: string[];
	error?: string;
}

export interface ChildOptions {
	provider: StreamingProvider;
	/** The tools the parent has. The child receives these minus the blocklist. */
	tools: ToolSpec[];
	execute: (name: string, args: Record<string, unknown>) => Promise<string>;
	maxSteps?: number;
	/**
		 * Whether the blocklist applies. **false is the broken version this lesson demonstrates.**
	 */
	blocklist?: boolean;
	/**
		 * What a subagent does when it meets an operation needing approval.
	 *
		 * Hermes defaults to `deny`, with the reason at `delegate_tool.py:60-76`:
		 * a subagent runs in a worker thread and **cannot reach the interactive approval callback**,
		 * and falling back to `input()` fights the parent process's TUI for stdin and deadlocks.
	 *
		 * So "a subagent denies automatically" is not merely conservative; it also solves a **liveness** problem.
	 */
	approval?: "deny" | "auto-approve";
	log?: (line: string) => void;
}

const CHILD_SYSTEM = `You are a focused sub-agent. You were given one specific task by a
parent agent. You cannot talk to the user and you cannot ask questions —
nobody is listening on your side.

Do the task with the tools you have, then reply with a short factual summary
of what you found. Your summary is the ONLY thing the parent will see: any
detail you leave out is lost.`;

/**
 * Run a subagent.
 *
 * Note how short this is. **Delegation's difficulty is not "how do you run a subagent"**
 * (that is a loop) but deciding what may not cross that boundary.
 */
export async function runChild(
	request: DelegationRequest,
	options: ChildOptions,
): Promise<ChildResult> {
	const { provider, tools, execute, maxSteps = 8, blocklist = true, approval = "deny", log } =
		options;

	const available = blocklist
		? tools.filter((tool) => !BLOCKED_FOR_CHILDREN.has(tool.name))
		: tools;

	// ⚠️ A brand new conversation. Not one line of the parent's history comes across.
	const messages: Message[] = [
		{
			role: "user",
			text: request.context ? `${request.goal}\n\nContext:\n${request.context}` : request.goal,
		},
	];

	const result: ChildResult = {
		goal: request.goal,
		summary: "",
		steps: 0,
		toolCalls: [],
		usage: { input: 0, output: 0, total: 0 },
		blockedAttempts: [],
	};

	for (let step = 0; step < maxSteps; step++) {
		result.steps = step + 1;
		let response: ModelResponse | undefined;

		for await (const event of provider.stream({
			system: CHILD_SYSTEM,
			messages,
			tools: available,
			maxTokens: 4000,
		})) {
			if (event.type === "done") response = event.response;
			if (event.type === "error") {
				result.error = event.message;
				return result;
			}
		}
		if (!response) {
			result.error = "stream ended without done";
			return result;
		}

		if (response.usage) {
			result.usage.input += response.usage.input;
			result.usage.output += response.usage.output;
			result.usage.total += response.usage.total;
		}

		messages.push({ role: "assistant", blocks: response.blocks, raw: response.raw });
		const text = response.blocks
			.filter((b) => b.type === "text")
			.map((b) => b.text)
			.join("");
		if (text.trim()) result.summary = text.trim();

		const calls = response.blocks.filter((b) => b.type === "toolCall");
		if (calls.length === 0) return result;

		const results: ToolResult[] = [];
		for (const call of calls) {
			result.toolCalls.push(call.name);
			log?.(`      ↳ ${call.name}(${JSON.stringify(call.args).slice(0, 60)})`);

				// The blocklist removes tools from the **tool list**, so normally the model cannot call them.
				// This branch blocks "the model called a tool it was never given from memory" —
				// and that really happens (in Lesson 20 it searched for a project name absent from the corpus).
			if (blocklist && BLOCKED_FOR_CHILDREN.has(call.name)) {
				result.blockedAttempts.push(call.name);
				results.push({
					toolCallId: call.id,
					toolName: call.name,
					content:
						`Tool "${call.name}" is not available to sub-agents. ` +
						"Finish your own task and report back; the parent decides what happens next.",
					isError: true,
				});
				continue;
			}

			if (approval === "deny" && MUTATING.has(call.name)) {
				results.push({
					toolCallId: call.id,
					toolName: call.name,
					content:
						"Denied: no user is present on this side to approve it. " +
						"Report what you found and let the parent ask.",
					isError: true,
				});
				continue;
			}

			try {
				results.push({
					toolCallId: call.id,
					toolName: call.name,
					content: await execute(call.name, call.args),
				});
			} catch (error) {
				results.push({
					toolCallId: call.id,
					toolName: call.name,
					content: error instanceof Error ? error.message : String(error),
					isError: true,
				});
			}
		}
		messages.push({ role: "toolResult", results });
	}

	result.error = `hit ${maxSteps} step limit`;
	return result;
}

/** The tools with side effects that this lesson needs. A real system would attach Lesson 8's risk levels. */
const MUTATING = new Set(["write_file", "edit_file", "run_command", "send_email"]);

/** The tool as the parent agent sees it. */
export const DELEGATE_TOOL: ToolSpec = {
	name: "delegate_task",
	description:
		"Hand one self-contained sub-task to a sub-agent with its own fresh context. " +
		"The sub-agent cannot see this conversation, so put everything it needs in " +
		"goal and context. You only get its final summary back.",
	parameters: {
		type: "object",
		properties: {
			goal: { type: "string", description: "The one task the sub-agent should do" },
			context: {
				type: "string",
				description: "Everything the sub-agent needs to know. It sees nothing else.",
			},
		},
		required: ["goal"],
	},
};
