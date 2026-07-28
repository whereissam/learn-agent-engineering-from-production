/**
 * 這一篇的「網際網路」。
 *
 * 為什麼要自己造一個假的 web？跟 Lesson 6 自己產 telemetry 是同一個理由：
 *
 *   1. **你知道正確答案。** 真實網頁你永遠不確定哪一句才是對的，
 *      也就沒辦法拿來當評估基準（Lesson 25 會用到）。
 *   2. **可重現。** 真的 Google 明天就換排序了，昨天跑出來的軌跡
 *      今天重跑不一樣，讀者會以為是自己弄錯。
 *   3. **不用金鑰、不用網路、不會被封鎖。** 設計原則 1：
 *      每一課都要能用 `PROVIDER=fake` 跑完。
 *
 * 這份語料是刻意「有病」的。真實的 web 有的毛病它都有：
 *
 *   - snippet 講的跟正文不一樣（而且兩個方向都有）
 *   - 同一份內容有兩個網址（GitHub README 和 docs 站）
 *   - 關鍵字塞好塞滿但沒有內容的 SEO 農場
 *   - 兩年前的懶人包還在到處被引用
 *   - 已經封存的 repo，但頁面上看不太出來
 *   - 提到關鍵字很多次但其實無關的新聞
 *
 * **這些不是為了刁難模型，是為了讓你在 Lesson 22 有東西可以排序。**
 * 一份乾淨的語料學不到 ranking。
 *
 * 語言：全部是英文。這是刻意的，見 README 的 Step 3
 * （中文 query 在關鍵字檢索下會查不到任何東西）。
 */

export type PageKind = "repo" | "docs" | "blog" | "paper" | "forum" | "dataset" | "news" | "spam";

export interface Page {
	url: string;
	site: string;
	title: string;
	/** 發佈日期。Lesson 22 的新鮮度排序會用到。 */
	published: string;
	kind: PageKind;
	/**
	 * 正文段落。
	 *
	 * 重點：**搜尋只會看到其中一小段**（snippet），完整內容要到
	 * Lesson 21 真的把網頁抓下來才拿得到。這個落差就是 Lesson 20 的主題。
	 */
	paragraphs: string[];
	/**
	 * 這一頁「真正的事實」是什麼。
	 *
	 * 跟 Lesson 6 的 groundTruth 一樣：**不會給 agent 看**，
	 * 也不會寫進產生出來的 HTML。它只存在原始碼裡，給寫課的人和
	 * 未來的評估案例（Lesson 25）用。
	 */
	groundTruth?: string;
}

