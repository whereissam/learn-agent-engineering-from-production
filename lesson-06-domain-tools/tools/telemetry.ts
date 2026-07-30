/**
 * Domain tools: robot telemetry.
 *
 * This is layer 3. Against Lesson 2's read_file / write_file, the biggest difference:
 *
 *   a general tool: hand the model **a pile of data** and let it work things out
 *   a domain tool:  hand **a question** to your code and give the model only the conclusion
 *
 * Concretely, offering only read_file would make the model read 700 JSON samples
 * and do statistics in its head. Three things would follow:
 *   1. a token explosion (100KB for one session)
 *   2. arithmetic errors (LLMs are very unreliable at numeric statistics)
 *   3. irreproducible results (asking twice about the same data can give different answers)
 *
 * So query_telemetry returns a statistical summary rather than raw samples,
 * find_anomalies finds candidate intervals with **deterministic code**,
 * and the model handles what it is good at: interpreting, connecting evidence, writing the report.
 *
 * The most important principle in domain tool design:
 *
 *   > What a program can compute must not be given to the model to compute.
 *   > The model judges and narrates; it does not do statistics.
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Tool } from "../../shared/tools/registry.ts";

const DATA_DIR = resolve(import.meta.dirname, "../data/sessions");

// ─────────────────────────────────────────────────────────────
// Data access
// ─────────────────────────────────────────────────────────────

interface Sample {
	t_ms: number;
	imu_pitch_deg: number;
	imu_roll_deg: number;
	imu_accel_z: number;
	foot_contact: [boolean, boolean, boolean, boolean];
	joint_torque_max: number;
	cmd_vel_x: number;
}

interface SessionMeta {
	session_id: string;
	robot_id: string;
	recorded_at: string;
	duration_ms: number;
	sample_count: number;
	sample_rate_hz: number;
	video_offset_ms: number;
}

/** Sessions already read are cached in memory, so one turn does not re-read files. */
const cache = new Map<string, Sample[]>();

async function loadIndex(): Promise<SessionMeta[]> {
	const raw = await readFile(resolve(DATA_DIR, "index.json"), "utf8");
	return JSON.parse(raw) as SessionMeta[];
}

async function loadSamples(sessionId: string): Promise<Sample[]> {
	const cached = cache.get(sessionId);
	if (cached) return cached;

	// The session id comes from the model, so it is untrusted input like everything else.
	// An allowlist comparison is used rather than a path check, because we know the id format exactly.
	if (!/^sess_\d{3}$/.test(sessionId)) {
		throw new Error(
			`Invalid session_id "${sessionId}". Expected the form sess_001. ` +
				"Call list_sessions to see valid ids.",
		);
	}

	let raw: string;
	try {
		raw = await readFile(resolve(DATA_DIR, `${sessionId}.jsonl`), "utf8");
	} catch {
		throw new Error(`Session ${sessionId} not found. Call list_sessions to see what exists.`);
	}

	const samples = raw
		.split("\n")
		.filter((line) => line.trim())
		.map((line) => JSON.parse(line) as Sample);

	cache.set(sessionId, samples);
	return samples;
}

// ─────────────────────────────────────────────────────────────
// list_sessions
// ─────────────────────────────────────────────────────────────

export const listSessionsTool: Tool = {
	name: "list_sessions",
	mutating: false,
	description:
		"List all recorded robot sessions with their metadata. " +
		"Start here when you do not know which session to investigate.",
	parameters: { type: "object", properties: {} },

	async execute() {
		const index = await loadIndex();
		const lines = index.map(
			(s) =>
				`${s.session_id}  robot=${s.robot_id}  ${s.duration_ms}ms  ` +
				`${s.sample_count} samples @ ${s.sample_rate_hz}Hz  recorded=${s.recorded_at}`,
		);
		return `${index.length} sessions\n${lines.join("\n")}`;
	},
};

// ─────────────────────────────────────────────────────────────
// get_session
// ─────────────────────────────────────────────────────────────

