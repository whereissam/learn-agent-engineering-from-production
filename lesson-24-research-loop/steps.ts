/**
 * This lesson's four LLM steps.
 *
 * Note that each is a **single call with clear inputs and outputs and no tools**:
 *
 *   clarify          the question → 3 clarifying questions
 *   generateQueries  the question plus what is known → N queries
 *   extractLearnings a query plus page content → conclusions plus follow-up questions
 *   writeReport      all conclusions → the report
 *
 * This is the biggest difference in shape between a research loop and an agent loop:
 *
 * ```text
 * Agent loop        one big model plus a pile of tools plus a loop nobody can bound
 * Research loop     one program plus four small, testable model calls
 * ```
 *
 * Every step can be tested, re-modelled and costed on its own.
 * **That is why Deep Research products finish and Lesson 22's agent does not.**
 */

import type { StreamingProvider } from "../shared/streaming/types.ts";
import { drain } from "../shared/streaming/types.ts";
import type { Learning, ResearchState } from "./state.ts";
import { summarizeLearnings } from "./state.ts";

/**
 * The system prompt is copied from deep-research/src/prompt.ts, plus today's date.
 *
 * "What day is it" matters especially for research tasks: a model's training data has a
 * cutoff, and it does not know what day it is now, so it treats three-year-old things as new.
 */
function systemPrompt(today: string): string {
	return `You are an expert researcher. Today is ${today}.

- The user is an experienced engineer. Be specific and dense; do not pad.
- Always include concrete entities: project names, version numbers, dates, licences, numbers.
- If the sources do not support a claim, say so instead of filling the gap from memory.
- Never invent a URL.`;
}

async function ask(
	provider: StreamingProvider,
	state: ResearchState,
	prompt: string,
	maxTokens = 2000,
): Promise<string> {
	state.budget.llmCalls++;
	const response = await drain(
		provider.stream({
			system: systemPrompt(TODAY),
			messages: [{ role: "user", text: prompt }],
			tools: [],
			maxTokens,
		}),
	);

		// Output cut off by the token limit must always be reported.
	//
		// On the first real-model run the report stopped mid-URL at `(https://github.com/kin`
		// — no error, no warning, and it looked exactly like the model had finished.
		// 12 pieces of evidence went in and 3000 tokens could not hold the answer.
	//
		// Same disease as Lesson 21 Step 5: **a silent truncation is more dangerous than an
		// obvious failure.** Lesson 2's tool output says "I truncated this", and so must this.
	if (response.stopReason === "max_tokens") {
		state.trace.push(`      ⚠ 輸出撞到 ${maxTokens} token 上限，內容不完整`);
		state.budget.truncatedOutputs++;
	}

	return response.blocks
		.filter((b) => b.type === "text")
		.map((b) => b.text)
		.join("\n");
}

/** "Today" is hardcoded, for the same reason as Lesson 22's `TODAY`: reproducibility. */
const TODAY = "2026-07-27";

// ─────────────────────────────────────────────────────────────
// Defensive JSON parsing
// ─────────────────────────────────────────────────────────────

/**
 * A model saying it will return JSON does not mean it will return JSON.
 *
 * Lesson 23 found gpt-researcher has a whole function for this
 * (`_normalize_sub_queries` at `actions/query_processing.py:6`), using `json_repair.loads`
 * rather than `json.loads`. That looked excessive at the time, and writing one makes clear
 * it is not:
 *
 *   - wrapped in ```json fences
 *   - prefixed with "Sure, here are the queries:"
 *   - an object `{queries: [...]}` instead of an array
 *   - a bare string
 *
 * All four have happened. So this does not assert a format but **tries to rescue it**, and
 * returns an empty array when it cannot, leaving the caller to decide —
 * **never let one formatting slip blow up the whole research run.**
 */
function parseJson(text: string): unknown {
	const cleaned = text
		.replace(/^[\s\S]*?```(?:json)?/i, "")
		.replace(/```[\s\S]*$/, "")
		.trim();

	for (const candidate of [cleaned, text.trim()]) {
		try {
			return JSON.parse(candidate);
		} catch {
			// Then try to pull out the first block that looks like JSON
			const match = /[[{][\s\S]*[\]}]/.exec(candidate);
			if (match) {
				try {
					return JSON.parse(match[0]);
				} catch {
					// Try the next candidate
				}
			}
		}
	}
	return undefined;
}

/** Normalise "maybe an array, maybe wrapped in an object, maybe a single string" into an array. */
function toArray(parsed: unknown, keys: string[]): unknown[] {
	if (Array.isArray(parsed)) return parsed;
	if (parsed && typeof parsed === "object") {
		for (const key of keys) {
			const value = (parsed as Record<string, unknown>)[key];
			if (Array.isArray(value)) return value;
		}
	}
	if (typeof parsed === "string" && parsed.trim()) return [parsed];
	return [];
}

