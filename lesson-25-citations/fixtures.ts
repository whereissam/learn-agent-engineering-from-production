/**
 * The reports to be checked.
 *
 * The first is **real**: Lesson 24's raw output from Gemini 3.6 Flash,
 * unchanged to the character (design principle 3).
 *
 * The other three are **deliberately corrupted** versions of the first, one per class of citation error.
 * How they are corrupted is written in code rather than prose, so you can check the corruptions yourself —
 * the same principle as Lesson 6's telemetry generator:
 * **to verify a checker you first need data whose answer you know.**
 */

/**
 * Lesson 24's real output.
 *
 * Reading this report by eye already turned up one suspicious citation (the licensing line carries three URLs,
 * and the forum one never mentions licensing). This lesson's checker has to find it by itself.
 */
export const REAL_REPORT = `### Direct Answer

Two open-source software projects include motion retargeting pipelines for the Unitree G1: **humanoid-mimic** and **openmotion/retarget-anything** (https://github.com/kinelabs/humanoid-mimic, https://github.com/openmotion/retarget-anything). 

* **humanoid-mimic**: **Works.** Version 0.7 (released June 2026) supports current Unitree G1 hardware running the 2026 SDK (https://github.com/kinelabs/humanoid-mimic, https://blog.kinelabs.dev/humanoid-mimic-0-7).
* **retarget-anything**: **Does not work.** The Unitree G1 profile was deprecated in v2.0 (March 2026) because it targets an outdated 2024 URDF joint ordering that causes immediate protective stops on current 2026 firmware (https://github.com/openmotion/retarget-anything, https://discourse.ros.org/t/g1-retargeting-foot-sliding/45211).

---

### Evidence and System Details

#### 1. humanoid-mimic
* **License & Compatibility**: Released under an MIT license, version 0.7 added hardware-validated support for the 2026 SDK joint ordering on the 23 degree-of-freedom (DoF) Unitree G1 (https://github.com/kinelabs/humanoid-mimic, https://blog.kinelabs.dev/humanoid-mimic-0-7, https://www.unitree.com/g1/developer).
* **Runtime & Hardware Specs**: Running on an NVIDIA RTX 4070 GPU, the pipeline outputs 50 Hz joint targets with ~18 ms end-to-end latency (https://github.com/kinelabs/humanoid-mimic). (Note: The G1 developer SDK supports control up to 500 Hz at the joint level) (https://www.unitree.com/g1/developer).
* **Control Approach**: The system prioritizes physics feasibility over strict pose matching, achieving a 71% hardware success rate on the Unitree H1 compared to 44% for pose-similarity baselines (https://arxiv.org/abs/2603.04417).

#### 2. openmotion/retarget-anything
* **License & Pipeline**: Licensed under Apache-2.0 (dated January 2004), this framework converts monocular video into joint trajectories by executing pose estimation, URDF kinematic solving, and a physics feasibility pass (https://github.com/openmotion/retarget-anything, https://openmotion.dev/docs/retarget-anything/getting-started, https://github.com/openmotion/retarget-anything/blob/main/LICENSE). Its stack targets Python 3.11 and CUDA 12 (https://github.com/openmotion/retarget-anything, https://openmotion.dev/docs/retarget-anything/getting-started).
* **Reason for Failure**: The 2026 Unitree G1 SDK update reindexed joints—such as moving \`left_hip_pitch\` from index 7 to 1 and \`left_knee\` from index 9 to 3—and reduced the \`left_knee\` velocity limit from 17 rad/s to 15 rad/s (https://www.unitree.com/g1/developer). Because \`retarget-anything\` v2.0 targets the 2024 URDF ordering, trajectory loading fails and triggers protective hardware stops on 2026 firmware (https://github.com/openmotion/retarget-anything, https://discourse.ros.org/t/g1-retargeting-foot-sliding/45211).
* **Status**: The G1 profile was officially deprecated in the March 2026 v2.0 release, directing users to the Unitree H1 profile instead (https://github.com/openmotion/retarget-anything, https://openmotion.dev/docs/retarget-anything/getting-started).

---

### Caveats and Operational Constraints

* **Backbone Weights Licensing**: While the \`humanoid-mimic\` codebase is MIT-licensed, its underlying pose backbone weights are distributed under a separate non-commercial license (https://blog.kinelabs.dev/humanoid-mimic-0-7).
* **Kinematic Foot Sliding**: Deploying \`humanoid-mimic\` 0.7 on the Unitree G1 causes foot sliding during fast footwork because its real-time contact solver assumes a flat sole (https://github.com/kinelabs/humanoid-mimic, https://discourse.ros.org/t/g1-retargeting-foot-sliding/45211). A practical workaround requires slowing trajectory playback speed to 0.8x (https://discourse.ros.org/t/g1-retargeting-foot-sliding/45211).
* **Hardware Dependency**: \`retarget-anything\` pose estimation runs approximately 40x slower when executed on CPU hardware instead of CUDA 12 (https://github.com/openmotion/retarget-anything).
* **Outdated Benchmarks**: A third-party review of seven motion retargeting tools claims \`retarget-anything\` works out-of-the-box for the G1 while \`humanoid-mimic\` supports only the H1; this conflicts with the June 2026 \`humanoid-mimic\` 0.7 release and \`retarget-anything\` v2.0 deprecation logs (https://robotblog.example.com/best-retargeting-tools, https://github.com/kinelabs/humanoid-mimic, https://github.com/openmotion/retarget-anything).`;

