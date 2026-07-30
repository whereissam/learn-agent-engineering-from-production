/**
 * Lesson 17 - the downstream damage of recall blindness
 *
 * ⚠️ One thing first, because it is this lesson's thesis:
 *
 *     **The ranker contains no LLM, and should not.**
 *
 * This program changes not one line of ranking. The model sits **outside**,
 * as an agent that has search_sessions as a tool.
 * That does not contradict the lesson's position; it measures that position's cost.
 *
 * `demo.ts` already proved recall blindness exists with deterministic scores:
 *
 *     ❌ no demotion: cron ranks first
 *     ✅ demoted to 0.25: interactive ranks first
 *
 * But ranking is an intermediate product. The real damage is the next step:
 *
 *     the agent receives a pile of cron summaries and answers the user confidently.
 *     **It does not know what it did not see.**
 *
 * This program measures that step. The same question, corpus and model,
 * with the only difference being whether ranking demotes.
 *
 * Run:
 *   PROVIDER=gemini bun run lesson-17:agent              # with demotion
 *   DEMOTE=off PROVIDER=gemini bun run lesson-17:agent   # without
 */

import { SessionSearchIndex } from "../shared/search/index.ts";
import { selectStreamingProvider } from "../shared/streaming/index.ts";
import type { Message, StreamingProvider, ToolSpec } from "../shared/streaming/types.ts";

const DEMOTE = (process.env.DEMOTE ?? "on").toLowerCase() !== "off";

/**
 * What the user is looking for.
 *
 * The right answer exists only in **that one** interactive conversation:
 * the sample rate was hardcoded and should be read from the session metadata.
 *
 * The 12 cron summaries all say "the sample rate is normal, no anomalies".
 * So whatever the model answers directly reflects which side it retrieved.
 */
const QUESTION =
	"我之前有查過 telemetry 取樣率的問題嗎？如果有，當時的結論是什麼？";

/** Words only obtainable by reading that real conversation. */
const CORRECT_SIGNALS = ["metadata", "寫死", "sample_rate_hz", "meta."];
/** Words that only appear if it read the cron summaries. */
const BLIND_SIGNALS = ["正常", "無異常", "沒有問題", "沒有異常"];

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;

const user = (text: string): Message => ({ role: "user", text });
const assistant = (text: string): Message => ({
	role: "assistant",
	blocks: [{ type: "text", text }],
	raw: null,
});

/** The same corpus as demo.ts, deliberately not shared so that changing one cannot break the other. */
function build(): SessionSearchIndex {
	const index = new SessionSearchIndex();

	index.addSession(
		{
			sessionId: "sess_real",
			title: "修 telemetry 取樣率的 bug",
			source: "interactive",
			startedAt: "2026-07-20T10:00:00Z",
			messageCount: 6,
		},
		[
			user("我們的 telemetry 取樣率設定好像有問題"),
			assistant("我看一下 config。目前 sample_rate_hz 寫死 50Hz。"),
			user("對，但 go2-c 那台實際是 100Hz"),
			assistant(
				"找到了。config.ts 把取樣率寫死了，應該從 session metadata 讀。" +
					"我改成 meta.sample_rate_hz，並在缺值時 fallback 到 50。",
			),
			user("測試過了嗎"),
			assistant("跑了 bun test，5 pass 0 fail。"),
		],
	);

	for (let day = 1; day <= 12; day++) {
		index.addSession(
			{
				sessionId: `sess_cron_${day}`,
				title: `每日 telemetry 摘要 ${day}`,
				source: "cron",
				startedAt: `2026-07-${String(day).padStart(2, "0")}T03:00:00Z`,
				messageCount: 2,
			},
			[
				user("產生每日 telemetry 摘要"),
				assistant(
					"今日 telemetry 摘要：取樣率正常，session 數量 14，" +
						"telemetry 取樣率 50Hz，無異常。telemetry 資料完整。",
				),
			],
		);
	}

	return index;
}