export const getSessionTool: Tool = {
	name: "get_session",
	mutating: false,
	description:
		"Get metadata and a health summary for one session. " +
		"This reports sampling gaps and clock offsets, so call it before trusting any timestamp.",
	parameters: {
		type: "object",
		properties: {
			session_id: { type: "string", description: "e.g. sess_001" },
		},
		required: ["session_id"],
	},

	async execute(args) {
		const sessionId = String(args.session_id ?? "");
		const index = await loadIndex();
		const meta = index.find((s) => s.session_id === sessionId);
		if (!meta) {
			throw new Error(`Session ${sessionId} not found. Call list_sessions to see what exists.`);
		}

		const samples = await loadSamples(sessionId);

			// Data quality checks are **the tool's** responsibility, not the model's.
		//
			// Without an unprompted report that the data has holes, the model naturally assumes it is complete
			// and draws conclusions about a period with no data at all. This is one of the most common
			// sources of hallucinated conclusions: not the model making things up, but the tool not telling the truth.
		const gaps = findGaps(samples, meta.sample_rate_hz);

		const lines = [
			`session_id: ${meta.session_id}`,
			`robot_id: ${meta.robot_id}`,
			`recorded_at: ${meta.recorded_at}`,
			`duration_ms: ${meta.duration_ms}`,
			`samples: ${samples.length} @ ${meta.sample_rate_hz}Hz`,
		];

		if (gaps.length > 0) {
			lines.push("");
			lines.push("DATA QUALITY WARNING: sampling gaps detected");
			for (const gap of gaps) {
				lines.push(`  no samples between t=${gap.start_ms}ms and t=${gap.end_ms}ms (${gap.duration_ms}ms)`);
			}
			lines.push("  Do not draw conclusions about what happened inside these windows.");
		}

		if (meta.video_offset_ms !== 0) {
			lines.push("");
			lines.push(`CLOCK OFFSET: video timestamps are ${meta.video_offset_ms}ms relative to telemetry.`);
			lines.push(
				`  To convert: video_t = telemetry_t + (${meta.video_offset_ms}). ` +
					"Use get_video_frame, which applies this for you.",
			);
		}

		return lines.join("\n");
	},
};

function findGaps(
	samples: Sample[],
	hz: number,
): Array<{ start_ms: number; end_ms: number; duration_ms: number }> {
	const expected = 1000 / hz;
	const gaps: Array<{ start_ms: number; end_ms: number; duration_ms: number }> = [];

	for (let i = 1; i < samples.length; i++) {
		const prev = samples[i - 1];
		const cur = samples[i];
		if (!prev || !cur) continue;
		const delta = cur.t_ms - prev.t_ms;
			// Tolerate 2x jitter; beyond that it counts as a hole
		if (delta > expected * 2.5) {
			gaps.push({ start_ms: prev.t_ms, end_ms: cur.t_ms, duration_ms: delta });
		}
	}

	return gaps;
}

// ─────────────────────────────────────────────────────────────
// query_telemetry
// ─────────────────────────────────────────────────────────────

const FIELDS = [
	"imu_pitch_deg",
	"imu_roll_deg",
	"imu_accel_z",
	"joint_torque_max",
	"cmd_vel_x",
] as const;

export const queryTelemetryTool: Tool = {
	name: "query_telemetry",
	mutating: false,
	description:
		"Get statistics for a time window: min, max, mean, and the timestamp of the extreme. " +
		"Returns aggregates, not raw samples, so you can query wide windows cheaply. " +
		"Also reports foot contact loss, which distinguishes a fall from a crouch.",
	parameters: {
		type: "object",
		properties: {
			session_id: { type: "string" },
			start_ms: { type: "number", description: "Window start. Omit for session start." },
			end_ms: { type: "number", description: "Window end. Omit for session end." },
		},
		required: ["session_id"],
	},

	async execute(args) {
		const sessionId = String(args.session_id ?? "");
		const samples = await loadSamples(sessionId);

		const start = typeof args.start_ms === "number" ? args.start_ms : -Infinity;
		const end = typeof args.end_ms === "number" ? args.end_ms : Infinity;

		if (start > end) {
			throw new Error(`start_ms (${start}) is after end_ms (${end}). Swap them.`);
		}

		const window = samples.filter((s) => s.t_ms >= start && s.t_ms <= end);

			// An empty window must be stated explicitly, along with **why**.
			// Returning only "no data" leaves the model unsure whether the range was wrong or the data is genuinely absent.
		if (window.length === 0) {
			const first = samples[0]?.t_ms ?? 0;
			const last = samples.at(-1)?.t_ms ?? 0;
			throw new Error(
				`No samples between t=${start}ms and t=${end}ms. ` +
					`This session has data from t=${first}ms to t=${last}ms. ` +
					"Either the window is outside the recording, or it falls inside a sampling gap " +
					"(call get_session to check).",
			);
		}

		const lines = [
			`${sessionId}  t=${window[0]?.t_ms}..${window.at(-1)?.t_ms}ms  ${window.length} samples`,
			"",
		];

		for (const field of FIELDS) {
			const values = window.map((s) => s[field]);
			const min = Math.min(...values);
			const max = Math.max(...values);
			const mean = values.reduce((a, b) => a + b, 0) / values.length;
			const peakIdx = values.indexOf(Math.abs(max) >= Math.abs(min) ? max : min);
			const peakAt = window[peakIdx]?.t_ms ?? 0;

			lines.push(
				`${field.padEnd(18)} min=${fmt(min)}  max=${fmt(max)}  mean=${fmt(mean)}  peak@${peakAt}ms`,
			);
		}

			// Ground contact is the signal that distinguishes a fall from a crouch,
			// so rather than dumping a pile of booleans, compute the conclusion directly.
		const airborne = window.filter((s) => s.foot_contact.every((c) => !c));
		lines.push("");
		if (airborne.length === 0) {
			lines.push("foot_contact: at least one foot on the ground for the entire window");
		} else {
			const from = airborne[0]?.t_ms ?? 0;
			const to = airborne.at(-1)?.t_ms ?? 0;
			lines.push(
				`foot_contact: ALL FEET OFF GROUND for ${airborne.length} samples ` +
					`(t=${from}..${to}ms, ${to - from + 20}ms total)`,
			);
		}

		return lines.join("\n");
	},
};

