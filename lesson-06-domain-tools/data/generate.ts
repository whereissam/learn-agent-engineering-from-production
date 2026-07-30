/**
 * Generate synthetic robot telemetry.
 *
 * Why generate it? Because teaching needs data whose right answer you know.
 * With real data you are never sure whether a spike really was a fall,
 * and synthetic data is something you planted, so it can serve as an evaluation baseline (used in Lesson 7).
 *
 * A fixed seed is used, so every generation produces exactly the same result.
 * That matters: agent behaviour is uncertain enough already, and the data should not be another variable.
 *
 * Run: bun run lesson-06-domain-tools/data/generate.ts
 */

import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const OUT = resolve(import.meta.dirname, "sessions");

/** A 50Hz sample rate, that is one sample every 20ms. */
const HZ = 50;
const DT_MS = 1000 / HZ;

/**
 * A reproducible random source (mulberry32).
 *
 * Not Math.random(), because that would make every generation different
 * and Lesson 7's evaluation cases meaningless.
 */
function rng(seed: number): () => number {
	return () => {
		seed |= 0;
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

export interface Sample {
	/** Milliseconds since the session started. */
	t_ms: number;
	/** Pitch, in degrees. Positive = leaning forwards. */
	imu_pitch_deg: number;
	/** Roll, in degrees. */
	imu_roll_deg: number;
	/** Vertical acceleration, m/s^2. About 9.8 at rest. */
	imu_accel_z: number;
	/** Ground contact state of the four feet. */
	foot_contact: [boolean, boolean, boolean, boolean];
	/** The largest absolute joint torque, Nm. */
	joint_torque_max: number;
	/** Commanded velocity, m/s. */
	cmd_vel_x: number;
}

interface SessionSpec {
	id: string;
	robot: string;
	/** A human-readable description. Note: this is **not** shown to the agent, which would be handing over the answer. */
	groundTruth: string;
	durationMs: number;
	seed: number;
	build(t: number, r: () => number): Sample;
}

const nominal = (t: number, r: () => number): Sample => ({
	t_ms: t,
	imu_pitch_deg: round(2 + noise(r, 1.5)),
	imu_roll_deg: round(noise(r, 1.2)),
	imu_accel_z: round(9.8 + noise(r, 0.4)),
	foot_contact: gait(t),
	joint_torque_max: round(18 + noise(r, 4)),
	cmd_vel_x: 0.6,
});

/** A walking gait: diagonal feet alternate on the ground. */
function gait(t: number): [boolean, boolean, boolean, boolean] {
	const phase = Math.floor(t / 250) % 2 === 0;
	return [phase, !phase, !phase, phase];
}

function noise(r: () => number, scale: number): number {
	return (r() - 0.5) * 2 * scale;
}

function round(n: number): number {
	return Math.round(n * 100) / 100;
}

// ─────────────────────────────────────────────────────────────
// Seven cases. Each is one of Lesson 7's evaluation cases.
//
// The first five are the originals. The last two (006, 007) were added later,
// because the original five shared a shape: **one event per session,
// and the event happens suddenly**. Real telemetry does not look like that.
//
//   006  two events in one recording  → does reporting only the worst count as right?
//   007  a very slow tip-over         → a single-point threshold fires very late
//
// Neither tests "is the model clever" but **whether the tools' shape assumes
// "one sudden event per session"**.
// ─────────────────────────────────────────────────────────────

const SESSIONS: SessionSpec[] = [
	{
		id: "sess_001",
		robot: "unitree-go2-a",
		groundTruth: "真正的跌倒：t=8200ms 開始前傾，8600ms 觸地全失，扭矩尖峰，之後躺平不動",
		durationMs: 14000,
		seed: 1001,
		build(t, r) {
			const s = nominal(t, r);
			if (t >= 8200 && t < 8600) {
					// The tip-over begins
				const p = (t - 8200) / 400;
				s.imu_pitch_deg = round(2 + 55 * p + noise(r, 2));
				s.joint_torque_max = round(18 + 45 * p + noise(r, 5));
			} else if (t >= 8600 && t < 9000) {
					// Ground impact
				s.imu_pitch_deg = round(62 + noise(r, 4));
				s.imu_accel_z = round(24 + noise(r, 3)); // 撞擊
				s.foot_contact = [false, false, false, false];
				s.joint_torque_max = round(88 + noise(r, 8));
			} else if (t >= 9000) {
					// Flat on the ground, with no recovery
				s.imu_pitch_deg = round(71 + noise(r, 1));
				s.foot_contact = [false, false, false, false];
				s.joint_torque_max = round(3 + noise(r, 1));
				s.cmd_vel_x = 0;
			}
			return s;
		},
	},
	{
		id: "sess_002",
		robot: "unitree-go2-a",
		groundTruth: "不是跌倒：t=5000ms 快速蹲下，pitch 有變化但腳一直著地，1.2 秒後恢復正常行走",
		durationMs: 12000,
		seed: 1002,
		build(t, r) {
			const s = nominal(t, r);
			if (t >= 5000 && t < 6200) {
					// Crouching: pitch moves, no foot leaves the ground, torque rises but not dramatically
				const p = Math.sin(((t - 5000) / 1200) * Math.PI);
				s.imu_pitch_deg = round(2 + 34 * p + noise(r, 2));
				s.joint_torque_max = round(18 + 30 * p + noise(r, 4));
				s.foot_contact = [true, true, true, true]; // ← 關鍵差異
				s.cmd_vel_x = 0;
			}
			return s;
		},
	},
	{
		id: "sess_003",
		robot: "unitree-go2-b",
		groundTruth: "外力碰撞：t=6400ms 側向撞擊，roll 尖峰與加速度尖峰，機器人踉蹌但自行恢復",
		durationMs: 13000,
		seed: 1003,
		build(t, r) {
			const s = nominal(t, r);
			if (t >= 6400 && t < 6600) {
					// The moment of impact
				s.imu_roll_deg = round(38 + noise(r, 5));
				s.imu_accel_z = round(19 + noise(r, 3));
				s.joint_torque_max = round(72 + noise(r, 9));
				s.foot_contact = [false, true, true, false];
			} else if (t >= 6600 && t < 7800) {
					// Recovering from the stumble
				const p = 1 - (t - 6600) / 1200;
				s.imu_roll_deg = round(38 * p + noise(r, 3));
				s.joint_torque_max = round(18 + 34 * p + noise(r, 5));
			}
			return s;
		},
	},
	{
		id: "sess_004",
		robot: "unitree-go2-b",
		groundTruth: "資料缺失：t=4000-7000ms 完全沒有取樣。這段期間發生什麼事無法從 telemetry 判斷",
		durationMs: 12000,
		seed: 1004,
		build: nominal,
	},
	{
		id: "sess_005",
		robot: "unitree-go2-c",
		groundTruth: "時鐘偏移：telemetry 顯示 t=7000ms 有事件，但影片時間戳比 telemetry 早 2300ms",
		durationMs: 13000,
		seed: 1005,
		build(t, r) {
			const s = nominal(t, r);
			if (t >= 7000 && t < 7400) {
				s.imu_pitch_deg = round(2 + 41 + noise(r, 3));
				s.joint_torque_max = round(66 + noise(r, 7));
				s.foot_contact = [false, false, true, true];
			}
			return s;
		},
	},
	{
		id: "sess_006",
		robot: "unitree-go2-a",
		groundTruth:
			"兩次事件：t=3000ms 踉蹌後恢復（near miss），t=9200ms 真的跌倒。" +
			"測「只報告最嚴重的那一個」這個很常見的失敗",
		durationMs: 14000,
		seed: 1006,
		build(t, r) {
			const s = nominal(t, r);

				// First: a stumble; not every foot leaves the ground, and it recovers after a second
			if (t >= 3000 && t < 4000) {
				const p = Math.sin(((t - 3000) / 1000) * Math.PI);
				s.imu_roll_deg = round(28 * p + noise(r, 3));
				s.joint_torque_max = round(18 + 40 * p + noise(r, 5));
				if (t >= 3300 && t < 3500) s.foot_contact = [false, true, true, false];
				return s;
			}

				// Second: a real fall
			if (t >= 9200 && t < 9600) {
				const p = (t - 9200) / 400;
				s.imu_pitch_deg = round(2 + 58 * p + noise(r, 2));
				s.joint_torque_max = round(18 + 48 * p + noise(r, 5));
			} else if (t >= 9600 && t < 10000) {
				s.imu_pitch_deg = round(64 + noise(r, 4));
				s.imu_accel_z = round(23 + noise(r, 3));
				s.foot_contact = [false, false, false, false];
				s.joint_torque_max = round(91 + noise(r, 8));
			} else if (t >= 10000) {
				s.imu_pitch_deg = round(73 + noise(r, 1));
				s.foot_contact = [false, false, false, false];
				s.joint_torque_max = round(3 + noise(r, 1));
				s.cmd_vel_x = 0;
			}
			return s;
		},
	},
	{
		id: "sess_007",
		robot: "unitree-go2-c",
		groundTruth:
			"極慢傾倒：從 t=4000ms 開始，pitch 用 6 秒緩慢增加到 55 度，" +
			"腳到 t=9500ms 才全部離地。每一個「單點門檻」都要很晚才會觸發，" +
			"測 find_anomalies 的候選會不會來得太晚、模型會不會因此把起點抓錯",
		durationMs: 13000,
		seed: 1007,
		build(t, r) {
			const s = nominal(t, r);

			if (t >= 4000 && t < 10000) {
					// A linear, very slow tip-over. No single instant looks like an accident.
				const p = (t - 4000) / 6000;
				s.imu_pitch_deg = round(2 + 53 * p + noise(r, 1.5));
				s.joint_torque_max = round(18 + 26 * p + noise(r, 3));
				s.cmd_vel_x = round(0.6 * (1 - p) * 100) / 100;
					// The feet leave the ground one at a time, not all at once
				if (t >= 8000) s.foot_contact = [false, true, true, false];
				if (t >= 9000) s.foot_contact = [false, false, true, false];
				if (t >= 9500) s.foot_contact = [false, false, false, false];
			} else if (t >= 10000) {
				s.imu_pitch_deg = round(56 + noise(r, 1));
				s.foot_contact = [false, false, false, false];
				s.joint_torque_max = round(4 + noise(r, 1));
				s.cmd_vel_x = 0;
			}
			return s;
		},
	},
];

// ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
	await mkdir(OUT, { recursive: true });

	const index: Array<Record<string, unknown>> = [];

	for (const spec of SESSIONS) {
		const r = rng(spec.seed);
		const samples: Sample[] = [];

		for (let t = 0; t < spec.durationMs; t += DT_MS) {
			// sess_004 deliberately leaves a hole in the data
			if (spec.id === "sess_004" && t >= 4000 && t < 7000) continue;
			samples.push(spec.build(t, r));
		}

		const lines = samples.map((s) => JSON.stringify(s)).join("\n");
		await writeFile(resolve(OUT, `${spec.id}.jsonl`), `${lines}\n`, "utf8");

		// Video timestamps. sess_005 is deliberately offset.
		const videoOffsetMs = spec.id === "sess_005" ? -2300 : 0;

		index.push({
			session_id: spec.id,
			robot_id: spec.robot,
			recorded_at: `2026-07-2${index.length + 1}T09:00:00Z`,
			duration_ms: spec.durationMs,
			sample_count: samples.length,
			sample_rate_hz: HZ,
			video_offset_ms: videoOffsetMs,
				// groundTruth is **not** written into the index; the agent must not see the answer.
				// It exists only in Lesson 7's evaluation cases.
		});
	}

	await writeFile(resolve(OUT, "index.json"), `${JSON.stringify(index, null, 2)}\n`, "utf8");

	console.log(`已產生 ${SESSIONS.length} 個 session 到 ${OUT}`);
	for (const spec of SESSIONS) {
		console.log(`  ${spec.id}  ${spec.groundTruth}`);
	}
}

await main();
