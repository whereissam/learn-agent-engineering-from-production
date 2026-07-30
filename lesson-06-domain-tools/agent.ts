/**
 * Lesson 6: domain tools
 *
 * This lesson's loop is nearly identical to Lesson 3's. **The only difference is the tools.**
 *
 * The general tools (read_file / write_file / bash) are gone,
 * replaced by a set that only means anything in the domain of "robot telemetry analysis".
 *
 * Which is the point: an agent's ceiling is set by what it can operate, not by how pretty the prompt is.
 *
 * Run: bun run lesson-06-domain-tools/agent.ts
 */

import { resolve } from "node:path";
import { LineReader } from "../shared/repl.ts";
import { fakeTelemetryProvider } from "./fake-provider.ts";
import { selectStreamingProvider } from "../shared/streaming/index.ts";
import type { Message, StreamingProvider, ToolResult } from "../shared/streaming/types.ts";
import {
	type ApprovalRequest,
	type ToolContext,
	ToolRegistry,
} from "../shared/tools/index.ts";
import { createIncidentReportTool } from "./tools/report.ts";
import {
	compareSessionsTool,
	findAnomaliesTool,
	getSessionTool,
	getVideoFrameTool,
	listSessionsTool,
	queryTelemetryTool,
} from "./tools/telemetry.ts";

const MAX_TOKENS = 16000;
const MAX_STEPS = 30;

/**
 * The domain context.
 *
 * Note what is written here is the rules for **how to judge**, not the answers.
 * This is a domain expert's knowledge; a model cannot know by itself how many degrees of pitch is anomalous,
 * or what your company means by "a fall".
 *
 * In a real product this is usually extracted into a file (an AGENTS.md or similar),
 * maintained by domain experts rather than hardcoded.
 */
const SYSTEM_PROMPT = `You are an incident analyst for a quadruped robot fleet.

## Your job
Given a session, determine what happened and write an incident report.

## Domain knowledge

Signals available:
- imu_pitch_deg: forward/backward tilt. Walking is roughly 0-5 deg.
- imu_roll_deg: side-to-side tilt. Walking is roughly 0-5 deg.
- imu_accel_z: vertical acceleration, ~9.8 at rest. Spikes above 15 mean impact.
- joint_torque_max: peak joint torque. Walking is roughly 15-25 Nm.
- foot_contact: which of the 4 feet are on the ground.

How to classify:
- FALL: large pitch or roll, ALL FEET LEAVE THE GROUND, and the robot does NOT
  return to normal afterwards. Torque usually spikes then goes near zero (motors give up).
- NEAR_MISS: destabilised but recovered. Robot returns to normal walking.
- EXTERNAL_COLLISION: sharp accel_z spike with a roll spike, brief, then recovers.
  The trigger is external, so cmd_vel does not explain it.
- NOMINAL: nothing above threshold.
- INCONCLUSIVE: the data cannot support a conclusion.

## The single most useful discriminator
A crouch and a fall both show a large pitch change. The difference is FOOT CONTACT:
in a crouch the feet stay on the ground. Always check foot contact before
calling something a fall.

## Rules you must follow
1. Call get_session FIRST. It reports sampling gaps and clock offsets.
   If there is a gap, you cannot conclude anything about that window.
   If get_session reports ANY data quality issue (a sampling gap, or a clock
   offset between video and telemetry), you MUST record it in the report's
   caveats, even if it did not change your conclusion. A reader of the report
   cannot see the tool output, so an unmentioned caveat is an invisible one.
2. Use find_anomalies to locate candidate windows, then query_telemetry to inspect them.
   find_anomalies gives you candidates, not answers.
3. Every claim in your report must cite a real number you actually retrieved.
   Never invent a measurement.
4. If data quality is poor, classify as 'inconclusive' with low confidence and
   say why in caveats. Guessing is worse than admitting uncertainty.

Answer in the same language the user writes in.`;

const registry = new ToolRegistry([
	listSessionsTool,
	getSessionTool,
	queryTelemetryTool,
	findAnomaliesTool,
	getVideoFrameTool,
	compareSessionsTool,
	createIncidentReportTool,
]);

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;

const AUTO_APPROVE = process.env.AUTO_APPROVE === "1";
const alwaysAllow = new Set<string>();

let currentRun: AbortController | undefined;

function handleInterrupt(): void {
	if (currentRun && !currentRun.signal.aborted) {
		currentRun.abort();
		return;
	}
	console.log(dim("\n再見。"));
	process.exit(0);
}

// ─────────────────────────────────────────────────────────────
// The agent loop: identical to Lesson 3's, not one line changed
// ─────────────────────────────────────────────────────────────

