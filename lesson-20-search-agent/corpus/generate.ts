/**
 * Generate two things from pages.ts:
 *
 *   pages/*.html   ← what a crawler sees (navigation, ads, cookie banners, footers)
 *   index.json     ← what a search engine has already tidied up (plain text)
 *
 * Why two? Because that is exactly the boundary between Lesson 20 and Lesson 21:
 *
 *   Lesson 20 (this one)  uses index.json only. It pretends somebody already cleaned the pages
 *                         for you, and concentrates on retrieval's own problems.
 *   Lesson 21             extracts the body from pages/*.html itself,
 *                         then checks against index.json's plain text —
 *                         did your extractor swallow the navigation and the ads too?
 *
 * The noise in the HTML is deliberate. A real page's body is often only 10-20% of it,
 * with the rest navigation, related reading, subscription forms and tracking scripts.
 * With a clean corpus, Lesson 21 would have nothing to teach.
 *
 * Run: bun run lesson-20-search-agent/corpus/generate.ts
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { type Page, PAGES } from "./pages.ts";

const OUT = import.meta.dirname;
const PAGES_DIR = resolve(OUT, "pages");

/** URL → filename. Also this lesson's document id. */
export function slugFor(url: string): string {
	return url
		.replace(/^https?:\/\//, "")
		.replace(/[^a-zA-Z0-9]+/g, "-")
		.replace(/^-|-$/g, "")
		.toLowerCase();
}

/**
 * Wrap one page into HTML that looks like a real web page.
 *
 * Note groundTruth does **not** appear in the output. As in Lesson 6:
 * the answer stays in the source and never flows anywhere the agent can see.
 */
function renderHtml(page: Page): string {
	const year = page.published.slice(0, 4);
	const body = page.paragraphs.map((p) => `        <p>${escapeHtml(p)}</p>`).join("\n");

	return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(page.title)}</title>
  <meta name="description" content="${escapeHtml(page.paragraphs[0]?.slice(0, 150) ?? "")}">
  <meta property="article:published_time" content="${page.published}">
  <link rel="stylesheet" href="/assets/site.css">
  <script src="/assets/analytics.js" async></script>
</head>
<body>
  <div id="cookie-banner">
    We use cookies to improve your experience. <button>Accept all</button> <button>Reject</button>
  </div>

  <header class="site-header">
    <a class="logo" href="/">${escapeHtml(page.site)}</a>
    <nav>
      <a href="/">Home</a>
      <a href="/docs">Docs</a>
      <a href="/blog">Blog</a>
      <a href="/pricing">Pricing</a>
      <a href="/login">Sign in</a>
    </nav>
  </header>

  <div class="layout">
    <main>
      <article>
        <h1>${escapeHtml(page.title)}</h1>
        <div class="byline">Published ${page.published} &middot; ${escapeHtml(page.site)}</div>
${body}
      </article>

      <section class="newsletter">
        <h3>Never miss an update</h3>
        <p>Join 24,000 engineers getting our weekly newsletter.</p>
        <form><input type="email" placeholder="you@example.com"><button>Subscribe</button></form>
      </section>
    </main>

    <aside class="sidebar">
      <div class="ad">Sponsored: Ship your robot fleet faster with RoboOps Cloud. Start free.</div>
      <h4>Related posts</h4>
      <ul>
        <li><a href="/related/1">10 things nobody tells you about humanoid robots</a></li>
        <li><a href="/related/2">Why your simulation results do not transfer</a></li>
        <li><a href="/related/3">A beginner's guide to URDF</a></li>
      </ul>
    </aside>
  </div>

  <footer>
    <p>&copy; ${year} ${escapeHtml(page.site)}. All rights reserved.</p>
    <p><a href="/terms">Terms</a> &middot; <a href="/privacy">Privacy</a> &middot; <a href="/contact">Contact</a></p>
  </footer>
</body>
</html>
`;
}

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

// ─────────────────────────────────────────────────────────────

/** What one document in index.json looks like. Both the search engine and the tools read this type. */
export interface IndexedPage {
	id: string;
	url: string;
	site: string;
	title: string;
	published: string;
	kind: Page["kind"];
	/** The body as plain text. **This is the already-cleaned version**, which Lesson 21 has to produce itself. */
	text: string;
	/** The matching HTML filename, used by Lesson 21. */
	html: string;
}

async function main(): Promise<void> {
	await rm(PAGES_DIR, { recursive: true, force: true });
	await mkdir(PAGES_DIR, { recursive: true });

	const index: IndexedPage[] = [];

	for (const page of PAGES) {
		const id = slugFor(page.url);
		const file = `${id}.html`;
		await writeFile(resolve(PAGES_DIR, file), renderHtml(page), "utf8");

		index.push({
			id,
			url: page.url,
			site: page.site,
			title: page.title,
			published: page.published,
			kind: page.kind,
			text: page.paragraphs.join("\n\n"),
			html: file,
		});
	}

	await writeFile(resolve(OUT, "index.json"), `${JSON.stringify(index, null, 2)}\n`, "utf8");

	const bytes = index.reduce((sum, p) => sum + p.text.length, 0);
	console.log(`Generated ${index.length} pages into ${PAGES_DIR}`);
	console.log(`Index: ${resolve(OUT, "index.json")} (${bytes} characters of body text)`);
}

if (import.meta.main) await main();
