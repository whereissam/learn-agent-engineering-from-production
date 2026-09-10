/**
 * Tool search: the tools are not in the context, an index of them is.
 *
 * Source: `mastra/packages/core/src/processors/processors/tool-search.ts` (654
 * lines) and `tool-search-stores.ts` (258 lines).
 *
 * ## The mechanism in one paragraph
 *
 * Give the model two meta-tools instead of the catalogue. `search_tools` runs BM25
 * over the tool names and descriptions and returns the top few as *text*.
 * `load_tool` promotes named tools into the request's real tool list. Only then can
 * the model call them. Mastra names the three states on
 * `tool-search.ts:12`:
 *
 *     export type ToolSearchFilterPhase = 'search' | 'load' | 'active';
 *
 * `search` — visible to the index, cheap, no schema in context.
 * `load`   — the model asked for it by name.
 * `active` — its full schema is in the request and it can be called.
 *
 * Those are three separate places to say no. A tool the user is not allowed to use
 * should not even be searchable; a tool that is searchable may still be refused at
 * load. Mastra threads a `filter(toolName, tool, phase)` callback through all
 * three for exactly that.
 *
 * ## What is deliberately smaller here
 *
 * Mastra's version carries per-thread stores with a TTL, a `ContextLoadedToolStore`
 * that survives across requests, and an `autoLoad` mode that collapses search and
 * load into one step. This file keeps the index, the three phases and one in-memory
 * store, because those are what the experiment needs. The stores are the part you
 * will actually have to think about in production — see the README's Step 5.
 */

import type { ToolSpec } from "../shared/providers/types.ts";

// ─────────────────────────────────────────────────────────────
// Tokenisation
// ─────────────────────────────────────────────────────────────

/**
 * Mirrors Mastra's `TOOL_SEARCH_TOKENIZE_OPTIONS` (`tool-search.ts:113`):
 * lowercase, split on punctuation *including underscores and hyphens*, minimum
 * length 2, **no stopword list**.
 *
 * The underscore split is the load-bearing part: `github_update_branch_protection`
 * has to become five terms or a query for "branch protection" never reaches it.
 *
 * Dropping stopwords is Mastra's call, and its stated reason is that tool
 * descriptions are short. It cuts the other way on the query side — a user's
 * sentence is mostly stopwords — and BM25's IDF term is what saves it: a word in
 * every document scores near zero anyway. Lesson 20's engine made the opposite
 * choice for prose documents, and both are defensible.
 */
