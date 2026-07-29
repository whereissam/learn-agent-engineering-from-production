/**
 * 把 playground 復原成「有 bug」的狀態。
 *
 *   bun run reset
 *
 * Lesson 2 之後的 agent 會真的改 playground 裡的檔案，所以每次示範完
 * 都要能復原。原本這是 package.json 裡一長串 sed，但那個做法有兩個問題：
 *
 *   1. 它只處理「agent 改了 store.ts 的 save」這一種修法。
 *      如果 agent 改的是 lookup（一樣正確），reset 就漏掉了。
 *   2. Lesson 5 的 playground 現在有第二個 bug（analytics.ts），
 *      一行 sed 塞不下。
 *
 * 所以改成把「該長什麼樣」寫清楚，然後強制寫回去。
 * **復原腳本要處理的是「任何被改過的狀態」，不是「我預期的那一種修法」。**
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");

interface Fixup {
	file: string;
	/** 任何一種寫法都會被換成 `buggy`。 */
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

/** 每一課都有的：短碼大小寫不一致。 */
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

/** 只有 Lesson 5 有的：分析用不同的 key。 */
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
