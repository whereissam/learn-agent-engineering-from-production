/**
 * Lesson 38, the offline half: where does the prefix stop being the same?
 *
 * No API key. Everything here is character counting over the requests six
 * builders would send, which makes it the repeatable half — and repeatability is
 * exactly what the online half cannot have (see `probe.ts`, and README Step 5).
 *
 * Run: bun run lesson-38
 */

import { analyse, OPENAI_ORDER, type RequestShape, SECTIONS, budget, newBreakpoints } from "./prefix.ts";
import { BUILDERS, TURNS } from "./turns.ts";

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;

function conversation(build: (turn: number) => RequestShape): RequestShape[] {
	return Array.from({ length: TURNS }, (_, i) => build(i + 1));
}

console.log(bold("Lesson 38: the cache you break yourself"));
console.log(dim(`${TURNS} turns per configuration, measured as characters shared from the start of the request\n`));

// ─────────────────────────────────────────────────────────────
// Step 1: where the first difference lands
// ─────────────────────────────────────────────────────────────

function report(order: typeof SECTIONS) {
	for (const builder of BUILDERS) {
		const divergences = analyse(conversation(builder.build), order);
		const worst = divergences.reduce((low, d) => Math.min(low, d.ratio), 1);
		const lost = Math.max(...divergences.map((d) => d.total - d.stable));
		const sections = [...new Set(divergences.map((d) => d.section))].join(", ");
		const rendered = `${(worst * 100).toFixed(0)}%`.padStart(10);
		console.log(
			`  ${builder.label.padEnd(22)}${worst > 0.5 ? green(rendered) : red(rendered)}` +
				`${String(lost).padStart(9)}${sections.padStart(17)}`,
		);
	}
}

console.log(bold("Step 1: assuming the request object's own order (system, tools, messages)"));
console.log(`  ${"configuration".padEnd(22)}${"reusable".padStart(10)}${"lost".padStart(9)}${"first change in".padStart(17)}`);
console.log(dim(`  ${"─".repeat(60)}`));
report(SECTIONS);

console.log(
	dim(
		"\n  'reusable' is the worst turn-to-turn overlap; 'lost' is the characters after\n" +
			"  the first difference, which have to be paid for again.\n",
	),
);

console.log(
	yellow(
		"  Read the percentages sceptically. The system prompt is 40k characters and\n" +
			"  dwarfs everything else, so a configuration can rewrite its entire tool list\n" +
			"  and still show 97% reusable. **The section is the signal, not the ratio** —\n" +
			"  which is why the two tool rows below look almost unchanged and are not.\n",
	),
);

// ─────────────────────────────────────────────────────────────
// Step 2: the same six, under the order the provider actually behaves as if it uses
// ─────────────────────────────────────────────────────────────

console.log(bold("Step 2: the same six, with tools moved to the back"));
console.log(`  ${"configuration".padEnd(22)}${"reusable".padStart(10)}${"lost".padStart(9)}${"first change in".padStart(17)}`);
console.log(dim(`  ${"─".repeat(60)}`));
report(OPENAI_ORDER);

console.log(
	dim(
		"\n  Under the request object's order, changing the tool list also throws away the\n" +
			"  message history behind it. Under this one it does not, and 'lost' shows it.\n" +
			"  This file cannot say which order is real — `probe.ts` asks a provider, and\n" +
			"  README Step 4 reports what it said.\n",
	),
);

// ─────────────────────────────────────────────────────────────
// Step 3: the breakpoint budget
// ─────────────────────────────────────────────────────────────

console.log(bold("Step 3: Anthropic's four markers, and what happens to the fifth"));

const marks = ["tools", "system", "history", "recent turn", "current turn", "scratch"];
const breakpoints = newBreakpoints();
for (const mark of marks) {
	const kept = budget(breakpoints);
	console.log(
		`  mark ${mark.padEnd(14)} ${kept ? green("placed") : red("dropped")}  ` +
			dim(`remaining=${breakpoints.remaining} dropped=${breakpoints.dropped}`),
	);
}

console.log(
	dim(
		"\n  Nothing threw. OpenCode counts these because the alternative is a 400\n" +
			"  (`anthropic-messages.ts:234`), and the counting means the sixth marker is\n" +
			"  discarded in silence. You asked for a discount and did not get one; the\n" +
			"  only evidence is the bill.\n",
	),
);

console.log(bold("In one sentence"));
console.log(
	dim(
		"A cache is not something you switch on — it is something you preserve, and\n" +
			"everything this series taught you to put in a system prompt destroys it.\n",
	),
);
