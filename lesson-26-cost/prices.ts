/**
 * The price table.
 *
 * ## This file is empty, deliberately
 *
 * Design principle 3 says example output must be really produced rather than invented. Prices are the same:
 * **unverified numbers are not hardcoded here**, because
 *
 *   1. prices change every few months
 *   2. the same model differs by region, by tier, and by whether caching applies
 *   3. a precise-looking but stale number is more dangerous than no number —
 *      you will make decisions with it
 *
 * So this defines only the **shape**, with the numbers left to you. Two ways to fill them in:
 *
 * ```bash
 * # 1. Environment variables (most convenient while estimating)
 * PRICE_INPUT=0.30 PRICE_OUTPUT=2.50 bun run lesson-26
 * ```
 *
 * ```ts
 * // 2. Write them into PRICES below (for real use)
 * "gemini-3.6-flash": { input: 0.30, output: 2.50, verifiedOn: "2026-07-27" },
 * ```
 *
 * The unit is always **dollars per million tokens**, because every provider's official pricing
 * uses that unit, and fewer conversions mean fewer mistakes.
 *
 * ## What happens with no prices filled in
 *
 * Everything runs, amounts are not shown, and **token counts are still recorded in full**.
 * That is deliberate: tokens are a measurable fact and money is an inference needing external information.
 * The two should not be mixed.
 */

export interface Price {
	/** Dollars per million input tokens */
	input: number;
	/** Dollars per million output tokens (thinking tokens usually bill at this rate) */
	output: number;
	/** The date you checked the official site. A price without this field is not worth believing. */
	verifiedOn: string;
}

/**
 * Fill this in yourself. The key is the model id (the value of `provider.model`).
 *
 * Write `verifiedOn` alongside it; six months from now you will thank yourself.
 */
export const PRICES: Record<string, Price> = {
	// "gemini-3.6-flash": { input: 0, output: 0, verifiedOn: "YYYY-MM-DD" },
	// "claude-opus-5":    { input: 0, output: 0, verifiedOn: "YYYY-MM-DD" },
	// "gpt-5":            { input: 0, output: 0, verifiedOn: "YYYY-MM-DD" },
};

export function priceFor(model: string): Price | undefined {
	const fromEnv = envPrice();
	if (fromEnv) return fromEnv;

	// Exact match first, then a prefix (because model ids often carry a date suffix)
	if (PRICES[model]) return PRICES[model];
	for (const [key, price] of Object.entries(PRICES)) {
		if (model.startsWith(key)) return price;
	}
	return undefined;
}

function envPrice(): Price | undefined {
	const input = Number(process.env.PRICE_INPUT);
	const output = Number(process.env.PRICE_OUTPUT);
	if (!Number.isFinite(input) || !Number.isFinite(output)) return undefined;
	return { input, output, verifiedOn: "(from environment variables)" };
}

export function hasPrices(): boolean {
	return envPrice() !== undefined || Object.keys(PRICES).length > 0;
}
