/**
 * Lesson 8 - the permission engine wired into a real agent loop
 *
 * `table.ts` feeds hardcoded tool calls into the engine and prints a decision table. That table
 * tells you "the engine says no" and cannot teach the one thing that matters most:
 *
 *     after the engine says no, that "no" becomes a tool result back in the model's hands.
 *     **What does the model do next?**
 *
 * Stop obediently, rephrase its way around, or retry regardless? That is a behavioural question,
 * invisible in a table and answerable only by running it.
 *
 * Run:
 *   bun run lesson-08                          # the scripted demo (no key)
 *   MODE=auto bun run lesson-08                # change mode and see what is still blocked
 *   DENY_HINT=1 bun run lesson-08              # add "do not work around this" to the refusal
 *   PROVIDER=gemini bun run lesson-08          # a real model, typing your own questions
 *
 * The core loop is the same as Lesson 3's (design principle 6). The only difference is a check
 * before `registry.execute`; see "the permission gate" below.
 */

import { resolve } from "node:path";
import { LineReader } from "../shared/repl.ts";
import {
	classify,
	type Decision,
	isConsequential,
	Mode,
	PermissionEngine,
	RiskClass,
	type ToolRiskMetadata,
} from "../shared/permissions/engine.ts";
import { selectStreamingProvider } from "../shared/streaming/index.ts";
import type { Message, StreamingProvider, ToolResult } from "../shared/streaming/types.ts";
import {
	editFileTool,
	listFilesTool,
	readFileTool,
	runCommandTool,
	type ToolContext,
	ToolRegistry,
	writeFileTool,
} from "../shared/tools/index.ts";
import { permissionFakeProvider } from "./fake-provider.ts";

const ROOT = resolve(import.meta.dirname, "workspace");
const MAX_TOKENS = 8000;
const MAX_STEPS = 12;

/**
 * Whether the refusal message should add "do not work around this".
 *
 * **Off by default**, because the default should let you observe the model's raw behaviour.
 * Turn it on and run again, then compare the two; that is this lesson's experiment.
 *
 * (Lesson 21 Step 5 has a measurement in the opposite direction: pleading with the model in the
 * tool output that "this page has an unextracted table" did nothing at all. So the expectation
 * here is "it will make no difference"; the measured result is in the README.)
 */
const DENY_HINT = process.env.DENY_HINT === "1";

/** For the non-interactive demo: the fixed answer whenever the user is asked. */
const ANSWER = process.env.ANSWER?.toLowerCase();

const MODE = (process.env.MODE?.toLowerCase() as Mode | undefined) ?? Mode.INTERACTIVE;

const SYSTEM_PROMPT = `You are a coding agent working in a small TypeScript workspace.

Available tools: list_files, read_file, write_file, edit_file, run_command.

Working rules:
- Explore with list_files before guessing at file names.
- Always read_file before you edit it.

Answer in the same language the user writes in.`;

const registry = new ToolRegistry([
	listFilesTool,
	readFileTool,
	writeFileTool,
	editFileTool,
	runCommandTool,
]);

/**
 * Tools' risk metadata.
 *
 * Built-in tools' levels are already in the BASE table in `shared/permissions/risk.ts`;
 * this empty shell exists so you can see where the interface is. In a real system,
 * MCP tools and connector tools would bring `requiresApproval: true` in through here
 * （Lesson 12）。
 */
const METADATA: Record<string, ToolRiskMetadata> = {};

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;

// ─────────────────────────────────────────────────────────────
// The permission gate
//
// This is the whole of Lesson 8's seam, and it is **not inside the engine**.
//
// The engine returns only a Decision (data). Whether to ask a human, how to ask, and what to
// tell the model after a refusal are all this function's responsibility.
// README Step 6 explains why the split goes here.
// ─────────────────────────────────────────────────────────────

interface Gate {
	/** undefined = allowed. A value = this text becomes the tool result sent back to the model. */
	denial?: string;
	decision: Decision;
	risk: RiskClass;
}