export const PAGES: Page[] = [
	// ───────────────────────────────────────────────────────────
	// 陷阱 1：snippet 說支援，正文說已經棄用
	// ───────────────────────────────────────────────────────────
	{
		url: "https://github.com/openmotion/retarget-anything",
		site: "github.com",
		title: "openmotion/retarget-anything: video to humanoid motion retargeting",
		published: "2026-05-12",
		kind: "repo",
		groundTruth:
			"G1 profile 在 v2.0 已棄用且不再維護。只讀 snippet 會以為它支援 G1。授權 Apache-2.0。",
		paragraphs: [
			"retarget-anything turns monocular video of a human into joint trajectories for a " +
				"humanoid robot. Out of the box it ships retargeting profiles for the Unitree G1, " +
				"the Unitree H1, and the Booster T1, plus a generic 23-DoF profile you can adapt.",
			"The pipeline is three stages: pose estimation on the video, a kinematic solve against " +
				"the robot URDF, and a physics feasibility pass that rejects trajectories the robot " +
				"cannot actually track.",
			"Installation requires Python 3.11 and a CUDA 12 device for the pose stage. CPU-only " +
				"inference works but runs roughly 40x slower, which is fine for offline batches.",
			"Deprecation notice, v2.0, March 2026: the G1 profile is deprecated and no longer " +
				"maintained. It was written against the 2024 G1 URDF and the joint ordering changed " +
				"in the 2026 SDK, so trajectories produced by the G1 profile will not load on current " +
				"firmware. We are not planning to fix it. Use the H1 profile, or see humanoid-mimic " +
				"which tracks the current G1 SDK.",
			"The H1 profile is actively maintained and is what we run in CI on every commit. " +
				"Booster T1 support is community maintained and lags about one release behind.",
			"License: Apache-2.0. Commercial use is fine, no copyleft obligations on your own code.",
			"If you use this in academic work please cite the accompanying tech report rather than " +
				"the repository URL.",
		],
	},

	// ───────────────────────────────────────────────────────────
	// 陷阱 2：同一份內容的第二個網址（近似重複）
	// ───────────────────────────────────────────────────────────
	{
		url: "https://openmotion.dev/docs/retarget-anything/getting-started",
		site: "openmotion.dev",
		title: "Getting started - retarget-anything documentation",
		published: "2026-05-14",
		kind: "docs",
		groundTruth:
			"跟 GitHub README 幾乎同一份內容（近似重複）。Lesson 22 的去重要處理這一對。",
		paragraphs: [
			"retarget-anything turns monocular video of a human into joint trajectories for a " +
				"humanoid robot. It ships retargeting profiles for the Unitree G1, the Unitree H1, " +
				"and the Booster T1, plus a generic 23-DoF profile.",
			"The pipeline has three stages: pose estimation, a kinematic solve against the robot " +
				"URDF, and a physics feasibility pass.",
			"Deprecation notice, v2.0: the G1 profile is deprecated and unmaintained. The joint " +
				"ordering changed in the 2026 SDK and we are not planning to fix it. Use the H1 " +
				"profile instead.",
			"Requirements: Python 3.11, CUDA 12 for the pose stage. See the installation guide for " +
				"the CPU-only path.",
			"License: Apache-2.0.",
		],
	},

	// ───────────────────────────────────────────────────────────
	// 陷阱 3：snippet 說只支援 H1，正文說 G1 後來加上了
	// （跟陷阱 1 剛好相反，所以「只讀 snippet」兩個方向都會錯）
	// ───────────────────────────────────────────────────────────
	{
		url: "https://github.com/kinelabs/humanoid-mimic",
		site: "github.com",
		title: "kinelabs/humanoid-mimic: real-time motion imitation for humanoids",
		published: "2026-06-30",
		kind: "repo",
		groundTruth:
			"這才是目前真的支援 G1 的專案（v0.7, 2026-06 加入）。但第一段只提 H1，snippet 會誤導成不支援 G1。授權 MIT。",
		paragraphs: [
			"humanoid-mimic is a real-time motion imitation stack originally built for the Unitree " +
				"H1. It takes a video stream or a mocap feed and produces joint targets at 50 Hz.",
			"Version 0.7, released June 2026, adds a Unitree G1 profile built against the 2026 SDK " +
				"joint ordering. The G1 profile is tested on hardware, not just in simulation, and is " +
				"the configuration we demo at conferences.",
			"Unlike offline retargeting tools, humanoid-mimic is designed to run in the control loop, " +
				"so it trades some accuracy for latency. Expect roughly 18 ms end-to-end on an RTX 4070.",
			"Known limitation: fast footwork produces foot sliding on the G1 because the contact " +
				"solver assumes a flat sole. There is an open issue with a workaround.",
			"License: MIT. Weights for the pose backbone are downloaded separately and carry their " +
				"own non-commercial license, which is the part people usually miss.",
			"Roadmap: Booster T1 profile, and an ONNX export so the pose stage can run without PyTorch.",
		],
	},

	// ───────────────────────────────────────────────────────────
	// 論文：答案在正文裡（code 連結不在 snippet）
	// ───────────────────────────────────────────────────────────
	{
		url: "https://arxiv.org/abs/2603.04417",
		site: "arxiv.org",
		title: "Video-to-Humanoid Motion Retargeting without Paired Data",
		published: "2026-03-09",
		kind: "paper",
		groundTruth: "程式碼連結只出現在正文最後一段，snippet 看不到。",
		paragraphs: [
			"We present a method for retargeting human motion from monocular video to humanoid " +
				"robots without paired human-robot demonstrations. Existing approaches require a " +
				"motion capture rig and a per-robot calibration pass.",
			"Our key observation is that the physics feasibility constraint is a stronger training " +
				"signal than pose similarity. We optimise for trajectories the robot can track rather " +
				"than trajectories that look like the human.",
			"We evaluate on the Unitree H1 and G1 in simulation, and on the H1 on hardware. " +
				"Success rate on the hardware benchmark is 71 percent, up from 44 percent for the " +
				"pose-similarity baseline.",
			"Limitations: we do not model contact-rich manipulation, and the feasibility pass assumes " +
				"a rigid flat ground plane.",
			"Code and pretrained checkpoints are released at github.com/kinelabs/humanoid-mimic " +
				"under the MIT license. The hardware evaluation scripts are in the eval/ directory.",
		],
	},

	// ───────────────────────────────────────────────────────────
	// 兩年前的懶人包：內容過時但關鍵字密度很高
	// ───────────────────────────────────────────────────────────
	{
		url: "https://robotblog.example.com/best-retargeting-tools",
		site: "robotblog.example.com",
		title: "7 best open source motion retargeting tools for Unitree robots",
		published: "2025-01-22",
		kind: "blog",
		groundTruth: "2025-01 的文章，內容已過時（說 humanoid-mimic 不支援 G1）。關鍵字密度高，容易排前面。",
		paragraphs: [
			"Looking for open source motion retargeting for your Unitree robot? We rounded up the " +
				"7 best retargeting tools for the Unitree G1, the Unitree H1 and other humanoid " +
				"robots. Motion retargeting from video is one of the hottest topics in robotics.",
			"1. retarget-anything. The most popular open source video to humanoid retargeting " +
				"project. Supports the Unitree G1 out of the box. Our top pick.",
			"2. humanoid-mimic. Real-time motion imitation, but H1 only. No Unitree G1 support, " +
				"so skip this one if you are on a G1.",
			"3. mocap2robot. A classic. Still works well for simple walking motions.",
			"Whichever retargeting tool you pick, remember that video to humanoid retargeting is " +
				"hard and your mileage with any Unitree robot will vary.",
		],
	},

	// ───────────────────────────────────────────────────────────
	// SEO 農場：關鍵字塞滿，沒有任何內容
	// ───────────────────────────────────────────────────────────
	{
		url: "https://top-robotics-tools.example.net/unitree-g1-retargeting-best-2026",
		site: "top-robotics-tools.example.net",
		title: "Unitree G1 retargeting: best open source video to humanoid retargeting 2026",
		published: "2026-07-01",
		kind: "spam",
		groundTruth: "SEO 農場。關鍵字密度最高，BM25 會把它排到很前面，但完全沒有資訊。",
		paragraphs: [
			"Unitree G1 retargeting is the best open source video to humanoid retargeting solution " +
				"for 2026. If you are looking for Unitree G1 retargeting, open source retargeting, " +
				"video to humanoid retargeting or humanoid motion retargeting, you have come to the " +
				"right place for Unitree G1 retargeting.",
			"Our team of Unitree G1 retargeting experts has reviewed the top open source video to " +
				"humanoid retargeting projects so you do not have to. Unitree G1 retargeting has " +
				"never been easier.",
			"Click here to see our full list of the best Unitree G1 retargeting tools. Sign up for " +
				"our newsletter to get more open source retargeting content.",
		],
	},

	// ───────────────────────────────────────────────────────────
	// 論壇：實務上的坑，只有這裡講得出來
	// ───────────────────────────────────────────────────────────
	{
		url: "https://discourse.ros.org/t/g1-retargeting-foot-sliding/45211",
		site: "discourse.ros.org",
		title: "G1 retargeting: foot sliding with retarget-anything, switched to humanoid-mimic",
		published: "2026-07-08",
		kind: "forum",
		groundTruth: "第一手實務經驗，證實 retarget-anything 的 G1 profile 在 2026 SDK 上已經不能用。",
		paragraphs: [
			"We spent two weeks trying to get retarget-anything's G1 profile working on a 2026 SDK " +
				"G1 and eventually gave up. The trajectories load but the joint ordering is wrong, " +
				"so the robot immediately goes into a protective stop.",
			"Confirmed with the maintainer in an issue: the G1 profile targets the 2024 URDF and is " +
				"deprecated. It is not a configuration problem on our end.",
			"We switched to humanoid-mimic 0.7 which has a current G1 profile. It works, but we do " +
				"see the foot sliding people have reported on fast footwork. Slowing the playback to " +
				"0.8x makes it usable for our demo.",
			"If anyone has a cleaner fix for the contact solver we would love to hear it.",
		],
	},

	// ───────────────────────────────────────────────────────────
	// 已封存的 repo：頁面上看不太出來
	// ───────────────────────────────────────────────────────────
	{
		url: "https://github.com/legacy-robotics/mocap2robot",
		site: "github.com",
		title: "legacy-robotics/mocap2robot: mocap to robot joint trajectories",
		published: "2023-11-02",
		kind: "repo",
		groundTruth: "2023 年封存，早於 G1 上市。看起來像是可用的選項，但已經沒有維護。",
		paragraphs: [
			"mocap2robot converts mocap BVH files into joint trajectories for legged and humanoid " +
				"robots. Supports the Unitree A1, Go1 and a generic humanoid template.",
			"This repository is archived. It is kept online because papers cite it, but it receives " +
				"no updates and issues are closed automatically.",
			"There is no video input path: you need a mocap suit or an existing BVH file.",
			"Last tested against ROS Noetic and Python 3.8.",
		],
	},

	// ───────────────────────────────────────────────────────────
	// 官方文件：權威來源
	// ───────────────────────────────────────────────────────────
	{
		url: "https://www.unitree.com/g1/developer",
		site: "unitree.com",
		title: "Unitree G1 - developer resources and SDK",
		published: "2026-04-18",
		kind: "docs",
		groundTruth: "官方，說明 2026 SDK 改了關節順序——這是兩個專案分歧的根因。",
		paragraphs: [
			"The Unitree G1 humanoid ships with a 23 degree-of-freedom configuration and an optional " +
				"three-finger hand. The developer SDK exposes joint-level position, velocity and " +
				"torque control at 500 Hz.",
			"Important change in the 2026 SDK: the joint index ordering was revised to group the " +
				"legs first, then the waist, then the arms. Trajectories generated against the 2024 " +
				"ordering will not transfer and may trigger a protective stop.",
			"A migration table between the 2024 and 2026 orderings is published in the SDK " +
				"repository under docs/migration.",
			"Unitree does not maintain video-based retargeting tooling. Community projects are " +
				"listed on the developer forum.",
		],
	},

	// ───────────────────────────────────────────────────────────
	// 發佈公告：明確的日期與授權
	// ───────────────────────────────────────────────────────────
	{
		url: "https://blog.kinelabs.dev/humanoid-mimic-0-7",
		site: "blog.kinelabs.dev",
		title: "humanoid-mimic 0.7: Unitree G1 support, on hardware",
		published: "2026-06-30",
		kind: "blog",
		groundTruth: "G1 支援的一手公告，日期 2026-06-30，MIT 授權。",
		paragraphs: [
			"humanoid-mimic 0.7 is out. The headline feature is a Unitree G1 profile built against " +
				"the 2026 SDK joint ordering, validated on hardware rather than only in simulation.",
			"Getting here took longer than we wanted because the 2026 ordering change invalidated " +
				"our test fixtures. If you are porting your own tooling, the SDK migration table is " +
				"the thing to read first.",
			"The project stays MIT licensed. Note that the pose backbone weights are a separate " +
				"download under a non-commercial license, so check that before shipping a product.",
			"Next up: a Booster T1 profile and an ONNX export path.",
		],
	},

	// ───────────────────────────────────────────────────────────
	// 資料集
	// ───────────────────────────────────────────────────────────
	{
		url: "https://huggingface.co/datasets/openmotion/human-motion-video",
		site: "huggingface.co",
		title: "openmotion/human-motion-video - a dataset of human motion clips",
		published: "2026-02-11",
		kind: "dataset",
		paragraphs: [
			"A dataset of 12,400 monocular video clips of everyday human motion, each with a fitted " +
				"SMPL sequence. Intended for training video-to-humanoid retargeting models.",
			"Clips are 2 to 10 seconds, 30 fps, 1080p. Camera is static in 80 percent of clips.",
			"License: CC BY-NC 4.0. Non-commercial only.",
		],
	},

	// ───────────────────────────────────────────────────────────
	// 無關但關鍵字很多的新聞
	// ───────────────────────────────────────────────────────────
	{
		url: "https://technews.example.com/2026/07/humanoid-robot-funding-round",
		site: "technews.example.com",
		title: "Humanoid robot startups raise record funding as Unitree expands",
		published: "2026-07-19",
		kind: "news",
		groundTruth: "跟檢索問題無關，但 Unitree / humanoid 出現很多次，是 precision 的考驗。",
		paragraphs: [
			"Humanoid robot startups raised a record amount in the first half of 2026, with Unitree " +
				"expanding its humanoid lineup and several competitors announcing new humanoid " +
				"platforms.",
			"Analysts point to falling actuator costs and to open source software as the two drivers. " +
				"Investors interviewed for this piece repeatedly mentioned motion quality as the " +
				"remaining bottleneck.",
			"Unitree declined to comment on unit shipments.",
		],
	},

	// ───────────────────────────────────────────────────────────
	// 授權檔：極短的頁面
	// ───────────────────────────────────────────────────────────
	{
		url: "https://github.com/openmotion/retarget-anything/blob/main/LICENSE",
		site: "github.com",
		title: "retarget-anything/LICENSE",
		published: "2026-05-12",
		kind: "repo",
		paragraphs: [
			"Apache License, Version 2.0, January 2004.",
			"Licensed under the Apache License, Version 2.0. You may not use this file except in " +
				"compliance with the License. Unless required by applicable law, software " +
				"distributed under the License is distributed on an AS IS BASIS.",
		],
	},

	// ───────────────────────────────────────────────────────────
	// 完全無關的頁面（讓檢索有東西可以排除）
	// ───────────────────────────────────────────────────────────
	{
		url: "https://cookingwith.example.com/sous-vide-guide",
		site: "cookingwith.example.com",
		title: "A practical guide to sous vide cooking times",
		published: "2026-01-05",
		kind: "blog",
		paragraphs: [
			"Sous vide is the technique of cooking food sealed in a bag in a temperature-controlled " +
				"water bath. The main advantage is that the food cannot overshoot the bath temperature.",
			"For a 2.5 cm steak, 54 degrees for one hour gives a consistent medium rare.",
		],
	},
];