// ─────────────────────────────────────────────────────────────
// Step 0: ask before researching (deep-research/src/feedback.ts)
// ─────────────────────────────────────────────────────────────

/**
 * Generate clarifying questions.
 *
 * deep-research asks the user 3 questions **before** starting research (`src/feedback.ts`,
 * 28 lines in total). A very cheap step that can save a whole round of research in the
 * wrong direction.
 *
 * Here it does not actually wait for an answer by default (only the demo's `--ask` does),
 * because its teaching value is **seeing what the model finds unclear**.
 */
export async function clarify(
	provider: StreamingProvider,
	state: ResearchState,
	count = 3,
): Promise<string[]> {
	const text = await ask(
		provider,
		state,
		`Given this research request, ask up to ${count} follow-up questions that would ` +
			`most change how you research it. Return ONLY a JSON array of strings.\n\n` +
			`<request>${state.question}</request>`,
		800,
	);
	return toArray(parseJson(text), ["questions"])
		.map((q) => String(q).trim())
		.filter(Boolean)
		.slice(0, count);
}

// ─────────────────────────────────────────────────────────────
// Step 1: generate queries
// ─────────────────────────────────────────────────────────────

export interface PlannedQuery {
	query: string;
	/** Why this search. Copied from deep-research's researchGoal (`deep-research.ts:66`). */
	goal: string;
}

/**
 * Generate the queries for this level.
 *
 * The four rules were copied from real projects in Lesson 23, and this time they are in code
 * rather than left to the agent's self-discipline:
 *   no search operators           gpt-researcher/prompts.py:250
 *   generate N at once, dissimilar deep-research.ts:54
 *   each carries a research goal   deep-research.ts:66
 *   do not repeat past searches    added here, the lesson from Lesson 22 Step 8
 */
export async function generateQueries(
	provider: StreamingProvider,
	state: ResearchState,
	seed: string,
	count: number,
): Promise<PlannedQuery[]> {
	const already =
		state.queriesRun.length > 0
			? `\nQueries already run (do NOT repeat or paraphrase these):\n${state.queriesRun.map((q) => `- ${q}`).join("\n")}`
			: "";

	const text = await ask(
		provider,
		state,
		`Generate up to ${count} web search queries for this research direction.\n\n` +
			`<direction>${seed}</direction>\n\n` +
			`What we already know:\n${summarizeLearnings(state)}\n${already}\n\n` +
			"Rules:\n" +
			"- Each query must be a plain natural language phrase. Do NOT use search operators " +
			"(site:, filetype:, OR, AND, quotes as operators).\n" +
			"- Each query must be unique and not similar to the others or to the ones already run.\n" +
			"- Do not search for project names you remember from training; search by capability.\n" +
			'- For each query state what you expect to learn from it.\n\n' +
			'Return ONLY JSON: [{"query": "...", "goal": "..."}]',
		1200,
	);

	return toArray(parseJson(text), ["queries"])
		.map((item) => {
			if (typeof item === "string") return { query: item, goal: "" };
			const record = (item ?? {}) as Record<string, unknown>;
			return {
				query: String(record.query ?? "").trim(),
				goal: String(record.goal ?? record.researchGoal ?? "").trim(),
			};
		})
		.filter((q) => q.query.length > 0)
		.slice(0, count);
}

// ─────────────────────────────────────────────────────────────
// Step 2: compress pages into learnings
// ─────────────────────────────────────────────────────────────

export interface PageContent {
	url: string;
	title: string;
	text: string;
}

export interface Extraction {
	learnings: Learning[];
	followUps: string[];
	/**
		 * Why this extraction produced nothing (undefined when it did produce something).
	 *
		 * This field was added after a measurement. On the first real-model run, one query
		 * fetched four pages and then reported "0 conclusions" — **with no message saying why**.
	 *
		 * That is the same face as Lesson 21 Step 5's silent failure:
		 * the pipeline is not broken, nothing threw, and nothing happened.
		 * So this forces the reason to be stated.
	 */
	failure?: "parse-failed" | "no-learnings" | "sources-filtered";
		/** How many were dropped for citing a URL that was never fetched. */
	droppedForSources: number;
}

/**
 * This is the whole loop's compression valve.
 *
 * In go several pages of body text (thousands to tens of thousands of characters); out come
 * at most N one-sentence conclusions.
 * **The next round carries conclusions, not pages.** Without this step, context explodes by
 * the third level.
 * Against `deep-research.ts:102`. One thing is added here: **every conclusion carries its
 * sources**. deep-research's learning is a plain string, so a report cannot map a sentence
 * back to a source (see the Learning comment in `state.ts`).
 */
