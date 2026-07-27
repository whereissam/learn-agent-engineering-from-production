/**
 * 檢索評估集。
 *
 * 這是 Lesson 7 的做法搬到搜尋上：**先有評分標準，再改排序。**
 * 不然你調 BM25 的 k1、加一個新訊號、換一個 embedding 模型之後，
 * 只能靠「感覺好像好一點」。
 *
 * 每個 query 標出哪些網址相關，以及相關到什麼程度：
 *
 *   3 = 直接回答了這個 query
 *   2 = 有用的佐證，但不是主要答案
 *   1 = 沾到邊，讀了不會後悔但也不太有用
 *   0 = 沒列出來的都算 0（不相關）
 *
 * **分級（graded）而不是「相關/不相關」二分**，因為排序的問題從來不是
 * 「有沒有找到」，是「最有用的有沒有排在前面」。二分制沒辦法區分
 * 「第一名是佐證、第五名才是答案」跟「第一名就是答案」。
 *
 * 標註原則：**我照著語料的 groundTruth 標，不是照著現在的排序結果標。**
 * 反過來做（先看排序輸出再決定哪些算相關）等於自己給自己打分。
 */

export interface EvalQuery {
	id: string;
	query: string;
	/** 為什麼要有這一題。寫下來才不會之後看不懂自己在測什麼。 */
	tests: string;
	/** 網址 → 相關程度（1-3）。沒列的都是 0。 */
	relevant: Record<string, number>;
}

const HUMANOID_MIMIC = "https://github.com/kinelabs/humanoid-mimic";
const MIMIC_BLOG = "https://blog.kinelabs.dev/humanoid-mimic-0-7";
const RETARGET_ANYTHING = "https://github.com/openmotion/retarget-anything";
const RETARGET_DOCS = "https://openmotion.dev/docs/retarget-anything/getting-started";
const ROS_THREAD = "https://discourse.ros.org/t/g1-retargeting-foot-sliding/45211";
const UNITREE_DEV = "https://www.unitree.com/g1/developer";
const ARXIV = "https://arxiv.org/abs/2603.04417";
const HF_DATASET = "https://huggingface.co/datasets/openmotion/human-motion-video";

export const QUERIES: EvalQuery[] = [
	{
		id: "q1-main",
		query: "open source video to humanoid retargeting for unitree g1",
		tests: "最基本的那一題。正確答案（humanoid-mimic）能不能贏過 SEO 農場和過時的懶人包",
		relevant: {
			[HUMANOID_MIMIC]: 3,
			[MIMIC_BLOG]: 3,
			[ARXIV]: 2,
			[ROS_THREAD]: 2,
			[RETARGET_ANYTHING]: 1,
			[RETARGET_DOCS]: 1,
		},
	},
	{
		id: "q2-chinese",
		query: "把影片動作轉到人形機器人的開源專案",
		tests: "跨語言。BM25 在這題必定掛零（斷不出任何英文字），dense 應該要救得回來",
		relevant: {
			[HUMANOID_MIMIC]: 3,
			[MIMIC_BLOG]: 3,
			[RETARGET_ANYTHING]: 2,
			[ARXIV]: 2,
			[RETARGET_DOCS]: 1,
		},
	},
	{
		id: "q3-deprecated",
		query: "retarget-anything g1 profile deprecated 2026 sdk",
		tests: "很明確的關鍵字題。BM25 本來就該贏，加了別的階段之後不能把它弄壞",
		relevant: {
			[RETARGET_ANYTHING]: 3,
			[RETARGET_DOCS]: 3,
			[ROS_THREAD]: 3,
			[UNITREE_DEV]: 2,
		},
	},
	{
		id: "q4-joint-order",
		query: "unitree g1 joint ordering change 2026",
		tests: "官方文件應該排第一。這題在測權威度：同樣講關節順序，官方 vs 部落格",
		relevant: {
			[UNITREE_DEV]: 3,
			[ROS_THREAD]: 2,
			[RETARGET_ANYTHING]: 1,
			[MIMIC_BLOG]: 1,
		},
	},
	{
		id: "q5-maintained",
		query: "which humanoid retargeting project is actively maintained",
		tests: "「還活著嗎」這種問題沒有任何頁面會直接寫。測的是能不能把已封存的 repo 壓下去",
		relevant: {
			[HUMANOID_MIMIC]: 3,
			[MIMIC_BLOG]: 3,
			[ROS_THREAD]: 2,
			[RETARGET_ANYTHING]: 1,
		},
	},
	{
		id: "q6-license",
		query: "mit license humanoid motion imitation commercial use",
		tests: "授權題。答案在正文深處，而且有一個容易搞混的對手（Apache-2.0 那個）",
		relevant: {
			[HUMANOID_MIMIC]: 3,
			[MIMIC_BLOG]: 2,
		},
	},
	{
		id: "q7-foot-sliding",
		query: "foot sliding contact solver flat sole humanoid",
		tests: "很技術的細節，只有論壇和 repo 的正文提過。測 dense 能不能抓到概念相近的段落",
		relevant: {
			[ROS_THREAD]: 3,
			[HUMANOID_MIMIC]: 3,
		},
	},
	{
		id: "q8-dataset",
		query: "human motion video dataset for training retargeting models",
		tests: "資料集題。這題的正確答案只有一個，測的是精準度而不是廣度",
		relevant: {
			[HF_DATASET]: 3,
			[ARXIV]: 1,
		},
	},
];
