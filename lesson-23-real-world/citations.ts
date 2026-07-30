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
		topic: "L20 query 生成：不要用搜尋運算子",
		repo: "gpt-researcher",
		path: "gpt_researcher/prompts.py",
		line: 250,
		contains: "Do not use search operator syntax",
		note: "我們 Lesson 20 Step 4 觀察到模型會亂生 site: / OR / 引號。他們用一行 prompt 明文禁止。",
	},
	{
		topic: "L20 query 生成：一次生幾條、要不重複",
		repo: "deep-research",
		path: "src/deep-research.ts",
		line: 54,
		contains: "Make sure each query is unique and not similar to each other",
		note: "用 structured output 一次要 N 條，並且要求彼此不相似。",
	},
	{
		topic: "L20 query 生成：每條 query 要附研究目標",
		repo: "deep-research",
		path: "src/deep-research.ts",
		line: 66,
		contains: "researchGoal",
		note: "query 不是裸字串，是 {query, researchGoal}。下一輪要用 researchGoal 接續。",
	},
	{
		topic: "L20 query 生成：先搜一次再生子問題",
		repo: "gpt-researcher",
		path: "gpt_researcher/actions/query_processing.py",
		line: 108,
		contains: "generate_search_queries_prompt",
		note: "sub-query 是拿「初步搜尋結果」當 context 生的，不是只看問題本身。",
	},
	{
		topic: "L20 結構化輸出會壞",
		repo: "gpt-researcher",
		path: "gpt_researcher/actions/query_processing.py",
		line: 6,
		contains: "_normalize_sub_queries",
		note: "整個函式在處理「模型回了 list / dict / 字串 / None」四種情況。生產環境的樣子。",
	},

		// ── Lesson 21: fetching and extraction ────────────────────
	{
		topic: "L21 抽取：整塊丟掉的標籤",
		repo: "crawl4ai",
		path: "crawl4ai/content_filter_strategy.py",
		line: 101,
		contains: "self.excluded_tags",
		note: "nav/footer/header/aside/script/style/form/iframe/noscript。跟我們的 DROP_TAGS 幾乎一樣。",
	},
	{
		topic: "L21 抽取：class/id 黑名單",
		repo: "crawl4ai",
		path: "crawl4ai/content_filter_strategy.py",
		line: 113,
		contains: "negative_patterns",
		note: "nav|footer|header|sidebar|ads|comment|promo|advert|social|share，一個正規表示式。",
	},
	{
		topic: "L21 抽取：表格和清單從一開始就保留",
		repo: "crawl4ai",
		path: "crawl4ai/content_filter_strategy.py",
		line: 50,
		contains: "included_tags",
		note: "ul/ol/li/table/tr/td/pre/code 都在白名單裡。我們 Lesson 21 撞了三次才學到這件事。",
	},
	{
		topic: "L21 抽取：文字密度評分",
		repo: "crawl4ai",
		path: "crawl4ai/content_filter_strategy.py",
		line: 568,
		contains: "threshold: float = 0.48",
		note: "PruningContentFilter 用 text_density/link_density/tag_weight/class_id_weight 加權評分。",
	},
	{
		topic: "L21 抽取：黑名單的產業版本",
		repo: "firecrawl",
		path: "apps/api/src/scraper/scrapeURL/lib/removeUnwantedElements.ts",
		line: 9,
		contains: "excludeNonMainTags",
		note: "48 條 CSS selector。同一個概念，只是清單長很多。",
	},
	{
		topic: "L21 抽取：針對特定網站的硬編碼",
		repo: "firecrawl",
		path: "apps/api/src/scraper/scrapeURL/lib/removeUnwantedElements.ts",
		line: 53,
		contains: "forceIncludeMainTags",
		note: "白名單裡有 .swoogo-* 這種特定平台的 class。真實的抽取器裡就是有這種東西。",
	},
	{
		topic: "L21 抽取：快的路徑壞了要有慢的路徑",
		repo: "firecrawl",
		path: "apps/api/src/scraper/scrapeURL/lib/removeUnwantedElements.ts",
		line: 106,
		contains: "Falling back to cheerio",
		note: "主要走 Rust transformer，失敗才退回 cheerio。效能與可靠性分兩層。",
	},

		// ── Lesson 22: retrieval and ranking ──────────────────────
	{
		topic: "L22 chunk 大小",
		repo: "gpt-researcher",
		path: "gpt_researcher/context/compression.py",
		line: 134,
		contains: "chunk_size=1000, chunk_overlap=100",
		note: "1000 字元一塊、10% 重疊。我們 Lesson 21 用 2400 字元 + 一段重疊。",
	},
	{
		topic: "L22 dense：用門檻過濾，不是取 top-k",
		repo: "gpt-researcher",
		path: "gpt_researcher/context/compression.py",
		line: 123,
		contains: "SIMILARITY_THRESHOLD",
		note: "預設 0.35。相似度低於門檻就整塊丟掉——這跟「排序取前五」是不同的哲學。",
	},
	{
		topic: "L22 便宜的路徑優先",
		repo: "gpt-researcher",
		path: "gpt_researcher/context/compression.py",
		line: 164,
		contains: "COMPRESSION_THRESHOLD",
		note: "總內容 < 8000 字元就完全跳過 embedding。不需要的時候不要付錢。",
	},
	{
		topic: "L22 每頁內容上限",
		repo: "deep-research",
		path: "src/deep-research.ts",
		line: 93,
		contains: "trimPrompt(content, 25_000)",
		note: "每一頁裁到 25k token 才進 prompt。沒有 rerank，沒有排序，就是硬裁。",
	},

		// ── Setting up Lesson 24: the loop and stopping conditions ─
	{
		topic: "L24 停止條件是結構性的，不是模型決定的",
		repo: "deep-research",
		path: "src/deep-research.ts",
		line: 230,
		contains: "Math.ceil(breadth / 2)",
		note: "每深一層，廣度砍半、深度減一。模型從頭到尾沒有「要不要繼續」的發言權。",
	},
	{
		topic: "L24 下一輪的 query 是上一輪的產物",
		repo: "deep-research",
		path: "src/deep-research.ts",
		line: 252,
		contains: "Previous research goal",
		note: "下一輪的輸入 = 上一輪的 researchGoal + followUpQuestions，不是原始問題。",
	},
	{
		topic: "L24 loop 裡流動的是 learnings，不是網頁",
		repo: "deep-research",
		path: "src/deep-research.ts",
		line: 102,
		contains: "generate a list of learnings from the contents",
		note: "五頁內容壓成最多 3 條 learning + 3 個後續問題。原始文字不進下一輪。",
	},
	{
		topic: "L24 已經讀過的 URL 要記得",
		repo: "gpt-researcher",
		path: "gpt_researcher/skills/researcher.py",
		line: 801,
		contains: "_get_new_urls",
		note: "抓之前先過濾掉 visited_urls。這正是我們 Lesson 22 Step 8 缺的東西。",
	},
	{
		topic: "L24 visited_urls 要跨子研究共用",
		repo: "gpt-researcher",
		path: "gpt_researcher/skills/researcher.py",
		line: 108,
		contains: "deliberately NOT cleared",
		note: "註解明講：子研究會共用父研究的 visited_urls，所以不能清空。",
	},
	{
		topic: "L24 並行度是寫死的小數字",
		repo: "deep-research",
		path: "src/deep-research.ts",
		line: 30,
		contains: "ConcurrencyLimit",
		note: "預設 2。註解寫「有更高的 rate limit 再調大」。",
	},
	{
		topic: "L24 單一分支失敗不能弄垮整輪",
		repo: "deep-research",
		path: "src/deep-research.ts",
		line: 282,
		contains: "learnings: []",
		note: "catch 之後回空結果，其他分支照常。逾時還特別分開記 log。",
	},
];
