/**
 * Lesson 37 - chat history is not enough: action / observation
 *
 * Four scenarios, each contrasting "the same history in two recordings":
 *
 *   conflict   the model says the tests passed and the environment says exit code 1
 *   failures   three failures (the environment refused / the user refused / our bug)
 *   batches    one response calling three tools, or three responses calling one each
 *   view       can you tell compaction happened afterwards
 *
 * Run:
 *   bun run lesson-37
 *   bun run lesson-37 conflict
 *
 * This lesson needs no model: what is proved is **a property of the data structure**, not model behaviour.
 * The real-model part is `bun run lesson-37:agent` (which asks a completely different question).
 */

import { Trajectory, conflictsFromChat } from "./trajectory.ts";
import type { TrajectoryEvent } from "./events.ts";

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;

let clock = 1_700_000_000_000;
const next = () => (clock += 1000);

/**
 * This trajectory reproduces **behaviour Lesson 8 really measured**:
 * the tool did not succeed and the model told the user it was done.
 * There it was a permission refusal; here it is an exit code, to demonstrate the `exitCode` field.
 */
function conflictFixture(): Trajectory {
	const trajectory = new Trajectory();
	const events: TrajectoryEvent[] = [
		{ kind: "message", id: "e1", timestamp: next(), source: "user", text: "Run the tests and confirm my change did not break anything." },
		{
			kind: "action",
			id: "e2",
			timestamp: next(),
			source: "agent",
			thought: "Run the tests first to see where things stand.",
			toolName: "run_command",
			toolCallId: "call_1",
			args: { command: "npm test" },
			llmResponseId: "resp_1",
		},
		{
			kind: "observation",
			id: "e3",
			timestamp: next(),
			source: "environment",
			toolName: "run_command",
			toolCallId: "call_1",
			actionId: "e2",
			content: "2 failing\n  1) store lookup is case-insensitive\n  2) analytics uses the same key\n",
			exitCode: 1,
		},
		{
			kind: "message",
			id: "e4",
			timestamp: next(),
			source: "agent",
			text: "Ran them; all tests pass, your change is fine.",
		},
	];
	for (const event of events) trajectory.add(event);
	return trajectory;
}

function scenarioConflict(): void {
	console.log(`\n${bold("── conflict · one command, two accounts")}`);
	const trajectory = conflictFixture();

	console.log(dim("\n  ① the chat log (the shape used in Lessons 1-28):"));
	for (const message of trajectory.toChatHistory()) {
		console.log(`    ${dim(message.role.padEnd(11))}${message.content.split("\n")[0]}`);
	}
	console.log(
		dim('\n    Both accounts are squeezed into the same field shape (a string), and neither carries "who said it".'),
	);

	const chat = conflictsFromChat(trajectory.toChatHistory());
	console.log(
		`    what string matching can tell you: failure wording seen ${chat.failureSeen ? "yes" : "no"}, ` +
			`success claim seen ${chat.claimSeen ? "yes" : "no"}, ${red(`trustworthy ${chat.confident ? "yes" : "no"}`)}`,
	);
	console.log(
		dim('    The keyword list is something I made up: change it to "all green" and it misses.'),
	);

	console.log(dim("\n  ② the trajectory (action / observation):"));
	for (const event of trajectory.all()) {
		const tag =
			event.source === "environment" ? green("[environment]") : cyan(`[${event.source}]`);
		const body =
			event.kind === "observation"
				? `exitCode=${event.exitCode} ${JSON.stringify(event.content.split("\n")[0])}`
				: event.kind === "action"
					? `${event.toolName}(${JSON.stringify(event.args)})`
					: event.kind === "message"
						? JSON.stringify(event.text.slice(0, 40))
						: "";
		console.log(`    ${tag.padEnd(24)} ${dim(event.kind.padEnd(12))}${body}`);
	}

	const conflicts = trajectory.conflicts();
	console.log(`\n  ${bold("The same question, on this structure, is a set operation:")}`);
	for (const conflict of conflicts) {
		console.log(
			`    ${red("conflict")} ${conflict.action.toolName}(${JSON.stringify(conflict.action.args)}) → exitCode=${conflict.exitCode}`,
		);
		console.log(`         and the agent then said: ${JSON.stringify(conflict.claim)}`);
	}

	console.log(
		yellow(
			'\n  ⚠ The difference is not "which reads better" but **whether it can be queried**.\n' +
				"    On a chat log this is a natural-language understanding problem (with an untrustworthy answer);\n" +
				"    on a trajectory it is one filter plus a join.",
		),
	);
}

