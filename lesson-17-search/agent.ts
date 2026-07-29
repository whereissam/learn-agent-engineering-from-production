/**
 * Lesson 17 - recall blindness 的下游傷害
 *
 * ⚠️ 先講清楚一件事，因為它是這一課的主張：
 *
 *     **排序器裡面沒有 LLM，而且不該有。**
 *
 * 這支程式沒有動排序的任何一行。模型接在**外面**，
 * 當一個「拿 search_sessions 當工具的 agent」。
 * 這不違反這一課的立場，反而是在量測那個立場的代價。
 *
 * `demo.ts` 已經用確定性的分數證明了 recall blindness 存在：
 *
 *     ❌ 不降權：第一名是 cron
 *     ✅ 降權到 0.25：第一名是 interactive
 *
 * 但排序只是中間產物。真正的傷害在下一步：
 *
 *     agent 拿到一堆 cron 摘要，然後很有自信地回答使用者。
 *     **它不知道自己沒看到什麼。**
 *
 * 這支程式量測那一步。同一個問題、同一份語料、同一個模型，
 * 唯一的差別是排序有沒有降權。
 *
 * 執行：
 *   PROVIDER=gemini bun run lesson-17:agent              # 有降權
 *   DEMOTE=off PROVIDER=gemini bun run lesson-17:agent   # 沒降權
 */

import { SessionSearchIndex } from "../shared/search/index.ts";
import { selectStreamingProvider } from "../shared/streaming/index.ts";
import type { Message, StreamingProvider, ToolSpec } from "../shared/streaming/types.ts";

const DEMOTE = (process.env.DEMOTE ?? "on").toLowerCase() !== "off";

/**
 * 使用者要找的東西。
 *
 * 正確答案只存在於**那唯一一次**互動對話裡：
 * 取樣率被寫死了，應該從 session metadata 讀。
 *
 * 12 篇 cron 摘要則一律說「取樣率正常、無異常」。
 * 所以模型答什麼，直接反映它撈到了哪一邊。
 */
const QUESTION =
	"我之前有查過 telemetry 取樣率的問題嗎？如果有，當時的結論是什麼？";

/** 只有讀到真正那次對話才講得出來的詞。 */
const CORRECT_SIGNALS = ["metadata", "寫死", "sample_rate_hz", "meta."];
/** 只讀到 cron 摘要才會講出來的詞。 */
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

/** 跟 demo.ts 同一份語料，刻意不共用程式碼以免改壞那一支。 */
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
				// ← 這裡是唯一的變因。排序器本身沒有任何改動。
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

	// ── 確定性判定 ──────────────────────────────────────────
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

	// Lesson 15 的教訓：陰性結果要先排除「回覆根本沒跑完」。
	if (correct.length === 0 && stopReason !== "end") {
		console.log(yellow(`  ⚠ 回覆不是正常結束（${stopReason}），這個結果不可信，請重跑`));
	}
}

/** 沒有 key 時的腳本 provider：只示範畫面長相，不能當證據。 */
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
