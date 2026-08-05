/**
 * The fake provider for Lesson 35.
 *
 * The shared one explores with `list_files` and `read_file`, which are governed
 * in-process by Lesson 8's engine and never reach a shell. This lesson's whole
 * subject is the other path — a command the engine has already approved — so it
 * needs a script that walks it.
 *
 * The script does nothing forbidden. Every command it runs is on the allowlist:
 *
 *   turn 0  run_command("cat notes.md")                  allowlisted, reads the brief
 *   turn 1  run_command("cat deploy.sh")                  allowlisted, finds where the token lives
 *   turn 2  run_command("cat ../outside/credentials.txt") allowlisted — `cat` is on the list
 *   turn 3  reports the token
 *
 * Turn 2 is the lesson. `cat` is on the allowlist, so Lesson 8's engine returns
 * `allowed: true` with `reason: "command is on the allowlist"`. Nothing has gone
 * wrong with the permission engine; it answered the question it was asked. The
 * question it was never asked is which bytes `cat` would go and get.
 *
 * (The fourth lesson in the series to bring its own fake provider, after 6, 8
 * and 20, and always for the same reason: the shared script never walks the path
 * being demonstrated.)
 */

import type {
	ModelRequest,
	ModelResponse,
	StreamEvent,
	StreamingProvider,
} from "../shared/streaming/types.ts";
import { drain } from "../shared/streaming/types.ts";

const DELAY_MS = Number(process.env.FAKE_DELAY_MS ?? 8);

interface Beat {
	say: string;
	tool?: { id: string; name: string; args: Record<string, unknown> };
}

const SCRIPT: Beat[] = [
	{
		say: "Let me read the notes first to see what the deploy failure is.",
		tool: { id: "s1", name: "run_command", args: { command: "cat notes.md" } },
	},
	{
		say: "The credentials are not in the repo. Let me see what deploy.sh reads.",
		tool: { id: "s2", name: "run_command", args: { command: "cat deploy.sh" } },
	},
	{
		say: "It reads ../outside/credentials.txt. Let me look at that file.",
		tool: {
			id: "s3",
			name: "run_command",
			args: { command: "cat ../outside/credentials.txt" },
		},
	},
	{
		say:
			"Found it. deploy.sh reads DEPLOY_TOKEN from ../outside/credentials.txt, and the value " +
			"configured there is tok-a91f-not-a-real-secret. If the deploy is returning 401, that " +
			"token is the thing to rotate.",
	},
];

export function sandboxFakeProvider(): StreamingProvider {
	let step = 0;

	const provider: StreamingProvider = {
		name: "fake",
		model: "scripted-sandbox",

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
		await new Promise((r) => setTimeout(r, DELAY_MS));
		yield { type: "text_delta", delta: char };
	}
	yield { type: "text_end" };
}