export async function runTurn(
	provider: StreamingProvider,
	messages: Message[],
	ctx: ToolContext,
	signal: AbortSignal,
	quiet = false,
): Promise<void> {
	for (let step = 0; step < MAX_STEPS; step++) {
		let response: Awaited<ReturnType<StreamingProvider["call"]>> | undefined;
		let streamError: { message: string; aborted: boolean } | undefined;
		let partialText = "";

		for await (const event of provider.stream(
			{ system: SYSTEM_PROMPT, messages, tools: registry.specs(), maxTokens: MAX_TOKENS },
			signal,
		)) {
			switch (event.type) {
				case "text_start":
					if (!quiet) process.stdout.write("\n");
					break;
				case "text_delta":
					partialText += event.delta;
					if (!quiet) process.stdout.write(event.delta);
					break;
				case "text_end":
					if (!quiet) process.stdout.write("\n");
					break;
				case "tool_call":
					if (!quiet) console.log(dim(`  → ${event.name}(${summarizeArgs(event.args)})`));
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
			if (streamError.aborted) {
				if (!quiet) console.log(yellow("\n\n[已中斷]"));
				if (partialText.trim()) {
					messages.push({
						role: "assistant",
						blocks: [{ type: "text", text: partialText }],
						raw: { role: "assistant", content: partialText },
					});
					messages.push({
						role: "user",
						text: "[你上一則回覆被我中斷了。等我的下一個指示。]",
					});
				}
				return;
			}
			if (!quiet) console.log(red(`\n[串流失敗] ${streamError.message}`));
			throw new Error(streamError.message);
		}

		if (!response) throw new Error("Stream ended without a response");

		messages.push({ role: "assistant", blocks: response.blocks, raw: response.raw });

		if (response.stopReason === "refusal") {
			if (!quiet) console.log(red("\n[模型拒絕了這個請求]"));
			return;
		}
		if (response.stopReason === "max_tokens") {
			if (!quiet) console.log(red(`\n[輸出撞到 ${MAX_TOKENS} token 上限]`));
			return;
		}

		const toolCalls = response.blocks.filter((b) => b.type === "toolCall");
		if (toolCalls.length === 0) return;

		const results: ToolResult[] = [];
		for (const call of toolCalls) {
			if (signal.aborted) {
				results.push({
					toolCallId: call.id,
					toolName: call.name,
					content: "Cancelled: the user interrupted before this tool ran.",
					isError: true,
				});
				continue;
			}
			try {
				const content = await registry.execute(call.name, call.args, ctx);
				results.push({ toolCallId: call.id, toolName: call.name, content });
				if (!quiet) console.log(dim(`  ${green("✓")} ${firstLine(content)}`));
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				results.push({ toolCallId: call.id, toolName: call.name, content: message, isError: true });
				if (!quiet) console.log(`  ${red("✗")} ${red(firstLine(message))}`);
			}
		}

		messages.push({ role: "toolResult", results });

		if (signal.aborted) {
			if (!quiet) console.log(yellow("\n[已中斷]"));
			return;
		}
	}

	if (!quiet) console.log(red(`\n[已達 ${MAX_STEPS} 步上限]`));
}

export { registry, SYSTEM_PROMPT };

// ─────────────────────────────────────────────────────────────

function createApprover(reader: LineReader) {
	return async (request: ApprovalRequest): Promise<boolean> => {
		if (AUTO_APPROVE || alwaysAllow.has(request.toolName)) return true;
		console.log(`\n${yellow("┌ 需要批准")}`);
		console.log(`${yellow("│")} ${request.summary}`);
		console.log(yellow("└"));
		const line = await reader.next(
			`  ${yellow("[y]")} 允許  ${yellow("[a]")} 都允許  ${yellow("[n]")} 拒絕 › `,
		);
		if (line === null) {
			console.log(dim("  (沒有輸入可讀，視為拒絕)"));
			return false;
		}
		const answer = line.trim().toLowerCase();
		if (answer === "a") {
			alwaysAllow.add(request.toolName);
			return true;
		}
		return answer === "y" || answer === "yes";
	};
}

function summarizeArgs(args: Record<string, unknown>): string {
	return Object.entries(args)
		.map(([key, value]) => {
			const text = typeof value === "string" ? value : JSON.stringify(value);
			return `${key}=${text.length > 40 ? `${text.slice(0, 40)}…` : text}`;
		})
		.join(" ");
}

function firstLine(text: string): string {
	const line = text.split("\n")[0] ?? "";
	return line.length > 90 ? `${line.slice(0, 90)}…` : line;
}

/**
 * This lesson brings its own fake provider.
 *
 * `shared/streaming/fake.ts` was written for the Lesson 1-5 coding agent;
 * it calls list_files / read_file, which here only earns Unknown tool.
 * Design principle 1 says every lesson must run without a key, so it needs its own.
 */
function selectProvider(): StreamingProvider {
	if (process.env.PROVIDER?.toLowerCase() === "fake") return fakeTelemetryProvider();
	return selectStreamingProvider();
}

async function main(): Promise<void> {
	const provider = selectProvider();
	const messages: Message[] = [];
	const reader = new LineReader();
	reader.raw.on("SIGINT", handleInterrupt);
	process.on("SIGINT", handleInterrupt);

	const ctx: ToolContext = {
			// This lesson has no file sandbox; the tools manage their own data access
		root: resolve(import.meta.dirname, "data"),
		approve: createApprover(reader),
		log: (line) => console.log(dim(`    │ ${line}`)),
	};

	console.log(dim(`provider: ${provider.name}  model: ${provider.model}`));
	console.log(dim(`tools:    ${registry.specs().map((t) => t.name).join(", ")}`));
	console.log(dim("試試看：分析 sess_001 發生了什麼事\n"));

	try {
		while (true) {
			const line = await reader.next("\x1b[36m> \x1b[0m");
			if (line === null) break;
			const input = line.trim();
			if (!input) continue;
			if (input === "/exit") break;

			messages.push({ role: "user", text: input });
			currentRun = new AbortController();
			try {
				await runTurn(provider, messages, ctx, currentRun.signal);
			} catch (error) {
				console.log(red(`\n[錯誤] ${(error as Error).message}`));
			} finally {
				currentRun = undefined;
			}
			console.log();
		}
	} finally {
		reader.close();
	}
}

// Do not start a REPL when Lesson 7 imports this as a module
if (import.meta.main) {
	try {
		await main();
	} catch (error) {
		console.error(`\n${error instanceof Error ? error.message : String(error)}`);
		process.exit(1);
	}
}
