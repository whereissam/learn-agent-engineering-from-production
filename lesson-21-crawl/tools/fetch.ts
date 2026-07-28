/**
 * fetch_page：Lesson 20 缺的那個工具。
 *
 * Lesson 20 的 agent 只有 snippet，所以它沒有辦法知道自己漏掉了什麼。
 * 加上這個工具之後，「去把那一頁打開來看」才變成一個可以做的動作，
 * 「我沒辦法確認」也才變成一個模型脫離得了的狀態。
 *
 * 這個工具做四件事，每一件都對應到一個真實世界的麻煩：
 *
 *   fetchPage()    robots / 403 / 404 / JS 渲染      → 錯誤訊息要說得出差別
 *   extractMain()  把導覽列、廣告、footer 砍掉        → 51% 的雜訊不要進 context
 *   chunkText()    長文件切塊                         → 要的東西常常在後面
 *   組裝輸出        標題、日期、第幾塊                 → 模型要知道自己看到的是片段
 */

import type { Tool } from "../../shared/tools/registry.ts";
import { chunkText } from "../extract/chunk.ts";
import { extractMain } from "../extract/html.ts";
import { fetchPage } from "../fetcher.ts";

/** 一次最多給模型多少字元。真實產品會照 token 算，這裡用字元近似。 */
const MAX_CHARS = 2400;

export const fetchPageTool: Tool = {
	name: "fetch_page",
	mutating: false,
	description:
		"Open one of the URLs from web_search and read its actual content, with navigation, ads " +
		"and footers removed. Long pages are split into chunks: the result tells you which chunk " +
		"you got and how many there are, and you can ask for another one. " +
		"Use this whenever a claim matters: a snippet shows the passage that matched your query, " +
		"which is often not what the page concludes.",
	parameters: {
		type: "object",
		properties: {
			url: {
				type: "string",
				description: "Full URL, exactly as it appeared in the search results.",
			},
			chunk: {
				type: "number",
				description:
					"Which chunk to read, starting at 1. Default 1. Only long pages have more than one.",
			},
		},
		required: ["url"],
	},

	async execute(args) {
		const url = String(args.url ?? "").trim();
		if (!url) throw new Error("url is empty. Pass a URL from the web_search results.");

		const result = fetchPage(url);

		// 抓不到。四種原因要分開講，因為每一種的「下一步」都不一樣：
		// robots 要放棄這一頁，403 要換來源，404 要回去搜尋。
		// 一律回 "fetch failed" 的話，模型只會一直重試同一個網址。
		if (!result.ok) throw new Error(result.detail);

		// includeStructures: true → 表格和清單也抽。
		// 這個 flag 是實測之後才加的，過程寫在 README Step 5。
		const { title, published, text, dropped } = extractMain(result.html, {
			includeStructures: true,
		});

		// 抓到了 HTML，卻抽不到任何文字。這幾乎一定是 JS 渲染的頁面。
		//
		// 這個錯誤要特別小心地寫：模型很容易把「抽不到」理解成「這一頁沒有資訊」，
		// 然後在答案裡寫「該頁沒有提到 X」——那是一個假的否定結論。
		if (text.trim().length === 0) {
			throw new Error(
				`Fetched ${url} but found no readable text. The page renders its content with ` +
					"JavaScript, so the HTML is an empty shell. " +
					"IMPORTANT: this means the content is unknown, NOT that the page is empty. " +
					"Do not conclude anything about what this page does or does not say. " +
					"Use its search snippet and look for the same information elsewhere.",
			);
		}

		const chunks = chunkText(text, { maxChars: MAX_CHARS });
		const requested = Number(args.chunk ?? 1);
		const wanted = Number.isFinite(requested) ? Math.trunc(requested) : 1;

		if (wanted < 1 || wanted > chunks.length) {
			throw new Error(
				`chunk ${wanted} does not exist: ${url} has ${chunks.length} chunk(s). ` +
					`Ask for a number between 1 and ${chunks.length}.`,
			);
		}

		const chunk = chunks[wanted - 1];
		if (!chunk) throw new Error(`chunk ${wanted} is missing. This is a bug in fetch_page.`);

		const header = [
			`# ${title}`,
			`url: ${url}`,
			published ? `published: ${published}` : "published: unknown",
			`chunk ${chunk.index} of ${chunk.total}  (${text.length} characters extracted in total)`,
		].join("\n");

		// 這個抽取器只保留段落，表格和清單會被丟掉。**一定要講出來。**
		//
		// 不講的話，模型會把「抽取器沒抽到」誤判成「這一頁沒有這個資訊」，
		// 然後要嘛編一個數字，要嘛一直換 query 重找。實測是後者：
		// 它讀完全部 7 個 chunk、又搜了 6 次，最後撞上步數上限（README Step 5）。
		const warning =
			dropped.tables > 0 || dropped.lists > 0
				? `\n\nNOTE: this extractor keeps paragraphs only. This page also contains ` +
					`${dropped.tables} table(s) and ${dropped.lists} list(s) whose contents are NOT ` +
					"included above. If the fact you need looks tabular (indices, versions, limits, " +
					"compatibility matrices), report that it could not be extracted from this page. " +
					"Do NOT conclude that the page does not contain it, and do not guess the value."
				: "";

		// 只有一塊的時候不要囉嗦；有多塊的時候一定要提醒，
		// 否則模型會拿第 1 塊的內容去回答整份文件的問題。
		const footer =
			chunk.total > 1
				? `\n\n---\nThis is chunk ${chunk.index}/${chunk.total}. You have NOT seen the rest of ` +
					`this page. Call fetch_page again with chunk=${Math.min(chunk.index + 1, chunk.total)} ` +
					"to continue, and do not describe the page as a whole until you have read what you need."
				: "";

		return `${header}${warning}\n\n${chunk.text}${footer}`;
	},
};
