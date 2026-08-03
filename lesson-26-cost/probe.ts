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
	{ label: "very short (100)", prompt: "Answer with one word: hi", maxTokens: 100 },
	{ label: "one sentence (400)", prompt: "Explain what BM25 is in one sentence", maxTokens: 400 },
	{ label: "one sentence (4000)", prompt: "Explain what BM25 is in one sentence", maxTokens: 4000 },
	{
		label: "long answer (2000)",
		prompt: "Explain the BM25 formula and what each parameter means, in at least 300 words",
		maxTokens: 2000,
	},
];

const provider = selectStreamingProvider();
console.log(dim(`provider: ${provider.name}  model: ${provider.model}\n`));

console.log(
	`${"case".padEnd(20)}${"input".padStart(8)}${"output".padStart(8)}${"total".padStart(8)}` +
		`${"gap".padStart(8)}${"underest.".padStart(10)}  stopReason`,
);
console.log(dim("─".repeat(72)));

for (const testCase of CASES) {
	const response = await drain(
		provider.stream({
			system: "You are a technical assistant.",
			messages: [{ role: "user", text: testCase.prompt }],
			tools: [],
			maxTokens: testCase.maxTokens,
		}),
	);

	const usage = response.usage;
	if (!usage) {
		console.log(`${testCase.label.padEnd(20)}${red("this provider reports no usage")}`);
		continue;
	}

	const naive = usage.input + usage.output;
	const gap = usage.total - naive;
	const ratio = naive > 0 ? usage.total / naive : 0;

	console.log(
		`${testCase.label.padEnd(20)}${String(usage.input).padStart(8)}` +
			`${String(usage.output).padStart(8)}${String(usage.total).padStart(8)}` +
			`${String(gap).padStart(8)}${`${ratio.toFixed(1)}x`.padStart(10)}  ${response.stopReason}`,
	);
}

console.log();
console.log(bold("Three things to look at"));
console.log(
	dim(
		"1. The gap is thinking tokens. They are not in output, and you pay for them:\n" +
			"   costing a run as input + output underestimates it several times over.\n\n" +
			'2. The gap also eats the maxTokens budget, so "the output was truncated" is often not\n' +
			"   your content being too long but the model thinking too long. Lesson 24's report,\n" +
			"   which stopped mid-URL, was exactly this.\n\n" +
			'3. Look at the two "one sentence" rows: same question, truncated at 400 and not at 4000.\n' +
			'   **For a reasoning model maxTokens is not "the output length limit" but "the budget for thinking plus writing".**',
	),
);
