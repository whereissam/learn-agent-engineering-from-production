/**
 * Lesson 14, the offline half: what did this agent actually do last week?
 *
 * No API key. One simulated morning, recorded two ways from the same calls, then
 * six operator questions asked of each record.
 *
 * Run: bun run lesson-14
 */

import { simulateMorning } from "./day.ts";
import { QUESTIONS, score } from "./questions.ts";
import { costOfSubtree, renderTree, rootsOf } from "./trace.ts";

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;

const { recorder, roots } = simulateMorning();
const spans = recorder.spans;
const log = recorder.sortedLog();

const clock = (at: number) => new Date(at).toISOString().slice(11, 19);

console.log(bold("Lesson 14: what did this agent actually do last week?"));
console.log(dim("One morning: a cron run, Dana's refund, and Sam's question — overlapping.\n"));

// ─────────────────────────────────────────────────────────────
// Step 1: the log
// ─────────────────────────────────────────────────────────────

console.log(bold("Step 1: the audit log, which is Lesson 8's Exercise 4"));
for (const line of log) {
	const extra = [
		line.attributes.tokens ? `${line.attributes.tokens}tok` : "",
		line.attributes.costCents ? `${line.attributes.costCents}c` : "",
		line.attributes.attempt ? `attempt=${line.attributes.attempt}` : "",
		line.attributes.decision ?? "",
	]
		.filter(Boolean)
		.join(" ");
	console.log(dim(`  ${clock(line.at)}  ${line.actor.padEnd(6)} ${line.message.padEnd(44)} ${extra}`));
}

console.log(
	dim(
		"\n  Complete, timestamped, and it carries every attribute the spans carry.\n" +
			"  Nothing is being withheld to make the comparison look good.\n",
	),
);

// ─────────────────────────────────────────────────────────────
// Step 2: the same events, as a tree
// ─────────────────────────────────────────────────────────────

console.log(bold("Step 2: the same calls, with one field added"));
for (const root of rootsOf(spans)) {
	console.log();
	for (const line of renderTree(spans, root.id)) console.log(dim(`  ${line}`));
	console.log(`  ${dim("→ total")} ${green(`${costOfSubtree(spans, root.id)}c`)}`);
}

console.log(
	dim(
		"\n  The added field is `parentSpanId`. Everything else — durations, tokens,\n" +
			"  decisions — was already in the log. One pointer turns a pile of events\n" +
			"  into something you can sum.\n",
	),
);

// ─────────────────────────────────────────────────────────────
// Step 3: six questions
// ─────────────────────────────────────────────────────────────

console.log(bold("Step 3: the questions an operator actually asks"));

for (const question of QUESTIONS) {
	const fromSpans = question.fromSpans(spans, roots);
	const fromLog = question.fromLog(log);

	console.log(`\n  ${question.text}`);
	console.log(`    log    ${fromLog === undefined ? red("cannot answer") : green(fromLog)}`);
	console.log(`    spans  ${fromSpans === undefined ? red("cannot answer") : green(fromSpans)}`);
	console.log(dim(`           ${question.note}`));
}

const result = score(spans, log, roots);
console.log(bold("\nScore"));
console.log(`  log    ${result.log}/${result.total}`);
console.log(`  spans  ${result.spans}/${result.total}`);

console.log(
	yellow(
		"\n  The log is not useless and this is not 3/6 versus 6/6 by construction — the\n" +
			"  first two questions are what logs are for, and the log answers them more\n" +
			"  simply than a tree does. The split is not about detail. It is that a log\n" +
			"  records events and a tree records causality, and three of these six\n" +
			"  questions are causal ones.\n",
	),
);

// ─────────────────────────────────────────────────────────────
// Step 4: why the obvious workaround does not work
// ─────────────────────────────────────────────────────────────

console.log(bold("Step 4: 'just sum the log by actor and time window'"));

const danaWindow = log.filter((line) => line.at >= 1_800_000_060_000 && line.at <= 1_800_000_230_000);
const windowCost = danaWindow.reduce((total, line) => total + (line.attributes.costCents ?? 0), 0);
const danaCost = costOfSubtree(spans, roots.dana);
const samCost = costOfSubtree(spans, roots.sam);

console.log(`  sum of every log line in Dana's window   ${windowCost}c`);
console.log(`  Dana's request, from the tree            ${danaCost}c`);
console.log(`  Sam's request, from the tree             ${samCost}c`);
console.log(
	`  ${dim("the window's error is")} ${red(`all ${samCost}c of Sam's request`)}${dim(", billed to Dana")}`,
);
console.log(
	dim(
		`\n  Read the size of that error carefully: it is not 'one cent'. It is 100% of\n` +
			`  another person's request, and it grows with whatever else happens to be\n` +
			`  running. Narrowing by actor patches this morning and breaks the first time\n` +
			`  one person has two requests open, which is a chat interface with a second\n` +
			`  tab.\n`,
	),
);

console.log(bold("In one sentence"));
console.log(
	dim(
		"A log tells you what happened; a tree tells you what happened *because of what*,\n" +
			"and every question about cost, blame or delegation is the second kind.\n",
	),
);
