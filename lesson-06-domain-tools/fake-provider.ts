/**
 * Lesson 6 專用的假 provider。
 *
 * ## 為什麼需要這一支
 *
 * `shared/streaming/fake.ts` 的腳本是寫給 Lesson 1-5 的 coding agent 的，
 * 它會呼叫 `list_files` / `read_file`。Lesson 6 換了一整組領域工具，
 * 所以那支假 provider 在這裡只會換來兩次 `Unknown tool`，
 * 然後吐一段跟機器人完全無關的罐頭文字。
 *
 * 也就是說**設計原則 1（每一課都要能用 `PROVIDER=fake` 跑）在 Lesson 6-7
 * 一直是不成立的**，只是沒有人去跑所以沒發現。這是 Lesson 20 寫自己的
 * 假 provider 時才回頭注意到的。
 *
 * ## 它演的軌跡
 *
 * 照 Lesson 6 README 的教學順序走一次：
 *
 *   get_session      先檢查資料品質（規則 1）
 *   find_anomalies   用確定性規則找候選區間
 *   query_telemetry  放大可疑區間
 *   get_video_frame  交叉驗證
 *   create_incident_report
 *
 * 分類刻意選 `near_miss`：`sess_002` 的 pitch 衝到 37 度看起來像跌倒，
 * 但腳一直在地上。**那個「一個訊號區分兩個很像的情況」才是整課的重點。**
 *
 * 用法：PROVIDER=fake bun run lesson-06
 */

import type {
	ModelRequest,
	ModelResponse,
	StreamEvent,
	StreamingProvider,
} from "../shared/streaming/types.ts";
import { drain } from "../shared/streaming/types.ts";

const DELAY_MS = Number(process.env.FAKE_DELAY_MS ?? 8);

/** 從使用者的問題裡認出 session id，認不出來就用 sess_002。 */
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
		text: "先看這個 session 的資料品質。",
		tool: "get_session",
		args: (session) => ({ session_id: session }),
	},
	{
		text: "資料完整。用門檻掃一次，找出候選區間。",
		tool: "find_anomalies",
		args: (session) => ({ session_id: session }),
	},
	{
		text: "有一段 pitch 異常。放大來看，重點是 foot_contact。",
		tool: "query_telemetry",
		args: (session) => ({ session_id: session, start_ms: 5000, end_ms: 6500 }),
	},
	{
		text: "腳沒有離地。用影片再確認一次。",
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
		"imu_pitch_deg 峰值 37.70°（正常行走 0-5°）",
		"joint_torque_max 峰值 51.36 Nm（正常行走 15-25 Nm）",
		"全程至少一隻腳著地，airborne 樣本為 0",
		"t>6500ms 後恢復正常行走",
	],
	caveats: ["這是假 provider 產生的罐頭報告，數字取自 README 的實測紀錄"],
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
				const text = "腳全程著地，所以這不是跌倒。寫報告。";
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
				`${session} 判定為 near_miss：pitch 到了 37.70°，看起來像跌倒，\n` +
				"但四隻腳全程至少有一隻著地，而且事後恢復正常行走。\n\n" +
				"（這是寫死的腳本，不是模型的判斷。真模型的實際軌跡在 README Step 0。\n" +
				"這支假 provider 的用途是讓沒有 API key 的人也能看到工具怎麼串起來。）";
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
