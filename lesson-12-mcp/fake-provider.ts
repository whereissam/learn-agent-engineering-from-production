/**
 * The fake provider specific to Lesson 12.
 *
 * The same reason again (the fourth lesson to bring its own): the shared script only calls file tools
 * and never touches an MCP tool, so nothing would be demonstrated.
 *
 * The script has two beats, matching this lesson's two points:
 *
 *   turn 0  mcp__fleet__list_robots            read-only, and **still requires approval**
 *   turn 1  mcp__fleet__schedule_maintenance   an external side effect, definitely requires approval
 *
 * Turn 0 is the point: `list_robots` sounds entirely harmless,
 * and it is somebody else's program, of which **you have only its name and one sentence it wrote about itself**.
 */

import type {
	ModelRequest,
	ModelResponse,
	StreamEvent,
	StreamingProvider,
} from "../shared/streaming/types.ts";
import { drain } from "../shared/streaming/types.ts";

const DELAY_MS = Number(process.env.FAKE_DELAY_MS ?? 8);

export function mcpFakeProvider(): StreamingProvider {
	let step = 0;

	const provider: StreamingProvider = {
		async *stream(request: ModelRequest, signal?: AbortSignal): AsyncIterable<StreamEvent> {
			const turn = step++;

				/** Find a tool whose name matches, falling back to the first, so COLLIDE mode still runs. */
			const pick = (suffix: string): string =>
				request.tools.find((tool) => tool.name.endsWith(suffix))?.name ??
				request.tools[0]?.name ??
				"unknown";

			if (turn === 0) {
				const text = "Let me check which robots are under maintenance.";
				yield* say(text, signal);
				const call = {
					id: "m1",
					name: pick("list_robots"),
					args: { status: "maintenance" },
				};
				yield { type: "tool_call", ...call };
				yield {
					type: "done",
					response: {
						blocks: [
							{ type: "text", text },
							{ type: "toolCall", ...call },
						],
						raw: null,
						stopReason: "tool_use",
					},
				};
				return;
			}

			if (turn === 1) {
				const text = "R-204 is under maintenance. I will book a slot for it.";
				yield* say(text, signal);
				const call = {
					id: "m2",
					name: pick("schedule_maintenance"),
					args: {
						robot_id: "R-204",
						window: { start: "2026-08-01T02:00:00Z", hours: 3 },
						notes: null,
					},
				};
				yield { type: "tool_call", ...call };
				yield {
					type: "done",
					response: {
						blocks: [
							{ type: "text", text },
							{ type: "toolCall", ...call },
						],
						raw: null,
						stopReason: "tool_use",
					},
				};
				return;
			}

			const last = request.messages[request.messages.length - 1];
			const denied = last?.role === "toolResult" && last.results.some((r) => r.isError);
			const text = denied
				? "The maintenance slot was not booked (approval was declined). R-204 is the one under maintenance."
				: "Booked. R-204 is the one under maintenance, and the on-site crew has been notified of the slot.";

			yield* say(text, signal);
			yield {
				type: "done",
				response: { blocks: [{ type: "text", text }], raw: null, stopReason: "end" },
			};
		},

		name: "fake",
		model: "scripted-mcp",

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
