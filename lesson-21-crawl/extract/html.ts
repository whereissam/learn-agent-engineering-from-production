/**
 * HTML → body text.
 *
 * This is where crawling gets genuinely hard. In fetched HTML the body is often only ten to
 * twenty percent; the rest is navigation, ads, subscription forms, related reading, cookie banners and footers.
 *
 * There are two extractors in this file, **deliberately one good and one bad**:
 *
 *   stripTags()    remove every tag and call the rest body text. Three lines, and wrong.
 *   extractMain()  cut the boilerplate, pick the body container, and only then take the text.
 *
 * Why keep the bad one? Because most people's first crawler looks like that, and it "appears
 * to work". `extract/measure.ts` tells you with numbers how far apart they are.
 *
 * Note: HTML is processed here with regular expressions. A real product should use a real parser
 * (cheerio, linkedom, jsdom, or an off-the-shelf extractor like Readability or trafilatura).
 * It is not used here because this lesson is about **extraction strategy**, not a parser's API.
 * The corpus HTML is generated here with a fixed structure, so regular expressions suffice.
 */

/** The extraction result. Title, date and body are separate because their uses differ. */
export interface Extracted {
	title: string;
	/** The publication date, or an empty string. Used by ranking and by "how old is this". */
	published: string;
	/** The body as plain text. */
	text: string;
	/**
	 * What on this page **was thrown away**.
	 *
	 * This field was added after a measurement, and it is this lesson's most important passage.
	 *
	 * The original extractor took only `<p>`, so tables and lists vanished silently. "Silently" is the key:
	 * the page was fetched, the chunks were read, and the model simply never finds the number it wants,
	 * **without knowing it is looking for something that was already discarded**.
	 * In the measurement the model burned the whole 16-step ceiling and still could not answer (README Step 5).
	 *
	 * Failing to fetch at least has an error message. Wrong extraction has nothing.
	 * So the tool has to say it itself — which is what Lesson 6's "tools should report data quality
	 * unprompted" looks like at the crawl layer.
	 */
	dropped: { tables: number; lists: number };
}

// ─────────────────────────────────────────────────────────────
// The counter-example: surely stripping the tags is enough?
// ─────────────────────────────────────────────────────────────

/**
 * The most intuitive approach: replace every tag with whitespace and the rest is the text.
 *
 * It is wrong, and wrong in a way that is hard to see — you get a large passage that "looks like
 * body text" with "Home Docs Blog Pricing Sign in" and "Accept all" mixed into it.
 * 「Sponsored: …」「Subscribe」「© 2026 All rights reserved」。
 *
 * The model will not complain. It takes it all and then cites advertising copy in its answer.
 */
export function stripTags(html: string): string {
	return decodeEntities(
		html
			// script / style *contents* must go too, or you extract a pile of JS
			.replace(/<script[\s\S]*?<\/script>/gi, " ")
			.replace(/<style[\s\S]*?<\/style>/gi, " ")
			.replace(/<[^>]+>/g, " "),
	)
		.replace(/\s+/g, " ")
		.trim();
}

// ─────────────────────────────────────────────────────────────
// The fix: cut the boilerplate first, then pick the body container
// ─────────────────────────────────────────────────────────────

/** Anything inside these tags is not body text, as a whole block. */
const DROP_TAGS = ["script", "style", "noscript", "nav", "header", "footer", "aside", "form"];

/**
 * Blocks whose class or id matches are dropped entirely.
 *
 * This list is crude, and real-world extractors (Readability, trafilatura) have much the same
 * thing underneath, only longer and paired with text-density statistics.
 * **No extractor is "correct in principle"; they are all heuristics.**
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
		 * Whether to extract tables and lists too (off by default).
	 *
		 * The default is false, because this lesson wants you to see the consequences of taking only `<p>`.
		 * `tools/fetch.ts` passes true. Both are kept so you can switch back and see the difference.
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

	// 1. Tags dropped as whole blocks
	for (const tag of DROP_TAGS) {
		body = body.replace(new RegExp(`<${tag}[\\s\\S]*?<\\/${tag}>`, "gi"), " ");
	}

	// 2. Blocks whose class or id matches the blocklist
	//    Only div / section are handled, because those are the tags such containers usually use
	body = dropByAttribute(body, DROP_PATTERNS);

	// 3. Pick the body container: <article> first, then <main>, and only then fall back to the whole body
	//
	//    The order is not arbitrary. <article> is the semantically most precise container,
	//    and "fall back to the whole body" is the last resort — once there, extraction quality
	//    rests entirely on the two blocklists above.
	const container =
		firstMatch(body, /<article[^>]*>([\s\S]*?)<\/article>/i) ??
		firstMatch(body, /<main[^>]*>([\s\S]*?)<\/main>/i) ??
		firstMatch(body, /<body[^>]*>([\s\S]*?)<\/body>/i) ??
		body;

	// 4. Take the blocks in their original order.
	//
	//    The intuitive version is "take only <p>", which is what this file used to do.
	//    It is precise, and it **silently** drops lists, tables and code blocks —
	//    which is exactly where the answer to "which index is this joint in the new SDK" lives.
	//
	//    Order matters: move a table to the end of the document and the relation
	//    "the paragraph above is talking about the table below" is severed.
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

		// Extracting not a single character usually means the page's content is drawn by JS (see fetcher.ts)
	const text = blocks.join("\n\n");

	// Still count what was dropped — **supporting tables does not mean extraction is complete**.
	// Only containers are counted (<table> / <ul> / <ol>), not <tr> / <li>,
	// because what is reported is "how many structured blocks", not "how many rows".
	const dropped = options.includeStructures
		? { tables: 0, lists: 0 }
		: { tables: count(container, /<table[\s>]/gi), lists: count(container, /<[uo]l[\s>]/gi) };

	return { title: decodeEntities(title).trim(), published, text, dropped };
}

// ─────────────────────────────────────────────────────────────

function dropByAttribute(html: string, patterns: string[]): string {
		// Scan the div / section opening tags one by one, and drop a match along with its contents.
		// Nesting is matched in the dumbest way: search forwards from the opening tag for its closing tag.
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

/** From `from`, find the matching close of `<tag>` (returns the index after the closing tag). */
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
 * Tables → plain text, one line per row.
 *
 * Why not keep the HTML for the model? Because `<table><tr><td>` costs tokens by itself, and a
 * model reads a pipe-separated table as well as an HTML one.
 * **What is preserved is the relation "which values share a row", not the markup language.**
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
