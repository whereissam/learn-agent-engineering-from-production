/**
 * Every passage of source this lesson cites.
 *
 * Design principle 4 says citations into other people's source must be verified. Earlier lessons' tables only dared say
 * which project a concept corresponds to, without line numbers, because the source had not been read. This lesson read it,
 * so every entry has a file and a line — and **line numbers go stale**.
 *
 * So this list is executable: `bun run lesson-23:check` goes into your local
 * clones and confirms each line is still there. After an upstream change you see which entries drifted,
 * rather than reading a document that looks precise and no longer matches.
 *
 * The versions read (`git rev-parse --short HEAD`):
 *
 *   deep-research    1f8f3e2    2026-04-11
 *   gpt-researcher   5d84d2f5   2026-07-14
 *   firecrawl        ab033afd9  2026-07-26
 *   crawl4ai         7e80152    2026-07-15
 */

export interface Citation {
	/** Which lesson and which topic here */
	topic: string;
	repo: "deep-research" | "gpt-researcher" | "firecrawl" | "crawl4ai";
	path: string;
	line: number;
	/** A string that must appear on (or near) that line. Used to tell whether the line number drifted. */
	contains: string;
	/** What this entry is about */
	note: string;
}

export const CITATIONS: Citation[] = [
		// ── Lesson 20: query generation ────────────────────────────
	{
		topic: "L20 query generation: no search operators",
		repo: "gpt-researcher",
		path: "gpt_researcher/prompts.py",
		line: 250,
		contains: "Do not use search operator syntax",
		note: "Lesson 20 Step 4 observed the model inventing site: / OR / quotes. They forbid it outright in one prompt line.",
	},
	{
		topic: "L20 query generation: how many at once, and no duplicates",
		repo: "deep-research",
		path: "src/deep-research.ts",
		line: 54,
		contains: "Make sure each query is unique and not similar to each other",
		note: "Structured output asks for N queries at once and requires them to be dissimilar.",
	},
	{
		topic: "L20 query generation: each query carries a research goal",
		repo: "deep-research",
		path: "src/deep-research.ts",
		line: 66,
		contains: "researchGoal",
		note: "A query is not a bare string but {query, researchGoal}. The next round continues from researchGoal.",
	},
	{
		topic: "L20 query generation: search once before generating sub-questions",
		repo: "gpt-researcher",
		path: "gpt_researcher/actions/query_processing.py",
		line: 108,
		contains: "generate_search_queries_prompt",
		note: "Sub-queries are generated with the initial search results as context, not from the question alone.",
	},
	{
		topic: "L20 structured output breaks",
		repo: "gpt-researcher",
		path: "gpt_researcher/actions/query_processing.py",
		line: 6,
		contains: "_normalize_sub_queries",
		note: "The whole function handles four cases: the model returned a list, a dict, a string, or None. This is what production looks like.",
	},

		// ── Lesson 21: fetching and extraction ────────────────────
	{
		topic: "L21 extraction: tags dropped wholesale",
		repo: "crawl4ai",
		path: "crawl4ai/content_filter_strategy.py",
		line: 101,
		contains: "self.excluded_tags",
		note: "nav/footer/header/aside/script/style/form/iframe/noscript — almost identical to our DROP_TAGS.",
	},
	{
		topic: "L21 extraction: the class/id blocklist",
		repo: "crawl4ai",
		path: "crawl4ai/content_filter_strategy.py",
		line: 113,
		contains: "negative_patterns",
		note: "nav|footer|header|sidebar|ads|comment|promo|advert|social|share, in one regular expression.",
	},
	{
		topic: "L21 extraction: tables and lists kept from the start",
		repo: "crawl4ai",
		path: "crawl4ai/content_filter_strategy.py",
		line: 50,
		contains: "included_tags",
		note: "ul/ol/li/table/tr/td/pre/code are all on the allowlist. Lesson 21 hit this three times before learning it.",
	},
	{
		topic: "L21 extraction: text-density scoring",
		repo: "crawl4ai",
		path: "crawl4ai/content_filter_strategy.py",
		line: 568,
		contains: "threshold: float = 0.48",
		note: "PruningContentFilter scores with weighted text_density/link_density/tag_weight/class_id_weight.",
	},
	{
		topic: "L21 extraction: the industrial-strength blocklist",
		repo: "firecrawl",
		path: "apps/api/src/scraper/scrapeURL/lib/removeUnwantedElements.ts",
		line: 9,
		contains: "excludeNonMainTags",
		note: "48 CSS selectors. The same idea, with a much longer list.",
	},
	{
		topic: "L21 extraction: hardcoding for specific sites",
		repo: "firecrawl",
		path: "apps/api/src/scraper/scrapeURL/lib/removeUnwantedElements.ts",
		line: 53,
		contains: "forceIncludeMainTags",
		note: "The allowlist contains platform-specific classes like .swoogo-*. Real extractors contain exactly this sort of thing.",
	},
	{
		topic: "L21 extraction: when the fast path breaks, have a slow path",
		repo: "firecrawl",
		path: "apps/api/src/scraper/scrapeURL/lib/removeUnwantedElements.ts",
		line: 106,
		contains: "Falling back to cheerio",
		note: "The primary path is a Rust transformer, falling back to cheerio on failure. Performance and reliability in two layers.",
	},

		// ── Lesson 22: retrieval and ranking ──────────────────────
	{
		topic: "L22 chunk size",
		repo: "gpt-researcher",
		path: "gpt_researcher/context/compression.py",
		line: 134,
		contains: "chunk_size=1000, chunk_overlap=100",
		note: "1000 characters per chunk with 10% overlap. Lesson 21 uses 2400 characters plus one overlapping passage.",
	},
	{
		topic: "L22 dense: filter by threshold, not top-k",
		repo: "gpt-researcher",
		path: "gpt_researcher/context/compression.py",
		line: 123,
		contains: "SIMILARITY_THRESHOLD",
		note: 'Default 0.35. Anything below the threshold is dropped entirely — a different philosophy from "rank and take the top five".',
	},
	{
		topic: "L22 prefer the cheap path",
		repo: "gpt-researcher",
		path: "gpt_researcher/context/compression.py",
		line: 164,
		contains: "COMPRESSION_THRESHOLD",
		note: "Under 8000 characters of total content, embedding is skipped entirely. Do not pay when you do not need to.",
	},
	{
		topic: "L22 per-page content cap",
		repo: "deep-research",
		path: "src/deep-research.ts",
		line: 93,
		contains: "trimPrompt(content, 25_000)",
		note: "Each page is cut to 25k tokens before entering the prompt. No rerank, no ranking, just a hard cut.",
	},

		// ── Setting up Lesson 24: the loop and stopping conditions ─
	{
		topic: "L24 the stopping condition is structural, not the model's decision",
		repo: "deep-research",
		path: "src/deep-research.ts",
		line: 230,
		contains: "Math.ceil(breadth / 2)",
		note: 'Each level halves the breadth and decrements the depth. The model never gets a say in "should I continue".',
	},
	{
		topic: "L24 the next round's queries are produced by the previous round",
		repo: "deep-research",
		path: "src/deep-research.ts",
		line: 252,
		contains: "Previous research goal",
		note: "The next round's input is the previous round's researchGoal + followUpQuestions, not the original question.",
	},
	{
		topic: "L24 what flows through the loop is learnings, not web pages",
		repo: "deep-research",
		path: "src/deep-research.ts",
		line: 102,
		contains: "generate a list of learnings from the contents",
		note: "Five pages of content compress into at most 3 learnings + 3 follow-up questions. The raw text does not enter the next round.",
	},
	{
		topic: "L24 remember which URLs have been read",
		repo: "gpt-researcher",
		path: "gpt_researcher/skills/researcher.py",
		line: 801,
		contains: "_get_new_urls",
		note: "visited_urls are filtered out before fetching. Exactly what Lesson 22 Step 8 was missing.",
	},
	{
		topic: "L24 visited_urls must be shared across sub-research",
		repo: "gpt-researcher",
		path: "gpt_researcher/skills/researcher.py",
		line: 108,
		contains: "deliberately NOT cleared",
		note: "The comment says it plainly: sub-research shares the parent's visited_urls, so it must not be cleared.",
	},
	{
		topic: "L24 concurrency is a small hardcoded number",
		repo: "deep-research",
		path: "src/deep-research.ts",
		line: 30,
		contains: "ConcurrencyLimit",
		note: 'Default 2. The comment says "raise it if you have a higher rate limit".',
	},
	{
		topic: "L24 one failing branch must not take down the round",
		repo: "deep-research",
		path: "src/deep-research.ts",
		line: 282,
		contains: "learnings: []",
		note: "On catch it returns an empty result and the other branches carry on. Timeouts are logged separately.",
	},
];