// ─────────────────────────────────────────────────────────────

function failureFixture(): Trajectory {
	const trajectory = new Trajectory();
	const events: TrajectoryEvent[] = [
		{ kind: "message", id: "f1", timestamp: next(), source: "user", text: "Clear the old cache, then re-run the tests." },
		{
			kind: "action", id: "f2", timestamp: next(), source: "agent",
			thought: "Delete the cache first.", toolName: "run_command", toolCallId: "c1",
			args: { command: "rm -rf .cache" }, llmResponseId: "r1",
		},
			// ① The user refused — with a reason, and as its own event type
		{
			kind: "user-reject", id: "f3", timestamp: next(), source: "environment",
			toolName: "run_command", toolCallId: "c1", actionId: "f2",
			rejectionReason:
				"the user declined: rm -rf is not on the allowlist, and .cache holds measurements that have not been uploaded",
		},
		{
			kind: "action", id: "f4", timestamp: next(), source: "agent",
			thought: "Then I will just run the tests.", toolName: "run_command", toolCallId: "c2",
			args: { command: "npm test" }, llmResponseId: "r2",
		},
			// ② The environment says it failed
		{
			kind: "observation", id: "f5", timestamp: next(), source: "environment",
			toolName: "run_command", toolCallId: "c2", actionId: "f4",
			content: "2 failing", exitCode: 1,
		},
		{
			kind: "action", id: "f6", timestamp: next(), source: "agent",
			thought: "Look at the file that failed.", toolName: "read_file", toolCallId: "c3",
			args: { path: "src/store.ts", offset: -5 }, llmResponseId: "r3",
		},
			// ③ Our own harness broke (source is "agent", not environment)
		{
			kind: "agent-error", id: "f7", timestamp: next(), source: "agent",
			toolName: "read_file", toolCallId: "c3",
			error:
				"TypeError: Cannot read properties of undefined (reading 'slice') — offset is never checked for negatives",
		},
	];
	for (const event of events) trajectory.add(event);
	return trajectory;
}

function scenarioFailures(): void {
	console.log(`\n${bold("── failures · three kinds of failure, one field cannot hold them")}`);
	const trajectory = failureFixture();

	console.log(dim("\n  ① the three failures as they appear in a chat log:"));
	for (const message of trajectory.toChatHistory()) {
		if (message.role !== "toolResult") continue;
		console.log(`    ${dim("toolResult")} ${message.content.slice(0, 62)}`);
	}
	console.log(red("    All three are a toolResult plus a string starting with Error. Indistinguishable."));

	console.log(dim("\n  ② the trajectory:"));
	const kinds = trajectory.failureKinds();
	console.log(`    the environment failed (exitCode≠0)   ${kinds.environment}`);
	console.log(`    the user declined (with a reason)     ${kinds.rejected}`);
	console.log(`    ${yellow("our own bug")}                          ${kinds.scaffold}`);

	console.log(
		yellow(
			'\n  ⚠ The third matters most: `source: "agent"` means **the scaffolding broke**, not that the world refused.\n' +
				"    Conflating them has a concrete cost: you end up tuning prompts against your own bug.",
		),
	);
	console.log(
		dim(
			"\n  And what should follow differs completely:\n" +
				"    environment failure → retry, or try another way\n" +
				"    the user declined   → **do not retry** (Lesson 8 measured five consecutive attempts)\n" +
				"    the scaffolding broke → the thing to fix is our code; no amount of model cleverness helps",
		),
	);
}

// ─────────────────────────────────────────────────────────────

