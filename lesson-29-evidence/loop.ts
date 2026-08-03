/**
 * Lesson 29's agent loop: the same loop as Lesson 8's, plus two lines of snapshot.
 *
 * Design principle 6 is especially easy to keep here. "Evidence of completion" sounds like it needs
 * loop changes, and in fact it only **adds one measurement at each end of the loop**:
 *
 *     base = await snapshot.track()      ← before the stream starts
 *     …… the turn proceeds as before ……
 *     patch = await snapshot.patch(base) ← after this turn ends
 *
 * ⚠️ **The first line's position is the easiest thing in this lesson to get wrong.**
 *
 * opencode puts it at the very start of `SessionProcessor.create` and leaves a comment explaining
 * why it cannot wait for an event (`session/processor.ts:98-101`):
 *
 *   > Pre-capture snapshot before the LLM stream starts. The AI SDK
 *   > may execute tools internally before emitting start-step events,
 *   > so capturing inside the event handler can be too late.
 *
 * That is: **a provider may already have touched files before emitting any event**
 * (provider-executed tools, SDK built-in tools, background hooks).
 * Take the baseline when the `tool_call` event arrives and that change falls before the baseline,
 * so it disappears from the patch — with no error message at all.
 *
 * `CAPTURE=first-tool` is that wrong version, and scenario 5 runs it.
 */

import type { Decision } from "../shared/permissions/engine.ts";
import {
	classify,
	isConsequential,
	PermissionEngine,
	type RiskClass,
} from "../shared/permissions/engine.ts";
import type { Message, StreamingProvider, ToolResult } from "../shared/streaming/types.ts";
import type { ToolContext, ToolRegistry } from "../shared/tools/index.ts";
import { compare, type Finding, type ToolRecord, type TurnRecord } from "./evidence.ts";
import type { Snapshot } from "./snapshot.ts";

export type Asker = (
	decision: Decision,
	toolName: string,
	args: Record<string, unknown>,
) => Promise<boolean>;

/** When to take the baseline. The default is the correct one. */
export type CapturePoint = "pre-stream" | "first-tool";

export interface RunOptions {
	provider: StreamingProvider;
	registry: ToolRegistry;
	engine: PermissionEngine;
	snapshot: Snapshot;
	messages: Message[];
	ctx: ToolContext;
	ask: Asker;
	signal: AbortSignal;
	system: string;
	capture?: CapturePoint;
	maxSteps?: number;
		/** Whether to print the stream. The demo wants it; tests do not. */
	verbose?: boolean;
}

export interface TurnOutcome {
	record: TurnRecord;
	findings: Finding[];
	steps: number;
		/** Whether it hit the step ceiling (if so, the patch is only "so far"). */
	exhausted: boolean;
}

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;

