/**
 * Check that every `file.ts:123` in a lesson points at a line that exists.
 *
 *   bun run check:citations
 *
 * ## Why this exists
 *
 * `check:i18n` compares the two language versions of each lesson and will fail
 * if a citation appears in one and not the other. That protects them from
 * drifting apart from *each other*. It cannot tell whether either one is right,
 * because the thing being cited lives in somebody else's repository.
 *
 * This repo has been wrong about its own citations more than once — the phase
 * type in Mastra's `tool-search.ts` was cited as `:13` for two months and is at
 * `:12` — and those were files sitting in this tree. The source projects for
 * Lessons 1-6, 8-10, 12 and 15-19 were not even cloned here until 2026-09-10,
 * so roughly a hundred line numbers had never been checked by anything.
 *
 * ## What it can and cannot prove
 *
 * It proves the weak half: the file exists and the line is inside it. A citation
 * that has slid by twenty lines and still lands inside the file passes here and
 * is still wrong, so a green run means "no citation is provably broken", never
 * "every citation is right".
 *
 * That is worth saying because the alternative — pinning the *content* of the
 * line — would fail on every upstream reformat and get deleted within a month.
 * The same reasoning as the contract tests: pin what must not change, measure
 * the rest.
 *
 * ## Source repositories are not vendored
 *
 * They are cloned locally and listed in `.git/info/exclude`, so a fresh checkout
 * has none of them. Missing repositories are reported as **skipped**, not failed,
 * and the exit code stays 0 — otherwise CI on a clean machine would be red for a
 * reason nobody can fix. Only a citation into a repository that *is* present can
 * fail the run.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");

/** Directories that hold somebody else's code, in the layout the lessons cite. */
const SOURCE_ROOTS = [
	"pi",
	"openworker",
	"hermes-agent",
	"mastra",
	"opencode",
	"openhands",
	"crawl4ai",
	"firecrawl",
	"gpt-researcher",
	"deep-research",
	"restate-ai-examples",
	"sandbox-runtime",
	"vllm",
	"fish-speech",
];

/**
 * This repo's own directories.
 *
 * Lessons cite themselves and each other — `shared/streaming/types.ts:44-51`,
 * `lesson-27-local-docs/ingest.ts:50` — and those citations go stale exactly the
 * same way. Leaving them out was the first version's blind spot: it reported
 * them as "no such file in any source repository", which was true and useless.
 */
const OWN_ROOTS = ["shared", "scripts", "tests"];

const CODE_EXTENSIONS = /\.(ts|tsx|py|md)$/;
const SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", ".venv", "__pycache__", ".next", "target"]);

/** A citation as it appears in prose: `path/to/file.ts:123` or `:120-140`. */
const CITATION = /([A-Za-z0-9_][A-Za-z0-9_./-]*\.(?:ts|tsx|py|md)):(\d+)(?:-(\d+))?/g;

interface Finding {
	document: string;
	citation: string;
	problem: string;
}

/** Every code file under a source root, indexed by its path relative to that root. */
function indexFiles(root: string): string[] {
	const found: string[] = [];
	const walk = (dir: string, relative: string) => {
		let entries: string[];
		try {
			entries = readdirSync(dir);
		} catch {
			return;
		}
		for (const entry of entries) {
			if (SKIP_DIRS.has(entry)) continue;
			const full = join(dir, entry);
			const rel = relative ? `${relative}/${entry}` : entry;
			let stats: ReturnType<typeof statSync>;
			try {
				stats = statSync(full);
			} catch {
				continue;
			}
			if (stats.isDirectory()) walk(full, rel);
			else if (CODE_EXTENSIONS.test(entry)) found.push(rel);
		}
	};
	walk(join(ROOT, root), "");
	return found;
}

const present: string[] = [];
const missing: string[] = [];
for (const root of SOURCE_ROOTS) {
	(existsSync(join(ROOT, root)) ? present : missing).push(root);
}

/** `<root>/<relative path>` for every indexed file, plus the index itself. */
const index = new Map<string, string[]>();
for (const root of present) index.set(root, indexFiles(root));

// This repo's own files, indexed under the same scheme so a self-citation is
// checked as strictly as a citation into somebody else's code.
for (const root of OWN_ROOTS) {
	if (existsSync(join(ROOT, root))) index.set(root, indexFiles(root));
}
for (const entry of readdirSync(ROOT)) {
	if (entry.startsWith("lesson-") && statSync(join(ROOT, entry)).isDirectory()) {
		index.set(entry, indexFiles(entry));
	}
}

const lineCounts = new Map<string, number>();
function lineCount(absolute: string): number {
	const cached = lineCounts.get(absolute);
	if (cached !== undefined) return cached;
	const count = readFileSync(absolute, "utf8").split("\n").length;
	lineCounts.set(absolute, count);
	return count;
}

