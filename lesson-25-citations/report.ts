/**
 * 把一份報告拆成「句子 + 它引用的網址」。
 *
 * 這一步聽起來瑣碎，但它決定了整個評估量得準不準。兩個決定：
 *
 * **1. 什麼算一個 claim。**
 * 標題、分隔線、空行不算；一個項目符號算一條；一段話裡有兩句就算兩條。
 * 太粗（整段當一條）會讓「一段裡只有一句沒引用」被稀釋掉；
 * 太細（每個子句）會製造一堆沒有原子的碎片。
 *
 * **2. 什麼算「有引用」。**
 * 我們的報告格式是把網址放在句尾括號裡。真實產品可能用 `[1]` 註腳，
 * 那就要另外對照參考文獻表——形狀不同，原則一樣：
 * **每一個事實句都要能對應回一個來源。**
 */

export interface Claim {
	text: string;
	sources: string[];
	/** 在報告裡的第幾行，方便你回去看上下文。 */
	line: number;
}

const URL_PATTERN = /https?:\/\/[^\s,)）、]+/g;

/** 這些行不是事實陳述，不該被要求附引用。 */
function isStructural(line: string): boolean {
	const trimmed = line.trim();
	if (trimmed.length === 0) return true;
	if (/^#{1,6}\s/.test(trimmed)) return true; // 標題
	if (/^[-*_]{3,}$/.test(trimmed)) return true; // 分隔線
	if (/^```/.test(trimmed)) return true;
	// 純粹的引導語（「以下是…：」）通常很短又以冒號結尾
	if (trimmed.length < 12 && /[:：]$/.test(trimmed)) return true;
	return false;
}

/**
 * 把一行切成句子。
 *
 * 中英文混排，所以句尾標點要兩種都認。
 *
 * ⚠️ **不能在網址裡的點切開。** 我第一版的做法是「先把網址換成佔位符、
 * 切完再換回來」，結果佔位符本身寫錯了（見 README Step 4），
 * 害每一條 claim 的引用都變成空的——而評估看起來還是「跑完了」。
 *
 * 現在的做法簡單很多：**根本不需要挖網址**。
 *
 *   `。！？` 不會出現在網址裡；
 *   ASCII 的 `.!?` 只有在後面接空白 + 大寫或項目符號時才切，
 *   而網址裡的點後面不會有空白。
 *
 * 少一個機制，就少一個會壞的地方。
 */
function splitSentences(line: string): string[] {
	return line
		.split(/(?<=[。！？])|(?<=[.!?])\s+(?=[A-Z*\-•])/)
		.map((part) => part.trim())
		.filter(Boolean);
}

export function parseReport(report: string): Claim[] {
	const claims: Claim[] = [];

	report.split("\n").forEach((line, index) => {
		if (isStructural(line)) return;

		for (const sentence of splitSentences(line)) {
			const sources = [...sentence.matchAll(URL_PATTERN)].map((m) => m[0].replace(/[.,:;]+$/, ""));
			const text = sentence.replace(URL_PATTERN, "").replace(/\(\s*[,、\s]*\)/g, "").trim();

			// 拿掉網址之後只剩符號的，是引用的續行，不是獨立的 claim
			if (text.replace(/[\s*_`#\-•·:：（）()]/g, "").length < 8) continue;

			claims.push({ text, sources, line: index + 1 });
		}
	});

	return claims;
}
