/**
 * Lesson 19 - delegation's four mechanisms (no key needed)
 *
 *   isolation  what a subagent can actually see
 *   blocklist  the five things a subagent may not do, and what happens with it off
 *   approval   there is nobody on the subagent's side to approve
 *   locate     when something breaks, can you tell which step broke
 *
 * Run:
 *   bun run lesson-19
 *   bun run lesson-19 blocklist
 *   BLOCK=off bun run lesson-19 blocklist     # recursive delegation
 *   APPROVE=auto bun run lesson-19 approval   # the subagent pressed y itself
 *
 * Each scenario's scripted provider sits beside the scenario (five lines) rather than in a shared file:
 * extracting it would mean reading two places to know what a passage acts out, and only the boilerplate is shared.
 */

import { BLOCKED_FOR_CHILDREN, runChild } from "./delegate.ts";
import type { ModelResponse, StreamEvent, StreamingProvider, ToolSpec } from "../shared/streaming/types.ts";

const BLOCK_ON = process.env.BLOCK !== "off";
const APPROVAL = process.env.APPROVE === "auto" ? "auto-approve" : "deny";

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;

const TOOLS: ToolSpec[] = [
	{ name: "read_file", description: "Read a file.", parameters: { type: "object", properties: { path: { type: "string" } } } },
	{ name: "write_file", description: "Write a file.", parameters: { type: "object", properties: { path: { type: "string" } } } },
	{ name: "delegate_task", description: "Delegate.", parameters: { type: "object", properties: { goal: { type: "string" } } } },
	{ name: "memory", description: "Write to shared MEMORY.md.", parameters: { type: "object", properties: { text: { type: "string" } } } },
	{ name: "cronjob", description: "Schedule work.", parameters: { type: "object", properties: { prompt: { type: "string" } } } },
	{ name: "clarify", description: "Ask the user a question.", parameters: { type: "object", properties: { question: { type: "string" } } } },
];

/** A provider that only follows the script. */
function scripted(beats: { say: string; tool?: { name: string; args: Record<string, unknown> } }[]): StreamingProvider {
	let step = 0;
	const provider: StreamingProvider = {
		name: "fake",
		model: "scripted-delegation",
		async *stream(): AsyncIterable<StreamEvent> {
			const beat = beats[Math.min(step++, beats.length - 1)] as (typeof beats)[number];
			const blocks: ModelResponse["blocks"] = [{ type: "text", text: beat.say }];
			if (beat.tool) {
				blocks.push({ type: "toolCall", id: `c${step}`, name: beat.tool.name, args: beat.tool.args });
			}
			yield {
				type: "done",
				response: { blocks, raw: null, stopReason: beat.tool ? "tool_use" : "end", usage: { input: 100, output: 20, total: 140 } },
			};
		},
		async call() {
			return { blocks: [], raw: null, stopReason: "end" };
		},
	};
	return provider;
}

// ─────────────────────────────────────────────────────────────
// 1. isolation
// ─────────────────────────────────────────────────────────────

async function scenarioIsolation(): Promise<void> {
	console.log(`\n${bold("── isolation · what a subagent can see")}`);

	// The parent's conversation contains something only it knows.
	const parentHistory = [
		"user: our staging environment has been throwing E-118 since last week.",
		"user: oh, and **the staging data is fake, do not draw conclusions from it**.",
		"assistant: understood, let me look at logs/.",
	];

	console.log(dim("  the parent agent's conversation:"));
	for (const line of parentHistory) console.log(dim(`    │ ${line}`));

	const seen: string[] = [];
	const provider = scripted([
		{ say: "Let me look.", tool: { name: "read_file", args: { path: "logs/inventory.log" } } },
		{ say: "The most common one in inventory is E-118, 11 times." },
	]);

	const child = await runChild(
		{ goal: "count the most frequent error code in logs/inventory.log", context: "The file is under the workspace." },
		{
			provider,
			tools: TOOLS,
			execute: async (name, args) => {
				seen.push(`${name}(${JSON.stringify(args)})`);
				return "2026-07-11T03:00:00Z ERROR E-118 … (11 entries)";
			},
		},
	);

	console.log(`\n  ${bold("the subagent's entire context:")}`);
	console.log(cyan(`    │ ${child.goal}`));
	console.log(cyan("    │ Context: The file is under the workspace."));

	const leaked = parentHistory.some((line) => child.goal.includes(line));
	console.log(
		`\n  did "the staging data is fake" cross over: ${leaked ? red("yes") : green("no")}`,
	);
	console.log(dim(`  the subagent's summary: ${child.summary}`));

	console.log(
		yellow(
			"\n  ⚠ This is both a feature and a bug, depending on how important that sentence was.\n" +
				"    The parent's context is not flooded by the subagent's ten tool calls (the feature),\n" +
				"    but the subagent also does not know the data is fake (the bug).\n" +
				"    **The parent decides what goes into the context parameter, and it forgets constantly.**",
		),
	);
}

