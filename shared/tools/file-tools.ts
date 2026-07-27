/**
 * 檔案工具：read / write / edit / list
 *
 * 每個工具都是一個 Tool 物件：spec（給模型看）+ execute（真正做事）。
 *
 * 對照 Pi：packages/agent/src/harness/tools/{read,write,edit}.ts
 */

import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { relativeToRoot, resolveInRoot } from "./paths.ts";
import type { Tool } from "./registry.ts";
import { formatBytes, MAX_LINES, truncateHead } from "./truncate.ts";

// ─────────────────────────────────────────────────────────────
// read_file
// ─────────────────────────────────────────────────────────────

export const readFileTool: Tool = {
	name: "read_file",
	mutating: false,
	description:
		"Read a text file from the project. Output is truncated to " +
		`${MAX_LINES} lines; use the offset parameter to continue reading a large file. ` +
		"Always read a file before editing it.",
	parameters: {
		type: "object",
		properties: {
			path: { type: "string", description: "File path relative to the project root" },
			offset: {
				type: "number",
				description: "1-indexed line to start reading from. Omit to start at the beginning.",
			},
		},
		required: ["path"],
	},

	async execute(args, ctx) {
		const target = resolveInRoot(ctx.root, args.path);
		const raw = await readFile(target, "utf8");

		const offset = typeof args.offset === "number" ? Math.max(1, args.offset) : 1;
		const lines = raw.split("\n");

		if (offset > lines.length) {
			throw new Error(`offset ${offset} is past the end of the file (${lines.length} lines)`);
		}

		const selected = lines.slice(offset - 1).join("\n");
		const { text, info } = truncateHead(selected);

		// 加上行號。模型要靠這個決定 edit 的位置，也方便它跟你溝通「第幾行有問題」。
		const numbered = text
			.split("\n")
			.map((line, i) => `${String(offset + i).padStart(5)}\t${line}`)
			.join("\n");

		const header = info.truncated
			? `${relativeToRoot(ctx.root, target)} (${info.originalLines} lines, ${formatBytes(info.originalBytes)})\n`
			: "";

		return header + numbered;
	},
};

// ─────────────────────────────────────────────────────────────
// write_file
// ─────────────────────────────────────────────────────────────

export const writeFileTool: Tool = {
	name: "write_file",
	mutating: true, // ← 會改變外部狀態，registry 會先問使用者
	description:
		"Create a new file, or completely overwrite an existing one. " +
		"To change part of an existing file, prefer edit_file - it is safer and cheaper.",
	parameters: {
		type: "object",
		properties: {
			path: { type: "string", description: "File path relative to the project root" },
			content: { type: "string", description: "The complete file contents to write" },
		},
		required: ["path", "content"],
	},

	async execute(args, ctx) {
		const target = resolveInRoot(ctx.root, args.path);

		if (typeof args.content !== "string") {
			throw new Error("content must be a string");
		}

		await mkdir(dirname(target), { recursive: true });
		await writeFile(target, args.content, "utf8");

		const lines = args.content.split("\n").length;
		return `Wrote ${relativeToRoot(ctx.root, target)} (${lines} lines, ${formatBytes(Buffer.byteLength(args.content))})`;
	},
};

// ─────────────────────────────────────────────────────────────
// edit_file
// ─────────────────────────────────────────────────────────────

