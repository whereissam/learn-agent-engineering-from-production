/**
 * 把本地文件變成可檢索的索引。
 *
 *   bun run lesson-27:ingest
 *
 * ## 本地文件跟網頁最大的差別：它會變
 *
 * Lesson 20-26 的語料是固定的十四頁，產生一次就不動了。本地文件不是：
 * 你今天改了 README，索引就過期了。而 embedding 是要花錢的，
 * 所以**不能每次都全部重算**。
 *
 * 這個檔案的重點因此不是「怎麼切 chunk」（那是 Lesson 21 做過的事），
 * 而是**怎麼知道哪些檔案變了**：
 *
 *   內容雜湊沒變  → 直接沿用舊的 chunk（和舊的 embedding）
 *   內容雜湊變了  → 重切這一個檔案
 *   檔案不見了    → 把它的 chunk 移除
 *
 * 這是本地 RAG 真正的工程量所在。很多教學跳過它，
 * 於是你做出一個「第二次跑就開始給過期答案」的系統。
 *
 * ## 來源識別
 *
 * 網頁的來源是 URL，天生唯一而且可以點開。本地文件沒有 URL，
 * 所以要自己造一個**看得懂、對得回去**的識別字：
 *
 *   docs/TODO.md#L120-L168
 *
 * 這個格式有三個好處：使用者看得懂、編輯器點得開、
 * 而且 Lesson 25 的引用驗證可以拿它回去撈原文對答案。
 */

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { relative, resolve } from "node:path";
import { chunkText } from "../lesson-21-crawl/extract/chunk.ts";

const ROOT = resolve(import.meta.dirname, "..");
const INDEX_PATH = resolve(import.meta.dirname, "index.json");

/**
 * 要收哪些檔案。
 *
 * 刻意只收 markdown，而且只收「文件」而不是「程式碼」——
 * 混在一起檢索的效果通常比較差，因為程式碼的詞彙分佈跟散文差太多。
 * 真的要索引程式碼，該用不同的 chunk 策略（按函式切，而不是按段落切）。
 */
const INCLUDE_DIRS = ["docs"];
const INCLUDE_FILES = ["README.md", "README.zh-TW.md"];
const LESSON_README = /^lesson-\d+[a-z-]*\/README\.md$/;

/** 跳過 clone 下來的參考專案和 node_modules，不然會掃到幾萬個檔案。 */
const SKIP_DIRS = new Set([
	"node_modules",
	".git",
	"crawl4ai",
	"firecrawl",
	"gpt-researcher",
	"deep-research",
]);

export interface LocalChunk {
	/** `path#L12-L48`，唯一而且人看得懂。 */
	id: string;
	path: string;
	/** 這一塊在檔案裡的行號範圍（1-based，含頭含尾）。 */
	startLine: number;
	endLine: number;
	/** 最近的標題，當成這一塊的「標題」。 */
	heading: string;
	text: string;
}

export interface LocalIndex {
	/** path → 內容雜湊。下次 ingest 用它判斷要不要重切。 */
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
 * 把一個 markdown 檔切成 chunk，並記住每一塊的行號和所屬標題。
 *
 * 行號是這裡唯一比 Lesson 21 多做的事，但它很重要：
 * **沒有行號，本地來源就沒辦法被驗證**（Lesson 25 要拿它回去比對）。
 *
 * 做法是先按行累積，再交給 `chunkText` 切——這樣切點還是在段落邊界，
 * 但我們自己知道每一塊落在哪幾行。
 */
export function chunkMarkdown(path: string, content: string): LocalChunk[] {
	const lines = content.split("\n");

	// 先找出每一行「當下的標題」是什麼
	const headings: string[] = [];
	let current = "";
	for (const line of lines) {
		const match = /^#{1,6}\s+(.*)$/.exec(line);
		if (match?.[1]) current = match[1].trim();
		headings.push(current);
	}

	const chunks = chunkText(content, { maxChars: 1200, overlapMaxChars: 200 });

	// 用「這一塊的第一段」去原文找行號。段落是唯一的機率很高，
	// 找不到就退回上一塊的結尾，不會算錯太多。
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
			// 內容沒變，沿用舊的 chunk。**這一行就是省錢的地方**：
			// 沿用 chunk 等於沿用它們的 embedding。
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
