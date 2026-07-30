/**
 * The token accounting experiment: proving `total ≠ input + output`.
 *
 *   bun run lesson-26:probe
 *
 * This experiment needs a real model (no usage means nothing to measure), so a key is required.
 * It is the only part of Lesson 26 that needs one; everything else runs offline.
 *
 * Why it deserves its own program: because **measuring this once changes your intuition about cost permanently**.
 */

import { selectStreamingProvider } from "../shared/streaming/index.ts";
import { drain } from "../shared/streaming/types.ts";

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;

const CASES: Array<{ label: string; prompt: string; maxTokens: number }> = [
	{ label: "極短 (100)", prompt: "只回答一個字：hi", maxTokens: 100 },
	{ label: "一句話 (400)", prompt: "用一句話說明 BM25 是什麼", maxTokens: 400 },
	{ label: "一句話 (4000)", prompt: "用一句話說明 BM25 是什麼", maxTokens: 4000 },
	{
		label: "長篇 (2000)",
		prompt: "詳細說明 BM25 的公式與每個參數的意義，至少 300 字",
		maxTokens: 2000,
	},
];

const provider = selectStreamingProvider();
console.log(dim(`provider: ${provider.name}  model: ${provider.model}\n`));

console.log(
	`${"案例".padEnd(14)}${"input".padStart(8)}${"output".padStart(8)}${"total".padStart(8)}` +
		`${"差額".padStart(8)}${"低估倍數".padStart(10)}  stopReason`,
);
console.log(dim("─".repeat(72)));

for (const testCase of CASES) {
	const response = await drain(
		provider.stream({
			system: "你是一個技術助理。",
			messages: [{ role: "user", text: testCase.prompt }],
			tools: [],
			maxTokens: testCase.maxTokens,
		}),
	);

	const usage = response.usage;
	if (!usage) {
		console.log(`${testCase.label.padEnd(14)}${red("這個 provider 沒有回報 usage")}`);
		continue;
	}

	const naive = usage.input + usage.output;
	const gap = usage.total - naive;
	const ratio = naive > 0 ? usage.total / naive : 0;

	console.log(
		`${testCase.label.padEnd(14)}${String(usage.input).padStart(8)}` +
			`${String(usage.output).padStart(8)}${String(usage.total).padStart(8)}` +
			`${String(gap).padStart(8)}${`${ratio.toFixed(1)}x`.padStart(10)}  ${response.stopReason}`,
	);
}

console.log();
console.log(bold("要看的三件事"));
console.log(
	dim(
		"1. 差額就是 thinking token。它不在 output 裡，但你要付錢——\n" +
			"   用 input + output 算成本會低估好幾倍。\n\n" +
			"2. 差額也吃掉 maxTokens 額度。所以「輸出被截斷」常常不是你的內容太長，\n" +
			"   是模型想太久。Lesson 24 那份在網址中間斷掉的報告就是這樣。\n\n" +
			"3. 看「一句話」那兩列：同一個問題，額度 400 會被截斷、額度 4000 不會。\n" +
			"   **maxTokens 對推理型模型不是「輸出長度上限」，是「想 + 寫的總額度」。**",
	),
);
