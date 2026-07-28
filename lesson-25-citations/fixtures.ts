/**
 * 要被檢查的報告。
 *
 * 第一份是**真的**：Lesson 24 用 Gemini 3.6 Flash 跑出來的原始輸出，
 * 一個字都沒改（設計原則 3）。
 *
 * 另外三份是從第一份**故意改壞的**，每一種對應一類引用錯誤。
 * 改壞的方式寫在程式碼裡而不是散文裡，所以你可以自己核對我改了什麼——
 * 這跟 Lesson 6 的 telemetry 產生器是同一個道理：
 * **要驗證一個檢查器，你得先有一份你知道答案的資料。**
 */

/**
 * Lesson 24 的真實輸出。
 *
 * 我在肉眼讀這份報告時就發現一處可疑的引用（授權那條掛了三個網址，
 * 其中論壇那篇根本沒提授權）。這一課的檢查器要能自己找出來。
 */
export const REAL_REPORT = `### 核心答案

目前有兩個主要的 Open Source 專案可用於將影片動作重定向（retarget）至 Unitree G1：**\`kinelabs/humanoid-mimic\`** 與 **\`openmotion/retarget-anything\`**。

* **\`kinelabs/humanoid-mimic\`（現在可用）**：0.7 版本支援 2026 年 SDK 的關節順序，並經過實體硬體測試 (https://github.com/kinelabs/humanoid-mimic)。
* **\`openmotion/retarget-anything\`（現在無法直接用於 G1）**：其 Unitree G1 設定檔已遭棄用且停止維護；因其仍採用 2024 年舊版 URDF 關節順序，在 2026 年 SDK 上運行會直接觸發保護性停機（protective stop）(https://github.com/openmotion/retarget-anything, https://discourse.ros.org/t/g1-retargeting-foot-sliding/45211)。

#### 1. kinelabs/humanoid-mimic
* **版本與發布日期**：專案於 2026 年 6 月釋出 Version 0.7 (https://github.com/kinelabs/humanoid-mimic)。
* **軟體授權**：代碼庫本身採用 MIT 授權發布，但其運作所需的預訓練姿勢骨幹模型權重（pretrained pose backbone weights）必須單獨下載，且屬於非商業授權（non-commercial license）(https://github.com/kinelabs/humanoid-mimic, https://discourse.ros.org/t/g1-retargeting-foot-sliding/45211, https://blog.kinelabs.dev/humanoid-mimic-0-7)。
* **效能與相容性**：0.7 版本加入了專門針對 2026 SDK 關節順序設計且經過硬體驗證的 Unitree G1 設定檔，在 Nvidia RTX 4070 上能以約 18 ms 的端到端延遲串流 50 Hz 的關節目標 (https://github.com/kinelabs/humanoid-mimic)。

#### 2. openmotion/retarget-anything
* **版本與授權**：專案於 2026 年 3 月發布 v2.0，採用 Apache License Version 2.0（2004 年 1 月版）(https://github.com/openmotion/retarget-anything, https://github.com/openmotion/retarget-anything/blob/main/LICENSE, https://openmotion.dev/docs/retarget-anything/getting-started)。
* **管道與執行環境**：此專案可將單眼影片轉換為人形機器人關節軌跡，內建 Unitree G1、Unitree H1、Booster T1 及通用 23-DoF 等設定檔 (https://openmotion.dev/docs/retarget-anything/getting-started)。執行需使用 Python 3.11 與 CUDA 12，純 CPU 推論速度比 GPU 推論慢約 40 倍 (https://github.com/openmotion/retarget-anything, https://openmotion.dev/docs/retarget-anything/getting-started)。
* **棄用與 SDK 變更**：2026 年 Unitree G1 SDK 更改了關節索引映射（例如將 \`left_hip_pitch\` 從索引 7 改為 1，\`left_knee\` 從 9 改為 3 並反轉方向符號），並基於修正後的散熱模型調低關節速度上限（如 \`left_knee\` 從 17 rad/s 降至 15 rad/s）(https://www.unitree.com/g1/developer)。

### 注意事項與限制（Caveats）

* **腳部滑動問題**：在 Unitree G1 上使用 \`humanoid-mimic 0.7\` 時，若執行快速腳步動作（fast footwork）會出現腳部滑動（foot sliding）的現象；開發者在展示時透過將播放速度降低至 0.8x 來緩解此問題 (https://discourse.ros.org/t/g1-retargeting-foot-sliding/45211)。
* **硬體保護停機**：若強行在 2026 SDK 韌體下執行 \`retarget-anything\`，會因傳送舊版 2024 URDF 的關節順序而導致機器人立即觸發保護性停機 (https://discourse.ros.org/t/g1-retargeting-foot-sliding/45211)。`;

