/**
 * Rerank: have the model re-rank the top few.
 *
 * Every earlier stage (BM25, dense, the signals) looks only at **statistics of the documents themselves**,
 * and none of them really "understands" the relation between query and document. Rerank is the last stage,
 * saving the expensive thing for when the candidates are already few.
 *
 * ```text
 * 14 documents → cheap retrieval takes the top 10 → the expensive model sees only those 10 → the top 5
 * ```
 *
 * **The same pattern as Lesson 6's `find_anomalies`**:
 * narrow the field with a cheap deterministic method, then let the model judge.
 *
 * ## Why an LLM here rather than a cross-encoder
 *
 * The textbook answer is a cross-encoder (`ms-marco-MiniLM-L-6-v2`, say):
 * feed the query and the document into a small model together and get a relevance score out. It is
 * orders of magnitude cheaper than an LLM, with far lower latency.
 *
 * It is not used here only because that needs downloading model weights, and this repo deliberately adds no dependencies.
 * **The shape is the same**: a model that sees the query and the full document re-scores it.
 *
 * ⚠️ This stage is off by default. The reason is in README Step 6:
 * on this 14-document corpus it **did not improve nDCG**.
 */

import { selectStreamingProvider } from "../../shared/streaming/index.ts";
import { drain } from "../../shared/streaming/types.ts";

export interface RerankCandidate {
	id: string;
	title: string;
	url: string;
	/** The content shown to the model. A real system would give extracted body text or the most relevant chunk. */
	text: string;
}

const SYSTEM = `You score how well a document answers a search query.

For each document output one line: <id> <score>
score is an integer 0-3:
  3 = directly answers the query
  2 = useful supporting evidence, not the main answer
  1 = tangentially related
  0 = not relevant

Rules:
- Judge the document's actual content, not how many query words it repeats.
- A page that repeats the query terms but says nothing is 0.
- An outdated page that would mislead the user is at most 1.
- Output nothing except the id/score lines.`;

/**
 * Return id → score. Ids the model omits count as 0, with the caller deciding what to do.
 *
 * This deliberately **does not ask the model for a ranking**, only per-document scores. The reason:
 * asking a model to emit a sorted list makes it easy to omit or repeat ids,
 * while per-document scores can be validated line by line. **The simpler the output format, the easier the errors.**
 */
export async function llmRerank(
	query: string,
	candidates: RerankCandidate[],
	maxChars = 700,
): Promise<Map<string, number>> {
	if (candidates.length === 0) return new Map();

	const provider = selectStreamingProvider();
	const listing = candidates
		.map((c) => `[${c.id}]\ntitle: ${c.title}\n${c.text.slice(0, maxChars)}`)
		.join("\n\n---\n\n");

	const response = await drain(
		provider.stream({
			system: SYSTEM,
			messages: [{ role: "user", text: `query: ${query}\n\n${listing}` }],
			tools: [],
			maxTokens: 1000,
		}),
	);

	const text = response.blocks
		.filter((b) => b.type === "text")
		.map((b) => b.text)
		.join("\n");

	const scores = new Map<string, number>();
	for (const line of text.split("\n")) {
			// Tolerate "[id] 3", "id 3" and "id: 3".
			// A model's output format always drifts a little, so the parser should be lenient.
		const match = /^\s*\[?([a-z0-9-]+)\]?\s*[: ]\s*([0-3])\s*$/i.exec(line);
		if (!match) continue;
		const [, id, score] = match;
		if (id && score) scores.set(id, Number(score));
	}

	return scores;
}
