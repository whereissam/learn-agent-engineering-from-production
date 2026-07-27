/**
 * 工具輸出截斷。
 *
 * 這是 Lesson 2 的核心問題：`ls -R` 一個大專案，或 `cat` 一個 10MB 的 log，
 * 輸出會直接把 context window 撐爆。而且你是「先付錢才發現爆掉」，
 * token 是照送進去的量計費的。
 *
 * 所以工具結果在進入對話歷史之前，一定要先過這一關。
 *
 * 對照 Pi：packages/agent/src/harness/utils/truncate.ts（350 行的完整版）
 */

/** 超過這個行數就截斷。 */
export const MAX_LINES = 400;

/** 超過這個位元組數就截斷（比行數更早觸發的話）。 */
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
 * 保留「開頭」，砍掉後面。
 *
 * 為什麼是保留開頭？因為檔案內容、目錄列表、編譯錯誤的重點通常在前面。
 * shell 輸出則相反，見 truncateTail()。
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

	// 先照行數砍，再照位元組砍，兩個條件哪個先中就用哪個。
	const kept: string[] = [];
	let bytes = 0;
	for (const line of lines.slice(0, maxLines)) {
		const lineBytes = Buffer.byteLength(line, "utf8") + 1;
		if (bytes + lineBytes > maxBytes) break;
		kept.push(line);
		bytes += lineBytes;
	}

	// 截斷提示是寫給「模型」看的，所以要告訴它兩件事：
	// (1) 東西被砍了，你看到的不完整
	// (2) 想看剩下的，可以怎麼做
	const notice =
		`\n\n[... 輸出被截斷：原本 ${originalLines} 行 / ${formatBytes(originalBytes)}，` +
		`只顯示前 ${kept.length} 行。需要後面的內容請用 offset 參數繼續讀，` +
		`或用更精確的條件縮小範圍。]`;

	return {
		text: kept.join("\n") + notice,
		info: { truncated: true, originalLines, originalBytes, keptLines: kept.length },
	};
}

/**
 * 保留「結尾」，砍掉前面。
 *
 * 給 shell 指令用：跑測試、build、npm install 的時候，重點（錯誤訊息、
 * 最終結果）幾乎都在最後面，前面是一大堆進度輸出。
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
	// 從後面往前收
	for (const line of lines.slice(-maxLines).reverse()) {
		const lineBytes = Buffer.byteLength(line, "utf8") + 1;
		if (bytes + lineBytes > maxBytes) break;
		kept.unshift(line);
		bytes += lineBytes;
	}

	const notice =
		`[... 前面被截斷：原本 ${originalLines} 行 / ${formatBytes(originalBytes)}，` +
		`只顯示最後 ${kept.length} 行。]\n\n`;

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
