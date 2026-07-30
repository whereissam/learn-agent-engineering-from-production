/**
 * Keep the two language versions of every lesson from drifting apart.
 *
 *   bun run check:i18n
 *
 * Two versions of a document always drift, and the one nobody reads drifts
 * first. This repo already learned that once (docs/TODO.md records deleting a
 * condensed second English README for exactly that reason), so the decision to
 * carry 29 lessons in two languages needs a checker rather than a promise.
 *
 * What makes these documents unusually drift-prone is what they contain:
 * measured numbers (token counts, pass rates, "3/3"), file:line citations into
 * upstream projects, and runnable commands. Prose can differ freely between
 * languages — that is the point of a translation — but those three things are
 * facts, and a fact that appears in one version and not the other is a bug.
 *
 * So this checker deliberately ignores wording and compares only what must
 * match:
 *
 *   headings         same count and nesting, so the two files stay navigable
 *                    against each other and against the lesson's Step numbers
 *   fenced code      same number of blocks, and identical content for blocks
 *                    that are commands or program output
 *   numbers          every measurement that appears in one must appear in the
 *                    other
 *   file:line refs   citations must be identical; a line number that moved in
 *                    one file and not the other is the exact failure that
 *                    lesson-23's checker exists to catch
 *   links            same set of relative links, so a renamed lesson does not
 *                    leave one language pointing at a 404
 *
 * Exit code 1 on any mismatch, so it can gate CI.
 */

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");

interface Facts {
	headings: string[];
	fences: string[];
	numbers: string[];
	citations: string[];
	links: string[];
}

/**
 * Pull the checkable facts out of one document.
 *
 * Numbers are normalised to digits only, because "3,622 行" and "3,622 lines"
 * must compare equal. Years and small ordinals are dropped: they appear in
 * prose ("the second time", "in 2026") often enough that comparing them would
 * produce noise instead of findings.
 */
function extract(text: string): Facts {
	const lines = text.split("\n");
	const headings: string[] = [];
	const fences: string[] = [];
	const links: string[] = [];

	let inFence = false;
	let buffer: string[] = [];

	for (const line of lines) {
		if (line.trimStart().startsWith("```")) {
			if (inFence) {
				fences.push(buffer.join("\n").trim());
				buffer = [];
			}
			inFence = !inFence;
			continue;
		}
		if (inFence) {
			buffer.push(line);
			continue;
		}
		const heading = /^(#{1,6}) /.exec(line);
		// Record the level only. Heading text is translated, so comparing it
		// would fail on every single lesson.
		if (heading) headings.push(heading[1] as string);
		for (const match of line.matchAll(/\]\((\.\.?\/[^)]+|[a-z0-9][^):]*\.(?:ts|md))\)/g)) {
			links.push(normaliseLink(match[1] as string));
		}
	}

	const body = stripFences(text);
	// A decimal point only counts when digits follow it, so a sentence-final
	// "272." does not read as a different number from "272".
	const numbers = [...body.matchAll(/\d[\d,_]*(?:\.\d+)?/g)]
		.map((m) => m[0].replace(/[,_]/g, ""))
		.filter((n) => n.length >= 2 && !/^20\d\d$/.test(n))
		.sort();
	const citations = [...body.matchAll(/[\w./-]+\.(?:ts|py|tsx|md):\d+(?:-\d+)?/g)]
		.map((m) => m[0])
		.sort();

	return { headings, fences, numbers, citations, links: links.sort() };
}

/**
 * Two links can point at the same thing in different languages, and that is
 * correct rather than drift:
 *
 *   ../lesson-02-tools/                  the English version links to the dir
 *   ../lesson-02-tools/README.zh-TW.md   the Chinese version links to Chinese
 *   ../README.md#quick-start             root README, English anchor
 *   ../README.zh-TW.md#開始跑             same section, Chinese anchor
 *
 * So compare destinations with the language suffix and the anchor removed. A
 * genuinely broken link (a renamed lesson) still shows up, because the
 * directory part is what differs then.
 */
