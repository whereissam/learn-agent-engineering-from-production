/**
 * The fetching layer.
 *
 * Lesson 20's corpus is a stack of static HTML files that readFile handles directly.
 * That teaches nothing, because the real web does not work like that:
 *
 *   fetch(url)  ← behind this one line sits a whole row of things that go wrong
 *
 * So a rule layer sits on top of reading files, acting out the four most common situations:
 *
 *   robots.txt disallows it   you have to honour it; the site will not stop you
 *   403 / paywall             they block you, and will not say why
 *   the content is drawn by JS the fetched HTML is an empty shell
 *   a very long page          fetchable, and it does not fit in context
 *
 * Each demands something different of the agent, so **the error messages must state the difference**.
 * Return "fetch failed" for all of them and the model just keeps retrying the same URL.
 *
 * Not done: timeouts and retries (Exercise 5), redirect chains, PDFs, robots crawl-delay,
 * conditional requests (ETag / If-Modified-Since). A real crawler handles all of these.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { IndexedPage } from "../lesson-20-search-agent/corpus/generate.ts";

const CORPUS = resolve(import.meta.dirname, "../lesson-20-search-agent/corpus");

/**
 * Our own robots.txt cache.
 *
 * The key idea: **robots.txt has no enforcement.** It is a request,
 * and your crawler has to read and honour it. What actually stops you is legal action and IP blocking, not this file.
 *
 * The SEO farm is set to disallow here, which is also common in the real world:
 * a content farm welcomes search engines and does not welcome crawlers that copy whole pages.
 */
const ROBOTS: Record<string, string[]> = {
	"top-robotics-tools.example.net": ["/"],
};

/** Sites whose content is drawn by JavaScript, so the fetched HTML is an empty shell. */
const JS_RENDERED = new Set(["huggingface.co"]);

/** Sites that return 403 (paywall, bot detection, geo-blocking… you are never told which). */
const FORBIDDEN = new Set(["technews.example.com"]);

/** These URLs return a very long document (see longDocument below). */
const LONG_PAGES = new Set(["https://www.unitree.com/g1/developer"]);

export type FetchResult =
	| { ok: true; url: string; html: string }
	| { ok: false; url: string; reason: FetchFailure; detail: string };

export type FetchFailure = "not_found" | "robots" | "forbidden";

let corpus: IndexedPage[] | undefined;

function loadCorpus(): IndexedPage[] {
	if (corpus) return corpus;
	try {
		corpus = JSON.parse(readFileSync(resolve(CORPUS, "index.json"), "utf8")) as IndexedPage[];
	} catch {
		throw new Error("Lesson 20's corpus not found. Generate it first: bun run lesson-20:corpus");
	}
	return corpus;
}

export function hostOf(url: string): string {
	try {
		return new URL(url).host;
	} catch {
		return "";
	}
}

/** The robots.txt check. A real crawler fetches and caches /robots.txt; this looks it up in a table. */
export function robotsAllows(url: string): boolean {
	const rules = ROBOTS[hostOf(url)];
	if (!rules) return true;
	const path = new URL(url).pathname;
	return !rules.some((prefix) => path.startsWith(prefix));
}

/**
 * Fetch one page.
 *
 * Note the order: **the robots check comes first**. Ask "may I fetch this" before
 * "can I fetch this". The other way round means the request is already sent before you find out it should not be.
 */
export function fetchPage(url: string): FetchResult {
	const normalized = url.trim();
	const host = hostOf(normalized);

	if (!host) {
		return {
			ok: false,
			url: normalized,
			reason: "not_found",
			detail: `"${normalized}" is not a valid absolute URL. Pass the full URL exactly as it appeared in the search results, including https://.`,
		};
	}

	if (!robotsAllows(normalized)) {
		return {
			ok: false,
			url: normalized,
			reason: "robots",
			detail:
				`${host}/robots.txt disallows crawling this path. ` +
				"This is a policy decision, not a technical failure: retrying will not help, and " +
				"neither will a different user agent. Use the search snippet for this page and say " +
				"in your answer that the page itself could not be read.",
		};
	}

	if (FORBIDDEN.has(host)) {
		return {
			ok: false,
			url: normalized,
			reason: "forbidden",
			detail:
				`${host} returned HTTP 403. The site is blocking automated access and does not say ` +
				"why (paywall, bot detection, and geo-blocking all look the same from here). " +
				"Do not retry. Look for the same information on another site.",
		};
	}

	const page = loadCorpus().find((p) => p.url === normalized);
	if (!page) {
		return {
			ok: false,
			url: normalized,
			reason: "not_found",
			detail:
				"HTTP 404. This URL is not in the index. Note that you cannot invent URLs: " +
				"run web_search and fetch one of the URLs it returned.",
		};
	}

	// A JS-rendered site: the HTML arrives and the body is not in it
	if (JS_RENDERED.has(host)) {
		return { ok: true, url: normalized, html: jsShell(page.title) };
	}

	// A very long document: fetchable, and it does not fit in context at once
	if (LONG_PAGES.has(normalized)) {
		return { ok: true, url: normalized, html: longDocument(page) };
	}

	return {
		ok: true,
		url: normalized,
		html: readFileSync(resolve(CORPUS, "pages", page.html), "utf8"),
	};
}

