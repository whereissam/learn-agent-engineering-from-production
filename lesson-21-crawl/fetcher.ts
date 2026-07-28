/**
 * 抓網頁這一層。
 *
 * Lesson 20 的語料是一疊靜態 HTML 檔，直接 readFile 就好了。
 * 但那樣學不到東西，因為真實的 web 不是這樣運作的：
 *
 *   fetch(url)  ← 這一行背後有一整排會出錯的地方
 *
 * 所以這裡在讀檔之外加了一層規則，把最常見的四種狀況演出來：
 *
 *   robots.txt 不准爬   你要自己遵守，網站不會擋你
 *   403 / 付費牆        對方擋你，而且不會說原因
 *   內容是 JS 畫的      HTML 抓回來是空殼
 *   頁面非常長          抓得到，但塞不進 context
 *
 * 每一種都要求 agent 做不同的事，所以**錯誤訊息必須說得出差別**。
 * 一律回「fetch failed」的話，模型只會一直重試同一個網址。
 *
 * 沒有做的：逾時與重試（練習 5）、redirect 鏈、PDF、robots crawl-delay、
 * 條件式請求（ETag / If-Modified-Since）。真實爬蟲這些都要處理。
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { IndexedPage } from "../lesson-20-search-agent/corpus/generate.ts";

const CORPUS = resolve(import.meta.dirname, "../lesson-20-search-agent/corpus");

/**
 * 我們自己的 robots.txt 快取。
 *
 * 重點觀念：**robots.txt 沒有強制力。** 它是一份請求，
 * 你的爬蟲要自己讀、自己遵守。會擋你的是法務和 IP 封鎖，不是這個檔案。
 *
 * 這裡把 SEO 農場設成 disallow，剛好也是真實世界常見的情形：
 * 內容農場很歡迎搜尋引擎，但不歡迎會把內容整段抄走的爬蟲。
 */
const ROBOTS: Record<string, string[]> = {
	"top-robotics-tools.example.net": ["/"],
};

/** 內容是 JavaScript 畫出來的網站，抓回來的 HTML 是空殼。 */
const JS_RENDERED = new Set(["huggingface.co"]);

/** 會回 403 的網站（付費牆、bot 偵測、地區封鎖…理由不會告訴你）。 */
const FORBIDDEN = new Set(["technews.example.com"]);

/** 這些網址會回一份很長的文件（見底下的 longDocument）。 */
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
		throw new Error("找不到 Lesson 20 的語料。先產生：bun run lesson-20:corpus");
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

/** robots.txt 檢查。真實爬蟲會先去抓 /robots.txt 並快取，這裡直接查表。 */
export function robotsAllows(url: string): boolean {
	const rules = ROBOTS[hostOf(url)];
	if (!rules) return true;
	const path = new URL(url).pathname;
	return !rules.some((prefix) => path.startsWith(prefix));
}

/**
 * 抓一頁。
 *
 * 注意順序：**robots 檢查在最前面**。先問「我可不可以抓」，
 * 再問「抓不抓得到」。反過來的話，你已經送出請求了才發現不該送。
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

	// JS 渲染的站：HTML 抓得到，但正文不在裡面
	if (JS_RENDERED.has(host)) {
		return { ok: true, url: normalized, html: jsShell(page.title) };
	}

	// 很長的文件：抓得到，但一次塞不進 context
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
// 兩種特別的頁面
// ─────────────────────────────────────────────────────────────

/**
 * 單頁應用（SPA）抓回來的樣子：一個空的掛載點，正文全部由 JS 在瀏覽器裡畫。
 *
 * 這是「要不要上 headless browser」這個決定的分水嶺。
 * 純 HTTP 抓取便宜到幾乎免費，headless browser 每一頁都要花掉幾百毫秒
 * 和幾百 MB 記憶體。真實系統的做法通常是：**先用便宜的抓，
 * 抽不到內容再退回昂貴的。**
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
 * 一份很長的技術文件。
 *
 * 兩個用途：
 *
 *   1. **chunking 的教材**：一次塞不進去，要切。
 *   2. **抽取器的考驗**：注意這一份的 HTML 模板跟 Lesson 20 語料**不一樣**，
 *      沒有 <article>，正文放在 <div class="doc-body"> 裡，還有表格和清單。
 *      `extractMain` 是照 Lesson 20 的模板寫的，碰到這種頁面就會露餡。
 *      這正是真實世界的樣子：**你的抽取器只對你看過的版型有效。**
 */
function longDocument(page: IndexedPage): string {
	const sections: string[] = [];

	// 24 個小節，內容是機械式產生的但固定（不用亂數，每次都一樣）
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
