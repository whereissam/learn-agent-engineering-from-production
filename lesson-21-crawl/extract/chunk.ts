/**
 * Split a long document into chunks that fit in context.
 *
 * Why not just truncate? Lesson 2 taught truncation, and that was for "the tool output is too long":
 * it cuts the tail and tells the model explicitly "I truncated this".
 *
 * Web pages are different: **what you want is often near the end.** In an SDK migration document,
 * the first 2000 characters are the preamble and the joint index you want is in section 18. Truncation means never reaching it.
 *
 * So it has to be chunked, and the model has to be able to choose which chunk to read.
 *
 * Three design decisions:
 *
 *   1. **Cut only at paragraph boundaries.** Cutting mid-sentence produces half a sentence,
 *      and the model reads "the velocity limit was lowered from" and then nothing;
 *      it completes the rest itself — the finest breeding ground for hallucination.
 *
 *   2. **Adjacent chunks overlap a little.** When a passage lands exactly on a boundary,
 *      without overlap neither side reads its full meaning.
 *
 *   3. **Every chunk is labelled which one of how many.** The model must know it is seeing
 *      a fragment rather than the whole, or it answers questions about the whole document from chunk 1.
 */

export interface Chunk {
	/** 1-based, for the model. */
	index: number;
	total: number;
	text: string;
}

export interface ChunkOptions {
	/** How many characters a chunk may hold. */
	maxChars?: number;
	/** Overlap: if the previous chunk's last paragraph is no longer than this, repeat it at the next chunk's start. */
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
			// A single paragraph exceeding the limit is its own chunk.
			// Rather than cutting mid-paragraph, let this chunk exceed maxChars a little.
			// (A real product would do sentence-level splitting here; that is Exercise 4.)
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

				// Overlap: carry the previous chunk's last paragraph across, provided it is short enough
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
