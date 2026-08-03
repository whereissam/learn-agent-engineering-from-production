/**
 * Verify that every line of source this lesson cites is still there.
 *
 * Why write this? Because **line numbers certainly go stale**. While comparing against Pi in earlier lessons
 * one was written wrongly (design principle 4 is what that left behind).
 *
 * Rather than a document that looks precise and no longer matches,
 * let the document check itself:
 *
 *   bun run lesson-23:check
 *
 * It looks for every citation in your local clones and reports three states:
 *
 *   ✓  the line number is right
 *   ~  the content is there and the line number drifted (it tells you the new one)
 *   ✗  gone (deleted or heavily rewritten upstream)
 *
 * The reference projects are not in version control (they are in `.git/info/exclude`), so somebody without clones
 * sees a list of clone commands rather than a pile of errors.
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

		// Look at the cited line first, then nearby, and only then search the whole file.
		// The "nearby" tolerance is deliberately small: drifting within 20 lines means the line number was not updated,
		// and drifting further usually means that code moved or was rewritten, which is worth looking at yourself.
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
	console.log(dim("This lesson reads real source, so clone the reference projects into the repo root first:\n"));
	for (const repo of missingRepos) {
		const info = REPOS[repo];
		console.log(`  git clone --depth 1 ${info.url} ${repo}    ${dim(`# I read ${info.commit}`)}`);
	}
	console.log(dim("\nThey are already in .git/info/exclude, so they will not be committed."));
	console.log(dim("(Not in .gitignore, because that file is for every reader; these are only your local reference copies)\n"));
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
			`${yellow("~")} ${result.citation.topic}\n  ${dim(where)} ${yellow(`→ actually on line ${result.actualLine}`)}`,
		);
	} else {
		missing++;
		console.log(
			`${red("✗")} ${result.citation.topic}\n  ${dim(where)} ${red(`could not find "${result.citation.contains}"`)}`,
		);
	}
}

if (results.some((r) => r.status !== "norepo")) {
	console.log();
	console.log(
		`${green(`${ok} correct`)}  ${drifted > 0 ? yellow(`${drifted} line numbers drifted`) : dim("0 drifted")}  ` +
			`${missing > 0 ? red(`${missing} not found`) : dim("0 missing")}`,
	);
	if (drifted > 0 || missing > 0) {
		console.log(dim("Drift or a miss means upstream changed. Go and see why; that is usually worth more than the original line."));
	}
}
