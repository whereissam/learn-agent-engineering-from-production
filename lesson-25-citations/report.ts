/**
 * Split a report into "sentences plus the URLs they cite".
 *
 * This step sounds trivial and it decides how accurately the whole evaluation measures. Two decisions:
 *
 * **1. What counts as one claim.**
 * Headings, rules and blank lines do not; one bullet is one claim; two sentences in a paragraph are two.
 * Too coarse (a whole paragraph as one) dilutes "one sentence in the paragraph has no citation";
 * too fine (every clause) manufactures a pile of fragments with no atoms.
 *
 * **2. What counts as "cited".**
 * This report format puts URLs in parentheses at the end of a sentence. A real product might use `[1]` footnotes,
 * which then need cross-referencing against a bibliography — a different shape with the same principle:
 * **every factual sentence must map back to a source.**
 */

export interface Claim {
	text: string;
	sources: string[];
	/** Which line of the report, so you can go back for context. */
	line: number;
}

const URL_PATTERN = /https?:\/\/[^\s,)）、]+/g;

/** These lines are not factual statements and must not be required to carry citations. */
function isStructural(line: string): boolean {
	const trimmed = line.trim();
	if (trimmed.length === 0) return true;
	if (/^#{1,6}\s/.test(trimmed)) return true; // 標題
	if (/^[-*_]{3,}$/.test(trimmed)) return true; // 分隔線
	if (/^```/.test(trimmed)) return true;
	// A pure lead-in ("the following are…:") is usually short and ends with a colon
	if (trimmed.length < 12 && /[:：]$/.test(trimmed)) return true;
	return false;
}

/**
 * Split one line into sentences.
 *
 * Chinese and English are mixed, so both kinds of sentence-ending punctuation must be recognised.
 *
 * ⚠️ **It must not split on a dot inside a URL.** The first version replaced URLs with placeholders,
 * split, and restored them, and the placeholder itself was written wrongly (see README Step 4),
 * making every claim's citations empty — while the evaluation still looked like it "ran through".
 *
 * The current approach is much simpler: **the URLs never need extracting**.
 *
 *   `。！？` never appear inside a URL;
 *   an ASCII `.!?` only splits when followed by whitespace plus a capital or a bullet,
 *   and a dot inside a URL is never followed by whitespace.
 *
 * One less mechanism is one less thing that can break.
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

				// A line that is only punctuation once URLs are removed is a citation continuation, not a claim of its own
			if (text.replace(/[\s*_`#\-•·:：（）()]/g, "").length < 8) continue;

			claims.push({ text, sources, line: index + 1 });
		}
	});

	return claims;
}
