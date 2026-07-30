/**
 * Lesson 27 - the downstream damage of the relevance floor
 *
 * Step 3 already proved deterministically that the floor blocks things: querying "how do you choose chunk size"
 * with no floor puts **a sous vide cooking guide in 4th place**.
 *
 * But ranking is an intermediate product. The real question is the next step:
 *
 *     once the model has those 8 results (3 about robots, 1 about sous vide),
 *     **does it actually cite them?**
 *
 * This lesson's local corpus is this repo's own documents and the web corpus is about robotics.
 * So for "how do you choose chunk size", **any web citation is wrong**.
 * The verdict is therefore deterministic: does an http URL appear in the answer.
 *
 * Run:
 *   PROVIDER=gemini bun run lesson-27:agent              # with the floor
 *   FLOOR=off PROVIDER=gemini bun run lesson-27:agent    # without it
 */

import { hybridSearch } from "./hybrid.ts";
import { selectStreamingProvider } from "../shared/streaming/index.ts";
import type { Message, StreamingProvider } from "../shared/streaming/types.ts";

const FLOOR = (process.env.FLOOR ?? "on").toLowerCase() !== "off";

/**
 * Only the local documents can answer this question (the web corpus is entirely robotics).
 * So it is a clean "one side is wholly irrelevant" scenario.
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

	// ── the deterministic verdict ───────────────────────────────
	//
	// No LLM judge (Lesson 25's position). The web corpus is uniformly irrelevant to this question,
	// so "does the answer contain a web source" is a string comparison.
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

	// Lesson 15's lesson: a negative result must first rule out "the reply never finished".
	if (citedWeb.length === 0 && stopReason !== "end") {
		console.log(yellow(`  ⚠ 回覆不是正常結束（${stopReason}），這個結果不可信，請重跑`));
	}
}

/** The scripted provider used without a key: it shows what the output looks like and is not evidence. */
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
