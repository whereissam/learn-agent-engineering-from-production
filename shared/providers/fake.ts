/**
 * A fake provider — no API key needed.
 *
 * It answers from a hardcoded script, so you can run things before obtaining a key
 * and step through the whole loop in a debugger.
 *
 * Not merely a toy: every real agent project needs something like this to write tests,
 * or every test run costs money and the results are irreproducible.
 * Against Pi: packages/ai/src/providers/faux.ts
 *
 * Usage: PROVIDER=fake bun run lesson-01-agent-loop/agent.ts
 *
 * The script switches itself based on which tools are available:
 *   read_file only          → Lesson 1's script
 *   write_file/edit_file    → Lesson 2's script (which triggers the approval flow)
 */

import type { AssistantBlock, ModelRequest, ModelResponse, Provider } from "./types.ts";

export function fakeProvider(): Provider {
	// How many times it has been called. The script advances on this.
	let step = 0;

	return {
		name: "fake",
		model: "scripted",

		async call(request: ModelRequest): Promise<ModelResponse> {
			const turn = step++;
			const toolNames = new Set(request.tools.map((t) => t.name));

			const script = toolNames.has("edit_file") ? lesson2Script : lesson1Script;
			return script(turn, request);
		},
	};
}

// ─────────────────────────────────────────────────────────────
// Lesson 1: read_file only
// ─────────────────────────────────────────────────────────────

function lesson1Script(turn: number, request: ModelRequest): ModelResponse {
		// Call 1: look at the README first
	if (turn === 0) {
		return toolCalls([{ id: "call_1", name: "read_file", args: { path: "README.md" } }]);
	}

		// Call 2: read two files at once.
		// This demonstrates parallel tool calls — one assistant message with several tool calls,
		// which the loop must execute all of before returning them together.
	if (turn === 1) {
		return toolCalls([
			{ id: "call_2", name: "read_file", args: { path: "src/store.ts" } },
			{ id: "call_3", name: "read_file", args: { path: "src/config.ts" } },
		]);
	}

		// Call 3: deliberately read a file that does not exist, so you see how an error reaches the model.
	if (turn === 2) {
		return toolCalls([
			{ id: "call_4", name: "read_file", args: { path: "src/does-not-exist.ts" } },
		]);
	}

		// Call 4: state the conclusion with no tool call → the loop ends.
	const readCount = request.messages.filter((m) => m.role === "toolResult").length;
	return text(
		`[fake provider] I ran ${readCount} rounds of tool calls.\n\n` +
			`A real model would give you an answer here. Set an API key and run it again to see real reasoning.`,
	);
}

// ─────────────────────────────────────────────────────────────
// Lesson 2: the full tool set, reaching the approval flow
//
// The script deliberately acts out a complete "fix the case-sensitivity bug" flow:
//   explore → read → run the tests (they fail) → edit (needs approval) → run again (they pass)
// ─────────────────────────────────────────────────────────────

function lesson2Script(turn: number, _request: ModelRequest): ModelResponse {
	switch (turn) {
		case 0:
			return toolCalls([{ id: "c1", name: "list_files", args: {} }]);

		case 1:
				// Read three files in parallel
			return toolCalls([
				{ id: "c2", name: "read_file", args: { path: "src/store.ts" } },
				{ id: "c3", name: "read_file", args: { path: "src/config.ts" } },
			]);

		case 2:
				// Run the tests to see the current state — the first approval prompt (run_command is mutating)
			return toolCalls([{ id: "c4", name: "run_command", args: { command: "bun test" } }]);

		case 3:
				// Make the change — the second approval prompt (edit_file is mutating)
			return toolCalls([
				{
					id: "c5",
					name: "edit_file",
					args: {
						path: "src/store.ts",
						old_string: "\tentries.set(code, url);",
						new_string: "\tentries.set(code.toLowerCase(), url);",
					},
				},
			]);

		case 4:
				// Verify the fix
			return toolCalls([{ id: "c6", name: "run_command", args: { command: "bun test" } }]);

		default:
			return text(
				"[fake provider] The script is done.\n\n" +
					"What you just watched was: explore → read → run the tests → edit → run them again to verify.\n" +
					"run_command and edit_file both needed your approval; read_file and list_files did not.\n\n" +
					"Set an API key and run it again to see real reasoning.",
			);
	}
}

// ─────────────────────────────────────────────────────────────

function toolCalls(
	calls: Array<{ id: string; name: string; args: Record<string, unknown> }>,
): ModelResponse {
	return {
		blocks: calls.map((call) => ({ type: "toolCall" as const, ...call })),
		raw: null,
		stopReason: "tool_use",
	};
}

function text(body: string): ModelResponse {
	const blocks: AssistantBlock[] = [{ type: "text", text: body }];
	return { blocks, raw: null, stopReason: "end" };
}