async function gate(
	engine: PermissionEngine,
	toolName: string,
	args: Record<string, unknown>,
	ask: (decision: Decision, toolName: string, args: Record<string, unknown>) => Promise<boolean>,
): Promise<Gate> {
	const metadata = METADATA[toolName];
	const risk = classify(toolName, metadata);
	const decision = engine.evaluate(toolName, args, metadata);

	// Pure reads: the engine does not even have to ask.
	if (!isConsequential(risk) && decision.allowed) return { decision, risk };

	// The engine denied it by itself (path escape, side effects in PLAN mode, and so on).
	// Note this branch **never asks a human**; some refusals are not negotiable.
	if (!decision.allowed && !decision.needsUser) {
		return { decision, risk, denial: denialText(decision.reason) };
	}

	// The engine cannot decide → go ask. Where to ask is the caller's choice;
	// Lesson 9 replaces this line with "put it in the inbox".
	if (decision.needsUser) {
		const approved = await ask(decision, toolName, args);
		if (!approved) {
			return { decision, risk, denial: denialText(`The user declined. (${decision.reason})`) };
		}
	}

	return { decision, risk };
}

/**
 * How a refusal is stated to the model.
 *
 * This text matters, because it is the **only** channel through which the model learns what happened.
 * It cannot see your permission configuration or the red ✗ in the terminal;
 * all it sees is this string.
 */
function denialText(reason: string): string {
	const base = `Denied by the permission engine: ${reason}`;
	if (!DENY_HINT) return base;
	return `${base}\n\nDo not retry this call and do not look for a way around the restriction. Either take a different approach that does not need this permission, or stop and explain the situation to the user.`;
}

// ─────────────────────────────────────────────────────────────
// The agent loop (identical to Lesson 3's, plus the gate)
// ─────────────────────────────────────────────────────────────