export interface Fixture {
	id: string;
	label: string;
	report: string;
	/** 這份報告裡我埋了什麼，檢查器至少要抓到這些。 */
	expect: {
		/** 至少要抓到幾條被嫁接的引用 */
		graftedAtLeast?: number;
		/** 至少要抓到幾個沒有來源支持的原子 */
		unsupportedAtomsAtLeast?: number;
		/** 至少要抓到幾條完全沒引用的事實句 */
		uncitedAtLeast?: number;
	};
	/** 我到底改了什麼。寫出來，讀者才驗得了我。 */
	injected?: string;
}

/** 數字漂移：來源說 0.8x、18 ms，報告寫成別的。 */
const DRIFTED = REAL_REPORT.replace("0.8x", "0.5x").replace("18 ms", "8 ms").replace(
	"50 Hz",
	"120 Hz",
);

/** 引用嫁接：把一條正確的句子掛到一個完全無關的來源上。 */
const GRAFTED = REAL_REPORT.replace(
	"(https://www.unitree.com/g1/developer)",
	"(https://www.unitree.com/g1/developer, https://cookingwith.example.com/sous-vide-guide)",
).replace(
	"若執行快速腳步動作（fast footwork）會出現腳部滑動（foot sliding）的現象；開發者在展示時透過將播放速度降低至 0.8x 來緩解此問題 (https://discourse.ros.org/t/g1-retargeting-foot-sliding/45211)",
	"若執行快速腳步動作（fast footwork）會出現腳部滑動（foot sliding）的現象；開發者在展示時透過將播放速度降低至 0.8x 來緩解此問題 (https://technews.example.com/2026/07/humanoid-robot-funding-round)",
);

/** 裸露斷言：把引用整個拔掉，句子照留。 */
const BARE = REAL_REPORT.split("\n")
	.map((line, index) =>
		index % 2 === 0 ? line : line.replace(/\s*\(https?:\/\/[^)]*\)/g, ""),
	)
	.join("\n");

export const FIXTURES: Fixture[] = [
	{
		id: "real",
		label: "Lesson 24 的真實輸出（一個字沒改）",
		report: REAL_REPORT,
		// 這裡不寫 expect，因為我不知道正確答案是幾——
		// **這份的用途是「檢查器對真實輸出說了什麼」，不是通過測試。**
		expect: {},
	},
	{
		id: "drifted",
		label: "數字漂移",
		report: DRIFTED,
		injected: "0.8x → 0.5x、18 ms → 8 ms、50 Hz → 120 Hz",
		expect: { unsupportedAtomsAtLeast: 3 },
	},
	{
		id: "grafted",
		label: "引用嫁接",
		report: GRAFTED,
		injected:
			"關節索引那條多掛一個烹飪網站；腳步滑動那條改掛一篇無關的募資新聞",
		expect: { graftedAtLeast: 2 },
	},
	{
		id: "bare",
		label: "裸露斷言",
		report: BARE,
		injected: "把一半行數的引用整個拔掉",
		expect: { uncitedAtLeast: 5 },
	},
];