export function tokenize(text: string): string[] {
	return text
		.toLowerCase()
		.split(/[\s\-_.,;:!?()[\]{}'"/+]+/)
		.filter((t) => t.length >= 2);
}

// ─────────────────────────────────────────────────────────────
// BM25 over tool descriptions
// ─────────────────────────────────────────────────────────────

const K1 = 1.5;
const B = 0.75;

export interface ToolHit {
	name: string;
	description: string;
	score: number;
	rank: number;
}

interface Doc {
	name: string;
	freq: Map<string, number>;
	length: number;
}

/**
 * The same BM25 as Lessons 17 and 20. Only the documents change: a session's
 * messages there, `name + description` here.
 *
 * That is the cheap part of this lesson and worth saying out loud — the mechanism
 * is not a new retrieval technique, it is pointing an old one at the tool list.
 */
export class ToolIndex {
	private docs: Doc[] = [];
	private df = new Map<string, number>();
	private avgLength = 0;
	private byName = new Map<string, ToolSpec>();

	constructor(tools: ToolSpec[]) {
		for (const tool of tools) {
			this.byName.set(tool.name, tool);
			// Mastra indexes `${name} ${description}` — tool-search.ts:354.
			const tokens = tokenize(`${tool.name} ${tool.description}`);
			const freq = new Map<string, number>();
			for (const t of tokens) freq.set(t, (freq.get(t) ?? 0) + 1);
			for (const t of freq.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
			this.docs.push({ name: tool.name, freq, length: tokens.length });
		}
		this.avgLength = this.docs.reduce((sum, d) => sum + d.length, 0) / this.docs.length;
	}

	get size(): number {
		return this.docs.length;
	}

	spec(name: string): ToolSpec | undefined {
		return this.byName.get(name);
	}

	search(query: string, topK = 5, minScore = 0): ToolHit[] {
		const terms = tokenize(query);
		if (terms.length === 0) return [];

		const N = this.docs.length;
		const scored = this.docs.map((doc) => {
			let score = 0;
			for (const term of terms) {
				const tf = doc.freq.get(term) ?? 0;
				if (tf === 0) continue;
				const df = this.df.get(term) ?? 0;
				const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
				const norm = tf * (K1 + 1);
				const denom = tf + K1 * (1 - B + (B * doc.length) / this.avgLength);
				score += idf * (norm / denom);
			}
			return { name: doc.name, score };
		});

		return scored
			.filter((s) => s.score > minScore)
			.sort((a, b) => b.score - a.score)
			.slice(0, topK)
			.map((s, i) => ({
				name: s.name,
				description: this.byName.get(s.name)?.description ?? "",
				score: s.score,
				rank: i + 1,
			}));
	}

	/** Where the correct tool actually landed, or `undefined` if it scored zero. Only used for measurement. */
	rankOf(query: string, name: string): number | undefined {
		const all = this.search(query, this.docs.length);
		const found = all.findIndex((h) => h.name === name);
		return found === -1 ? undefined : found + 1;
	}
}

// ─────────────────────────────────────────────────────────────
// The two meta-tools
// ─────────────────────────────────────────────────────────────

/**
 * These two specs are the *entire* tool list the model starts with. Their combined
 * size against the 200-tool catalogue's is the number Step 1 measures.
 */
export const SEARCH_TOOLS_SPEC: ToolSpec = {
	name: "search_tools",
	description:
		"Search the catalogue of available tools by keyword. Returns matching tool names and descriptions. " +
		"You cannot call a tool found this way until you load it with load_tool.",
	parameters: {
		type: "object",
		properties: {
			query: { type: "string", description: "Keywords describing what you need to do." },
		},
		required: ["query"],
	},
};

export const LOAD_TOOL_SPEC: ToolSpec = {
	name: "load_tool",
	description:
		"Make one or more tools found by search_tools available to call. " +
		"Pass exact tool names. They become callable on your next turn.",
	parameters: {
		type: "object",
		properties: {
			toolNames: { type: "array", items: { type: "string" }, description: "Exact tool names to load." },
		},
		required: ["toolNames"],
	},
};

// ─────────────────────────────────────────────────────────────
// The three phases, as state
// ─────────────────────────────────────────────────────────────

export type Phase = "search" | "load" | "active";

/** Mastra's `filter` hook, reduced to its signature. Returning false means "not at this phase". */
export type PhaseFilter = (name: string, phase: Phase) => boolean;

export interface SearchOutcome {
	hits: ToolHit[];
	/** Rendered for the model. Mastra truncates descriptions to 150 characters (tool-search.ts:417). */
	text: string;
}

/**
 * One conversation's loaded-tool state.
 *
 * Mastra makes this pluggable (`LegacyMapLoadedToolStore` with a TTL,
 * `ContextLoadedToolStore` keyed by thread) because *where this set lives* decides
 * whether a tool loaded in turn 3 is still loaded in turn 40, or after a restart.
 * That question is Lesson 33's, and the README's Step 5 says why it is not a detail.
 */
export class ToolSearchSession {
	private loaded = new Set<string>();

	constructor(
		private index: ToolIndex,
		private filter: PhaseFilter = () => true,
		private topK = 5,
	) {}

	search(query: string): SearchOutcome {
		const hits = this.index
			.search(query, this.topK * 2)
			.filter((h) => this.filter(h.name, "search"))
			.slice(0, this.topK);

		const text =
			hits.length === 0
				? "No tools matched. Try different keywords."
				: hits
						.map((h) => {
							const d = h.description.length > 150 ? `${h.description.slice(0, 147)}...` : h.description;
							return `${h.name}: ${d}`;
						})
						.join("\n");

		return { hits, text };
	}

	/** Returns what was actually loaded and what was refused, because the model needs to be told which. */
	load(names: string[]): { loaded: string[]; rejected: string[] } {
		const loaded: string[] = [];
		const rejected: string[] = [];
		for (const name of names) {
			if (!this.index.spec(name) || !this.filter(name, "load")) {
				rejected.push(name);
				continue;
			}
			this.loaded.add(name);
			loaded.push(name);
		}
		return { loaded, rejected };
	}

	/** The tools whose full schema goes into the next request. */
	active(): ToolSpec[] {
		return [...this.loaded]
			.filter((name) => this.filter(name, "active"))
			.map((name) => this.index.spec(name))
			.filter((s): s is ToolSpec => s !== undefined);
	}

	/** What the request's `tools` field actually contains: the meta-tools plus whatever is active. */
	requestTools(): ToolSpec[] {
		return [SEARCH_TOOLS_SPEC, LOAD_TOOL_SPEC, ...this.active()];
	}

	isLoaded(name: string): boolean {
		return this.loaded.has(name);
	}
}

/** The bytes a tool list costs on the wire. Not tokens — `agent.ts` measures those against a real provider. */
export function serialisedBytes(tools: ToolSpec[]): number {
	return JSON.stringify(tools).length;
}
