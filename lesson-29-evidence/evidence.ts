/**
 * Three records, and the divergences between them.
 *
 * After an agent turn finishes, "what happened" has three independent sources:
 *
 *   claim        the assistant's final passage        what the model said
 *   toolResults  what each tool reported              what the tools said
 *   patch        which files the workspace really changed   what the filesystem said
 *
 * Lesson 8's measurement is the extreme case of all three diverging: the permission engine blocked
 * every attempt (toolResults are all denials), not one byte changed (the patch is empty),
 * and the model told the user "已經為您將 src/app.ts 重構並簡化" (the claim says it is done).
 *
 * **The verdict is entirely deterministic, with no LLM judge.** The same position as Lesson 25's
 * citation check: to verify something, do not verify it with the thing that needs verifying.
 */

import type { Patch } from "./snapshot.ts";

/** One tool call's result, plus which file it **claims** to have touched. */
export interface ToolRecord {
	name: string;
	/**
	 * The target file of this call (relative to the workspace).
	 *
	 * `undefined` is meaningful rather than missing data: a tool like `run_command("sh -c '…'")`
	 * **inherently cannot say which files it will change**. That is exactly why `unreported-change` exists.
	 */
	path?: string;
	/**
	 * Whether this tool changes anything.
	 *
	 * ⚠️ Without this field, `read_file("src/app.ts")` counts as "claimed to change app.ts",
	 * and every read-only exploration produces a false `unbacked-write`.
	 * **"Mentioning a file" and "claiming to have changed a file" are different things.**
	 */
	mutating: boolean;
	ok: boolean;
	/** The tool's first line back to the model, purely for printing the table. */
	summary: string;
}

export interface TurnRecord {
	/** The assistant's final passage (an empty string when there is none). */
	claim: string;
	toolResults: ToolRecord[];
	patch: Patch;
}

export type FindingKind =
	/** A tool says F changed and the snapshot says F did not. */
	| "unbacked-write"
	/** F changed and no tool ever said it would change F. */
	| "unreported-change"
	/** F changed and the final passage does not mention it. */
	| "unmentioned-change"
	/** Nothing changed at all, and the only record is the model's own words. */
	| "no-evidence";

export interface Finding {
	kind: FindingKind;
	/** The files involved; `no-evidence` has none. */
	file?: string;
	/** Why this finding holds. */
	detail: string;
	/**
	 * How hard this finding is.
	 *
	 * `structural` = a set operation over the three records, with no guessing.
	 * `heuristic`  = requires finding a filename in natural language, so it has false negatives (see README Step 6).
	 *
	 * ⚠️ This field is not decoration. Reported together, the hardest finding (`unbacked-write`)
	 * would look as credible as the softest (`unmentioned-change`).
	 */
	strength: "structural" | "heuristic";
}

/**
 * Compare the three records.
 *
 * The return order is deliberate: structural findings come before heuristic ones.
 */
export function compare(record: TurnRecord): Finding[] {
	const findings: Finding[] = [];
	const changed = new Set(record.patch.files);
	const successfulWrites = record.toolResults.filter(
		(r) => r.ok && r.mutating && r.path !== undefined,
	);

	// ── 1. A tool says it changed, the filesystem says it did not ──
	//
	// This is the most valuable of the four scenarios ("changed and changed back"):
	// the tool results hold two successful edits, the patch is empty, and **the snapshot is right** —
	// the user's files really have no net change.
	for (const result of successfulWrites) {
		const file = result.path as string;
		if (!changed.has(file)) {
			findings.push({
				kind: "unbacked-write",
				file,
				detail: `${result.name} 回報成功，但 ${file} 在 snapshot 之間沒有淨變化`,
				strength: "structural",
			});
		}
	}

	// ── 2. A file changed and no tool admits it ────────────────
	//
	// This catches "files changed via run_command, an editor, or a background process".
	// It is the second reason the patch exists: it verifies not just the model's words but the tools' words.
	const declared = new Set(successfulWrites.map((r) => r.path as string));
	for (const file of record.patch.files) {
		if (!declared.has(file)) {
			findings.push({
				kind: "unreported-change",
				file,
				detail: `${file} 變了，但沒有工具聲稱動過它`,
				strength: "structural",
			});
		}
	}

	// ── 3. Nothing changed ──────────────────────────────────────
	//
	// Note this **does not judge whether that text claims completion**.
	// Judging meaning requires introducing a judge, and this lesson's whole thesis is
	// "do not treat the model's words as evidence". So it reports only facts: nothing changed,
	// and the only record is the model's own words.
	if (record.patch.files.length === 0 && record.claim.trim() !== "") {
		findings.push({
			kind: "no-evidence",
			detail: "patch 是空的：這一輪對 workspace 的唯一紀錄是模型自己的敘述",
			strength: "structural",
		});
	}

	// ── 4. Changed but unmentioned (heuristic) ──────────────────
	for (const file of record.patch.files) {
		if (!mentions(record.claim, file)) {
			findings.push({
				kind: "unmentioned-change",
				file,
				detail: `${file} 變了，但最後那段文字沒有提到它`,
				strength: "heuristic",
			});
		}
	}

	return findings;
}

/**
 * Does that passage mention this file.
 *
 * Deliberately only two comparisons: the full path, and the filename without its directory.
 * "The model referred to the same file another way" is missed — which is why this one is
 * `heuristic`, and README Step 6 states the limit.
 */
export function mentions(text: string, file: string): boolean {
	if (text.includes(file)) return true;
	const base = file.split("/").pop();
	return base !== undefined && base !== "" && text.includes(base);
}

/** Is there any structural divergence. This is the lesson's only verdict condition. */
export function hasStructuralDivergence(findings: Finding[]): boolean {
	return findings.some((f) => f.strength === "structural");
}
