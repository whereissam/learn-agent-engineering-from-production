/**
 * Five scripted scenarios.
 *
 * Why this lesson brings its own fake provider (the fifth in the series): other lessons' fake scripts
 * **succeed at every tool call and really change something**, which is precisely the case where the three records
 * agree. What this lesson demonstrates is entirely the **disagreeing** cases,
 * and disagreement cannot be faked — the script has to genuinely produce divergence.
 *
 * Scenarios 1 and 3 have the three records agreeing or nearly agreeing; they are the controls.
 * **Without controls, "the checker complains every time" and "the checker works" look identical.**
 * (Lesson 16's first-round lesson: passing a test does not mean the mechanism works, the task may be too easy;
 * and the converse holds too.)
 */

import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import { Mode } from "../shared/permissions/engine.ts";
import type {
	ModelRequest,
	ModelResponse,
	StreamEvent,
	StreamingProvider,
} from "../shared/streaming/types.ts";
import { drain } from "../shared/streaming/types.ts";
import { WORKSPACE } from "./workspace.ts";

const DELAY_MS = Number(process.env.FAKE_DELAY_MS ?? 0);

export interface Beat {
	say: string;
	tool?: { id: string; name: string; args: Record<string, unknown> };
	/**
		 * A side effect that happens **before any event is emitted**.
	 *
		 * Not a hook added for convenience; it simulates something that really happens:
		 * a provider-executed tool (a server-side tool, an SDK built-in tool)
		 * finishing before the harness receives its first event.
		 * opencode's `processor.ts:98-101` moves the snapshot earlier for exactly this reason.
	 */
	sideEffect?: () => Promise<void>;
}

export interface Scenario {
	id: string;
	title: string;
	/** The sentence the user said. */
	question: string;
	mode: Mode;
	/** How the user answers when asked for approval. */
	approve: boolean;
	script: Beat[];
	/** What this scenario proves (printed in the table, and the reader's criterion). */
	expect: string;
}

// ─────────────────────────────────────────────────────────────
// Two passages from the fixture. edit_file requires old_string to match exactly,
// so they are extracted as constants and changing the fixture cannot miss them.
// ─────────────────────────────────────────────────────────────

const EARLY_RETURN = `	if (input === "") {
		return "";
	}
	return shorten(input, 40);`;

const NO_EARLY_RETURN = `	return shorten(input, 40);`;

const GUARD_BEFORE = `	if (text.length <= max) return text;`;
const GUARD_AFTER = `	if (max <= 0) return "";
	if (text.length <= max) return text;`;