function scenarioBatches(): void {
	console.log(`\n${bold("── batches · three tools in one response, or one tool in each of three")}`);

	const parallel = new Trajectory();
	for (let i = 1; i <= 3; i++) {
		parallel.add({
			kind: "action", id: `p${i}`, timestamp: next(), source: "agent",
			thought: "Read all three files together.", toolName: "read_file", toolCallId: `pc${i}`,
			args: { path: `src/${i}.ts` }, llmResponseId: "resp_same",
		});
	}

	const sequential = new Trajectory();
	for (let i = 1; i <= 3; i++) {
		sequential.add({
			kind: "action", id: `s${i}`, timestamp: next(), source: "agent",
			thought: "Read another one.", toolName: "read_file", toolCallId: `sc${i}`,
			args: { path: "src/store.ts" }, llmResponseId: `resp_${i}`,
		});
	}

	console.log(
		`\n  parallel:   ${parallel.batches().size} batches / ${parallel.all().length} actions` +
			dim("  ← one response called three tools"),
	);
	console.log(
		`  sequential: ${sequential.batches().size} batches / ${sequential.all().length} actions` +
			dim("  ← three responses called one each, with identical arguments"),
	);

	console.log(
		dim(
			"\n  In a chat log the two look almost identical (three assistant messages either way),\n" +
				"  and they are completely different things:",
		),
	);
	console.log(
		dim(
			"    parallel                     → a normal batch operation\n" +
				"    sequential + identical args  → a **doom loop** (the opencode rule Lesson 28 mentions)",
		),
	);
	console.log(
		yellow(
			"\n  ⚠ This field also fixes a bug we really hit: in Lesson 23 Gemini did not send `index`,\n" +
				"    so parallel tool calls' arguments were concatenated into one broken string, latent for three lessons.\n" +
				'    We patched it with `index ?? id`; OpenHands has "the same response" **in the data model**.',
		),
	);
}

// ─────────────────────────────────────────────────────────────

function scenarioView(): void {
	console.log(`\n${bold("── view · after compaction, can you tell it was compacted")}`);

	const trajectory = new Trajectory();
	for (let i = 1; i <= 4; i++) {
		trajectory.add({
			kind: "message", id: `v${i}`, timestamp: next(), source: i % 2 ? "user" : "agent",
			text: `the conversation content of turn ${i}…`,
		});
	}
	trajectory.add({
		kind: "condensation", id: "vc", timestamp: next(), source: "environment",
		forgottenIds: ["v1", "v2"],
		summary: "(summary) The user wants the short-code case-sensitivity bug fixed; it has been located in store.ts.",
	});
	trajectory.add({
		kind: "message", id: "v5", timestamp: next(), source: "user", text: "Go ahead and change it the way you said.",
	});

	console.log(`\n  the full trajectory: ${trajectory.all().length} events`);
	console.log(`  the view the LLM sees: ${trajectory.view().length} events`);
	console.log(
		dim(`    forgotten: v1, v2  summary: ${(trajectory.all()[4] as { summary: string }).summary.slice(0, 30)}…`),
	);

	console.log(
		yellow(
			"\n  ⚠ Lesson 5 rewrites the message array in place, so **after compaction you cannot tell it happened**:\n" +
				'    the old messages are gone, and "why they are gone" left no record at all.',
		),
	);
	console.log(
		dim(
			"\n  As an event instead:\n" +
				"    trajectory  append-only, the complete factual record (v1 and v2 are still there)\n" +
				"    view        a computed projection, the one the model sees\n\n" +
				"  **Compaction goes from a destructive rewrite to a queryable, reversible event.**",
		),
	);
}

// ─────────────────────────────────────────────────────────────

const SCENARIOS: Record<string, () => void> = {
	conflict: scenarioConflict,
	failures: scenarioFailures,
	batches: scenarioBatches,
	view: scenarioView,
};

function main(): void {
	const only = process.argv[2];
	const names = only ? [only] : Object.keys(SCENARIOS);
	for (const name of names) {
		const scenario = SCENARIOS[name];
		if (!scenario) {
			console.error(`Unknown scenario: ${name}. Available: ${Object.keys(SCENARIOS).join(", ")}`);
			process.exitCode = 1;
			return;
		}
		scenario();
	}
	console.log(
		dim("\n(The real-model half asks a different question: `PROVIDER=gemini bun run lesson-37:agent`)"),
	);
}

main();
