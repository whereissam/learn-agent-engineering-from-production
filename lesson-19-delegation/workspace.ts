/**
 * Three services' error logs, and their ground truth.
 *
 * This corpus was designed to measure **information loss**, so it has one deliberate device:
 *
 *   the most frequent error code in inventory.log is E-118,
 *   and the file header says "an older numbering scheme was used before 2026-07-14".
 *
 * An agent that can see the original text has a chance to state that;
 * an agent that only receives a subagent's summary knows it **only if the subagent chose to write it in**.
 * That is the concrete shape of delegation's information boundary.
 *
 * Every verdict is an `includes()`, with no LLM judge (the same position as Lessons 25 and 29).
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export const WORKSPACE = resolve(import.meta.dirname, "workspace");

/** Each service's most frequent error code — what has to be answered correctly. */
export const GROUND_TRUTH = {
	checkout: "E-402",
	inventory: "E-118",
	notify: "E-511",
} as const;

/**
 * The strings that decide "was the caveat mentioned".
 *
 * Deliberately broad (any one match counts), because what this question measures is **whether the information crossed the boundary**,
 * not the wording. Too narrow would misjudge "said it correctly in other words" as lost —
 * exactly the kind of false negative Lesson 16 hit.
 */
export const CAVEAT_MARKERS = ["2026-07-14", "renumber", "renumbered", "migration", "migrated", "old code"];

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

	// Stop `npm test` climbing into the main repo (Lesson 2's escape, hit again in Lesson 29).
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

/** Does the answer contain the three correct error codes. */
export function scoreCodes(answer: string): { hit: string[]; missed: string[] } {
	const hit: string[] = [];
	const missed: string[] = [];
	for (const [service, code] of Object.entries(GROUND_TRUTH)) {
		(answer.includes(code) ? hit : missed).push(`${service}:${code}`);
	}
	return { hit, missed };
}

/** Does the answer mention the caveat. */
export function mentionsCaveat(answer: string): boolean {
	return CAVEAT_MARKERS.some((marker) => answer.toLowerCase().includes(marker.toLowerCase()));
}
