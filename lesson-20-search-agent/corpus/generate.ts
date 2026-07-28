/**
 * 把 pages.ts 產生成兩份東西：
 *
 *   pages/*.html   ← 一個爬蟲會看到的樣子（有導覽列、廣告、cookie 橫幅、footer）
 *   index.json     ← 一個搜尋引擎已經整理好的樣子（純文字）
 *
 * 為什麼要分成兩份？因為這正好是 Lesson 20 和 Lesson 21 的分界：
 *
 *   Lesson 20（這一課）  只用 index.json。假裝「有人已經幫你把網頁清乾淨了」，
 *                        專心看檢索本身的問題。
 *   Lesson 21            改成從 pages/*.html 自己抽正文，
 *                        然後跟 index.json 的純文字對答案——
 *                        你的抽取器有沒有把導覽列和廣告一起吃進去？
 *
 * HTML 裡的雜訊是刻意加的。真實網頁的正文常常只佔整頁的 10-20%，
 * 剩下的都是導覽、推薦閱讀、訂閱表單、追蹤腳本。
 * 如果語料是乾淨的，Lesson 21 就沒東西可學。
 *
 * 執行：bun run lesson-20-search-agent/corpus/generate.ts
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { type Page, PAGES } from "./pages.ts";

const OUT = import.meta.dirname;
const PAGES_DIR = resolve(OUT, "pages");

/** URL → 檔名。同時當成這一課的 document id。 */
export function slugFor(url: string): string {
	return url
		.replace(/^https?:\/\//, "")
		.replace(/[^a-zA-Z0-9]+/g, "-")
		.replace(/^-|-$/g, "")
		.toLowerCase();
}

/**
 * 把一頁包成看起來像真的網頁的 HTML。
 *
 * 注意 groundTruth **沒有**出現在輸出裡。跟 Lesson 6 一樣：
 * 答案只留在原始碼，不會流到 agent 看得到的地方。
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

/** index.json 裡一筆文件的樣子。搜尋引擎和工具都讀這個型別。 */
export interface IndexedPage {
	id: string;
	url: string;
	site: string;
	title: string;
	published: string;
	kind: Page["kind"];
	/** 正文純文字。**這是「已經被清乾淨」的版本**，Lesson 21 要自己做出這個。 */
	text: string;
	/** 對應的 HTML 檔名，Lesson 21 會用到。 */
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
	console.log(`已產生 ${index.length} 個頁面到 ${PAGES_DIR}`);
	console.log(`索引：${resolve(OUT, "index.json")}（正文共 ${bytes} 字元）`);
}

if (import.meta.main) await main();
