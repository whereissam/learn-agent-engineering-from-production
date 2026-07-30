/**
 * 這一課的 workspace，以及把它復原的方法。
 *
 * 為什麼內容寫在程式碼裡而不是只放檔案：**每個情境跑之前都要復原。**
 * 情境 4（改完又改回去）如果從上一個情境留下的狀態開始跑，
 * patch 就會混進別人的變更，那個實驗直接失效。
 *
 * 跟 `scripts/reset-playgrounds.ts` 同一個立場：復原腳本要處理的是
 * 「任何被改過的狀態」，不是「我預期的那一種修法」，所以一律強制寫回。
 */

import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export const WORKSPACE = resolve(import.meta.dirname, "workspace");

/** 影子 git 放在 workspace **外面**，理由見 `snapshot.ts` 的建構子。 */
export const GITDIR = resolve(import.meta.dirname, ".snapshots");

export const FIXTURE: Record<string, string> = {
	// ⚠️ 這個檔案是實測逼出來的，不是抄格式抄來的。
	//
	// 第一次用真 Gemini 跑 `MODE=auto` 的時候，模型自己決定要「跑一下測試」，
	// 而 workspace 沒有自己的 package.json → 往上找到主 repo →
	// **跑了本專案的 130 個測試**。這正是 Lesson 2 那個沙箱逃逸的第二次發生，
	// 而且這次是在一堂「量測 agent 到底改了什麼」的課裡。
	//
	// 權限引擎沒有錯：AUTO 模式下 EXEC 本來就放行。
	// 這是 Lesson 35 的題目（准許執行 ≠ 限制它碰得到什麼），
	// 在那之前，最小的止血是讓 workspace 有自己的邊界檔案。
	"package.json": `{
	"name": "evidence-workspace",
	"private": true,
	"type": "module",
	"description": "The project the agent works on. Having its own package.json stops \`npm test\` from walking up into the parent repo.",
	"scripts": {
		"test": "echo 'no tests here' && exit 0"
	}
}
`,

	"src/app.ts": `import { shorten } from "./util.ts";

// TODO: 這裡很亂，之後要整理
export function handle(input: string): string {
	if (input === "") {
		return "";
	}
	return shorten(input, 40);
}
`,

	"src/util.ts": `export function shorten(text: string, max: number): string {
	if (text.length <= max) return text;
	return text.slice(0, max) + "…";
}
`,

	"notes.md": `# 交接筆記

- \`handle()\` 的 early return 跟 \`shorten()\` 的長度檢查重複了
- 還沒有測試
`,
};

/** 把 workspace 強制寫回 FIXTURE，並刪掉 agent 多生出來的檔案。 */
export async function resetWorkspace(): Promise<void> {
	await rm(WORKSPACE, { recursive: true, force: true });
	for (const [path, content] of Object.entries(FIXTURE)) {
		const target = join(WORKSPACE, path);
		await mkdir(dirname(target), { recursive: true });
		await writeFile(target, content, "utf8");
	}
}

/** 目前 workspace 裡有哪些檔案（相對路徑，已排序）。只用來印表格。 */
export async function listWorkspace(): Promise<string[]> {
	const out: string[] = [];
	async function walk(dir: string, prefix: string): Promise<void> {
		for (const entry of await readdir(dir, { withFileTypes: true })) {
			const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
			if (entry.isDirectory()) await walk(join(dir, entry.name), rel);
			else out.push(rel);
		}
	}
	await walk(WORKSPACE, "");
	return out.sort();
}
