/**
 * 跑一次完整研究。
 *
 *   bun run lesson-24                            用預設 breadth=3 depth=2
 *   bun run lesson-24 -- --breadth 2 --depth 1   便宜版
 *   bun run lesson-24 -- --ask                   先看模型想澄清什麼
 *   bun run lesson-24 -- "你的問題"
 *   PROVIDER=fake bun run lesson-24              不需要金鑰
 *
 * 這不是 REPL。研究是一個**跑完就結束**的任務，不是一段對話——
 * 這件事本身就是這一課想說的。
 */

import { fakeResearchProvider } from "./fake-provider.ts";
import { selectStreamingProvider } from "../shared/streaming/index.ts";
import type { StreamingProvider } from "../shared/streaming/types.ts";
import { DEFAULT_OPTIONS, estimateCost, research } from "./research.ts";
import { clarify, writeReport } from "./steps.ts";
import { createState } from "./state.ts";

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;

function flag(name: string, fallback: number): number {
	const index = process.argv.indexOf(`--${name}`);
	if (index === -1) return fallback;
	const value = Number(process.argv[index + 1]);
	return Number.isFinite(value) ? value : fallback;
}

function selectProvider(): StreamingProvider {
	if (process.env.PROVIDER?.toLowerCase() === "fake") return fakeResearchProvider();
	return selectStreamingProvider();
}

const DEFAULT_QUESTION = "有哪些 open source 專案可以把影片動作 retarget 到 Unitree G1？現在還能用嗎？";

async function main(): Promise<void> {
	const positional = process.argv.slice(2).filter((a) => !a.startsWith("--") && Number.isNaN(Number(a)));
	const question = positional[0] ?? DEFAULT_QUESTION;

	const options = {
		...DEFAULT_OPTIONS,
		breadth: flag("breadth", DEFAULT_OPTIONS.breadth),
		depth: flag("depth", DEFAULT_OPTIONS.depth),
		pagesPerQuery: flag("pages", DEFAULT_OPTIONS.pagesPerQuery),
		concurrency: flag("concurrency", DEFAULT_OPTIONS.concurrency),
	};

	const provider = selectProvider();
	const state = createState(question);
	const estimate = estimateCost(options);

	console.log(dim(`provider: ${provider.name}  model: ${provider.model}`));
	console.log(bold(`\n問題：${question}\n`));
	console.log(
		dim(
			`預算：breadth=${options.breadth} depth=${options.depth} pages=${options.pagesPerQuery}` +
				`  →  最多 ${estimate.searches} 次搜尋、${estimate.fetches} 次抓取、約 ${estimate.llmCalls} 次模型呼叫`,
		),
	);
	console.log(dim("（這個上界是開跑前就算得出來的。對照 Lesson 22：那個 agent 的上界是「撞到步數上限」）\n"));

	if (process.argv.includes("--ask")) {
		const questions = await clarify(provider, state);
		console.log(bold("研究之前，模型想先問清楚："));
		for (const q of questions) console.log(`  - ${q}`);
		console.log(dim("\n（deep-research/src/feedback.ts 會真的等你回答。這裡只印出來給你看）\n"));
	}

	const started = Date.now();
	await research(provider, state, question, options);
	const elapsed = ((Date.now() - started) / 1000).toFixed(1);

	console.log(bold("研究過程"));
	for (const line of state.trace) console.log(dim(line));

	console.log(bold("\n證據"));
	for (const [i, learning] of state.learnings.entries()) {
		console.log(`  ${green(`[${i + 1}]`)} ${learning.text}`);
		console.log(dim(`      ${learning.sources.join(", ")}  (depth ${learning.depth})`));
	}

	const report = await writeReport(provider, state);
	console.log(bold("\n報告\n"));
	console.log(report);

	const { budget } = state;
	console.log(bold("\n實際用掉"));
	console.log(
		dim(
			`  搜尋 ${budget.searches}  抓取 ${budget.fetches}  模型呼叫 ${budget.llmCalls}  耗時 ${elapsed}s\n` +
				`  擋掉重複：URL ${budget.skippedDuplicates} 次、query ${budget.skippedQueries} 次` +
				(budget.truncatedOutputs > 0
					? `\n  ⚠ ${budget.truncatedOutputs} 次輸出被 token 上限截斷`
					: ""),
		),
	);
	console.log(
		dim(`  證據 ${state.learnings.length} 條，來自 ${state.visited.size} 個不重複的網址`),
	);
}

if (import.meta.main) {
	try {
		await main();
	} catch (error) {
		console.error(`\n${error instanceof Error ? error.message : String(error)}`);
		process.exit(1);
	}
}
