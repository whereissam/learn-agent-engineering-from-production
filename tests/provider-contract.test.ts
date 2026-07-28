/**
 * Provider 契約測試。
 *
 * ## 這份測試存在的理由
 *
 * 這個 repo 三次踩到同一族的錯：
 *
 *   Lesson 7   `mustMention` 的存在被當成「有資料品質問題」的代理
 *   Lesson 25  評估讀 `index.json`，agent 讀 `fetchPage` 的長文件
 *   shared     `usage` 加進共用型別，但只有串流那一支填
 *
 * 共同點是**同一件事有兩個實作，而它們對這件事的認知悄悄分岔了**。
 * 三次都沒有任何東西報錯：型別檢查過、測試綠、程式跑得完，
 * 只是行為不一樣。
 *
 * 「以後小心一點」不是解法。解法是**寫一份斷言，跑過所有實作**——
 * 分岔的那一刻就會有東西紅起來。
 *
 * ## 這裡測什麼、不測什麼
 *
 * 測的是**契約**（每個實作都必須成立的事），不是行為
 * （模型講了什麼）。所以它不需要 API key，也不需要模型很聰明。
 *
 * 真模型才驗得到的部分（usage 到底有沒有回來）放在最後一段，
 * 有金鑰才跑。CI 上跑前半段就夠擋住分岔。
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { ModelRequest, ModelResponse, Provider } from "../shared/providers/types.ts";
import { drain } from "../shared/streaming/types.ts";
import type { StreamingProvider } from "../shared/streaming/types.ts";

/**
 * 假 provider 預設每個字停 25ms（那是給人看打字機效果用的）。
 *
 * 測試裡那樣會直接撞上 5 秒逾時——**而且第一次跑就撞到了**。
 * `DELAY_MS` 是在 module 載入時讀的，所以必須在 import 之前設好，
 * 也就是只能用動態 import。
 *
 * 這件事本身也算一個小教訓：**module 層讀 env 會讓測試變難寫。**
 */
process.env.FAKE_DELAY_MS = "0";

const { fakeProvider } = await import("../shared/providers/fake.ts");
const { fakeStreamingProvider } = await import("../shared/streaming/fake.ts");

const REQUEST: ModelRequest = {
	system: "You are a test harness.",
	messages: [{ role: "user", text: "hello" }],
	tools: [
		{
			name: "read_file",
			description: "Read a file",
			parameters: {
				type: "object",
				properties: { path: { type: "string" } },
				required: ["path"],
			},
		},
	],
	maxTokens: 500,
};

const VALID_STOP_REASONS = new Set(["end", "tool_use", "max_tokens", "refusal"]);

/**
 * 每一個 provider 都必須成立的事。
 *
 * 注意這裡**不**要求 usage 一定存在——假 provider 沒有真的呼叫 API，
 * 要求它捏一個 usage 出來只會讓測試變成謊言。
 * 要求的是：**有的話，數字要自洽。**
 */
function assertResponseContract(response: ModelResponse, label: string): void {
	assert.ok(Array.isArray(response.blocks), `${label}: blocks 必須是陣列`);
	assert.ok(
		VALID_STOP_REASONS.has(response.stopReason),
		`${label}: stopReason "${response.stopReason}" 不在合法值裡`,
	);
	assert.ok("raw" in response, `${label}: 一定要保留 raw（provider 的原生訊息）`);

	for (const block of response.blocks) {
		if (block.type === "toolCall") {
			assert.equal(typeof block.id, "string", `${label}: tool call 要有 id`);
			assert.ok(block.name.length > 0, `${label}: tool call 要有名字`);
			assert.equal(typeof block.args, "object", `${label}: args 要是物件（已 parse 過）`);
			assert.ok(block.args !== null, `${label}: args 不能是 null`);
		} else {
			assert.equal(typeof block.text, "string", `${label}: text block 要有字串`);
		}
	}

	if (response.usage) {
		const { input, output, total } = response.usage;
		for (const [name, value] of Object.entries({ input, output, total })) {
			assert.ok(Number.isFinite(value) && value >= 0, `${label}: usage.${name} 要是非負數`);
		}
		// ⚠️ 不是 `total === input + output`。
		// Gemini 的 thinking token 不在 output 裡但算進 total（Lesson 26 實測），
		// 所以契約只能要求 total 不小於兩者之和。
		assert.ok(
			total >= input + output,
			`${label}: total (${total}) 不該小於 input + output (${input + output})`,
		);
	}
}

