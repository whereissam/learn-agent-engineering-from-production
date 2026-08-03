/**
 * This lesson's workspace, and how to restore it.
 *
 * Why the contents live in code rather than only as files: **every scenario restores before running.**
 * If scenario 4 (changed and changed back) started from the state the previous scenario left,
 * the patch would include somebody else's changes and that experiment would be void.
 *
 * The same position as `scripts/reset-playgrounds.ts`: a restore script has to handle
 * **any modified state**, not "the fix I expected", so it always force-writes.
 */

import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export const WORKSPACE = resolve(import.meta.dirname, "workspace");

/** The shadow git lives **outside** the workspace; the reason is in `snapshot.ts`'s constructor. */
export const GITDIR = resolve(import.meta.dirname, ".snapshots");

export const FIXTURE: Record<string, string> = {
	// ⚠️ This file was forced out by measurement, not copied from a template.
	//
	// On the first real-Gemini `MODE=auto` run, the model decided by itself to "run the tests",
	// and the workspace had no package.json of its own → npm walked up to the main repo →
	// **it ran this project's 130 tests**. The second occurrence of Lesson 2's sandbox escape,
	// this time inside a lesson about measuring what the agent actually changed.
	//
	// The permission engine did nothing wrong: EXEC is allowed in AUTO mode.
	// This is Lesson 35's subject (permitting execution ≠ limiting what it can reach),
	// and until then the smallest way to stop the bleeding is giving the workspace its own boundary file.
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

	// TODO: this is messy and needs tidying later
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

	"notes.md": `# Handover notes

- the early return in \`handle()\` duplicates the length check in \`shorten()\`
- no tests yet
`,
};

/** Force the workspace back to FIXTURE and delete extra files the agent created. */
export async function resetWorkspace(): Promise<void> {
	await rm(WORKSPACE, { recursive: true, force: true });
	for (const [path, content] of Object.entries(FIXTURE)) {
		const target = join(WORKSPACE, path);
		await mkdir(dirname(target), { recursive: true });
		await writeFile(target, content, "utf8");
	}
}

/** Which files are currently in the workspace (relative paths, sorted). Only used for printing the table. */
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
