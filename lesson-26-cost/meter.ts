/**
 * Cost metering: record every call's spend without changing any lesson's code.
 *
 * ## Why wrapping rather than passing in
 *
 * gpt-researcher passes `cost_callback` as a parameter into **every** function that calls a model
 * (visible in `query_processing.py` and `compression.py`). Very direct,
 * at the price of one more parameter in every signature and one missed call meaning one missed charge.
 *
 * This uses a decorator instead: wrap the provider, so `stream()` is still `stream()`
 * and merely keeps the books on the way past.
 *
 * ```ts
 * const provider = withMetering(selectStreamingProvider(), meter);
 * ```
 *
 * Lesson 24's `research()` needs no changes at all and has a complete cost record.
 * **This is design principle 6 in practice: add features beside the core, do not change the core.**
 *
 * The price: a decorator sees only the request and the response, not the caller's semantics.
 * So classifying (which call generated queries, which wrote the report) needs a classification function
 * of your own; see the `classify` parameter.
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
	/** The caller's semantic label, "generateQueries" for example. Decided by classify. */
	label: string;
	usage?: TokenUsage;
	/** This call's spend in dollars. undefined without a price table. */
	cost?: number;
	/** Was the output cut off by maxTokens. */
	truncated: boolean;
	/** How many characters this request sent (including the system prompt and the whole history). */
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

		/** Grouped by label, to see which step spends the money. */
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
 * Compute one call's cost.
 *
 * ⚠️ **This deliberately uses `total` rather than `input + output`.**
 *
 * Measured on Gemini 3.6 Flash: input=10, output=57, and total=683.
 * The 616 in between are thinking tokens — outside output, and billed.
 * Computing from `input + output` underestimates this call tenfold.
 *
 * As for apportioning it: thinking tokens are usually billed at the output rate,
 * so "total minus input" is treated here as the part charged at the output rate.
 * **Every provider's billing details differ; reconcile against a real invoice before shipping.**
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

				// A stream that is interrupted or errors emits no done event. **Such a call is billed too**,
				// so it is still recorded, just without usage — otherwise the books come up short
				// and you conclude "failed calls are free".
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