function fmt(n: number): string {
	return n.toFixed(2).padStart(7);
}

// ─────────────────────────────────────────────────────────────
// find_anomalies
// ─────────────────────────────────────────────────────────────

/**
 * Find candidate anomaly intervals with deterministic rules.
 *
 * Note this tool **draws no conclusion**. It does not say "this is a fall", only "something here is worth looking at".
 * Deciding whether it is a fall is the model's job, because that needs several signals and context combined.
 *
 * This division of labour matters:
 *   rules handle recall (miss nothing), the model handles precision (judge what is real).
 * The reverse (having the model scan all the data for anomalies) is both expensive and unreliable.
 */
export const findAnomaliesTool: Tool = {
	name: "find_anomalies",
	mutating: false,
	description:
		"Scan a session for time windows worth investigating, using deterministic thresholds. " +
		"Returns candidate windows with the signal that triggered them. " +
		"These are CANDIDATES, not conclusions: you must inspect each one to decide what actually happened.",
	parameters: {
		type: "object",
		properties: { session_id: { type: "string" } },
		required: ["session_id"],
	},

	async execute(args) {
		const sessionId = String(args.session_id ?? "");
		const samples = await loadSamples(sessionId);

		interface Hit {
			t_ms: number;
			signal: string;
			value: number;
		}
		const hits: Hit[] = [];

		for (const s of samples) {
			if (Math.abs(s.imu_pitch_deg) > 30) {
				hits.push({ t_ms: s.t_ms, signal: "pitch>30deg", value: s.imu_pitch_deg });
			}
			if (Math.abs(s.imu_roll_deg) > 30) {
				hits.push({ t_ms: s.t_ms, signal: "roll>30deg", value: s.imu_roll_deg });
			}
			if (s.imu_accel_z > 15) {
				hits.push({ t_ms: s.t_ms, signal: "accel_z>15", value: s.imu_accel_z });
			}
			if (s.joint_torque_max > 60) {
				hits.push({ t_ms: s.t_ms, signal: "torque>60Nm", value: s.joint_torque_max });
			}
			if (s.foot_contact.every((c) => !c)) {
				hits.push({ t_ms: s.t_ms, signal: "all_feet_airborne", value: 0 });
			}
		}

		if (hits.length === 0) {
			return `${sessionId}: no anomalies above threshold. The session looks nominal.`;
		}

			// Merge adjacent hits into intervals, or it would emit hundreds of lines
		const windows: Array<{ start: number; end: number; signals: Set<string> }> = [];
		for (const hit of hits.sort((a, b) => a.t_ms - b.t_ms)) {
			const last = windows.at(-1);
			if (last && hit.t_ms - last.end <= 500) {
				last.end = hit.t_ms;
				last.signals.add(hit.signal);
			} else {
				windows.push({ start: hit.t_ms, end: hit.t_ms, signals: new Set([hit.signal]) });
			}
		}

		const lines = [`${sessionId}: ${windows.length} candidate window(s)`, ""];
		for (const [i, w] of windows.entries()) {
			lines.push(
				`[${i + 1}] t=${w.start}..${w.end}ms (${w.end - w.start + 20}ms)  ` +
					`signals: ${[...w.signals].join(", ")}`,
			);
		}
		lines.push("");
		lines.push("Use query_telemetry on each window to see the full picture before concluding.");

		return lines.join("\n");
	},
};

