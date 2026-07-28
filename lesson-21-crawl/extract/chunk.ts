/**
 * 把一份長文切成塞得進 context 的塊。
 *
 * 為什麼不直接截斷就好？Lesson 2 教過截斷，那是為了「工具輸出太長」，
 * 截掉的是尾巴，而且明確告訴模型「我截掉了」。
 *
 * 但網頁不一樣：**你要的東西常常就在後面。** 一份 SDK 遷移文件，
 * 前 2000 字是前言，你要的那個關節編號在第 18 節。截斷等於永遠拿不到。
 *
 * 所以要切塊，而且要讓模型能自己決定看哪一塊。
 *
 * 三個設計決定：
 *
 *   1. **只在段落邊界切。** 切在句子中間會產生半句話，
 *      模型讀到「the velocity limit was lowered from」就沒了，
 *      它會自己補完後半句——這是幻覺最好的溫床。
 *
 *   2. **相鄰的塊要重疊一點。** 一段話剛好跨在邊界上的時候，
 *      沒有重疊的話兩邊都讀不到完整意思。
 *
 *   3. **每一塊都要標「第幾塊、共幾塊」。** 模型必須知道自己看到的是
 *      片段，不是全部，否則它會用第 1 塊的內容回答整份文件的問題。
 */

export interface Chunk {
	/** 1-based，給模型看的。 */
	index: number;
	total: number;
	text: string;
}

export interface ChunkOptions {
	/** 一塊最多幾個字元。 */
	maxChars?: number;
	/** 重疊：前一塊的最後一段如果不超過這個長度，就重複放進下一塊開頭。 */
	overlapMaxChars?: number;
}

export function chunkText(text: string, options: ChunkOptions = {}): Chunk[] {
	const maxChars = options.maxChars ?? 2400;
	const overlapMaxChars = options.overlapMaxChars ?? 300;

	const paragraphs = text.split(/\n\n+/).filter((p) => p.trim().length > 0);
	if (paragraphs.length === 0) return [];

	const chunks: string[][] = [];
	let current: string[] = [];
	let size = 0;

	for (const paragraph of paragraphs) {
		// 單一段落就超過上限：它自己就是一塊。
		// 不從中間切，寧可讓這一塊比 maxChars 大一點。
		// （真實產品會在這裡做句子級切分，那是練習 4。）
		if (paragraph.length > maxChars) {
			if (current.length > 0) {
				chunks.push(current);
				current = [];
				size = 0;
			}
			chunks.push([paragraph]);
			continue;
		}

		if (size + paragraph.length > maxChars && current.length > 0) {
			chunks.push(current);

			// 重疊：把上一塊的最後一段帶過來，前提是它夠短
			const tail = current[current.length - 1] ?? "";
			current = tail.length <= overlapMaxChars ? [tail] : [];
			size = current.reduce((n, p) => n + p.length, 0);
		}

		current.push(paragraph);
		size += paragraph.length;
	}

	if (current.length > 0) chunks.push(current);

	return chunks.map((paragraphs, i) => ({
		index: i + 1,
		total: chunks.length,
		text: paragraphs.join("\n\n"),
	}));
}
