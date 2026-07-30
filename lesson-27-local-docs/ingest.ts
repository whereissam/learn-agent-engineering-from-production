/**
 * Turning local documents into a searchable index.
 *
 *   bun run lesson-27:ingest
 *
 * ## The biggest difference from web pages: local documents change
 *
 * Lessons 20-26's corpus is a fixed fourteen pages generated once and left alone. Local documents are not:
 * edit a README today and the index is stale. And embeddings cost money,
 * so **recomputing everything every time is out**.
 *
 * So this file's point is not "how to chunk" (Lesson 21 did that)
 * but **how to know which files changed**:
 *
 *   the content hash is unchanged  → reuse the old chunks (and their old embeddings)
 *   the content hash changed       → re-chunk this one file
 *   the file is gone               → remove its chunks
 *
 * This is where the real engineering in local RAG lives. Many tutorials skip it,
 * leaving you with a system that starts giving stale answers on its second run.
 *
 * ## Source identity
 *
 * A web source is a URL: unique by nature and clickable. A local document has no URL,
 * so it needs a **legible, resolvable** identifier of its own:
 *
 *   docs/TODO.md#L120-L168
 *
 * The format has three benefits: a user can read it, an editor can open it,
 * and Lesson 25's citation verification can use it to fetch the original text and check.
 */

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { relative, resolve } from "node:path";
import { chunkText } from "../lesson-21-crawl/extract/chunk.ts";

const ROOT = resolve(import.meta.dirname, "..");
const INDEX_PATH = resolve(import.meta.dirname, "index.json");

/**
 * Which files to collect.
 *
 * Deliberately markdown only, and documents rather than code —
 * retrieving them together usually works worse, because code's vocabulary distribution is too far from prose's.
 * Indexing code properly needs a different chunking strategy (by function rather than by paragraph).
 */
const INCLUDE_DIRS = ["docs"];
const INCLUDE_FILES = ["README.md", "README.zh-TW.md"];
const LESSON_README = /^lesson-\d+[a-z-]*\/README\.md$/;

/** Skip cloned reference projects and node_modules, or it scans tens of thousands of files. */
const SKIP_DIRS = new Set([
	"node_modules",
	".git",
	"crawl4ai",
	"firecrawl",
	"gpt-researcher",
	"deep-research",
]);

export interface LocalChunk {
	/** `path#L12-L48`: unique and human-readable. */
	id: string;
	path: string;
	/** This chunk's line range in the file (1-based, inclusive). */
	startLine: number;
	endLine: number;
	/** The nearest heading, used as this chunk's "title". */
	heading: string;
	text: string;
}

export interface LocalIndex {
	/** path → content hash. The next ingest uses it to decide what to re-chunk. */
	hashes: Record<string, string>;
	chunks: LocalChunk[];
}