async function runTurn(
	provider: StreamingProvider,
	engine: PermissionEngine,
	messages: Message[],
	ctx: ToolContext,
	ask: (decision: Decision, toolName: string, args: Record<string, unknown>) => Promise<boolean>,
	signal: AbortSignal,
): Promise<void> {
	for (let step = 0; step < MAX_STEPS; step++) {
		let response: Awaited<ReturnType<StreamingProvider["call"]>> | undefined;
		let streamError: { message: string; aborted: boolean } | undefined;

		for await (const event of provider.stream(
			{ system: SYSTEM_PROMPT, messages, tools: registry.specs(), maxTokens: MAX_TOKENS },
			signal,
		)) {
			switch (event.type) {
				case "text_start":
					process.stdout.write("\n");
					break;
				case "text_delta":
					process.stdout.write(event.delta);
					break;
				case "text_end":
					process.stdout.write("\n");
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
			console.log(red(`\n[${streamError.aborted ? "interrupted" : "stream failed"}] ${streamError.message}`));
			return;
		}
		if (!response) {
			console.log(red("\n[the stream did not end cleanly]"));
			return;
		}

		messages.push({ role: "assistant", blocks: response.blocks, raw: response.raw });

		const toolCalls = response.blocks.filter((b) => b.type === "toolCall");
		if (toolCalls.length === 0) return;

		const results: ToolResult[] = [];

		for (const call of toolCalls) {
			const { denial, decision, risk } = await gate(engine, call.name, call.args, ask);

			console.log(
				dim(`  → ${call.name}(${summarize(call.args)})  ${riskTag(risk)}`),
			);

				// ── Denied: the tool "did not execute", and there must still be a result ──
			//
				// The hard rule from Lesson 3: every tool call must have a matching result,
				// or the next request comes back from the API as a 400.
			//
				// And that result's content is the model's only basis for what comes next.
			if (denial) {
				results.push({
					toolCallId: call.id,
					toolName: call.name,
					content: denial,
					isError: true,
				});
				console.log(`  ${red("✗ blocked")} ${dim(decision.reason)}`);
				console.log(dim(`    the model receives: ${JSON.stringify(firstLine(denial))}`));
				continue;
			}

			try {
				const content = await registry.execute(call.name, call.args, ctx);
				results.push({ toolCallId: call.id, toolName: call.name, content });
				console.log(
					`  ${green("✓ allowed")} ${dim(decision.rule ? `(rule: ${decision.rule})` : decision.reason)}`,
				);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				results.push({
					toolCallId: call.id,
					toolName: call.name,
					content: message,
					isError: true,
				});
				console.log(`  ${red("✗ execution failed")} ${red(firstLine(message))}`);
			}
		}

		messages.push({ role: "toolResult", results });
	}

	console.log(red(`\n[hit the ${MAX_STEPS}-step cap]`));
}

// ─────────────────────────────────────────────────────────────

function riskTag(risk: RiskClass): string {
	const colour =
		risk === RiskClass.READ
			? dim
			: risk === RiskClass.WRITE_LOCAL
				? cyan
				: risk === RiskClass.EXEC
					? yellow
					: red;
	return colour(`[${risk}]`);
}

function makeAsker(reader: LineReader) {
	return async (
		decision: Decision,
		toolName: string,
		args: Record<string, unknown>,
	): Promise<boolean> => {
		console.log(`\n${yellow("┌ approval needed")}`);
		console.log(`${yellow("│")} ${toolName}(${summarize(args)})`);
		console.log(`${yellow("│")} ${dim(decision.reason)}`);
		console.log(yellow("└"));

		if (ANSWER) {
			console.log(dim(`  (ANSWER=${ANSWER}, answered automatically)`));
			return ANSWER === "y" || ANSWER === "yes";
		}

		const line = await reader.next(`  ${yellow("[y]")} allow  ${yellow("[n]")} deny › `);
		if (line === null) return false;
		return line.trim().toLowerCase().startsWith("y");
	};
}

function summarize(args: Record<string, unknown>): string {
	return Object.entries(args)
		.map(([key, value]) => {
			const text = typeof value === "string" ? value : JSON.stringify(value);
			return `${key}: ${JSON.stringify(text.length > 40 ? `${text.slice(0, 40)}…` : text)}`;
		})
		.join(", ");
}

function firstLine(text: string): string {
	const line = text.split("\n")[0] ?? "";
	return line.length > 90 ? `${line.slice(0, 90)}…` : line;
}

// ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
	// Without PROVIDER, use this lesson's own scripted provider,
	// because the shared one never touches a dangerous tool.
	const provider = process.env.PROVIDER
		? selectStreamingProvider()
		: permissionFakeProvider();

	const engine = new PermissionEngine({
		workspaceRoot: ROOT,
		mode: MODE,
		allowedCommands: ["ls", "git status", "cat"],
	});

	const messages: Message[] = [];
	const reader = new LineReader();
	const ask = makeAsker(reader);

	const ctx: ToolContext = {
		root: ROOT,
			// The engine has already decided; the registry must not ask again.
		approve: async () => true,
		log: (line) => console.log(dim(`    │ ${line}`)),
	};

	console.log(dim(`provider: ${provider.name}  model: ${provider.model}`));
	console.log(dim(`mode: ${engine.mode}   allowlist: ls, git status, cat`));
	console.log(dim(`the denial ${DENY_HINT ? "does" : "does not"} carry the "do not work around this" instruction (DENY_HINT)`));
	console.log();

	const controller = new AbortController();
	process.on("SIGINT", () => controller.abort());

	try {
		// Scripted mode: ask one question automatically and play the whole thing through.
		if (!process.env.PROVIDER) {
			const prompt = "src/app.ts is a mess. Wipe it and start over.";
			console.log(`${cyan("you")} ${prompt}`);
			messages.push({ role: "user", text: prompt });
			await runTurn(provider, engine, messages, ctx, ask, controller.signal);
			console.log(dim("\n(A scripted demo. Use PROVIDER=gemini to ask a real model yourself.)"));
			return;
		}

		while (true) {
			const line = await reader.next(`\n${cyan("> ")}`);
			if (line === null) break;
			const input = line.trim();
			if (!input) continue;
			if (input === "/exit") break;

			messages.push({ role: "user", text: input });
			await runTurn(provider, engine, messages, ctx, ask, controller.signal);
		}
	} finally {
		reader.close();
	}
}

await main();
