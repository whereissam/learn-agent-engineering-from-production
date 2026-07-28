/**
 * HTML → 正文。
 *
 * 這是 crawl 真正困難的地方。抓下來的 HTML 裡，正文常常只佔一到兩成，
 * 其他都是導覽列、廣告、訂閱表單、推薦閱讀、cookie 橫幅、footer。
 *
 * 這個檔案裡有兩個抽取器，**故意寫成一好一壞**：
 *
 *   stripTags()    把標籤全部拿掉，剩下的都算正文。三行寫完，而且是錯的。
 *   extractMain()  先把 boilerplate 砍掉，再挑正文容器，最後才拿文字。
 *
 * 為什麼要留著爛的那個？因為多數人第一次寫爬蟲都會寫成那樣，
 * 而且它「看起來會動」。`extract/measure.ts` 會用數字告訴你差多少。
 *
 * 注意：這裡用正規表示式處理 HTML。正式產品應該用真的 parser
 * （cheerio、linkedom、jsdom，或 Readability / trafilatura 這類現成的抽取器）。
 * 這裡不用，是因為這一課的重點是**抽取策略**，不是 parser 的 API。
 * 語料的 HTML 是我們自己產的，結構固定，所以正規表示式夠用。
 */

/** 抽取結果。標題、日期、正文分開，是因為它們的用途不一樣。 */
export interface Extracted {
	title: string;
	/** 發佈日期，抓不到就是空字串。排序和「這資料多舊」都要用到。 */
	published: string;
	/** 正文純文字。 */
	text: string;
	/**
	 * 這一頁有哪些東西**被丟掉了**。
	 *
	 * 這個欄位是實測之後才加的，而且它是這一課最重要的一段。
	 *
	 * 原本的抽取器只取 `<p>`，所以表格和清單會安靜地消失。「安靜」是關鍵：
	 * 頁面抓到了、chunk 也讀完了，模型只是永遠找不到它要的那個數字，
	 * 而且**不知道自己在找一個已經被丟掉的東西**。
	 * 實測裡模型因此燒光了 16 步上限還答不出來（README Step 5）。
	 *
	 * 抓不到頁面至少有錯誤訊息。抽錯內容什麼都沒有。
	 * 所以工具必須自己把這件事講出來——這就是 Lesson 6
	 * 「工具要主動報告資料品質」在 crawl 這一層的樣子。
	 */
	dropped: { tables: number; lists: number };
}

// ─────────────────────────────────────────────────────────────
// 反例：把標籤拿掉就好了吧？
// ─────────────────────────────────────────────────────────────

/**
 * 最直覺的做法：所有標籤換成空白，剩下的就是文字。
 *
 * 這是錯的，但錯得很不明顯——你會拿到一大段「看起來像正文」的東西，
 * 裡面混著「Home Docs Blog Pricing Sign in」「Accept all」
 * 「Sponsored: …」「Subscribe」「© 2026 All rights reserved」。
 *
 * 模型不會抱怨。它會照單全收，然後在回答裡引用廣告文案。
 */
export function stripTags(html: string): string {
	return decodeEntities(
		html
			// script / style 的「內容」也要拿掉，不然會抽到一堆 JS
			.replace(/<script[\s\S]*?<\/script>/gi, " ")
			.replace(/<style[\s\S]*?<\/style>/gi, " ")
			.replace(/<[^>]+>/g, " "),
	)
		.replace(/\s+/g, " ")
		.trim();
}

// ─────────────────────────────────────────────────────────────
// 正解：先砍 boilerplate，再挑正文容器
// ─────────────────────────────────────────────────────────────

/** 這些標籤裡的東西，整塊都不是正文。 */
const DROP_TAGS = ["script", "style", "noscript", "nav", "header", "footer", "aside", "form"];

/**
 * 這些 class / id 出現時整塊丟掉。
 *
 * 這份清單很土，但真實世界的抽取器（Readability、trafilatura）
 * 骨子裡也有一份差不多的東西，只是更長、還配上文字密度的統計。
 * **沒有一個抽取器是「原理上正確」的，全部都是啟發式規則。**
 */
const DROP_PATTERNS = [
	"cookie",
	"banner",
	"newsletter",
	"subscribe",
	"sidebar",
	"related",
	"promo",
	"ad",
	"advert",
	"sponsor",
	"comment",
	"share",
];

export interface ExtractOptions {
	/**
	 * 要不要把表格和清單也抽出來（預設不要）。
	 *
	 * 預設是 false，因為這一課要讓你先看到「只抽 `<p>`」的後果。
	 * `tools/fetch.ts` 傳的是 true。兩個都留著，你可以自己切回去看差別。
	 */
	includeStructures?: boolean;
}