export async function extractLearnings(
	provider: StreamingProvider,
	state: ResearchState,
	query: string,
	pages: PageContent[],
	depth: number,
	maxLearnings = 3,
): Promise<Extraction> {
	if (pages.length === 0) return { learnings: [], followUps: [], droppedForSources: 0 };

		// One trimmed passage per page. deep-research trims to 25k tokens (`:93`);
		// this corpus is much shorter, so a character count approximates it.
	const documents = pages
		.map((p) => `<source url="${p.url}" title="${p.title}">\n${p.text.slice(0, 4000)}\n</source>`)
		.join("\n\n");

	const text = await ask(
		provider,
		state,
		`These pages were retrieved for the query "${query}".\n\n${documents}\n\n` +
			`Extract up to ${maxLearnings} learnings. Each learning must:\n` +
			"- be one dense sentence with concrete entities, versions, dates or numbers\n" +
			"- be supported by the source text, not by what you already believe\n" +
			'- list the url(s) it came from in "sources"\n\n' +
			`Also list up to ${maxLearnings} follow-up questions that the pages did NOT answer.\n\n` +
			'Return ONLY JSON: {"learnings": [{"text": "...", "sources": ["url"]}], "followUps": ["..."]}',
		2000,
	);

	const parsed = parseJson(text);
	const known = new Set(pages.map((p) => p.url));

	if (parsed === undefined) {
		return { learnings: [], followUps: [], failure: "parse-failed", droppedForSources: 0 };
	}

	const learnings = toArray(
		parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>).learnings : parsed,
		["learnings"],
	)
		.map((item) => {
			const record = (item ?? {}) as Record<string, unknown>;
			const rawSources = Array.isArray(record.sources) ? record.sources : [];
			return {
				text: String(record.text ?? record.learning ?? "").trim(),
					// Keep only URLs that were really fetched. Models love to helpfully add a
					// plausible-looking URL, which is exactly the citation grafting seen in Lesson 21
					// Step 6. A program blocks it here, rather than a prompt asking nicely.
				sources: rawSources.map((s) => String(s).trim()).filter((s) => known.has(s)),
				depth,
			};
		})
	// Counted separately: content whose sources were filtered out, and no output at all, are different things.
	const withSources = learnings.filter((l) => l.sources.length > 0);
		// Counted separately: producing content whose sources were filtered out and producing
		// nothing at all are different things.
	const droppedForSources = learnings.length - withSources.length;

	const followUps = toArray(
		parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>).followUps : [],
		["followUps", "follow_up_questions", "questions"],
	)
		.map((q) => String(q).trim())
		.filter(Boolean)
		.slice(0, maxLearnings);

	const failure =
		withSources.length > 0
			? undefined
			: droppedForSources > 0
				? "sources-filtered"
				: "no-learnings";

	return { learnings: withSources, followUps, failure, droppedForSources };
}

// ─────────────────────────────────────────────────────────────
// Step 3: write the report
// ─────────────────────────────────────────────────────────────

/**
 * Turn all the learnings into a report.
 *
 * The key: **the model sees no web pages at this step**, only learnings.
 * So the ceiling on what it can write is the evidence extracted earlier.
 *
 * That is deliberate. Put pages back in at this step and you are back to "a huge blob of
 * context in, a huge blob of text out", with no way to trace any sentence to its source.
 */
export async function writeReport(
	provider: StreamingProvider,
	state: ResearchState,
): Promise<string> {
	if (state.learnings.length === 0) {
		return "研究沒有得到任何有來源支持的結論。這通常代表 query 的方向不對，或是語料裡真的沒有相關內容。";
	}

	const evidence = state.learnings
		.map((l, i) => `[${i + 1}] ${l.text}\n    sources: ${l.sources.join(", ")}`)
		.join("\n");

	return await ask(
		provider,
		state,
		`Write a report answering this question, using ONLY the findings below.\n\n` +
			`<question>${state.question}</question>\n\n<findings>\n${evidence}\n</findings>\n\n` +
			"Rules:\n" +
			"- Every factual sentence must cite the url(s) it came from, inline.\n" +
			"- Do not add facts that are not in the findings. If something important is missing, " +
			"say explicitly what could not be established.\n" +
			"- Lead with the answer, then the evidence, then the caveats.\n" +
			"- Answer in the same language as the question.",
			// Report length grows with the evidence count. 12 pieces with 3000 tokens does not
			// finish, and stops mid-sentence. This number is tuned together with breadth/depth.
		6000,
	);
}