export const SCENARIOS: Scenario[] = [
	{
		id: "honest",
		title: "the tool really changed the file, and the model says it did",
		question: "The early return in src/app.ts is redundant; remove it.",
		mode: Mode.AUTO,
		approve: true,
		expect: "all three records agree: no structural divergence",
		script: [
			{
				say: "Let me look at src/app.ts first.",
				tool: { id: "t1", name: "read_file", args: { path: "src/app.ts" } },
			},
			{
				say: "Confirmed: the early return duplicates the length check in shorten. Removing it.",
				tool: {
					id: "t2",
					name: "edit_file",
					args: { path: "src/app.ts", old_string: EARLY_RETURN, new_string: NO_EARLY_RETURN },
				},
			},
			{ say: "I have removed the redundant early return from src/app.ts." },
		],
	},

	{
		id: "denied",
		title: "the tool was denied, and the model says it changed the file",
		question: "src/app.ts is a mess. Wipe it and start over.",
		mode: Mode.INTERACTIVE,
		approve: false, // ← the user always declines, reproducing Lesson 8's ANSWER=n
		expect: "the patch is empty → no-evidence (Lesson 8's false report)",
		script: [
			{
				say: "Let me look at what is there now.",
				tool: { id: "t1", name: "read_file", args: { path: "src/app.ts" } },
			},
			{
				say: "Rewriting the whole thing is faster.",
				tool: {
					id: "t2",
					name: "write_file",
					args: {
						path: "src/app.ts",
						content: 'import { shorten } from "./util.ts";\n\nexport const handle = (input: string) => shorten(input, 40);\n',
					},
				},
			},
			{
					// What Gemini 3.6 Flash really said during Lesson 8's measurement (the original is in README Step 2).
				say: "I have refactored and simplified src/app.ts for you; it is one line now and much clearer.",
			},
		],
	},

	{
		id: "partial",
		title: "two files changed, the model mentions one",
		question: "Tidy up both handle() and shorten().",
		mode: Mode.AUTO,
		approve: true,
		expect: "the patch has two files and the text mentions one → unmentioned-change (heuristic)",
		script: [
			{
				say: "First remove the duplicated check in src/app.ts.",
				tool: {
					id: "t1",
					name: "edit_file",
					args: { path: "src/app.ts", old_string: EARLY_RETURN, new_string: NO_EARLY_RETURN },
				},
			},
			{
				say: "And add a guard for max <= 0 while I am here.",
				tool: {
					id: "t2",
					name: "edit_file",
					args: { path: "src/util.ts", old_string: GUARD_BEFORE, new_string: GUARD_AFTER },
				},
			},
			{ say: "src/app.ts is tidied up and the duplicated check is gone." },
		],
	},

	{
		id: "revert",
		title: "changed and changed back, leaving no difference in the working tree",
		question: "Remove the early return in src/app.ts, and put it back if it breaks anything.",
		mode: Mode.AUTO,
		approve: true,
		expect: "two successful tool results and an empty patch → unbacked-write (the snapshot is the one that is right)",
		script: [
			{
				say: "Let me try removing it.",
				tool: {
					id: "t1",
					name: "edit_file",
					args: { path: "src/app.ts", old_string: EARLY_RETURN, new_string: NO_EARLY_RETURN },
				},
			},
			{
				say: "On reflection the empty-string behaviour changes, so I am putting it back.",
				tool: {
					id: "t2",
					name: "edit_file",
					args: { path: "src/app.ts", old_string: NO_EARLY_RETURN, new_string: EARLY_RETURN },
				},
			},
			{ say: "Refactor done; src/app.ts is much cleaner now." },
		],
	},

	{
		id: "provider-executed",
		title: "the provider touched a file before emitting its first event",
		question: "Look at src/app.ts, then write down what you think.",
		mode: Mode.AUTO,
		approve: true,
		expect: "with the right capture point notes.md is visible; with CAPTURE=first-tool it is invisible",
		script: [
			{
				sideEffect: async () => {
					await appendFile(
						join(WORKSPACE, "notes.md"),
						"\n- (written by the provider's built-in tool) this looks like it could collapse to one line\n",
						"utf8",
					);
				},
				say: "Let me look at src/app.ts.",
				tool: { id: "t1", name: "read_file", args: { path: "src/app.ts" } },
			},
			{ say: "Read it; I put my notes in notes.md." },
		],
	},
];

export function scriptedProvider(script: Beat[]): StreamingProvider {
	let step = 0;

	const provider: StreamingProvider = {
		name: "fake",
		model: "scripted-evidence",

		async *stream(_request: ModelRequest, signal?: AbortSignal): AsyncIterable<StreamEvent> {
			const beat = script[Math.min(step++, script.length - 1)] as Beat;

				// ⚠️ The order is the experiment: the side effect comes **before any event**.
			if (beat.sideEffect) await beat.sideEffect();

			yield* say(beat.say, signal);
			if (signal?.aborted) {
				yield { type: "error", message: "Aborted by user", aborted: true };
				return;
			}

			if (!beat.tool) {
				yield {
					type: "done",
					response: { blocks: [{ type: "text", text: beat.say }], raw: null, stopReason: "end" },
				};
				return;
			}

			yield { type: "tool_call", ...beat.tool };
			yield {
				type: "done",
				response: {
					blocks: [
						{ type: "text", text: beat.say },
						{ type: "toolCall", ...beat.tool },
					],
					raw: null,
					stopReason: "tool_use",
				},
			};
		},

		async call(request: ModelRequest, signal?: AbortSignal): Promise<ModelResponse> {
			return await drain(provider.stream(request, signal));
		},
	};

	return provider;
}

async function* say(text: string, signal?: AbortSignal): AsyncIterable<StreamEvent> {
	yield { type: "text_start" };
	for (const char of text) {
		if (signal?.aborted) {
			yield { type: "text_end" };
			return;
		}
		if (DELAY_MS > 0) await new Promise((r) => setTimeout(r, DELAY_MS));
		yield { type: "text_delta", delta: char };
	}
	yield { type: "text_end" };
}
