/**
 * Run one complete research pass.
 *
 *   bun run lesson-24                            with the default breadth=3 depth=2
 *   bun run lesson-24 -- --breadth 2 --depth 1   the cheap version
 *   bun run lesson-24 -- --ask                   see what the model wants clarified first
 *   bun run lesson-24 -- "your question"
 *   PROVIDER=fake bun run lesson-24              no key needed
 *
 * This is not a REPL. Research is a task that **ends when it finishes** rather than a conversation —
 * and that fact is itself what this lesson wants to say.
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

const DEFAULT_QUESTION =
	"Which open source projects can retarget video motion onto a Unitree G1, and do they still work?";

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
	console.log(bold(`\nQuestion: ${question}\n`));
	console.log(
		dim(
			`budget: breadth=${options.breadth} depth=${options.depth} pages=${options.pagesPerQuery}` +
				`  →  at most ${estimate.searches} searches, ${estimate.fetches} fetches, about ${estimate.llmCalls} model calls`,
		),
	);
	console.log(
		dim(
			'(That ceiling is computable before the run starts. Compare Lesson 22, where the ceiling was "it hit the step cap")\n',
		),
	);

	if (process.argv.includes("--ask")) {
		const questions = await clarify(provider, state);
		console.log(bold("Before researching, the model wants to clarify:"));
		for (const q of questions) console.log(`  - ${q}`);
		console.log(dim("\n(deep-research/src/feedback.ts really waits for your answer. Here they are only printed.)\n"));
	}

	const started = Date.now();
	await research(provider, state, question, options);
	const elapsed = ((Date.now() - started) / 1000).toFixed(1);

	console.log(bold("The research"));
	for (const line of state.trace) console.log(dim(line));

	console.log(bold("\nEvidence"));
	for (const [i, learning] of state.learnings.entries()) {
		console.log(`  ${green(`[${i + 1}]`)} ${learning.text}`);
		console.log(dim(`      ${learning.sources.join(", ")}  (depth ${learning.depth})`));
	}

	const report = await writeReport(provider, state);
	console.log(bold("\nReport\n"));
	console.log(report);

	const { budget } = state;
	console.log(bold("\nActually spent"));
	console.log(
		dim(
			`  searches ${budget.searches}  fetches ${budget.fetches}  model calls ${budget.llmCalls}  elapsed ${elapsed}s\n` +
				`  duplicates blocked: ${budget.skippedDuplicates} URLs, ${budget.skippedQueries} queries` +
				(budget.truncatedOutputs > 0
					? `\n  ⚠ ${budget.truncatedOutputs} outputs were cut by the token cap`
					: ""),
		),
	);
	console.log(
		dim(`  ${state.learnings.length} pieces of evidence, from ${state.visited.size} distinct URLs`),
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
