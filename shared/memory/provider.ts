/**
 * The memory provider interface.
 *
 * The lifecycle comment at the top of Hermes's memory_provider.py
 * is a design you can copy almost verbatim:
 *
 *   initialize()           connect, create resources, warm up
 *   system_prompt_block()  static text for the system prompt
 *   prefetch(query)        recall before each turn
 *   sync_turn(user, asst)  the write after each turn
 *   get_tool_schemas()     whether to give the model memory-related tools
 *   shutdown()             cleanup
 *
 * The point is that those three hook points **map exactly onto three positions in our loop**:
 *
 *   systemPromptBlock()  → before the loop starts, once
 *   prefetch(query)      → before every LLM call (Lesson 5's transformContext position)
 *   syncTurn(u, a)       → after every turn
 *
 * In other words, "long-term memory" is not a new loop but three hooks on the old one.
 *
 * Source: hermes-agent/agent/memory_provider.py
 */

import type { ToolSpec } from "../providers/types.ts";

export interface MemoryProvider {
	/** A short identifier, "file" or "honcho" for example. */
	readonly name: string;

	/**
		 * Is this provider usable right now?
	 *
		 * Hermes's comment says specifically: **do not touch the network here**, only check configuration and dependencies.
		 * Because it is called synchronously at agent startup, and a network request slows startup down.
	 */
	isAvailable(): boolean;

	initialize?(): Promise<void>;

	/**
		 * Static text for the system prompt.
	 *
		 * "Static" is the key: this content does not change during a session,
		 * so it can be prompt-cached. Anything that changes goes through prefetch.
	 */
	systemPromptBlock(): string;

	/**
		 * Recall memories relevant to this turn's input.
	 *
		 * Return the raw text; **do not add a fence yourself**.
		 * The manager adds the fence uniformly; the reason is in manager.ts.
	 */
	prefetch(query: string): Promise<string>;

	/** The write after a turn ends. */
	syncTurn(userMessage: string, assistantMessage: string): Promise<void>;

	/** Memory tools for the model ("remember this", say). */
	toolSpecs?(): ToolSpec[];

	/** Execute a memory tool. */
	handleToolCall?(name: string, args: Record<string, unknown>): Promise<string>;

	shutdown?(): Promise<void>;
}
