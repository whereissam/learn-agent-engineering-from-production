/**
 * Lesson 27 - 相關性門檻的下游傷害
 *
 * Step 3 已經用確定性的方式證明門檻在擋東西：查「chunk 大小要怎麼選」時，
 * 沒有門檻的話一篇 **sous vide 烹飪指南會排到第 4 名**。
 *
 * 但排序是中間產物。真正該問的是下一步：
 *
 *     模型拿到那 8 筆（其中 3 筆是機器人、1 筆是舒肥）之後，
 *     **會不會真的引用它們？**
 *
 * 這一課的本地語料是這個 repo 自己的文件，網頁語料是機器人主題。
 * 所以對「chunk 大小要怎麼選」這個問題，**任何一筆網頁引用都是錯的**。
 * 判定因此是確定性的：答案裡有沒有出現 http 網址。
 *
 * 執行：
 *   PROVIDER=gemini bun run lesson-27:agent              # 有門檻
 *   FLOOR=off PROVIDER=gemini bun run lesson-27:agent    # 沒門檻
 */

import { hybridSearch } from "./hybrid.ts";
import { selectStreamingProvider } from "../shared/streaming/index.ts";
import type { Message, StreamingProvider } from "../shared/streaming/types.ts";

const FLOOR = (process.env.FLOOR ?? "on").toLowerCase() !== "off";

/**
 * 這個問題只有本地文件答得出來（網頁語料全是機器人）。
 * 所以它是一個乾淨的「一邊完全不相關」情境。
 */
const QUESTION = "chunk 大小要怎麼選？";

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;

async function main(): Promise<void> {
	const result = await hybridSearch(QUESTION, 8, { disableFloor: !FLOOR });

	const webHits = result.hits.filter((h) => h.kind === "web");

	console.log(bold(`\n相關性門檻的下游傷害   門檻 ${FLOOR ? green("開啟") : red("關閉")}`));
	console.log(dim("─".repeat(66)));
	console.log(dim(`檢索到 ${result.hits.length} 筆，其中 ${webHits.length} 筆來自網頁語料`));
	for (const hit of result.hits) {
		const tag = hit.kind === "web" ? red("[網頁]") : dim("[本地]");
		console.log(dim(`  ${hit.rank}. `) + tag + dim(` ${hit.source}`));
	}
	if (webHits.length > 0) {
		console.log(
			yellow(`  ⚠ 網頁語料是機器人主題，對這個問題全部都不相關。引用任何一筆都是錯的。`),
		);
	}
	console.log(dim("─".repeat(66)));

	const context = result.hits
		.map((h) => `[${h.source}] ${h.title}\n${h.snippet}`)
		.join("\n\n");

	const model: StreamingProvider = process.env.PROVIDER
		? selectStreamingProvider()
		: scriptedProvider(webHits.map((h) => h.source));

	console.log(`\n${bold("問：")}${QUESTION}`);
	console.log(bold("答："));

	let answer = "";
	let stopReason = "?";
	for await (const event of model.stream({
		system:
			"Answer the user's question using only the retrieved sources below. " +
			"Cite the source identifier in brackets after each claim.\n\n" +
			context,
		messages: [{ role: "user", text: QUESTION } satisfies Message],
		tools: [],
		maxTokens: 2000,
	})) {
		if (event.type === "text_delta") {
			answer += event.delta;
			process.stdout.write(event.delta);
		}
		if (event.type === "done") {
			stopReason = event.response.stopReason;
			const text = event.response.blocks
				.filter((b) => b.type === "text")
				.map((b) => b.text)
				.join("");
			if (text) answer = text;
		}
	}

	// ── 確定性判定 ──────────────────────────────────────────
	//
	// 不用 LLM 裁判（Lesson 25 的立場）。網頁語料對這個問題一律不相關，
	// 所以「答案裡有沒有網頁來源」就是一個字串比對。
	const citedWeb = webHits.map((h) => h.source).filter((url) => answer.includes(url));

	const localCount = result.hits.length - webHits.length;

	console.log(bold("\n\n判定"));
	console.log(
		dim(`  8 個位置：本地 ${localCount} 筆、不相關的網頁 ${webHits.length} 筆`) +
			(webHits.length > 0
				? red(`（${webHits.length} 筆相關的本地文件被擠掉了）`)
				: green("（全部給了相關來源）")),
	);
	if (citedWeb.length > 0) {
		console.log(`  ${red("✗ 引用了不相關的來源")}：`);
		for (const url of citedWeb) console.log(red(`     ${url}`));
	} else if (webHits.length > 0) {
		console.log(`  ${yellow("○ 模型自己避開了")}：不相關的來源進了 context，但沒被引用`);
		console.log(dim("     注意這不是門檻在保護你，是模型剛好沒上當。"));
	} else {
		console.log(`  ${green("✓ 不相關的來源根本沒進 context")}`);
	}
	console.log(dim(`  provider: ${model.name} / ${model.model}  stopReason=${stopReason}`));

	// Lesson 15 的教訓：陰性結果要先排除「回覆根本沒跑完」。
	if (citedWeb.length === 0 && stopReason !== "end") {
		console.log(yellow(`  ⚠ 回覆不是正常結束（${stopReason}），這個結果不可信，請重跑`));
	}
}

/** 沒有 key 時的腳本 provider：只示範畫面長相，不能當證據。 */
function scriptedProvider(webSources: string[]): StreamingProvider {
	const text =
		"chunk 大小要在語意完整和 context 預算之間取捨。" +
		(webSources[0] ? ` 另外可參考 [${webSources[0]}]。` : "");
	const response = {
		blocks: [{ type: "text" as const, text }],
		raw: null,
		stopReason: "end" as const,
	};
	return {
		name: "fake",
		model: "scripted-floor（不能當證據）",
		async *stream() {
			yield { type: "text_start" };
			yield { type: "text_delta", delta: text };
			yield { type: "text_end" };
			yield { type: "done", response };
		},
		async call() {
			return response;
		},
	};
}

await main();