export async function runTurn(options: RunOptions): Promise<TurnOutcome> {
	const {
		provider,
		registry,
		engine,
		snapshot,
		messages,
		ctx,
		ask,
		signal,
		system,
		capture = "pre-stream",
		maxSteps = 12,
		verbose = true,
	} = options;

		// ── the baseline ──────────────────────────────────────────
	let base = capture === "pre-stream" ? await snapshot.track() : undefined;

	const toolRecords: ToolRecord[] = [];
	let claim = "";
	let steps = 0;
	let exhausted = true;

	for (let step = 0; step < maxSteps; step++) {
		steps = step + 1;
		let response: Awaited<ReturnType<StreamingProvider["call"]>> | undefined;
		let streamError: { message: string; aborted: boolean } | undefined;

		for await (const event of provider.stream(
			{ system, messages, tools: registry.specs(), maxTokens: 8000 },
			signal,
		)) {
			switch (event.type) {
				case "text_start":
					if (verbose) process.stdout.write("\n");
					break;
				case "text_delta":
					if (verbose) process.stdout.write(event.delta);
					break;
				case "text_end":
					if (verbose) process.stdout.write("\n");
					break;
				case "tool_call":
						// The wrong capture point: by now the provider may already have touched files.
					if (base === undefined) base = await snapshot.track();
					break;
				case "done":
					response = event.response;
					break;
				case "error":
					streamError = { message: event.message, aborted: event.aborted };
					break;
			}
		}

		if (streamError) {
			if (verbose) {
				console.log(red(`\n[${streamError.aborted ? "interrupted" : "stream failed"}] ${streamError.message}`));
			}
			exhausted = false;
			break;
		}
		if (!response) {
			if (verbose) console.log(red("\n[the stream did not end cleanly]"));
			exhausted = false;
			break;
		}

		messages.push({ role: "assistant", blocks: response.blocks, raw: response.raw });

		const text = response.blocks
			.filter((b) => b.type === "text")
			.map((b) => b.text)
			.join("");
		if (text.trim() !== "") claim = text;

		const toolCalls = response.blocks.filter((b) => b.type === "toolCall");
		if (toolCalls.length === 0) {
			exhausted = false;
			break;
		}

		const results: ToolResult[] = [];

		for (const call of toolCalls) {
			const risk = classify(call.name);
			const decision = engine.evaluate(call.name, call.args);
			const mutating = isConsequential(risk);
			const path = typeof call.args.path === "string" ? normalize(call.args.path) : undefined;

			const denial = await gate(engine, decision, risk, call.name, call.args, ask);

			if (verbose) console.log(dim(`  → ${call.name}(${summarize(call.args)})  [${risk}]`));

			if (denial) {
					// Lesson 3's hard rule: every tool call must have a result, or the next request 400s.
				results.push({
					toolCallId: call.id,
					toolName: call.name,
					content: denial,
					isError: true,
				});
				toolRecords.push({ name: call.name, path, mutating, ok: false, summary: firstLine(denial) });
				if (verbose) console.log(`  ${red("✗ blocked")} ${dim(decision.reason)}`);
				continue;
			}

			try {
				const content = await registry.execute(call.name, call.args, ctx);
				results.push({ toolCallId: call.id, toolName: call.name, content });
				toolRecords.push({ name: call.name, path, mutating, ok: true, summary: firstLine(content) });
				if (verbose) console.log(`  ${green("✓")} ${dim(firstLine(content))}`);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				results.push({
					toolCallId: call.id,
					toolName: call.name,
					content: message,
					isError: true,
				});
				toolRecords.push({ name: call.name, path, mutating, ok: false, summary: firstLine(message) });
				if (verbose) console.log(`  ${red("✗ execution failed")} ${red(firstLine(message))}`);
			}
		}

		messages.push({ role: "toolResult", results });
	}

		// ── finishing up ──────────────────────────────────────────
	//
		// `base` can still be undefined only in `first-tool` mode when the model called no tool at all.
		// In that case "before this turn" is now, and the patch is necessarily empty.
	if (base === undefined) base = await snapshot.track();

	const patch = await snapshot.patch(base);
	const record: TurnRecord = { claim, toolResults: toolRecords, patch };

	return { record, findings: compare(record), steps, exhausted };
}

// ─────────────────────────────────────────────────────────────

/** The same gate as Lesson 8's, minus the DENY_HINT experiment. */
async function gate(
	_engine: PermissionEngine,
	decision: Decision,
	risk: RiskClass,
	toolName: string,
	args: Record<string, unknown>,
	ask: Asker,
): Promise<string | undefined> {
	if (!isConsequential(risk) && decision.allowed) return undefined;

	if (!decision.allowed && !decision.needsUser) {
		return `Denied by the permission engine: ${decision.reason}`;
	}

	if (decision.needsUser) {
		const approved = await ask(decision, toolName, args);
		if (!approved) {
			return `Denied by the permission engine: the user declined. (${decision.reason})`;
		}
	}

	return undefined;
}

function normalize(path: string): string {
	return path.replace(/^\.\//, "");
}

function summarize(args: Record<string, unknown>): string {
	return Object.entries(args)
		.map(([key, value]) => {
			const text = typeof value === "string" ? value : JSON.stringify(value);
			return `${key}: ${JSON.stringify(text.length > 32 ? `${text.slice(0, 32)}…` : text)}`;
		})
		.join(", ");
}

function firstLine(text: string): string {
	const line = text.split("\n")[0] ?? "";
	return line.length > 76 ? `${line.slice(0, 76)}…` : line;
}