export const editFileTool: Tool = {
	name: "edit_file",
	mutating: true,
	description:
		"Replace an exact string in a file with another string. " +
		"old_string must appear EXACTLY ONCE in the file - include enough surrounding " +
		"context to make it unique. Read the file first so you know the exact text.",
	parameters: {
		type: "object",
		properties: {
			path: { type: "string", description: "File path relative to the project root" },
			old_string: {
				type: "string",
				description: "Exact text to find. Must match the file byte-for-byte, including indentation.",
			},
			new_string: { type: "string", description: "Text to replace it with" },
		},
		required: ["path", "old_string", "new_string"],
	},

	async execute(args, ctx) {
		const target = resolveInRoot(ctx.root, args.path);
		const { old_string: oldString, new_string: newString } = args;

		if (typeof oldString !== "string" || typeof newString !== "string") {
			throw new Error("old_string and new_string must both be strings");
		}
		if (oldString === newString) {
			throw new Error("old_string and new_string are identical - nothing to do");
		}

		const original = await readFile(target, "utf8");

		// 這個檢查是 edit 工具的靈魂。
		//
		// 0 次 → 模型記錯了或猜的，讓它重讀檔案
		// 2 次以上 → 有歧義，改了會動到不該動的地方
		//
		// 兩種情況都要「拒絕執行 + 講清楚為什麼」，而不是硬改。
		const count = countOccurrences(original, oldString);

		if (count === 0) {
			throw new Error(
				`old_string was not found in ${relativeToRoot(ctx.root, target)}. ` +
					"Read the file again and copy the exact text, including whitespace and indentation.",
			);
		}
		if (count > 1) {
			throw new Error(
				`old_string appears ${count} times in ${relativeToRoot(ctx.root, target)}. ` +
					"It must be unique - add more surrounding lines to disambiguate.",
			);
		}

		const updated = original.replace(oldString, newString);
		await writeFile(target, updated, "utf8");

		return `Edited ${relativeToRoot(ctx.root, target)}\n${renderDiff(oldString, newString)}`;
	},
};

function countOccurrences(haystack: string, needle: string): number {
	let count = 0;
	let index = haystack.indexOf(needle);
	while (index !== -1) {
		count++;
		index = haystack.indexOf(needle, index + needle.length);
	}
	return count;
}

/** 給模型看的極簡 diff，讓它確認改動符合預期。 */
function renderDiff(before: string, after: string): string {
	const minus = before.split("\n").map((l) => `- ${l}`);
	const plus = after.split("\n").map((l) => `+ ${l}`);
	return [...minus, ...plus].join("\n");
}

// ─────────────────────────────────────────────────────────────
// list_files
// ─────────────────────────────────────────────────────────────

const IGNORED = new Set(["node_modules", ".git", "dist", "build", ".next", "coverage"]);

export const listFilesTool: Tool = {
	name: "list_files",
	mutating: false,
	description:
		"List files and directories, recursively. Use this to explore the project " +
		"structure before reading individual files.",
	parameters: {
		type: "object",
		properties: {
			path: {
				type: "string",
				description: "Directory relative to the project root. Omit for the root itself.",
			},
		},
	},

	async execute(args, ctx) {
		const target = resolveInRoot(ctx.root, args.path ?? ".");

		const info = await stat(target);
		if (!info.isDirectory()) {
			throw new Error(`${relativeToRoot(ctx.root, target)} is a file, not a directory`);
		}

		const entries = await walk(target, ctx.root, 0);
		const { text, info: trunc } = truncateHead(entries.join("\n"));

		if (entries.length === 0) return "(empty directory)";
		return trunc.truncated ? text : `${entries.length} entries\n${text}`;
	},
};

async function walk(dir: string, root: string, depth: number): Promise<string[]> {
	// 深度上限：沒有這個的話，一個 symlink 迴圈就能讓 agent 掛掉。
	if (depth > 6) return [];

	const out: string[] = [];
	const entries = await readdir(dir, { withFileTypes: true });

	// 排序讓輸出穩定，同樣的專案每次跑結果一樣，才方便你比對。
	entries.sort((a, b) => a.name.localeCompare(b.name));

	for (const entry of entries) {
		if (entry.name.startsWith(".") || IGNORED.has(entry.name)) continue;

		const full = join(dir, entry.name);
		const rel = relativeToRoot(root, full);

		if (entry.isDirectory()) {
			out.push(`${rel}/`);
			out.push(...(await walk(full, root, depth + 1)));
		} else {
			out.push(rel);
		}
	}

	return out;
}
