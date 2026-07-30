/**
 * The citation evaluation runner.
 *
 *   bun run lesson-25                    run four reports
 *   bun run lesson-25 -- --show real     see one report's per-claim verdicts
 *   bun run lesson-25 -- --save          save a baseline
 *   bun run lesson-25 -- --compare       compare against the baseline and see regressions
 *
 * `--save` / `--compare` reuse Lesson 7's shape directly. **An evaluation with no regression comparison
 * can only tell you today's score, not whether that change broke something**,
 * and the latter is what an evaluation is really for (Lesson 22 Step 5 caught its collapse that way).
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { IndexedPage } from "../lesson-20-search-agent/corpus/generate.ts";
import { extractMain } from "../lesson-21-crawl/extract/html.ts";
import { fetchPage } from "../lesson-21-crawl/fetcher.ts";
import { FIXTURES } from "./fixtures.ts";
import { parseReport } from "./report.ts";
import { type ClaimVerdict, verifyClaim } from "./verify.ts";

const CORPUS = resolve(import.meta.dirname, "../lesson-20-search-agent/corpus");
const BASELINE = resolve(import.meta.dirname, "baseline.json");

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;

/**
 * Build "URL → source body text".
 *
 * ⚠️ **This must go through exactly the same fetch path as the agent.**
 *
 * The first version read plain text from `corpus/index.json` directly, and the joint-mapping claim was judged
 * "7, 9, 3, 17, 15 and left_knee all unsourced" — while those numbers are plainly on the page.
 *
 * The cause is that Lesson 21's `fetcher.ts` returns a **dynamically generated long document** for
 * `unitree.com/g1/developer` (that SDK migration guide), while index.json holds the short version.
 * **What the agent read and what the evaluation checked against were different,
 * so correct citations were judged hallucinated.**
 *
 * A bug in the evaluation itself, and the most dangerous kind: it sends you to "fix" something that is not broken.
 * The lesson: **the evaluation's sources must be the same sources the system actually saw**.
 */
function loadCorpus(): Map<string, string> {
	let pages: IndexedPage[];
	try {
		pages = JSON.parse(readFileSync(resolve(CORPUS, "index.json"), "utf8")) as IndexedPage[];
	} catch {
		throw new Error("找不到 Lesson 20 的語料。先產生：bun run lesson-20:corpus");
	}

	const corpus = new Map<string, string>();
	for (const page of pages) {
			// Through fetcher plus extractMain, exactly as Lesson 24's runQuery does
		const result = fetchPage(page.url);
		const text = result.ok
			? extractMain(result.html, { includeStructures: true }).text
			: "";
			// Pages that cannot be fetched (robots / 403 / a JS shell) fall back to the index's text,
			// because the agent at least sees the snippet
		corpus.set(page.url, `${page.title}\n${text || page.text}`);
	}
	return corpus;
}

export interface Scorecard {
	id: string;
		/** How many sentences have actual content */
	claims: number;
		/** Sentences with no citation at all */
	uncited: number;
		/** How many checkable atoms there are */
	atoms: number;
		/** Atoms supported by no source */
	unsupportedAtoms: number;
		/** How many cited sources support not one atom */
	grafted: number;
		/** Cited URLs absent from the corpus entirely */
	unknownSources: number;
}

function score(report: string, corpus: Map<string, string>): {
	card: Scorecard;
	verdicts: ClaimVerdict[];
} {
	const claims = parseReport(report);
	const verdicts = claims.map((c) => verifyClaim(c.text, c.sources, corpus));

	const card: Scorecard = {
		id: "",
		claims: claims.length,
			// A sentence with no atoms is usually a transition and must not count as a bare assertion.
			// Only "stated something concrete with no source" counts.
		uncited: claims.filter((c, i) => c.sources.length === 0 && (verdicts[i]?.atoms.length ?? 0) > 0)
			.length,
		atoms: verdicts.reduce((sum, v) => sum + v.atoms.length, 0),
		unsupportedAtoms: verdicts.reduce((sum, v) => sum + v.unsupportedAtoms.length, 0),
		grafted: verdicts.reduce((sum, v) => sum + v.graftedSources.length, 0),
		unknownSources: verdicts.reduce(
			(sum, v) => sum + v.sources.filter((s) => !s.known).length,
			0,
		),
	};

	return { card, verdicts };
}

// ─────────────────────────────────────────────────────────────

const corpus = loadCorpus();
const args = process.argv.slice(2);