/**
 * Find the file a citation refers to.
 *
 * The lessons are inconsistent about prefixes — `openworker/coworker/risk.py`
 * names its repo, `packages/agent/src/agent-loop.ts` does not, and
 * `agent-loop.ts` is just a filename — so a citation is matched as a **path
 * suffix** against the index. An unambiguous single match resolves; several
 * matches are reported rather than guessed at, because guessing is how a
 * checker starts confirming the wrong file.
 */
function resolveCitation(
	path: string,
	scope?: Set<string>,
): { absolute: string; display: string } | "ambiguous" | undefined {
	const matches: Array<{ absolute: string; display: string }> = [];
	for (const [root, files] of index) {
		if (scope && !scope.has(root)) continue;
		const stripped = path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
		for (const file of files) {
			if (file === stripped || file.endsWith(`/${stripped}`)) {
				matches.push({ absolute: join(ROOT, root, file), display: `${root}/${file}` });
			}
		}
	}
	if (matches.length === 1) return matches[0];
	if (matches.length > 1) return "ambiguous";
	return undefined;
}

/**
 * Which source repositories a document actually talks about.
 *
 * `types.ts:113` matches a hundred files across fourteen repositories and would
 * otherwise be skipped forever — and a bare filename is exactly the kind of
 * citation most likely to be stale. But every lesson names its source in its own
 * header, so an ambiguous citation is retried against only the repositories the
 * document mentions. That is narrowing by evidence rather than guessing: if the
 * document names two repositories and both match, it stays ambiguous.
 *
 * This repo's own roots are **always** in scope. A lesson citing its own code
 * writes `engine.ts:173` without saying "shared" anywhere, and the first version
 * of this narrowing therefore reported Lesson 35's citation as broken. It was
 * right: line 173 of `shared/permissions/engine.ts` is the `WRITE_LOCAL` check
 * the lesson describes. A checker confident enough to accuse needs the same
 * verification as the thing it is checking.
 */
function scopeFor(text: string): Set<string> {
	const scope = new Set<string>();
	for (const root of index.keys()) {
		if (!SOURCE_ROOTS.includes(root) || text.includes(root)) scope.add(root);
	}
	return scope;
}

/** Documents that carry citations: every lesson README, plus the roadmap. */
function documents(): string[] {
	const found: string[] = [];
	for (const entry of readdirSync(ROOT)) {
		if (!entry.startsWith("lesson-")) continue;
		for (const name of ["README.md", "README.zh-TW.md"]) {
			const path = join(ROOT, entry, name);
			if (existsSync(path)) found.push(path);
		}
	}
	for (const name of ["docs/TODO.md", "docs/TODO.zh-TW.md"]) {
		const path = join(ROOT, name);
		if (existsSync(path)) found.push(path);
	}
	return found;
}

const findings: Finding[] = [];
let checked = 0;
let skipped = 0;

for (const document of documents()) {
	const text = readFileSync(document, "utf8");
	const relative = document.slice(ROOT.length + 1);
	const scope = scopeFor(text);

	for (const match of text.matchAll(CITATION)) {
		const [whole, path = "", startText = "0", endText] = match;
		const start = Number(startText);
		const end = endText ? Number(endText) : start;

		// A citation into a repo that is not cloned is not a failure — it is
		// unknowable. Reporting it as one would make a clean checkout red.
		const namedRoot = SOURCE_ROOTS.find((root) => path.startsWith(`${root}/`));
		if (namedRoot && missing.includes(namedRoot)) {
			skipped++;
			continue;
		}

		let resolved = resolveCitation(path);
		// Retry inside the repositories this document actually names.
		if (resolved === "ambiguous" && scope.size > 0) resolved = resolveCitation(path, scope);
		if (resolved === undefined) {
			// Unprefixed paths may belong to a repo nobody cloned. Only complain when
			// every source repository is present and it still cannot be found.
			if (missing.length > 0) {
				skipped++;
				continue;
			}
			findings.push({ document: relative, citation: whole, problem: "no such file in any source repository" });
			continue;
		}
		if (resolved === "ambiguous") {
			skipped++;
			continue;
		}

		checked++;
		const total = lineCount(resolved.absolute);
		if (end > total) {
			findings.push({
				document: relative,
				citation: whole,
				problem: `${resolved.display} has ${total} lines`,
			});
		}
	}
}

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;

console.log(
	`citation check  ${checked} citations resolved across ${present.length} source repositories` +
		(skipped > 0 ? dim(`, ${skipped} skipped`) : ""),
);
if (missing.length > 0) {
	console.log(yellow(`  not cloned, so their citations cannot be checked: ${missing.join(", ")}`));
}

if (findings.length === 0) {
	console.log(green("\nevery resolvable citation points at a line that exists"));
	console.log(
		dim("(which is the weak half: a citation that slid ten lines and stayed inside the file still passes)"),
	);
} else {
	console.log(red(`\nbroken citations (${findings.length})`));
	for (const finding of findings) {
		console.log(`  ${finding.document}  ${yellow(finding.citation)}  ${dim(finding.problem)}`);
	}
	process.exit(1);
}