// ─────────────────────────────────────────────────────────────
// 2. blocklist
// ─────────────────────────────────────────────────────────────

async function scenarioBlocklist(): Promise<void> {
	console.log(`\n${bold("── blocklist · the five things a subagent may not do")}`);
	console.log(dim(`  BLOCK=${BLOCK_ON ? "on" : "off"}`));

	console.log(dim("\n  five blocked tools, five different reasons:"));
	for (const [tool, reason] of [
		["delegate_task", "resources: it expands exponentially"],
		["clarify", "channel: there is no user on the subagent's side"],
		["memory", "shared state: if anyone can write, the isolation is fake"],
		["send_message", "external side effects: irreversible, and the parent never knows"],
		["cronjob", "identity: it schedules future work in the parent's name"],
	]) {
		console.log(`    ${dim(String(tool).padEnd(15))}${dim(String(reason))}`);
	}

		// The subagent's tool list simply does not contain them.
	const available = BLOCK_ON ? TOOLS.filter((t) => !BLOCKED_FOR_CHILDREN.has(t.name)) : TOOLS;
	console.log(
		`\n  the tools a subagent actually gets: ${available.map((t) => t.name).join(", ")}`,
	);

		// ── recursion ───────────────────────────────────────────
	let spawned = 0;
	const DEPTH_CAP = 4;

	async function spawn(depth: number): Promise<void> {
		if (depth > DEPTH_CAP) return;
		spawned++;
		const provider = scripted([
			{ say: "This is too big; I will split it into two more subtasks.", tool: { name: "delegate_task", args: { goal: `subtask d${depth}` } } },
			{ say: "Done." },
		]);
		const child = await runChild(
			{ goal: `a task at depth ${depth}` },
			{
				provider,
				tools: TOOLS,
				blocklist: BLOCK_ON,
				execute: async (name) => {
					if (name === "delegate_task") {
							// Without the blocklist, a subagent really can call subagents.
						await spawn(depth + 1);
						await spawn(depth + 1);
						return "done";
					}
					return "ok";
				},
			},
		);
		if (child.blockedAttempts.length > 0 && depth === 1) {
			console.log(dim(`  the subagent tried to call ${child.blockedAttempts.join(", ")} and was blocked`));
		}
	}

	await spawn(1);

	console.log(
		`\n  ${BLOCK_ON ? green(String(spawned)) : red(String(spawned))} subagents were spawned in total` +
			dim(` (depth cap ${DEPTH_CAP}, 2 per level)`),
	);
	if (!BLOCK_ON) {
		console.log(
			red("  ⚠ Every one of them burns tokens, and the parent only ever sees the top level's summary."),
		);
		console.log(
			dim("    In reality there is no depth cap; the API quota or your wallet is the cap."),
		);
	}
}

// ─────────────────────────────────────────────────────────────
// 3. approval
// ─────────────────────────────────────────────────────────────

