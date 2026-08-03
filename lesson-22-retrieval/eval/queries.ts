/**
 * The retrieval evaluation set.
 *
 * Lesson 7's approach moved onto search: **have the scoring standard before changing the ranking.**
 * Otherwise, after tuning BM25's k1, adding a signal or changing embedding model,
 * all you have is "it feels a bit better".
 *
 * Each query marks which URLs are relevant and how relevant:
 *
 *   3 = answers this query directly
 *   2 = useful corroboration, not the main answer
 *   1 = tangential; you would not regret reading it and it is not much use
 *   0 = anything unlisted (irrelevant)
 *
 * **Graded rather than a relevant/irrelevant binary**, because ranking's problem is never
 * "was it found" but "is the most useful thing near the top". A binary cannot distinguish
 * "first place is corroboration and fifth is the answer" from "first place is the answer".
 *
 * The labelling principle: **labels follow the corpus's groundTruth, not the current ranking output.**
 * The other way round (looking at the ranking and then deciding what is relevant) is marking your own homework.
 */

export interface EvalQuery {
	id: string;
	query: string;
	/** Why this query exists. Written down so you can still tell what it tests later. */
	tests: string;
	/** URL → relevance (1-3). Anything unlisted is 0. */
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
		tests:
			"The most basic question. Can the right answer (humanoid-mimic) beat the SEO farm and the stale round-up",
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
		tests:
			"Cross-lingual. BM25 is guaranteed to score zero here (it tokenises no English words); dense retrieval should rescue it",
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
		tests:
			"A blunt keyword question. BM25 should win it outright, and the later stages must not break that",
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
		tests:
			"The official docs should rank first. This tests authority: same topic, official source vs a blog",
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
		tests:
			'No page states "is this still alive" outright. This tests whether an archived repo can be pushed down',
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
		tests:
			"A licensing question. The answer is deep in the body, with an easily confused rival (the Apache-2.0 one)",
		relevant: {
			[HUMANOID_MIMIC]: 3,
			[MIMIC_BLOG]: 2,
		},
	},
	{
		id: "q7-foot-sliding",
		query: "foot sliding contact solver flat sole humanoid",
		tests:
			"A technical detail mentioned only in the forum thread and a repo body. Tests whether dense retrieval catches a conceptually similar passage",
		relevant: {
			[ROS_THREAD]: 3,
			[HUMANOID_MIMIC]: 3,
		},
	},
	{
		id: "q8-dataset",
		query: "human motion video dataset for training retargeting models",
		tests:
			"A dataset question with exactly one right answer. This tests precision rather than breadth",
		relevant: {
			[HF_DATASET]: 3,
			[ARXIV]: 1,
		},
	},
];