// ─────────────────────────────────────────────────────────────
// Two special kinds of page
// ─────────────────────────────────────────────────────────────

/**
 * What a single-page application looks like when fetched: an empty mount point, with the body drawn by JS in the browser.
 *
 * This is the watershed for "do we need a headless browser".
 * Pure HTTP fetching is nearly free; a headless browser costs hundreds of milliseconds
 * and hundreds of MB per page. A real system usually does this: **fetch cheaply first,
 * and fall back to the expensive path when nothing can be extracted.**
 */
function jsShell(title: string): string {
	return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${title}</title></head>
<body>
  <div id="root"></div>
  <noscript>You need to enable JavaScript to run this app.</noscript>
  <script src="/static/js/main.9f2a1c.js"></script>
</body>
</html>
`;
}

/**
 * A very long technical document.
 *
 * Two uses:
 *
 *   1. **teaching material for chunking**: it does not fit at once and must be split.
 *   2. **a test for the extractor**: note that this HTML template **differs** from Lesson 20's corpus.
 *      There is no <article>, the body sits in <div class="doc-body">, and there are tables and lists.
 *      `extractMain` was written against Lesson 20's template and shows its seams on a page like this.
 *      Which is exactly what the real world is like: **your extractor only works on layouts you have seen.**
 */
function longDocument(page: IndexedPage): string {
	const sections: string[] = [];

	// 24 sections, generated mechanically but fixed (no randomness; identical every time)
	for (let i = 1; i <= 24; i++) {
		const joint = `joint_${String(i).padStart(2, "0")}`;
		sections.push(`
      <h2>Section ${i}: ${joint} migration notes</h2>
      <p>In the 2024 ordering ${joint} was index ${i + 6}; in the 2026 ordering it is index ${i}.
      Trajectories generated against the old ordering will drive the wrong actuator, which the
      safety layer reports as a tracking error rather than as a mapping error. This is the single
      most common cause of a protective stop after an SDK upgrade.</p>
      <p>Torque limits are unchanged for this joint. The velocity limit was lowered from
      ${20 - (i % 5)} rad/s to ${18 - (i % 5)} rad/s to match the revised thermal model, so a
      trajectory that was feasible under the 2024 SDK may now be rejected at load time.</p>
      <ul>
        <li>2024 index: ${i + 6}</li>
        <li>2026 index: ${i}</li>
        <li>Direction sign: ${i % 3 === 0 ? "inverted" : "unchanged"}</li>
      </ul>`);
	}

	return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${page.title} - SDK migration guide</title>
  <meta property="article:published_time" content="${page.published}">
</head>
<body>
  <div class="docs-shell">
    <div class="toc">
      <a href="#s1">Overview</a> <a href="#s2">Joint ordering</a> <a href="#s3">Torque limits</a>
    </div>
    <div class="doc-body">
      <h1>${page.title} - SDK migration guide</h1>
      <p>${page.text.split("\n\n")[0] ?? ""}</p>
      <p>This guide lists every joint index change between the 2024 and 2026 SDK releases.
      Read the section for each joint your controller touches before upgrading.</p>
      <table>
        <tr><th>Joint</th><th>2024 index</th><th>2026 index</th></tr>
        <tr><td>left_hip_pitch</td><td>7</td><td>1</td></tr>
        <tr><td>left_knee</td><td>9</td><td>3</td></tr>
        <tr><td>waist_yaw</td><td>1</td><td>13</td></tr>
      </table>
${sections.join("\n")}
    </div>
  </div>
</body>
</html>
`;
}