if (args.includes("--show")) {
	const id = args[args.indexOf("--show") + 1] ?? "real";
	const fixture = FIXTURES.find((f) => f.id === id);
	if (!fixture) throw new Error(`找不到 ${id}。可用：${FIXTURES.map((f) => f.id).join(", ")}`);

	const { verdicts } = score(fixture.report, corpus);
	console.log(bold(`\n${fixture.label}\n`));

	for (const verdict of verdicts) {
		const problems = verdict.graftedSources.length + verdict.unsupportedAtoms.length;
		const mark = problems === 0 ? green("✓") : red("✗");
		console.log(`${mark} ${verdict.claim.slice(0, 76)}`);

		for (const source of verdict.sources) {
			const tag = !source.known
				? red("網址不在語料裡")
				: source.supported === 0
					? red("嫁接：這一頁沒有支持這句話的任何內容")
					: green(`支持 ${source.supported} 個原子`);
			console.log(dim(`    ${source.url.slice(0, 62)}  ${tag}`));
		}
		if (verdict.sources.length === 0 && verdict.atoms.length > 0) {
			console.log(dim(`    ${yellow("沒有引用")}`));
		}
		if (verdict.unsupportedAtoms.length > 0) {
			console.log(
				dim(`    ${yellow(`查無來源：${verdict.unsupportedAtoms.map((a) => a.raw).join(", ")}`)}`),
			);
		}
	}
	process.exit(0);
}

const cards: Scorecard[] = [];
let failures = 0;

console.log(dim("claims=有內容的句子  uncited=講了具體的事卻沒附來源"));
console.log(dim("grafted=引用了但完全不支持  unsupported=找不到任何來源的原子\n"));

for (const fixture of FIXTURES) {
	const { card } = score(fixture.report, corpus);
	card.id = fixture.id;
	cards.push(card);

	console.log(bold(fixture.label));
	if (fixture.injected) console.log(dim(`  埋的錯：${fixture.injected}`));
	console.log(
		`  claims ${card.claims}  uncited ${card.uncited}  atoms ${card.atoms}  ` +
			`unsupported ${card.unsupportedAtoms}  grafted ${card.grafted}  unknown ${card.unknownSources}`,
	);

		// Compare "what was planted" against "what the checker caught"
	const checks: Array<[string, number, number | undefined]> = [
		["grafted", card.grafted, fixture.expect.graftedAtLeast],
		["unsupported", card.unsupportedAtoms, fixture.expect.unsupportedAtomsAtLeast],
		["uncited", card.uncited, fixture.expect.uncitedAtLeast],
	];
	for (const [name, actual, expected] of checks) {
		if (expected === undefined) continue;
		if (actual >= expected) {
			console.log(`  ${green("✓")} ${name} ${actual} ≥ ${expected}`);
		} else {
			failures++;
			console.log(`  ${red("✗")} ${name} ${actual} < ${expected}  ${red("檢查器漏抓了")}`);
		}
	}
	console.log();
}

if (args.includes("--save")) {
	writeFileSync(BASELINE, `${JSON.stringify(cards, null, 2)}\n`, "utf8");
	console.log(dim(`基準已存到 ${BASELINE}`));
} else if (args.includes("--compare")) {
	let baseline: Scorecard[];
	try {
		baseline = JSON.parse(readFileSync(BASELINE, "utf8")) as Scorecard[];
	} catch {
		throw new Error("還沒有基準。先跑 bun run lesson-25 -- --save");
	}

	console.log(bold("跟基準比較"));
	let changed = 0;
	for (const card of cards) {
		const before = baseline.find((b) => b.id === card.id);
		if (!before) {
			console.log(`  ${yellow("+")} ${card.id} 是新的`);
			continue;
		}
		for (const key of ["claims", "uncited", "atoms", "unsupportedAtoms", "grafted"] as const) {
			if (before[key] !== card[key]) {
				changed++;
					// For these metrics, more is worse (except claims, which is only scale)
				const worse = key !== "claims" && card[key] > before[key];
				const arrow = `${before[key]} → ${card[key]}`;
				console.log(`  ${worse ? red("✗") : yellow("~")} ${card.id}.${key}  ${arrow}`);
			}
		}
	}
	if (changed === 0) console.log(`  ${green("✓")} 所有指標跟基準一致`);
}

if (failures > 0) {
	console.log(red(`\n${failures} 項沒通過：檢查器沒抓到我故意埋的錯。`));
	process.exit(1);
}
