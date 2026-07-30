/**
 * 三個服務的錯誤日誌，以及它們的標準答案。
 *
 * 這份語料是為了量**資訊遺失**設計的，所以有一個刻意的機關：
 *
 *   inventory.log 最常出現的錯誤碼是 E-118，
 *   但檔頭寫著「2026-07-14 之前用的是舊的編號方案」。
 *
 * 一個看得到原文的 agent 有機會講出這件事；
 * 一個只拿得到子 agent 摘要的 agent，**只有在子 agent 決定把它寫進摘要時**
 * 才知道。這就是委派那條資訊邊界的具體形狀。
 *
 * 判定全部是 `includes()`，沒有 LLM 裁判（跟 Lesson 25、29 同一個立場）。
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export const WORKSPACE = resolve(import.meta.dirname, "workspace");

/** 每個服務最常出現的錯誤碼 —— 這是要答對的東西。 */
export const GROUND_TRUTH = {
	checkout: "E-402",
	inventory: "E-118",
	notify: "E-511",
} as const;

/**
 * 「有沒有提到那個但書」的判定字串。
 *
 * 刻意收得寬（任何一個命中就算），因為這一題要量的是**資訊有沒有跨過邊界**，
 * 不是措辭。收太窄會把「講對了但用別的說法」誤判成遺失 ——
 * 那正是 Lesson 16 那種假陰性。
 */
export const CAVEAT_MARKERS = ["2026-07-14", "renumber", "編號", "改號", "遷移", "migration", "舊"];

function logLines(entries: [string, number][], start: string): string[] {
	const lines: string[] = [];
	let minute = 0;
	for (const [code, count] of entries) {
		for (let i = 0; i < count; i++) {
			const stamp = `${start}T${String(3 + Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}:00Z`;
			lines.push(`${stamp} ERROR ${code} request_id=req_${1000 + minute} retries=${i % 3}`);
			minute += 7;
		}
	}
	return lines;
}

export const FIXTURE: Record<string, string> = {
	"logs/checkout.log": [
		"# checkout service - error log (rotated daily)",
		...logLines(
			[
				["E-402", 7],
				["E-500", 3],
				["E-301", 2],
			],
			"2026-07-28",
		),
	].join("\n"),

	"logs/inventory.log": [
		"# inventory service - error log (rotated daily)",
		"# NOTE: entries before 2026-07-14 use the OLD error-code scheme (E-1xx).",
		"# Codes were renumbered after the July migration; E-118 is now reported as E-204.",
		...logLines(
			[
				["E-118", 9],
				["E-204", 3],
				["E-118", 2],
			],
			"2026-07-11",
		),
	].join("\n"),

	"logs/notify.log": [
		"# notify service - error log (rotated daily)",
		...logLines(
			[
				["E-511", 5],
				["E-402", 2],
				["E-118", 1],
			],
			"2026-07-28",
		),
	].join("\n"),

	// 讓 `npm test` 不會爬到主 repo（Lesson 2 的逃逸，Lesson 29 又踩了一次）。
	"package.json": `{
	"name": "delegation-workspace",
	"private": true,
	"type": "module",
	"scripts": { "test": "echo 'no tests here' && exit 0" }
}
`,
};

export async function resetWorkspace(): Promise<void> {
	await rm(WORKSPACE, { recursive: true, force: true });
	for (const [path, content] of Object.entries(FIXTURE)) {
		const target = join(WORKSPACE, path);
		await mkdir(dirname(target), { recursive: true });
		await writeFile(target, content, "utf8");
	}
}

/** 答案裡有沒有三個正確的錯誤碼。 */
export function scoreCodes(answer: string): { hit: string[]; missed: string[] } {
	const hit: string[] = [];
	const missed: string[] = [];
	for (const [service, code] of Object.entries(GROUND_TRUTH)) {
		(answer.includes(code) ? hit : missed).push(`${service}:${code}`);
	}
	return { hit, missed };
}

/** 答案裡有沒有提到那個但書。 */
export function mentionsCaveat(answer: string): boolean {
	return CAVEAT_MARKERS.some((marker) => answer.toLowerCase().includes(marker.toLowerCase()));
}