function hashOf(text: string): string {
	return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

function listMarkdown(): string[] {
	const found: string[] = [];

	for (const file of INCLUDE_FILES) {
		if (existsSync(resolve(ROOT, file))) found.push(file);
	}

	const walk = (dir: string): void => {
		for (const entry of readdirSync(resolve(ROOT, dir), { withFileTypes: true })) {
			if (SKIP_DIRS.has(entry.name)) continue;
			const path = dir === "." ? entry.name : `${dir}/${entry.name}`;
			if (entry.isDirectory()) {
				walk(path);
			} else if (entry.name.endsWith(".md")) {
				found.push(path);
			}
		}
	};

	for (const dir of INCLUDE_DIRS) {
		if (existsSync(resolve(ROOT, dir))) walk(dir);
	}

	for (const entry of readdirSync(ROOT, { withFileTypes: true })) {
		if (!entry.isDirectory() || SKIP_DIRS.has(entry.name)) continue;
		const candidate = `${entry.name}/README.md`;
		if (LESSON_README.test(candidate) && existsSync(resolve(ROOT, candidate))) {
			found.push(candidate);
		}
	}

	return [...new Set(found)].sort();
}

/**
 * Split one markdown file into chunks, remembering each one's line range and owning heading.
 *
 * Line numbers are the only thing done here beyond Lesson 21, and they matter:
 * **without line numbers a local source cannot be verified** (Lesson 25 needs them to compare back).
 *
 * The approach accumulates by line first, then hands off to `chunkText` — so cut points still land on
 * paragraph boundaries, and we know which lines each chunk covers.
 */
export function chunkMarkdown(path: string, content: string): LocalChunk[] {
	const lines = content.split("\n");

	// First work out each line's current heading
	const headings: string[] = [];
	let current = "";
	for (const line of lines) {
		const match = /^#{1,6}\s+(.*)$/.exec(line);
		if (match?.[1]) current = match[1].trim();
		headings.push(current);
	}

	const chunks = chunkText(content, { maxChars: 1200, overlapMaxChars: 200 });

	// Use the chunk's first paragraph to find its line numbers in the original. A paragraph is very likely unique,
	// and failing that it falls back to the previous chunk's end, which cannot be far wrong.
	const result: LocalChunk[] = [];
	let cursor = 0;

	for (const chunk of chunks) {
		const firstLine = chunk.text.split("\n")[0] ?? "";
		let start = lines.findIndex((line, i) => i >= cursor && line.trim() === firstLine.trim());
		if (start === -1) start = cursor;

		const height = chunk.text.split("\n").length;
		const end = Math.min(start + height - 1, lines.length - 1);
		cursor = end;

		result.push({
			id: `${path}#L${start + 1}-L${end + 1}`,
			path,
			startLine: start + 1,
			endLine: end + 1,
			heading: headings[start] ?? "",
			text: chunk.text,
		});
	}

	return result;
}

function loadIndex(): LocalIndex {
	try {
		return JSON.parse(readFileSync(INDEX_PATH, "utf8")) as LocalIndex;
	} catch {
		return { hashes: {}, chunks: [] };
	}
}

export function readIndex(): LocalIndex {
	const index = loadIndex();
	if (index.chunks.length === 0) {
		throw new Error("本地索引是空的。先跑：bun run lesson-27:ingest");
	}
	return index;
}

// ─────────────────────────────────────────────────────────────

if (import.meta.main) {
	const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
	const previous = loadIndex();
	const files = listMarkdown();

	const hashes: Record<string, string> = {};
	const chunks: LocalChunk[] = [];
	let reused = 0;
	let rebuilt = 0;

	for (const path of files) {
		const content = readFileSync(resolve(ROOT, path), "utf8");
		const hash = hashOf(content);
		hashes[path] = hash;

		if (previous.hashes[path] === hash) {
				// The content is unchanged, so the old chunks are reused. **This line is where the money is saved**:
				// reusing chunks means reusing their embeddings.
			chunks.push(...previous.chunks.filter((c) => c.path === path));
			reused++;
			continue;
		}

		chunks.push(...chunkMarkdown(path, content));
		rebuilt++;
	}

	const removed = Object.keys(previous.hashes).filter((path) => !hashes[path]);

	writeFileSync(INDEX_PATH, `${JSON.stringify({ hashes, chunks }, null, 0)}\n`, "utf8");

	console.log(`索引：${files.length} 個檔案、${chunks.length} 個 chunk`);
	console.log(dim(`  沿用 ${reused}、重切 ${rebuilt}、移除 ${removed.length}`));
	if (removed.length > 0) console.log(dim(`  移除：${removed.join(", ")}`));

	const bytes = chunks.reduce((sum, c) => sum + c.text.length, 0);
	console.log(dim(`  正文共 ${bytes.toLocaleString()} 字元`));
	console.log(dim(`  最大的檔案：${largest(chunks)}`));
}

function largest(chunks: LocalChunk[]): string {
	const byPath = new Map<string, number>();
	for (const chunk of chunks) byPath.set(chunk.path, (byPath.get(chunk.path) ?? 0) + 1);
	const top = [...byPath.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
	return top.map(([path, count]) => `${path} (${count} 塊)`).join("、");
}
