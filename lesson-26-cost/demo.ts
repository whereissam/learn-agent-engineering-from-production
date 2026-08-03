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
	return "other";
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

const QUESTION =
	"Which open source projects can retarget video motion onto a Unitree G1, and do they still work?";

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
			`  estimated ceiling: ${estimate.searches} searches, ${estimate.fetches} fetches, ${estimate.llmCalls} model calls` +
				`  actual: ${state.budget.searches} searches, ${state.budget.fetches} fetches, ${meter.calls.length} model calls`,
		),
	);
	console.log(dim(`  ${state.learnings.length} pieces of evidence`));
	return meter;
}

function printBreakdown(meter: CostMeter): void {
	const { totals } = meter;
	const showMoney = hasPrices();

	console.log(
		`  ${"step".padEnd(18)}${"calls".padStart(6)}${"total token".padStart(14)}${"share".padStart(8)}` +
			(showMoney ? "USD".padStart(12) : ""),
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
			`  ─ totals: input ${totals.input.toLocaleString()}, output ${totals.output.toLocaleString()}, ` +
				`total ${totals.total.toLocaleString()}` +
				(totals.input + totals.output > 0
					? ` (thinking is ${(((totals.total - totals.input - totals.output) / totals.total) * 100).toFixed(0)}%)`
					: ""),
		),
	);
	if (showMoney) console.log(`  ${bold(`total $${totals.cost.toFixed(4)}`)}`);
	if (truncated > 0) console.log(`  ${yellow(`⚠ ${truncated} calls were cut by maxTokens`)}`);
	if (totals.unknown > 0) console.log(dim(`  (${totals.unknown} calls reported no usage)`));
}

async function main(): Promise<void> {
	if (!hasPrices()) {
		console.log(
			yellow("No price table, so only tokens are shown. ") +
				dim("See prices.ts for how to fill it in, or try PRICE_INPUT=… PRICE_OUTPUT=… directly.\n"),
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