async function scenarioApproval(): Promise<void> {
	console.log(`\n${bold("── approval · there is nobody on the subagent's side")}`);
	console.log(dim(`  APPROVE=${APPROVAL}`));

	const written: string[] = [];
	const provider = scripted([
		{ say: "I will write the conclusion into the report.", tool: { name: "write_file", args: { path: "report.md" } } },
		{ say: "Finished." },
	]);

	const child = await runChild(
		{ goal: "count the error codes and write the result to report.md" },
		{
			provider,
			tools: TOOLS,
			approval: APPROVAL,
			execute: async (name, args) => {
				if (name === "write_file") written.push(String(args.path));
				return "ok";
			},
		},
	);

	console.log(`  files actually written: ${written.length === 0 ? green("(none)") : red(written.join(", "))}`);
	console.log(dim(`  the subagent said: ${child.summary}`));

	if (APPROVAL === "deny") {
		console.log(
			green("\n  ✓ denied by default. ") +
				dim("Hermes gives two reasons (delegate_tool.py:60-76):\n" +
					"    safety    nobody watches a subagent's actions, so it should have no side effects\n" +
					"    liveness  a worker thread has no interactive callback; falling back to input() fights the parent's TUI for stdin and **deadlocks**"),
		);
	} else {
		console.log(
			red("\n  ⚠ auto-approved: the file really was written, and nobody ever saw the request."),
		);
		console.log(dim("    Hermes has this switch (`delegation.subagent_auto_approve`), default false, commented as opt-in YOLO."));
	}
}

// ─────────────────────────────────────────────────────────────
// 4. locate
// ─────────────────────────────────────────────────────────────

async function scenarioLocate(): Promise<void> {
	console.log(`\n${bold("── locate · when something breaks, can you tell which step it was")}`);

	const goals = ["count checkout's error codes", "count inventory's error codes", "count notify's error codes"];
	const results: { goal: string; toolFailed: boolean; summary: string }[] = [];

	for (const [index, goal] of goals.entries()) {
			// The second subagent cannot read its file, **and its script gives a number anyway** —
			// which is exactly what a model really does (the family of Lesson 8's "false completion report").
		const broken = index === 1;
		const provider = scripted([
			{ say: "Reading the file.", tool: { name: "read_file", args: { path: `logs/${index}.log` } } },
			{ say: broken ? "The most common one is E-118." : `The most common one is E-${400 + index}.` },
		]);

			// The truth is recorded by the demo rather than asked of the subagent — asking it means trusting it.
		let toolFailed = false;
		const child = await runChild(
			{ goal },
			{
				provider,
				tools: TOOLS,
				execute: async () => {
					if (broken) {
						toolFailed = true;
						throw new Error("ENOENT: logs/inventory.log");
					}
					return "…";
				},
			},
		);
		results.push({ goal, toolFailed, summary: child.summary });
	}

	console.log(dim("\n  the truth (recorded by the demo)      the tool result the parent received:"));
	for (const row of results) {
		console.log(
			`    ${row.goal.padEnd(30)} ${row.toolFailed ? red("tool failed") : green("tool ok    ")}  ${dim(row.summary)}`,
		);
	}

	console.log(
		yellow(
			"\n  ⚠ Here is a failure specific to delegation: **the subagent swallowed it.**\n" +
				"    The file could not be read → the tool returned an isError string → but that is the **subagent's** context,\n" +
				"    and it can choose not to mention it, leaving the parent with a summary that looks fine.",
		),
	);
	console.log(
		dim(
			'\n  Delegation makes "which step broke" easy to locate (every subtask has a name),\n' +
				'  and "did anything break" hard to detect (a natural-language summary sits in between).\n' +
				"  → This is Lesson 29's conclusion in delegation form: **a summary is not evidence.**",
		),
	);
}

// ─────────────────────────────────────────────────────────────

const SCENARIOS: Record<string, () => Promise<void>> = {
	isolation: scenarioIsolation,
	blocklist: scenarioBlocklist,
	approval: scenarioApproval,
	locate: scenarioLocate,
};

async function main(): Promise<void> {
	const only = process.argv[2];
	const names = only ? [only] : Object.keys(SCENARIOS);
	for (const name of names) {
		const scenario = SCENARIOS[name];
		if (!scenario) {
			console.error(`Unknown scenario: ${name}. Available: ${Object.keys(SCENARIOS).join(", ")}`);
			process.exitCode = 1;
			return;
		}
		await scenario();
	}
	console.log(
		dim("\n(The real-model cost comparison lives in `MODE=delegate PROVIDER=gemini bun run lesson-19:agent`)"),
	);
}

await main();