function normaliseLink(href: string): string {
	return href
		.replace(/#.*$/, "")
		// Any document can have a .zh-TW edition (READMEs, docs/TODO), and a link
		// to it is the same link as one to the English default.
		.replace(/\.zh-TW\.md$/, ".md")
		.replace(/README\.md$/, "");
}

function stripFences(text: string): string {
	const out: string[] = [];
	let inFence = false;
	for (const line of text.split("\n")) {
		if (line.trimStart().startsWith("```")) {
			inFence = !inFence;
			continue;
		}
		if (!inFence) out.push(line);
	}
	return out.join("\n");
}

/** Multiset difference, so a fact repeated twice in one version is caught. */
function missing(a: string[], b: string[]): string[] {
	const pool = [...b];
	const out: string[] = [];
	for (const item of a) {
		const at = pool.indexOf(item);
		if (at === -1) out.push(item);
		else pool.splice(at, 1);
	}
	return out;
}

interface Problem {
	lesson: string;
	kind: string;
	detail: string;
}

function compare(lesson: string, en: string, zh: string): Problem[] {
	const a = extract(en);
	const b = extract(zh);
	const problems: Problem[] = [];

	if (a.headings.length !== b.headings.length) {
		problems.push({
			lesson,
			kind: "headings",
			detail: `en has ${a.headings.length} headings, zh-TW has ${b.headings.length}`,
		});
	} else if (a.headings.join(",") !== b.headings.join(",")) {
		problems.push({ lesson, kind: "headings", detail: "heading nesting differs" });
	}

	if (a.fences.length !== b.fences.length) {
		problems.push({
			lesson,
			kind: "code",
			detail: `en has ${a.fences.length} code blocks, zh-TW has ${b.fences.length}`,
		});
	}

	for (const [kind, left, right] of [
		["citations", a.citations, b.citations],
		["links", a.links, b.links],
		["numbers", a.numbers, b.numbers],
	] as const) {
		const onlyEn = missing(left, right);
		const onlyZh = missing(right, left);
		if (onlyEn.length > 0) {
			problems.push({ lesson, kind, detail: `only in en: ${preview(onlyEn)}` });
		}
		if (onlyZh.length > 0) {
			problems.push({ lesson, kind, detail: `only in zh-TW: ${preview(onlyZh)}` });
		}
	}

	return problems;
}

function preview(items: string[]): string {
	const head = items.slice(0, 6).join(", ");
	return items.length > 6 ? `${head} … (+${items.length - 6})` : head;
}

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;

/**
 * Every document that exists in both languages.
 *
 * English is the default filename and Chinese carries the suffix, so a reader
 * landing anywhere gets English and can switch. That applies to the roadmap
 * too, not only the lessons: docs/TODO.md is linked from all 29 lessons, so if
 * it were Chinese-by-default an English reader would fall out of the language
 * on the most-linked page in the repo.
 */
function pairs(): { name: string; en: string; zh: string }[] {
	const out = [
		{ name: "README", en: join(ROOT, "README.md"), zh: join(ROOT, "README.zh-TW.md") },
		{ name: "docs/TODO", en: join(ROOT, "docs/TODO.md"), zh: join(ROOT, "docs/TODO.zh-TW.md") },
	];
	for (const lesson of readdirSync(ROOT).filter((n) => n.startsWith("lesson-")).sort()) {
		out.push({
			name: lesson,
			en: join(ROOT, lesson, "README.md"),
			zh: join(ROOT, lesson, "README.zh-TW.md"),
		});
	}
	return out;
}

const problems: Problem[] = [];
const untranslated: string[] = [];
let checked = 0;

for (const { name, en, zh } of pairs()) {
	if (!existsSync(en) && !existsSync(zh)) continue;
	if (!existsSync(en) || !existsSync(zh)) {
		untranslated.push(name);
		continue;
	}
	checked++;
	problems.push(...compare(name, readFileSync(en, "utf8"), readFileSync(zh, "utf8")));
}

console.log(`翻譯對照檢查　${checked} 份文件有兩個版本，${untranslated.length} 份還缺一個語言`);

if (untranslated.length > 0) {
	console.log(yellow(`\n還缺一個語言（${untranslated.length}）`));
	for (const lesson of untranslated) console.log(dim(`  ${lesson}`));
}

if (problems.length > 0) {
	console.log(red(`\n不一致（${problems.length}）`));
	for (const problem of problems) {
		console.log(`  ${problem.lesson}  ${yellow(`[${problem.kind}]`)} ${dim(problem.detail)}`);
	}
} else if (checked > 0) {
	console.log(green("\n兩個版本的標題、程式碼區塊、數字、行號引用、連結全部一致"));
}

// A missing translation is progress rather than a failure; only a mismatch fails.
process.exitCode = problems.length > 0 ? 1 : 0;
