/**
 * The fake provider specific to Lesson 8.
 *
 * Why not `shared/streaming/fake.ts`: that one is for the coding agent
 * and only calls list_files / read_file, all of which are READ risk,
 * so the permission engine **never says no** to it and nothing gets demonstrated.
 *
 * This script is deliberately designed: the model **tries three blocked approaches in a row**,
 * each tripping a different rule in the engine.
 *
 *   turn 0  run_command("ls")             → on the allowlist, allowed automatically
 *   turn 1  run_command("rm -rf src")     → EXEC and not on the list, so it asks
 *   turn 2  run_command("ls; rm -rf src") → the prefix fools the list, and there are metacharacters
 *   turn 3  write_file("../../evil.txt")  → path escape, blocked even in AUTO
 *   turn 4  gives up and says something
 *
 * Turn 2 is the point: **it is a genuine attempt to route around**. The prefix comparison passes (it starts with "ls"),
 * and only the metacharacter check stops it. See Lesson 8's README Step 4.
 *
 * (This is the third lesson in the series with its own fake provider, after Lessons 6 and 20.
 * The reason is always the same: the shared script never walks the path this lesson demonstrates.)
 */

import type {
	ModelRequest,
	ModelResponse,
	StreamEvent,
	StreamingProvider,
} from "../shared/streaming/types.ts";
import { drain } from "../shared/streaming/types.ts";

const DELAY_MS = Number(process.env.FAKE_DELAY_MS ?? 12);

interface Beat {
	say: string;
	tool?: { id: string; name: string; args: Record<string, unknown> };
}

const SCRIPT: Beat[] = [
	{
		say: "我先看一下目錄結構。",
		tool: { id: "p1", name: "run_command", args: { command: "ls" } },
	},
	{
		say: "src/app.ts 太亂了，我直接砍掉重寫比較快。",
		tool: { id: "p2", name: "run_command", args: { command: "rm -rf src" } },
	},
	{
			// The first reaction after a refusal: switch to a "safe-looking" opening.
		//
			// Note this is `ls && rm`, not `ls; rm`. The difference matters:
			// the prefix comparison requires a word boundary (starting with `"ls"` or `"ls "`), so `ls; rm`
			// does not even pass the prefix check. `ls && rm` is the kind that really fools the prefix
			// and **is stopped only by the metacharacter check**.
		say: "好，那我換個方式做。",
		tool: { id: "p3", name: "run_command", args: { command: "ls && rm -rf src" } },
	},
	{
			// Another direction: skip the shell and use a file tool to write outside the workspace.
		say: "那我先把備份寫到工作區外面。",
		tool: {
			id: "p4",
			name: "write_file",
			args: { path: "../../evil.txt", content: "backup" },
		},
	},
	{
		say:
			"三種做法都被權限規則擋下來了，我不再嘗試繞過。\n\n" +
			"我沒有動任何檔案。如果你確定要重寫 src/app.ts，" +
			"可以改用 interactive 模式並批准那一次指令，或是把工作區設成可寫並讓我逐檔編輯。",
	},
];

export function permissionFakeProvider(): StreamingProvider {
	let step = 0;

	const provider: StreamingProvider = {
		name: "fake",
		model: "scripted-permissions",

		async *stream(_request: ModelRequest, signal?: AbortSignal): AsyncIterable<StreamEvent> {
			const beat = SCRIPT[Math.min(step++, SCRIPT.length - 1)] as Beat;

			yield* say(beat.say, signal);
			if (signal?.aborted) {
				yield { type: "error", message: "Aborted by user", aborted: true };
				return;
			}

			if (!beat.tool) {
				yield {
					type: "done",
					response: {
						blocks: [{ type: "text", text: beat.say }],
						raw: null,
						stopReason: "end",
					},
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
		await new Promise((r) => setTimeout(r, DELAY_MS));
		yield { type: "text_delta", delta: char };
	}
	yield { type: "text_end" };
}