describe("Provider 契約：所有實作都要成立", () => {
	const nonStreaming: Array<[string, Provider]> = [["fake（非串流）", fakeProvider()]];
	const streaming: Array<[string, StreamingProvider]> = [
		["fake（串流）", fakeStreamingProvider()],
	];

	for (const [label, provider] of nonStreaming) {
		test(`${label} 回傳合法的 ModelResponse`, async () => {
			assertResponseContract(await provider.call(REQUEST), label);
		});
	}

	for (const [label, provider] of streaming) {
		test(`${label} 回傳合法的 ModelResponse`, async () => {
			assertResponseContract(await drain(provider.stream(REQUEST)), label);
		});

		test(`${label} 的事件順序合法`, async () => {
			const events: string[] = [];
			for await (const event of provider.stream(REQUEST)) events.push(event.type);

			// text_start 一定要配一個 text_end，而且不能重疊
			let open = false;
			for (const type of events) {
				if (type === "text_start") {
					assert.ok(!open, `${label}: text_start 重複開啟`);
					open = true;
				}
				if (type === "text_end") {
					assert.ok(open, `${label}: text_end 沒有對應的 text_start`);
					open = false;
				}
			}
			assert.ok(!open, `${label}: text_start 沒有關`);

			// 一定要以 done 或 error 收尾，不能就這樣結束
			const last = events.at(-1);
			assert.ok(
				last === "done" || last === "error",
				`${label}: 串流以 "${last}" 結束，呼叫端會拿不到結果`,
			);
		});

		test(`${label}：call() 和 stream() 給一樣的結果`, async () => {
			// 這一條專門擋「兩個入口悄悄分岔」——
			// `call()` 在真實 provider 裡是 `drain(stream())` 的包裝，
			// 如果哪天有人在其中一邊加了東西，這裡會紅。
			const viaStream = await drain(provider.stream(REQUEST));
			const viaCall = await provider.call(REQUEST);
			assert.equal(viaCall.stopReason, viaStream.stopReason);
			assert.equal(viaCall.blocks.length, viaStream.blocks.length);
		});
	}
});

/**
 * 真模型才驗得到的部分。
 *
 * 沒有 `PROVIDER` 就跳過——**跳過要說出來**，不然你會以為它跑過了。
 * 這也是為什麼這裡用 `test.skip` 而不是直接 `return`。
 */
describe("Provider 契約：真模型（需要金鑰）", () => {
	const requested = process.env.PROVIDER?.toLowerCase();
	const live = requested && requested !== "fake";

	if (!live) {
		test.skip("設 PROVIDER=openai|gemini|anthropic 才會跑（會真的花錢）", () => {});
		return;
	}

	test("串流版有回報 usage", async () => {
		const { selectStreamingProvider } = await import("../shared/streaming/index.ts");
		const response = await drain(selectStreamingProvider().stream(REQUEST));
		assertResponseContract(response, `${requested}（串流）`);
		assert.ok(response.usage, "真的 provider 一定要回報 usage，不然算不了成本");
	});

	test("非串流版也有回報 usage", async () => {
		// 這一條就是為了擋 Lesson 26 那個「只改串流那一支」的錯。
		const { selectProvider } = await import("../shared/providers/index.ts");
		const response = await selectProvider().call(REQUEST);
		assertResponseContract(response, `${requested}（非串流）`);
		assert.ok(
			response.usage,
			"非串流版也要回報 usage：共用型別答應的事，每個實作都要做到",
		);
	});
});