// ─────────────────────────────────────────────────────────────
// get_video_frame
// ─────────────────────────────────────────────────────────────

export const getVideoFrameTool: Tool = {
	name: "get_video_frame",
	mutating: false,
	description:
		"Describe the video frame at a given TELEMETRY timestamp. " +
		"Clock offset between video and telemetry is applied automatically, so pass telemetry time.",
	parameters: {
		type: "object",
		properties: {
			session_id: { type: "string" },
			t_ms: { type: "number", description: "Telemetry timestamp, not video timestamp" },
		},
		required: ["session_id", "t_ms"],
	},

	async execute(args) {
		const sessionId = String(args.session_id ?? "");
		const t = Number(args.t_ms);
		if (!Number.isFinite(t)) throw new Error("t_ms must be a number");

		const index = await loadIndex();
		const meta = index.find((s) => s.session_id === sessionId);
		if (!meta) throw new Error(`Session ${sessionId} not found.`);

		const videoT = t + meta.video_offset_ms;

		if (videoT < 0) {
			throw new Error(
				`Telemetry t=${t}ms maps to video t=${videoT}ms, which is before the video starts. ` +
					`This session has a ${meta.video_offset_ms}ms clock offset.`,
			);
		}

			// A real system would decode the frame here and hand it to a vision model.
			// This lesson substitutes a text description; the point is teaching clock alignment.
		const samples = await loadSamples(sessionId);
		const nearest = samples.reduce((best, s) =>
			Math.abs(s.t_ms - t) < Math.abs(best.t_ms - t) ? s : best,
		);

		const posture =
			nearest.imu_pitch_deg > 50
				? "robot is on the ground, body pitched far forward"
				: nearest.imu_pitch_deg > 25
					? "robot is leaning forward steeply"
					: Math.abs(nearest.imu_roll_deg) > 25
						? "robot is tilted to one side"
						: "robot is upright and walking";

		const feet = nearest.foot_contact.filter(Boolean).length;

		return [
			`video frame at telemetry t=${t}ms (video t=${videoT}ms, offset ${meta.video_offset_ms}ms)`,
			`description: ${posture}`,
			`feet on ground: ${feet}/4`,
		].join("\n");
	},
};

// ─────────────────────────────────────────────────────────────
// compare_sessions
// ─────────────────────────────────────────────────────────────

export const compareSessionsTool: Tool = {
	name: "compare_sessions",
	mutating: false,
	description:
		"Compare peak values between two sessions. " +
		"Useful for deciding whether a signal is unusual for this robot or normal behaviour.",
	parameters: {
		type: "object",
		properties: {
			session_a: { type: "string" },
			session_b: { type: "string" },
		},
		required: ["session_a", "session_b"],
	},

	async execute(args) {
		const a = String(args.session_a ?? "");
		const b = String(args.session_b ?? "");
		const [sa, sb] = await Promise.all([loadSamples(a), loadSamples(b)]);

		const lines = [`${"field".padEnd(18)} ${a.padEnd(12)} ${b.padEnd(12)} delta`, ""];

		for (const field of FIELDS) {
			const peakA = Math.max(...sa.map((s) => Math.abs(s[field])));
			const peakB = Math.max(...sb.map((s) => Math.abs(s[field])));
			lines.push(
				`${field.padEnd(18)} ${peakA.toFixed(2).padEnd(12)} ${peakB.toFixed(2).padEnd(12)} ${(peakB - peakA).toFixed(2)}`,
			);
		}

		const airA = sa.filter((s) => s.foot_contact.every((c) => !c)).length;
		const airB = sb.filter((s) => s.foot_contact.every((c) => !c)).length;
		lines.push("");
		lines.push(`airborne samples   ${String(airA).padEnd(12)} ${String(airB).padEnd(12)} ${airB - airA}`);

		return lines.join("\n");
	},
};
