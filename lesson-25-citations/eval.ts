/**
 * 引用評估執行器。
 *
 *   bun run lesson-25                    跑四份報告
 *   bun run lesson-25 -- --show real     看某一份的逐條判定
 *   bun run lesson-25 -- --save          存成基準
 *   bun run lesson-25 -- --compare       跟基準比，看有沒有退步
 *
 * `--save` / `--compare` 直接沿用 Lesson 7 的形狀。**沒有回歸比較的評估
 * 只能告訴你「現在幾分」，不能告訴你「剛才那個改動有沒有弄壞東西」**，
 * 而後者才是評估真正的用途（Lesson 22 Step 5 就是靠它抓到崩塌的）。
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
 * 建立「網址 → 來源正文」。
 *
 * ⚠️ **這裡一定要走跟 agent 完全相同的抓取路徑。**
 *
 * 第一版我直接讀 `corpus/index.json` 的純文字，結果關節映射那條被判成
 * 「7、9、3、17、15、left_knee 全部查無來源」——但那些數字明明在頁面上。
 *
 * 原因是 Lesson 21 的 `fetcher.ts` 對 `unitree.com/g1/developer` 這個網址
 * 會回一份**動態產生的長文件**（那份 SDK 遷移指南），而 index.json 裡存的
 * 是短版。**agent 讀到的東西和我拿來對答案的東西不一樣，
 * 於是正確的引用被判成幻覺。**
 *
 * 這是評估自己的 bug，而且是最危險的那種：它會讓你去「修」一個沒壞的東西。
 * 教訓：**評估的來源必須跟系統實際看到的來源是同一份**。
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
		// 走 fetcher + extractMain，跟 Lesson 24 的 runQuery 一模一樣
		const result = fetchPage(page.url);
		const text = result.ok
			? extractMain(result.html, { includeStructures: true }).text
			: "";
		// 抓不到的頁面（robots / 403 / JS 空殼）退回索引裡的文字，
		// 因為 agent 至少看得到 snippet
		corpus.set(page.url, `${page.title}\n${text || page.text}`);
	}
	return corpus;
}

export interface Scorecard {
	id: string;
	/** 有實際內容的句子總數 */
	claims: number;
	/** 完全沒有附引用的句子 */
	uncited: number;
	/** 可查核的原子總數 */
	atoms: number;
	/** 沒有任何來源支持的原子 */
	unsupportedAtoms: number;
	/** 被引用、但一個原子都不支持的來源次數 */
	grafted: number;
	/** 引用了語料裡根本沒有的網址 */
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
		// 「沒有原子的句子」通常是過渡句，不該被算成裸露斷言。
		// 只有「講了具體的事卻沒附來源」才算。
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

	// 對照「我埋了什麼」和「檢查器抓到什麼」
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
				// 對這些指標來說「變多」就是變差（claims 除外，它只是規模）
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