async function main(): Promise<void> {
	const index = build();

	const searchTool: ToolSpec = {
		name: "search_sessions",
		description:
			"Search the user's past conversation sessions by keyword. " +
			"Returns the matching messages with surrounding context.",
		parameters: {
			type: "object",
			properties: { query: { type: "string", description: "Keywords to search for" } },
			required: ["query"],
		},
	};

	const model: StreamingProvider = process.env.PROVIDER
		? selectStreamingProvider()
		: scriptedProvider();

	console.log(bold(`\nrecall blindness 的下游傷害   來源降權 ${DEMOTE ? green("開啟") : red("關閉")}`));
	console.log(dim(`語料：1 篇使用者的真實對話 + 12 篇 cron 摘要`));
	console.log(dim("─".repeat(66)));
	console.log(`${bold("問：")}${QUESTION}\n`);

	const messages: Message[] = [{ role: "user", text: QUESTION }];
	let answer = "";
	let stopReason = "?";
	const searched: string[] = [];

	for (let step = 0; step < 6; step++) {
		let response: Awaited<ReturnType<StreamingProvider["call"]>> | undefined;

		for await (const event of model.stream({
			system:
				"You help the user recall what happened in their past sessions. " +
				"Use search_sessions before answering. Base your answer only on what you find.",
			messages,
			tools: [searchTool],
			maxTokens: 2000,
		})) {
			if (event.type === "text_delta") {
				answer += event.delta;
				process.stdout.write(event.delta);
			}
			if (event.type === "done") {
				response = event.response;
				stopReason = event.response.stopReason;
			}
		}
		if (!response) break;

		messages.push({ role: "assistant", blocks: response.blocks, raw: response.raw });
		const calls = response.blocks.filter((b) => b.type === "toolCall");
		if (calls.length === 0) break;

		messages.push({
			role: "toolResult",
			results: calls.map((call) => {
				const query = String(call.args.query ?? "");
				searched.push(query);
					// ← the only variable. The ranker itself is unchanged.
				const hits = index.discover(query, 3, 2, {
					disableSourceWeighting: !DEMOTE,
				});
				return {
					toolCallId: call.id,
					toolName: call.name,
					content:
						hits
							.map(
								(h) =>
									`[${h.hit.source}] ${h.hit.sessionTitle} (score ${h.hit.score.toFixed(2)})\n` +
									h.window.map((m) => `  ${m.role}: ${m.text}`).join("\n"),
							)
							.join("\n\n") || "(沒有結果)",
				};
			}),
		});
	}

	// ── the deterministic verdict ───────────────────────────────
	const correct = CORRECT_SIGNALS.filter((s) => answer.includes(s));
	const blind = BLIND_SIGNALS.filter((s) => answer.includes(s));

	console.log(bold("\n\n判定"));
	console.log(dim(`  模型搜了 ${searched.length} 次：${searched.join(" / ")}`));
	console.log(
		dim(`  最終回答 ${answer.trim().length} 字`) +
			(answer.trim() ? "" : red("（撞到步數上限，一直在搜，沒有給答案）")),
	);
	console.log(`  只有讀到真實對話才講得出的詞：${correct.length ? green(correct.join(", ")) : dim("無")}`);
	console.log(`  只有讀到 cron 摘要才會講的詞：${blind.length ? red(blind.join(", ")) : dim("無")}`);

	if (correct.length > 0) {
		console.log(`  ${green("✓ 找到了真正那次對話")}`);
	} else {
		console.log(`  ${red("✗ recall blindness")}：模型沒有撈到使用者真正問過的那次`);
		console.log(dim("     注意它多有自信。它不知道自己漏了什麼。"));
	}
	console.log(dim(`  provider: ${model.name} / ${model.model}  stopReason=${stopReason}`));

	// Lesson 15's lesson: a negative result must first rule out "the reply never finished".
	if (correct.length === 0 && stopReason !== "end") {
		console.log(yellow(`  ⚠ 回覆不是正常結束（${stopReason}），這個結果不可信，請重跑`));
	}
}

/** The scripted provider used without a key: it shows what the output looks like and is not evidence. */
function scriptedProvider(): StreamingProvider {
	const call = { id: "s1", name: "search_sessions", args: { query: "telemetry 取樣率" } };
	let step = 0;
	const provider: StreamingProvider = {
		name: "fake",
		model: "scripted-recall（不能當證據）",
		async *stream() {
			if (step++ === 0) {
				yield { type: "tool_call", ...call };
				yield {
					type: "done",
					response: {
						blocks: [{ type: "toolCall", ...call }],
						raw: null,
						stopReason: "tool_use",
					},
				};
				return;
			}
			const text = DEMOTE
				? "有。你發現 config.ts 把取樣率寫死了，結論是應該從 session metadata 讀。"
				: "有查過，當時的結論是取樣率正常、無異常。";
			yield { type: "text_start" };
			yield { type: "text_delta", delta: text };
			yield { type: "text_end" };
			yield {
				type: "done",
				response: { blocks: [{ type: "text", text }], raw: null, stopReason: "end" },
			};
		},
		async call() {
			throw new Error("not used");
		},
	};
	return provider;
}

await main();
