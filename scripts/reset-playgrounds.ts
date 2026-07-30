/**
 * Restore the playgrounds to their buggy state.
 *
 *   bun run reset
 *
 * From Lesson 2 on, the agent really edits files in the playground, so every demonstration
 * has to be restorable. This used to be a long chain of sed in package.json, and that had two problems:
 *
 *   1. It only handled one fix: "the agent changed store.ts's save".
 *      If the agent changed lookup instead (equally correct), reset missed it.
 *   2. Lesson 5's playground now has a second bug (analytics.ts),
 *      which does not fit in one line of sed.
 *
 * So it changed to stating what things should look like and force-writing them back.
 * **A restore script has to handle any modified state, not "the fix I expected".**
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");

interface Fixup {
	file: string;
	/** Any spelling of it is replaced by `buggy`. */
	patterns: RegExp[];
	buggy: string;
	what: string;
}

const LESSONS = [
	"lesson-02-tools",
	"lesson-03-streaming",
	"lesson-04-sessions",
	"lesson-05-compaction",
	"lesson-10-agent-server",
];

/** Present in every lesson: inconsistent case in the short code. */
const STORE_FIXUPS: Fixup[] = [
	{
		file: "src/store.ts",
		patterns: [/entries\.set\(code(?:\.toLowerCase\(\))?, url\);/],
		buggy: "entries.set(code, url);",
		what: "save 存原始大小寫",
	},
	{
		file: "src/store.ts",
		patterns: [/return entries\.get\(code(?:\.toLowerCase\(\))?\);/],
		buggy: "return entries.get(code.toLowerCase());",
		what: "lookup 轉小寫（不一致就在這）",
	},
];

/** Only in Lesson 5: analytics uses a different key. */
const ANALYTICS_FIXUPS: Fixup[] = [
	{
		file: "src/analytics.ts",
		patterns: [/clicks\.push\(\{ code(?:: code\.toLowerCase\(\))?, at: Date\.now\(\), referer, userAgent \}\);/],
		buggy: "clicks.push({ code, at: Date.now(), referer, userAgent });",
		what: "record 存原始大小寫",
	},
	{
		file: "src/analytics.ts",
		patterns: [/const key = code(?:\.toLowerCase\(\))?;/],
		buggy: "const key = code.toLowerCase();",
		what: "statsFor 轉小寫（第二個不一致）",
	},
];

let changed = 0;

for (const lesson of LESSONS) {
	const fixups = lesson === "lesson-05-compaction"
		? [...STORE_FIXUPS, ...ANALYTICS_FIXUPS]
		: STORE_FIXUPS;

	for (const fixup of fixups) {
		const path = resolve(ROOT, lesson, "playground", fixup.file);
		if (!existsSync(path)) continue;

		const before = readFileSync(path, "utf8");
		let after = before;
		for (const pattern of fixup.patterns) {
			after = after.replace(pattern, fixup.buggy);
		}

		if (after !== before) {
			writeFileSync(path, after, "utf8");
			console.log(`  ${lesson}/${fixup.file}  ← ${fixup.what}`);
			changed++;
		}
	}
}

console.log(changed === 0 ? "playground 已經是原始（有 bug）的狀態" : `已復原 ${changed} 處`);