export function extractMain(html: string, options: ExtractOptions = {}): Extracted {
	const title = firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i) ?? "";
	const published =
		firstMatch(html, /<meta[^>]+article:published_time"?\s+content="([^"]+)"/i) ??
		firstMatch(html, /<meta[^>]+content="([^"]+)"[^>]+article:published_time/i) ??
		"";

	let body = html;

	// 1. 整塊丟掉的標籤
	for (const tag of DROP_TAGS) {
		body = body.replace(new RegExp(`<${tag}[\\s\\S]*?<\\/${tag}>`, "gi"), " ");
	}

	// 2. class / id 命中黑名單的區塊
	//    只處理 div / section，因為那是這類容器最常用的標籤
	body = dropByAttribute(body, DROP_PATTERNS);

	// 3. 挑正文容器：<article> 優先，其次 <main>，都沒有才退回整個 body
	//
	//    這個順序不是隨便排的。<article> 是語意上最精確的容器，
	//    而「退回整個 body」是最後手段——退到那一步，你的抽取品質就靠
	//    上面兩步的黑名單撐著了。
	const container =
		firstMatch(body, /<article[^>]*>([\s\S]*?)<\/article>/i) ??
		firstMatch(body, /<main[^>]*>([\s\S]*?)<\/main>/i) ??
		firstMatch(body, /<body[^>]*>([\s\S]*?)<\/body>/i) ??
		body;

	// 4. 依照原始順序取出區塊。
	//
	//    最直覺的寫法是「只取 <p>」，那也是這個檔案原本的樣子。
	//    它抓得準，但會**安靜地**丟掉清單、表格、程式碼區塊——
	//    而那正是「這個關節在新版是第幾號」這種問題的答案所在。
	//
	//    順序很重要：表格如果被搬到全文最後面，
	//    「上面那段講的就是下面這張表」的關係就斷了。
	const pattern = options.includeStructures
		? /<(p|ul|ol|table)\b[^>]*>([\s\S]*?)<\/\1>/gi
		: /<(p)\b[^>]*>([\s\S]*?)<\/\1>/gi;

	const blocks: string[] = [];
	for (const match of container.matchAll(pattern)) {
		const tag = (match[1] ?? "p").toLowerCase();
		const inner = match[2] ?? "";
		const rendered =
			tag === "table" ? renderTable(inner) : tag === "ul" || tag === "ol" ? renderList(inner) : plain(inner);
		if (rendered) blocks.push(rendered);
	}

	// 一個字都抽不到，通常代表這頁的內容是 JS 畫出來的（見 fetcher.ts）
	const text = blocks.join("\n\n");

	// 還是要數一下丟掉了什麼——**即使已經支援表格，也不代表抽得完整**。
	// 只數容器（<table> / <ul> / <ol>），不數 <tr> / <li>，
	// 因為要回報的是「有幾塊結構化內容」，不是「有幾行」。
	const dropped = options.includeStructures
		? { tables: 0, lists: 0 }
		: { tables: count(container, /<table[\s>]/gi), lists: count(container, /<[uo]l[\s>]/gi) };

	return { title: decodeEntities(title).trim(), published, text, dropped };
}

// ─────────────────────────────────────────────────────────────

function dropByAttribute(html: string, patterns: string[]): string {
	// 逐一掃過 div / section 開頭標籤，命中黑名單就連同它的內容一起丟。
	// 這裡用最笨的方式做巢狀對應：從開頭標籤往後找對應的結束標籤。
	let result = "";
	let rest = html;

	const openTag = /<(div|section)\b([^>]*)>/i;
	let match = openTag.exec(rest);

	while (match) {
		const [full, tag = "div", attrs = ""] = match;
		const start = match.index;
		result += rest.slice(0, start);
		rest = rest.slice(start);

		const hit = patterns.some((p) => new RegExp(`(class|id)="[^"]*\\b${p}[^"]*"`, "i").test(attrs));

		if (hit) {
			const end = findClosingTag(rest, tag, full.length);
			rest = end === -1 ? "" : rest.slice(end);
		} else {
			result += full;
			rest = rest.slice(full.length);
		}

		match = openTag.exec(rest);
	}

	return result + rest;
}

/** 從 `from` 開始找 `<tag>` 對應的結束位置（回傳結束標籤之後的 index）。 */
function findClosingTag(html: string, tag: string, from: number): number {
	const pattern = new RegExp(`<${tag}\\b[^>]*>|<\\/${tag}>`, "gi");
	pattern.lastIndex = from;
	let depth = 1;
	let m = pattern.exec(html);
	while (m) {
		depth += m[0].startsWith("</") ? -1 : 1;
		if (depth === 0) return m.index + m[0].length;
		m = pattern.exec(html);
	}
	return -1;
}

function plain(html: string): string {
	return decodeEntities(stripInlineTags(html)).replace(/\s+/g, " ").trim();
}

/**
 * 表格 → 每列一行的純文字。
 *
 * 為什麼不保留 HTML 給模型？因為 `<table><tr><td>` 這些標籤本身要花 token，
 * 而且模型讀 pipe 分隔的表格跟讀 HTML 表格一樣好。
 * **保留的是「哪些值在同一列」這個關係，不是標記語言。**
 */
function renderTable(html: string): string {
	const rows = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((row) =>
		[...(row[1] ?? "").matchAll(/<(td|th)\b[^>]*>([\s\S]*?)<\/\1>/gi)]
			.map((cell) => plain(cell[2] ?? ""))
			.join(" | "),
	);
	return rows.filter(Boolean).join("\n");
}

function renderList(html: string): string {
	return [...html.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)]
		.map((m) => `- ${plain(m[1] ?? "")}`)
		.filter((line) => line !== "- ")
		.join("\n");
}

function count(text: string, pattern: RegExp): number {
	return [...text.matchAll(pattern)].length;
}

function stripInlineTags(html: string): string {
	return html.replace(/<[^>]+>/g, "");
}

function firstMatch(text: string, pattern: RegExp): string | undefined {
	return pattern.exec(text)?.[1];
}

function decodeEntities(text: string): string {
	return text
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&middot;/g, "·")
		.replace(/&copy;/g, "©")
		.replace(/&amp;/g, "&");
}
