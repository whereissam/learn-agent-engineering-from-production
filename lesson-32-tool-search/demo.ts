/**
 * Lesson 32, the offline half: what does the catalogue cost, and can BM25 find
 * the right tool in it?
 *
 * No API key needed. Everything here is deterministic — bytes, ranks, counts —
 * so it is the part that can be a contract test.
 *
 * The part that needs a real model (does the model *call* the right tool)
 * is `agent.ts`.
 *
 * Run: bun run lesson-32
 */

import { CATALOG, CATALOG_BY_NAME, TASKS } from "./catalog.ts";
import {
	LOAD_TOOL_SPEC,
	SEARCH_TOOLS_SPEC,
	serialisedBytes,
	ToolIndex,
	ToolSearchSession,
} from "./tool-search.ts";

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;

const TOP_K = 5;
const specs = CATALOG.map(({ service: _service, ...spec }) => spec);
const index = new ToolIndex(specs);

console.log(bold("Lesson 32: 200 tools do not fit in context"));
console.log(dim(`${CATALOG.length} tools from ${new Set(CATALOG.map((t) => t.service)).size} services\n`));

// ─────────────────────────────────────────────────────────────
// Step 1: the mechanism off — everything in the request
// ─────────────────────────────────────────────────────────────

console.log(bold("Step 1: what the whole catalogue costs on the wire"));

const allBytes = serialisedBytes(specs);
const metaBytes = serialisedBytes([SEARCH_TOOLS_SPEC, LOAD_TOOL_SPEC]);

console.log(`  all ${CATALOG.length} tools        ${String(allBytes).padStart(7)} bytes`);
console.log(`  2 meta-tools        ${String(metaBytes).padStart(7)} bytes`);
console.log(`  ratio               ${(allBytes / metaBytes).toFixed(0)}x`);
console.log(dim("  Bytes, not tokens. agent.ts asks a real provider what it counts.\n"));

// ─────────────────────────────────────────────────────────────
// Step 2: the count is not the problem — the near-duplicates are
// ─────────────────────────────────────────────────────────────

console.log(bold("Step 2: how many tools are a plausible answer"));

const AMBIGUOUS = ["send", "message", "issue", "create", "list"];
for (const word of AMBIGUOUS) {
	const n = specs.filter((t) => `${t.name} ${t.description}`.toLowerCase().includes(word)).length;
	console.log(`  "${word}"`.padEnd(14) + `${String(n).padStart(3)} of ${CATALOG.length} tools mention it`);
}
console.log(dim("  A catalogue of 200 distinct tools would be easy. This is the hard shape.\n"));

// ─────────────────────────────────────────────────────────────
// Step 3: the mechanism on — can BM25 surface the right one?
// ─────────────────────────────────────────────────────────────

console.log(bold(`Step 3: BM25 over name + description, top ${TOP_K}`));
console.log(dim("  The query is the user's sentence verbatim. No rewriting, no model.\n"));

console.log(`  ${"task".padEnd(14)}${"rank".padStart(6)}  expected tool`);
console.log(dim(`  ${"─".repeat(66)}`));

let inTopK = 0;
let found = 0;
const misses: Array<{ id: string; rank: number | undefined; got: string }> = [];

for (const task of TASKS) {
	const rank = index.rankOf(task.prompt, task.expected);
	const top = index.search(task.prompt, TOP_K);
	if (rank !== undefined) found++;
	if (rank !== undefined && rank <= TOP_K) {
		inTopK++;
		console.log(`  ${task.id.padEnd(14)}${green(String(rank).padStart(6))}  ${task.expected}`);
	} else {
		const shown = rank === undefined ? "none" : String(rank);
		console.log(`  ${task.id.padEnd(14)}${red(shown.padStart(6))}  ${task.expected}`);
		misses.push({ id: task.id, rank, got: top[0]?.name ?? "—" });
	}
}

console.log(dim(`  ${"─".repeat(66)}`));
console.log(`  in top ${TOP_K}: ${inTopK}/${TASKS.length}    ranked at all: ${found}/${TASKS.length}\n`);

if (misses.length > 0) {
	console.log(bold("  Where it misses, and what it returned instead"));
	for (const miss of misses) {
		const task = TASKS.find((t) => t.id === miss.id);
		if (!task) continue;
		console.log(dim(`    ${miss.id}: "${task.prompt}"`));
		console.log(dim(`      wanted ${task.expected} (rank ${miss.rank ?? "unranked"}), top hit was ${miss.got}`));
	}
	console.log(
		yellow(
			"\n  These are vocabulary misses, not ranking bugs: the user's words and the\n" +
				"  tool's words do not overlap. README Step 2, and Exercise 1, are about that.\n",
		),
	);
}

// ─────────────────────────────────────────────────────────────
// Step 4: the three phases, on one task
// ─────────────────────────────────────────────────────────────

console.log(bold("Step 4: search -> load -> active, for one task"));

const walkthrough = TASKS.find((t) => t.id === "oncall");
if (!walkthrough) throw new Error("walkthrough task missing");

const session = new ToolSearchSession(index, () => true, TOP_K);
console.log(dim(`  task: "${walkthrough.prompt}"\n`));

const before = session.requestTools();
console.log(`  phase 0  request carries ${before.length} tools, ${serialisedBytes(before)} bytes`);

const outcome = session.search(walkthrough.prompt);
console.log(`  search   returned ${outcome.hits.length} names as text:`);
for (const hit of outcome.hits) console.log(dim(`             ${hit.rank}. ${hit.name}  (${hit.score.toFixed(2)})`));

const chosen = outcome.hits[0]?.name;
if (!chosen) throw new Error("search returned nothing for the walkthrough task");
const { loaded } = session.load([chosen]);
console.log(`  load     ${loaded.join(", ")}`);

const after = session.requestTools();
console.log(`  active   request carries ${after.length} tools, ${serialisedBytes(after)} bytes`);
console.log(
	dim(
		`           still ${((serialisedBytes(after) / allBytes) * 100).toFixed(1)}% of what the full catalogue would cost\n`,
	),
);

// ─────────────────────────────────────────────────────────────
// Step 5: the phases are three separate places to say no
// ─────────────────────────────────────────────────────────────

console.log(bold("Step 5: the same tool, refused at each phase"));

const target = "aws_ec2_terminate_instance";
if (!CATALOG_BY_NAME.has(target)) throw new Error(`${target} missing from catalogue`);
const query = "terminate an ec2 instance permanently";

for (const blocked of ["search", "load", "active"] as const) {
	const s = new ToolSearchSession(index, (name, phase) => !(name === target && phase === blocked), TOP_K);
	const hits = s.search(query);
	const visible = hits.hits.some((h) => h.name === target);
	const { loaded: ok } = s.load([target]);
	const callable = s.active().some((t) => t.name === target);
	console.log(
		`  refuse at ${blocked.padEnd(7)} searchable=${String(visible).padEnd(5)} ` +
			`loadable=${String(ok.length > 0).padEnd(5)} callable=${callable}`,
	);
}

console.log(
	dim(
		"\n  Refusing at `active` means the model reads the schema, plans around it, and\n" +
			"  fails at the call. Refusing at `search` means it never learns the tool exists.\n" +
			"  Same denial, different conversations.\n",
	),
);

console.log(bold("In one sentence"));
console.log(
	dim(
		"Tool search trades a large fixed context cost for a retrieval step that can miss —\n" +
			"so the question stops being 'how big is my catalogue' and becomes 'how good is my index'.\n",
	),
);
