/**
 * 成本計量：不改任何一課的程式碼，就把每次呼叫的花費記下來。
 *
 * ## 為什麼用「包起來」而不是「傳進去」
 *
 * gpt-researcher 的做法是把 `cost_callback` 當參數傳進**每一個**會呼叫模型的
 * 函式（`query_processing.py`、`compression.py` 都看得到）。那樣很直接，
 * 但代價是每個函式簽章都多一個參數，而且漏傳一個地方就少算一筆。
 *
 * 這裡改用裝飾器：把 provider 包一層，`stream()` 照樣是 `stream()`，
 * 只是路過的時候順手記帳。
 *
 * ```ts
 * const provider = withMetering(selectStreamingProvider(), meter);
 * ```
 *
 * Lesson 24 的 `research()` 一行都不用改，就有完整的成本紀錄。
 * **這也是設計原則 6 的實踐：新功能加在核心旁邊，不要改核心。**
 *
 * 代價是：裝飾器只看得到「request 和 response」，看不到呼叫端的語意。
 * 所以要分類（哪一筆是生 query、哪一筆是寫報告）就得自己給一個分類函式，
 * 見 `classify` 參數。
 */

import type {
	ModelRequest,
	ModelResponse,
	StreamEvent,
	StreamingProvider,
	TokenUsage,
} from "../shared/streaming/types.ts";
import { type Price, priceFor } from "./prices.ts";

export interface CallRecord {
	/** 呼叫端的語意標籤，例如 "generateQueries"。由 classify 決定。 */
	label: string;
	usage?: TokenUsage;
	/** 這一次的花費（美元）。沒有價目表就是 undefined。 */
	cost?: number;
	/** 輸出有沒有被 maxTokens 砍掉。 */
	truncated: boolean;
	/** 這次請求送進去多少字元（含 system 和整段對話歷史）。 */
	promptChars: number;
	elapsedMs: number;
}

export class CostMeter {
	readonly calls: CallRecord[] = [];

	get totals(): { input: number; output: number; total: number; cost: number; unknown: number } {
		let input = 0;
		let output = 0;
		let total = 0;
		let cost = 0;
		let unknown = 0;

		for (const call of this.calls) {
			if (!call.usage) {
				unknown++;
				continue;
			}
			input += call.usage.input;
			output += call.usage.output;
			total += call.usage.total;
			cost += call.cost ?? 0;
		}

		return { input, output, total, cost, unknown };
	}

	/** 依標籤分組，看錢花在哪一個步驟。 */
	byLabel(): Array<{ label: string; calls: number; total: number; cost: number }> {
		const groups = new Map<string, { calls: number; total: number; cost: number }>();

		for (const call of this.calls) {
			const group = groups.get(call.label) ?? { calls: 0, total: 0, cost: 0 };
			group.calls++;
			group.total += call.usage?.total ?? 0;
			group.cost += call.cost ?? 0;
			groups.set(call.label, group);
		}

		return [...groups.entries()]
			.map(([label, g]) => ({ label, ...g }))
			.sort((a, b) => b.total - a.total);
	}
}

/**
 * 算一次呼叫多少錢。
 *
 * ⚠️ **這裡刻意用 `total` 而不是 `input + output`。**
 *
 * Gemini 3.6 Flash 實測：input=10、output=57，但 total=683。
 * 中間 616 個是 thinking token——它不在 output 裡，但你要付錢。
 * 用 `input + output` 算，這一筆會少算 10 倍。
 *
 * 至於怎麼分攤：thinking token 通常照 output 價計費，
 * 所以這裡把「total 減掉 input」當成要付 output 價的部分。
 * **各家 provider 的計費細節不同，上線前一定要拿帳單對一次。**
 */
function costOf(usage: TokenUsage | undefined, price: Price | undefined): number | undefined {
	if (!usage || !price) return undefined;
	const billedOutput = Math.max(usage.total - usage.input, usage.output);
	return (usage.input * price.input + billedOutput * price.output) / 1_000_000;
}

export function withMetering(
	provider: StreamingProvider,
	meter: CostMeter,
	classify: (request: ModelRequest) => string = () => "call",
): StreamingProvider {
	const price = priceFor(provider.model);

	const wrapped: StreamingProvider = {
		name: provider.name,
		model: provider.model,

		async *stream(request: ModelRequest, signal?: AbortSignal): AsyncIterable<StreamEvent> {
			const started = Date.now();
			const promptChars =
				request.system.length +
				request.messages.reduce(
					(sum, m) => sum + (m.role === "user" ? m.text.length : JSON.stringify(m).length),
					0,
				);

			let recorded = false;

			for await (const event of provider.stream(request, signal)) {
				if (event.type === "done") {
					recorded = true;
					meter.calls.push({
						label: classify(request),
						usage: event.response.usage,
						cost: costOf(event.response.usage, price),
						truncated: event.response.stopReason === "max_tokens",
						promptChars,
						elapsedMs: Date.now() - started,
					});
				}
				yield event;
			}

			// 串流中斷或出錯時不會有 done 事件。**這種呼叫一樣要付錢**，
			// 所以還是記一筆，只是沒有 usage——不然帳目會少算，
			// 而且你會以為「失敗的呼叫是免費的」。
			if (!recorded) {
				meter.calls.push({
					label: `${classify(request)} (未完成)`,
					truncated: false,
					promptChars,
					elapsedMs: Date.now() - started,
				});
			}
		},

		async call(request: ModelRequest, signal?: AbortSignal): Promise<ModelResponse> {
			let response: ModelResponse | undefined;
			for await (const event of wrapped.stream(request, signal)) {
				if (event.type === "done") response = event.response;
			}
			if (!response) throw new Error("Stream ended without a response");
			return response;
		},
	};

	return wrapped;
}
