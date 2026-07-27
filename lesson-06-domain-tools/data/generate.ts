/**
 * 產生合成的機器人 telemetry 資料。
 *
 * 為什麼要自己產？因為教學需要「你知道正確答案」的資料。
 * 真實資料你永遠不確定那個 spike 到底是不是真的跌倒，
 * 但合成資料是你自己埋的，所以可以拿來當評估基準（Lesson 7 會用）。
 *
 * 用固定 seed，所以每次產出來的結果一模一樣。
 * 這很重要：agent 的行為已經夠不確定了，資料不該再是另一個變因。
 *
 * 執行：bun run lesson-06-domain-tools/data/generate.ts
 */

import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const OUT = resolve(import.meta.dirname, "sessions");

/** 取樣頻率 50Hz，也就是每 20ms 一筆。 */
const HZ = 50;
const DT_MS = 1000 / HZ;

/**
 * 可重現的亂數（mulberry32）。
 *
 * 不用 Math.random()，因為那樣每次產出的資料都不同，
 * Lesson 7 的評估案例就會失去意義。
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
	/** 從 session 開始算的毫秒數。 */
	t_ms: number;
	/** 俯仰角，度。正值 = 前傾。 */
	imu_pitch_deg: number;
	/** 翻滾角，度。 */
	imu_roll_deg: number;
	/** 垂直加速度，m/s^2。靜止時約 9.8。 */
	imu_accel_z: number;
	/** 四隻腳的觸地狀態。 */
	foot_contact: [boolean, boolean, boolean, boolean];
	/** 各關節扭矩的最大絕對值，Nm。 */
	joint_torque_max: number;
	/** 指令速度，m/s。 */
	cmd_vel_x: number;
}

interface SessionSpec {
	id: string;
	robot: string;
	/** 給人看的描述。注意：這個「不會」給 agent 看，不然就等於送答案。 */
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

/** 走路步態：對角線的腳交替著地。 */
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
// 五個案例。每一個都是 Lesson 7 的一個評估案例。
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
				// 開始傾倒
				const p = (t - 8200) / 400;
				s.imu_pitch_deg = round(2 + 55 * p + noise(r, 2));
				s.joint_torque_max = round(18 + 45 * p + noise(r, 5));
			} else if (t >= 8600 && t < 9000) {
				// 撞地
				s.imu_pitch_deg = round(62 + noise(r, 4));
				s.imu_accel_z = round(24 + noise(r, 3)); // 撞擊
				s.foot_contact = [false, false, false, false];
				s.joint_torque_max = round(88 + noise(r, 8));
			} else if (t >= 9000) {
				// 躺平，沒有恢復
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
				// 蹲下：pitch 動了，但腳沒離地，扭矩上升但不誇張
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
				// 撞擊瞬間
				s.imu_roll_deg = round(38 + noise(r, 5));
				s.imu_accel_z = round(19 + noise(r, 3));
				s.joint_torque_max = round(72 + noise(r, 9));
				s.foot_contact = [false, true, true, false];
			} else if (t >= 6600 && t < 7800) {
				// 踉蹌恢復中
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
];

// ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
	await mkdir(OUT, { recursive: true });

	const index: Array<Record<string, unknown>> = [];

	for (const spec of SESSIONS) {
		const r = rng(spec.seed);
		const samples: Sample[] = [];

		for (let t = 0; t < spec.durationMs; t += DT_MS) {
			// sess_004 刻意在中間留一個資料洞
			if (spec.id === "sess_004" && t >= 4000 && t < 7000) continue;
			samples.push(spec.build(t, r));
		}

		const lines = samples.map((s) => JSON.stringify(s)).join("\n");
		await writeFile(resolve(OUT, `${spec.id}.jsonl`), `${lines}\n`, "utf8");

		// 影片時間戳。sess_005 刻意偏移。
		const videoOffsetMs = spec.id === "sess_005" ? -2300 : 0;

		index.push({
			session_id: spec.id,
			robot_id: spec.robot,
			recorded_at: `2026-07-2${index.length + 1}T09:00:00Z`,
			duration_ms: spec.durationMs,
			sample_count: samples.length,
			sample_rate_hz: HZ,
			video_offset_ms: videoOffsetMs,
			// groundTruth 「不」寫進 index，agent 不該看到答案。
			// 它只存在於 Lesson 7 的評估案例裡。
		});
	}

	await writeFile(resolve(OUT, "index.json"), `${JSON.stringify(index, null, 2)}\n`, "utf8");

	console.log(`已產生 ${SESSIONS.length} 個 session 到 ${OUT}`);
	for (const spec of SESSIONS) {
		console.log(`  ${spec.id}  ${spec.groundTruth}`);
	}
}

await main();
