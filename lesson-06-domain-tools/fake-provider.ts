/**
 * The fake provider specific to Lesson 6.
 *
 * ## Why this exists
 *
 * `shared/streaming/fake.ts`'s script was written for the Lesson 1-5 coding agent
 * and calls `list_files` / `read_file`. Lesson 6 swaps in a whole set of domain tools,
 * so that fake provider earns two `Unknown tool` results here
 * and then emits a canned paragraph with nothing to do with robots.
 *
 * That is, **design principle 1 (every lesson must run with `PROVIDER=fake`) was false for Lessons 6-7
 * all along**, and nobody ran it so nobody noticed. It came to light while writing Lesson 20's
 * own fake provider.
 *
 * ## The trajectory it acts out
 *
 * It follows Lesson 6's README order once through:
 *
 *   get_session      check data quality first (rule 1)
 *   find_anomalies   find candidate intervals with deterministic rules
 *   query_telemetry  zoom into the suspicious interval
 *   get_video_frame  cross-validate
 *   create_incident_report
 *
 * The classification is deliberately `near_miss`: `sess_002`'s pitch spikes to 37 degrees and looks like a fall,
 * while the feet stay on the ground. **That "one signal separating two very similar situations" is the whole lesson's point.**
 *
 * Usage: PROVIDER=fake bun run lesson-06
 */

import type {
	ModelRequest,
	ModelResponse,
	StreamEvent,
	StreamingProvider,
} from "../shared/streaming/types.ts";
import { drain } from "../shared/streaming/types.ts";

const DELAY_MS = Number(process.env.FAKE_DELAY_MS ?? 8);

/** Recognise a session id in the user's question, falling back to sess_002. */
function sessionFrom(request: ModelRequest): string {
	const text = request.messages.map((m) => (m.role === "user" ? m.text : "")).join(" ");
	return /sess_\d{3}/.exec(text)?.[0] ?? "sess_002";
}

interface Step {
	text: string;
	tool: string;
	args: (session: string) => Record<string, unknown>;
}

const STEPS: Step[] = [
	{
		text: "First, check this session's data quality.",
		tool: "get_session",
		args: (session) => ({ session_id: session }),
	},
	{
		text: "The data is complete. Sweep it with thresholds to find candidate windows.",
		tool: "find_anomalies",
		args: (session) => ({ session_id: session }),
	},
	{
		text: "One stretch of pitch looks wrong. Zoom in; foot_contact is the thing to watch.",
		tool: "query_telemetry",
		args: (session) => ({ session_id: session, start_ms: 5000, end_ms: 6500 }),
	},
	{
		text: "The feet never left the ground. Confirm it against the video.",
		tool: "get_video_frame",
		args: (session) => ({ session_id: session, t_ms: 5620 }),
	},
];

const REPORT_ARGS = (session: string) => ({
	session_id: session,
	classification: "near_miss",
	confidence: "high",
	window_start_ms: 5360,
	window_end_ms: 6500,
	evidence: [
		"imu_pitch_deg peaked at 37.70° (0-5° in normal walking)",
		"joint_torque_max peaked at 51.36 Nm (15-25 Nm in normal walking)",
		"at least one foot stayed down throughout; 0 airborne samples",
		"normal walking resumed after t>6500ms",
	],
	caveats: ["A canned report from the fake provider; the numbers come from the measured run in the README"],
});

export function fakeTelemetryProvider(): StreamingProvider {
	let step = 0;

	const provider: StreamingProvider = {
		name: "fake",
		model: "scripted-telemetry",

		async *stream(request: ModelRequest, signal?: AbortSignal): AsyncIterable<StreamEvent> {
			const session = sessionFrom(request);
			const turn = step++;
			const scripted = STEPS[turn];

			if (scripted && request.tools.length > 0) {
				yield* say(scripted.text, signal);
				if (signal?.aborted) return yield aborted();
				const call = { id: `f${turn}`, name: scripted.tool, args: scripted.args(session) };
				yield { type: "tool_call", ...call };
				yield {
					type: "done",
					response: {
						blocks: [
							{ type: "text", text: scripted.text },
							{ type: "toolCall", ...call },
						],
						raw: null,
						stopReason: "tool_use",
					},
				};
				return;
			}

			if (turn === STEPS.length) {
				const text = "The feet stayed down the whole time, so this was not a fall. Writing the report.";
				const call = { id: "freport", name: "create_incident_report", args: REPORT_ARGS(session) };
				yield* say(text, signal);
				if (signal?.aborted) return yield aborted();
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

			const outro =
				`${session} is classified near_miss: pitch reached 37.70°, which looks like a fall,\n` +
				"but at least one of the four feet was down throughout, and normal walking resumed afterwards.\n\n" +
				"(This is a hardcoded script, not the model's judgement. A real model's actual trajectory is in\n" +
				"README Step 0. This fake provider exists so that people without an API key can still see how\n" +
				"the tools chain together.)";
			yield* say(outro, signal);
			if (signal?.aborted) return yield aborted();
			yield {
				type: "done",
				response: { blocks: [{ type: "text", text: outro }], raw: null, stopReason: "end" },
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
		await sleep(DELAY_MS);
		yield { type: "text_delta", delta: char };
	}
	yield { type: "text_end" };
}

function aborted(): StreamEvent {
	return { type: "error", message: "Aborted by user", aborted: true };
}

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}
