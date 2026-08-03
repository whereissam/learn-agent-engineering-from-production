/**
 * Tool output truncation.
 *
 * Lesson 2's core problem: `ls -R` on a large project, or `cat` on a 10MB log,
 * blows the context window outright. And you **pay before discovering it blew up**,
 * because tokens are billed on what was sent.
 *
 * So a tool result must pass through here before entering the conversation history.
 *
 * Against Pi: packages/agent/src/harness/utils/truncate.ts (the full version, 350 lines)
 */

/** Truncate beyond this many lines. */
export const MAX_LINES = 400;

/** Truncate beyond this many bytes (when that triggers before the line count). */
export const MAX_BYTES = 32_000;

export interface TruncationInfo {
	truncated: boolean;
	originalLines: number;
	originalBytes: number;
	keptLines: number;
}

export interface TruncateResult {
	text: string;
	info: TruncationInfo;
}

/**
 * Keep the **beginning** and cut the rest.
 *
 * Why keep the beginning? Because for file contents, directory listings and compiler errors the point is usually near the top.
 * Shell output is the opposite; see truncateTail().
 */
export function truncateHead(text: string, maxLines = MAX_LINES, maxBytes = MAX_BYTES): TruncateResult {
	const lines = text.split("\n");
	const originalLines = lines.length;
	const originalBytes = Buffer.byteLength(text, "utf8");

	if (originalLines <= maxLines && originalBytes <= maxBytes) {
		return {
			text,
			info: { truncated: false, originalLines, originalBytes, keptLines: originalLines },
		};
	}

	// Cut by lines first, then by bytes; whichever condition trips first wins.
	const kept: string[] = [];
	let bytes = 0;
	for (const line of lines.slice(0, maxLines)) {
		const lineBytes = Buffer.byteLength(line, "utf8") + 1;
		if (bytes + lineBytes > maxBytes) break;
		kept.push(line);
		bytes += lineBytes;
	}

	// The truncation notice is written for **the model**, so it must say two things:
	// (1) something was cut and what you see is incomplete
	// (2) how to see the rest
	const notice =
		`\n\n[... output truncated: ${originalLines} lines / ${formatBytes(originalBytes)} originally, ` +
		`showing the first ${kept.length} lines. Use the offset parameter to read further, ` +
		`or narrow the request with a more precise filter.]`;

	return {
		text: kept.join("\n") + notice,
		info: { truncated: true, originalLines, originalBytes, keptLines: kept.length },
	};
}

/**
 * Keep the **end** and cut the front.
 *
 * For shell commands: running tests, a build or npm install puts the point (the error message,
 * the final result) almost always at the end, with a mass of progress output before it.
 */
export function truncateTail(text: string, maxLines = MAX_LINES, maxBytes = MAX_BYTES): TruncateResult {
	const lines = text.split("\n");
	const originalLines = lines.length;
	const originalBytes = Buffer.byteLength(text, "utf8");

	if (originalLines <= maxLines && originalBytes <= maxBytes) {
		return {
			text,
			info: { truncated: false, originalLines, originalBytes, keptLines: originalLines },
		};
	}

	const kept: string[] = [];
	let bytes = 0;
	// Collect backwards from the end
	for (const line of lines.slice(-maxLines).reverse()) {
		const lineBytes = Buffer.byteLength(line, "utf8") + 1;
		if (bytes + lineBytes > maxBytes) break;
		kept.unshift(line);
		bytes += lineBytes;
	}

	const notice =
		`[... start truncated: ${originalLines} lines / ${formatBytes(originalBytes)} originally, ` +
		`showing the last ${kept.length} lines.]\n\n`;

	return {
		text: notice + kept.join("\n"),
		info: { truncated: true, originalLines, originalBytes, keptLines: kept.length },
	};
}

export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes}B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
	return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}
