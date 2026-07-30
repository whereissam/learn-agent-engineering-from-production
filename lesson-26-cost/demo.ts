/**
 * Attach cost metering to Lesson 24's research.
 *
 *   bun run lesson-26                          the default shape
 *   bun run lesson-26 -- --shapes              run two shapes and compare cost
 *   PRICE_INPUT=0.3 PRICE_OUTPUT=2.5 bun run lesson-26     with amounts
 *   PROVIDER=fake bun run lesson-26            offline (no usage; structure only)
 *
 * ⚠️ **Not one line of Lesson 24's code changed.** This merely wraps its provider.
 */

import { research } from "../lesson-24-research-loop/research.ts";
import { DEFAULT_OPTIONS, estimateCost } from "../lesson-24-research-loop/research.ts";
import { createState } from "../lesson-24-research-loop/state.ts";
import { fakeResearchProvider } from "../lesson-24-research-loop/fake-provider.ts";
import { writeReport } from "../lesson-24-research-loop/steps.ts";
import { selectStreamingProvider } from "../shared/streaming/index.ts";
import type { ModelRequest, StreamingProvider } from "../shared/streaming/types.ts";
import { CostMeter, withMetering } from "./meter.ts";
import { hasPrices } from "./prices.ts";

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;

/**
 * Which step a call belongs to.
 *
 * The decorator sees only the request and not who called, so it can only recognise from the prompt.
 * Slightly crude, and **it costs nothing**: Lesson 24 need not know anybody is keeping books beside it.
 *
 * Adding a label parameter to every function signature also works (gpt-researcher does that),
 * which is more precise and requires remembering to pass it for every new step. Both are reasonable trade-offs.
 */
function classify(request: ModelRequest): string {
	const prompt = request.messages.map((m) => (m.role === "user" ? m.text : "")).join("\n");
	if (prompt.includes("web search queries")) return "generateQueries";
	if (prompt.includes("Extract up to")) return "extractLearnings";
	if (prompt.includes("Write a report")) return "writeReport";
	if (prompt.includes("follow-up questions that would")) return "clarify";
	return "其他";
}

function baseProvider(): StreamingProvider {
	if (process.env.PROVIDER?.toLowerCase() === "fake") return fakeResearchProvider();
	return selectStreamingProvider();
}

function flag(name: string, fallback: number): number {
	const index = process.argv.indexOf(`--${name}`);
	if (index === -1) return fallback;
	const value = Number(process.argv[index + 1]);
	return Number.isFinite(value) ? value : fallback;
}

const QUESTION = "有哪些 open source 專案可以把影片動作 retarget 到 Unitree G1？現在還能用嗎？";

async function runShape(breadth: number, depth: number): Promise<CostMeter> {
	const meter = new CostMeter();
	const provider = withMetering(baseProvider(), meter, classify);
	const options = { ...DEFAULT_OPTIONS, breadth, depth };
	const state = createState(QUESTION);

	await research(provider, state, QUESTION, options);
	await writeReport(provider, state);

	const estimate = estimateCost(options);
	console.log(
		dim(
			`  預估上界：搜尋 ${estimate.searches}、抓取 ${estimate.fetches}、模型呼叫 ${estimate.llmCalls}` +
				`　實際：搜尋 ${state.budget.searches}、抓取 ${state.budget.fetches}、模型呼叫 ${meter.calls.length}`,
		),
	);
	console.log(dim(`  證據 ${state.learnings.length} 條`));
	return meter;
}

function printBreakdown(meter: CostMeter): void {
	const { totals } = meter;
	const showMoney = hasPrices();

	console.log(
		`  ${"步驟".padEnd(18)}${"次數".padStart(6)}${"total token".padStart(14)}${"占比".padStart(8)}` +
			(showMoney ? "美元".padStart(12) : ""),
	);

	for (const group of meter.byLabel()) {
		const share = totals.total > 0 ? (group.total / totals.total) * 100 : 0;
		console.log(
			`  ${group.label.padEnd(18)}${String(group.calls).padStart(6)}` +
				`${group.total.toLocaleString().padStart(14)}${`${share.toFixed(1)}%`.padStart(8)}` +
				(showMoney ? `$${group.cost.toFixed(5)}`.padStart(12) : ""),
		);
	}

	const truncated = meter.calls.filter((c) => c.truncated).length;
	console.log(
		dim(
			`  ─ 合計 input ${totals.input.toLocaleString()}、output ${totals.output.toLocaleString()}、` +
				`total ${totals.total.toLocaleString()}` +
				(totals.input + totals.output > 0
					? `（thinking 佔 ${(((totals.total - totals.input - totals.output) / totals.total) * 100).toFixed(0)}%）`
					: ""),
		),
	);
	if (showMoney) console.log(`  ${bold(`合計 $${totals.cost.toFixed(4)}`)}`);
	if (truncated > 0) console.log(`  ${yellow(`⚠ ${truncated} 次呼叫被 maxTokens 截斷`)}`);
	if (totals.unknown > 0) console.log(dim(`  （${totals.unknown} 次呼叫沒有 usage）`));
}

async function main(): Promise<void> {
	if (!hasPrices()) {
		console.log(
			yellow("沒有價目表，只顯示 token。") +
				dim(" 填法看 prices.ts，或 PRICE_INPUT=… PRICE_OUTPUT=… 直接試算。\n"),
		);
	}

	if (process.argv.includes("--shapes")) {
			// "The depth knob is the cost knob" — two shapes turn it into numbers
		const shapes: Array<[number, number]> = [
			[2, 1],
			[3, 2],
		];
		for (const [breadth, depth] of shapes) {
			console.log(bold(`\nbreadth=${breadth} depth=${depth}`));
			const meter = await runShape(breadth, depth);
			printBreakdown(meter);
		}
		return;
	}

	const breadth = flag("breadth", DEFAULT_OPTIONS.breadth);
	const depth = flag("depth", DEFAULT_OPTIONS.depth);
	console.log(bold(`breadth=${breadth} depth=${depth}`));
	const meter = await runShape(breadth, depth);
	printBreakdown(meter);
}

if (import.meta.main) {
	try {
		await main();
	} catch (error) {
		console.error(`\n${error instanceof Error ? error.message : String(error)}`);
		process.exit(1);
	}
}