export interface Fixture {
	id: string;
	label: string;
	report: string;
	/** What was planted in this report; the checker must catch at least these. */
	expect: {
		/** At least this many grafted citations must be caught */
		graftedAtLeast?: number;
		/** At least this many unsupported atoms must be caught */
		unsupportedAtomsAtLeast?: number;
		/** At least this many uncited factual sentences must be caught */
		uncitedAtLeast?: number;
	};
	/** Exactly what was changed. Written out so the reader can check it. */
	injected?: string;
}

/** Number drift: the source says 0.8x and 18 ms, and the report says something else. */
const DRIFTED = REAL_REPORT.replace("0.8x", "0.5x").replace("18 ms", "8 ms").replace(
	"50 Hz",
	"120 Hz",
);

/** Citation grafting: attach a correct sentence to a wholly unrelated source. */
const GRAFTED = REAL_REPORT.replace(
	"(https://www.unitree.com/g1/developer)",
	"(https://www.unitree.com/g1/developer, https://cookingwith.example.com/sous-vide-guide)",
).replace(
	"A practical workaround requires slowing trajectory playback speed to 0.8x (https://discourse.ros.org/t/g1-retargeting-foot-sliding/45211)",
	"A practical workaround requires slowing trajectory playback speed to 0.8x (https://technews.example.com/2026/07/humanoid-robot-funding-round)",
);

/** A bare assertion: strip the citations entirely and keep the sentence. */
const BARE = REAL_REPORT.split("\n")
	.map((line, index) =>
		index % 2 === 0 ? line : line.replace(/\s*\(https?:\/\/[^)]*\)/g, ""),
	)
	.join("\n");

export const FIXTURES: Fixture[] = [
	{
		id: "real",
		label: "Lesson 24's real output, not a word changed",
		report: REAL_REPORT,
			// No expect here, because the right answer is unknown —
			// **this one's purpose is "what the checker says about real output", not passing a test.**
		expect: {},
	},
	{
		id: "drifted",
		label: "number drift",
		report: DRIFTED,
		injected: "0.8x → 0.5x, 18 ms → 8 ms, 50 Hz → 120 Hz",
		expect: { unsupportedAtomsAtLeast: 3 },
	},
	{
		id: "grafted",
		label: "citation grafting",
		report: GRAFTED,
		injected:
			"the joint-index line gains a cooking site; the foot-sliding line is re-attached to an unrelated funding story",
		expect: { graftedAtLeast: 2 },
	},
	{
		id: "bare",
		label: "bare assertions",
		report: BARE,
		injected: "citations stripped from every other line",
		expect: { uncitedAtLeast: 5 },
	},
];
