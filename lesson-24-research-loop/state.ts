/**
 * Research state: this lesson's real protagonist.
 *
 * Lesson 22 Step 8's failure looked like this: the model searched 14 times, hit the step ceiling, no answer.
 * The conclusion then was "ranking cannot fix this, because the problem is on the agent's side".
 *
 * What this lesson says is that the problem is **not on the agent's side but in the agent shape itself**:
 *
 * ```text
 * Agent loop (Lessons 1-23)   the model decides the next step → until it says stop
 * Research loop (this lesson) the program decides the next step → it stops when the budget runs out,
 *                             and the model only does small tasks
 *
 * The difference is not "which is smarter" but **who holds the control flow**.
 * A while loop with no stopping condition, paired with a model that always feels "one more search
 * might help", burns the step ceiling.
 *
 * There is no LLM call in this file. It is merely **a state machine's state** —
 * and almost all of this lesson's value is here.
 */

/**
 * One learned thing.
 *
 * ⚠️ This differs from deep-research, deliberately.
 *
 * The learnings at `deep-research/src/deep-research.ts:107` are `string[]`, plain text with
 * **no sources**. So at the report-writing step (`:129`) all it can do is dump every learning
 * into the prompt and append a list of "all URLs visited" at the end of the report.
 *
 * That list cannot tell you **which sentence came from which URL**.
 * Lesson 21 Step 6 showed "citation grafting" first-hand: an unsupported sentence carrying a
 * real URL. Catching that requires evidence and source to be bound together.
 *
 * So `sources` is stored as well. That is the precondition for Lesson 25's citation verification.
 */
export interface Learning {
	/** A one-sentence conclusion. Specific, carrying a number or a date. */
	text: string;
	/** Which URLs this sentence was read from. **Must not be empty.** */
	sources: string[];
	/** Which level this was learned at. Useful for understanding the research's shape, and for debugging. */
	depth: number;
}

/** Resources spent. The other face of the depth knob: depth is money. */
export interface Budget {
	llmCalls: number;
	searches: number;
	fetches: number;
	/** How many times a URL was skipped for having been read. The larger this is, the more dedup is worth. */
	skippedDuplicates: number;
	/** How many times a query was skipped for having been run. */
	skippedQueries: number;
	/** How many model outputs hit the token limit and were truncated. **Anything other than zero needs handling.** */
	truncatedOutputs: number;
}

export interface ResearchState {
	question: string;
	learnings: Learning[];
	/**
		 * URLs already read.
	 *
		 * Against `_get_new_urls` at `gpt-researcher/gpt_researcher/skills/researcher.py:801`,
		 * and the comment at `:108`:
	 *
	 *   > visited_urls is deliberately NOT cleared here. It may be shared with a
	 *   > parent researcher ... so that already scraped URLs are not fetched again.
	 *
		 * Note this Set is **shared across the whole research tree**, not one per level.
		 * deep-research does collect visitedUrls but **only uses them to list Sources at the end
		 * of the report** (`deep-research.ts:229`, `:292`), never to avoid re-fetching.
		 * A clear difference between the two projects; this follows gpt-researcher.
	 */
	visited: Set<string>;
	/** Queries already run, so one level does not ask nearly the same thing twice. */
	queriesRun: string[];
	budget: Budget;
	/** What happened at each step, for the demo to print. */
	trace: string[];
}

export function createState(question: string): ResearchState {
	return {
		question,
		learnings: [],
		visited: new Set(),
		queriesRun: [],
		budget: { llmCalls: 0, searches: 0, fetches: 0, skippedDuplicates: 0, skippedQueries: 0, truncatedOutputs: 0 },
		trace: [],
	};
}

/**
 * The research's shape: breadth and depth.
 *
 * Copied straight from `deep-research/src/deep-research.ts:230-231`:
 *
 * ```ts
 * const newBreadth = Math.ceil(breadth / 2);
 * const newDepth = depth - 1;
 * ```
 *
 * Why halve the breadth? Because the first level asks "what facets does this topic have", and
 * further down it gets more specific and needs fewer queries. Hold the breadth constant and
 * the cost is breadth^depth — breadth=4 with depth=3 is 64 searches.
 *
 * Halved: 4 → 2 → 1, totalling 4 + 8 + 8, a few dozen, and **the bound is computable**.
 *
 * **Being able to compute the bound** is itself the point. Lesson 22's agent's bound was the
 * step ceiling, which is not a budget but a circuit breaker.
 */
export function nextBreadth(breadth: number): number {
	return Math.ceil(breadth / 2);
}

/**
 * Normalise a query into a comparable form.
 *
 * The prompt already says "do not repeat queries you have run", and **that is only a plea**.
 * The fake provider repeated two on its first run — a real model does too, just less often.
 *
 * This lesson's subject is "do not ask a prompt for what a program can guarantee", so
 * duplication is blocked in code rather than merely mentioned in the prompt.
 */
export function normalizeQuery(query: string): string {
	return query
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter(Boolean)
		.sort()
		.join(" ");
}

/** Whether this is the last level. */
export function isLastLayer(depth: number): boolean {
	return depth - 1 <= 0;
}

/**
 * Compress the research state into a passage, as context for the next round's query generation.
 *
 * **What flows through the loop is learnings, not pages.**
 * Against `deep-research.ts:102`: five pages of content compress into at most 3 learnings, and
 * the original text never enters the next round.
 *
 * This is Lesson 5's context compaction growing inside a research loop.
 * Without it, context explodes by the third level.
 */
export function summarizeLearnings(state: ResearchState, max = 12): string {
	if (state.learnings.length === 0) return "(nothing learned yet)";
		// Take the most recent few. The most recent are usually the most specific, because research goes coarse to fine.
	return state.learnings
		.slice(-max)
		.map((l) => `- ${l.text}`)
		.join("\n");
}
