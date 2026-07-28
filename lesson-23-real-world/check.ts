/**
 * 驗證這一課引用的每一行原始碼還在不在。
 *
 * 為什麼要寫這個？因為**行號一定會過期**。前面幾課對照 Pi 的時候，
 * 我就寫錯過一次（設計原則 4 那條就是那次留下的）。
 *
 * 與其寫一份「看起來很精確、其實已經對不上」的文件，
 * 不如讓文件自己可以被檢查：
 *
 *   bun run lesson-23:check
 *
 * 它會去你本機的 clone 找每一條引用，回報三種狀態：
 *
 *   ✓  行號正確
 *   ~  內容還在，但行號漂了（會告訴你新行號）
 *   ✗  找不到了（上游刪掉或大改）
 *
 * 參考專案不進版控（在 `.git/info/exclude` 裡），所以沒 clone 的人
 * 會看到一份 clone 指令，而不是一堆錯誤。
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CITATIONS, type Citation } from "./citations.ts";

const ROOT = resolve(import.meta.dirname, "..");

const REPOS: Record<Citation["repo"], { url: string; commit: string }> = {
	"deep-research": { url: "https://github.com/dzhng/deep-research", commit: "1f8f3e2" },
	"gpt-researcher": { url: "https://github.com/assafelovic/gpt-researcher", commit: "5d84d2f5" },
	firecrawl: { url: "https://github.com/firecrawl/firecrawl", commit: "ab033afd9" },
	crawl4ai: { url: "https://github.com/unclecode/crawl4ai", commit: "7e80152" },
};

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;

type Status = "ok" | "drifted" | "missing" | "norepo";

function check(citation: Citation): { status: Status; actualLine?: number } {
	const file = resolve(ROOT, citation.repo, citation.path);
	if (!existsSync(resolve(ROOT, citation.repo))) return { status: "norepo" };
	if (!existsSync(file)) return { status: "missing" };

	const lines = readFileSync(file, "utf8").split("\n");

	// 先看引用的那一行，不對再看附近，都不對就全檔搜。
	// 「附近」的容忍範圍刻意設小：漂 20 行以內算行號沒更新，
	// 漂更多通常代表那段程式碼被搬走或重寫了，值得你自己去看一眼。
	const target = lines[citation.line - 1] ?? "";
	if (target.includes(citation.contains)) return { status: "ok" };

	for (let offset = 1; offset <= 20; offset++) {
		for (const index of [citation.line - 1 + offset, citation.line - 1 - offset]) {
			if (lines[index]?.includes(citation.contains)) {
				return { status: "drifted", actualLine: index + 1 };
			}
		}
	}

	const found = lines.findIndex((line) => line.includes(citation.contains));
	if (found >= 0) return { status: "drifted", actualLine: found + 1 };

	return { status: "missing" };
}

const results = CITATIONS.map((citation) => ({ citation, ...check(citation) }));

const missingRepos = [...new Set(results.filter((r) => r.status === "norepo").map((r) => r.citation.repo))];

if (missingRepos.length > 0) {
	console.log(dim("這一課要對照真實原始碼，先把參考專案 clone 到 repo 根目錄：\n"));
	for (const repo of missingRepos) {
		const info = REPOS[repo];
		console.log(`  git clone --depth 1 ${info.url} ${repo}    ${dim(`# 我讀的是 ${info.commit}`)}`);
	}
	console.log(dim("\n它們已經在 .git/info/exclude 裡，不會進版控。"));
	console.log(dim("（沒有寫進 .gitignore，因為那是給所有讀者的，這幾份只是你本機的參考資料）\n"));
}

let ok = 0;
let drifted = 0;
let missing = 0;
let currentTopic = "";

for (const result of results) {
	if (result.status === "norepo") continue;

	const prefix = result.citation.topic.slice(0, 3);
	if (prefix !== currentTopic) {
		currentTopic = prefix;
		console.log();
	}

	const where = `${result.citation.repo}/${result.citation.path}:${result.citation.line}`;

	if (result.status === "ok") {
		ok++;
		console.log(`${green("✓")} ${result.citation.topic}\n  ${dim(where)}`);
	} else if (result.status === "drifted") {
		drifted++;
		console.log(
			`${yellow("~")} ${result.citation.topic}\n  ${dim(where)} ${yellow(`→ 實際在第 ${result.actualLine} 行`)}`,
		);
	} else {
		missing++;
		console.log(
			`${red("✗")} ${result.citation.topic}\n  ${dim(where)} ${red(`找不到 "${result.citation.contains}"`)}`,
		);
	}
}

if (results.some((r) => r.status !== "norepo")) {
	console.log();
	console.log(
		`${green(`${ok} 條正確`)}  ${drifted > 0 ? yellow(`${drifted} 條行號漂了`) : dim("0 條漂移")}  ` +
			`${missing > 0 ? red(`${missing} 條找不到`) : dim("0 條遺失")}`,
	);
	if (drifted > 0 || missing > 0) {
		console.log(dim("漂移或遺失代表上游改過。去看一眼他們為什麼改，那通常比原本那行更有價值。"));
	}
}
