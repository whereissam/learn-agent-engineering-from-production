/**
 * 價目表。
 *
 * ## 這個檔案是空的，而且是刻意的
 *
 * 設計原則 3 說「輸出範例要是真的跑出來的，不要編造」。價目也一樣：
 * **我不會把我沒查證過的數字寫死在這裡**，因為
 *
 *   1. 價格每隔幾個月就變
 *   2. 同一個模型在不同區域、不同層級、有沒有快取，價格都不同
 *   3. 一個看起來很精確但其實過期的數字，比沒有數字更危險——
 *      你會拿它去做決策
 *
 * 所以這裡只定義**形狀**，數字由你自己填。填法有兩種：
 *
 * ```bash
 * # 1. 環境變數（試算的時候最方便）
 * PRICE_INPUT=0.30 PRICE_OUTPUT=2.50 bun run lesson-26
 * ```
 *
 * ```ts
 * // 2. 寫進下面的 PRICES（正式使用）
 * "gemini-3.6-flash": { input: 0.30, output: 2.50, verifiedOn: "2026-07-27" },
 * ```
 *
 * 單位一律是**每一百萬 token 多少美元**，因為所有 provider 的官方定價
 * 都是這個單位，換算越少出錯機會越少。
 *
 * ## 沒填價目會怎樣
 *
 * 一切照跑，只是不顯示金額，**token 數還是完整記錄**。
 * 這是刻意的：token 是可以量測的事實，錢是需要外部資訊的推算。
 * 兩者不該混在一起。
 */

export interface Price {
	/** 每百萬 input token 多少美元 */
	input: number;
	/** 每百萬 output token 多少美元（thinking token 通常算這個價） */
	output: number;
	/** 你是哪一天去官網確認的。沒有這個欄位的價格不值得相信。 */
	verifiedOn: string;
}

/**
 * 自己填。key 是 model id（`provider.model` 的值）。
 *
 * 建議連 `verifiedOn` 一起寫，半年後你會感謝自己。
 */
export const PRICES: Record<string, Price> = {
	// "gemini-3.6-flash": { input: 0, output: 0, verifiedOn: "YYYY-MM-DD" },
	// "claude-opus-5":    { input: 0, output: 0, verifiedOn: "YYYY-MM-DD" },
	// "gpt-5":            { input: 0, output: 0, verifiedOn: "YYYY-MM-DD" },
};

export function priceFor(model: string): Price | undefined {
	const fromEnv = envPrice();
	if (fromEnv) return fromEnv;

	// 完全比對優先，再試前綴（因為 model id 常常帶日期後綴）
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
	return { input, output, verifiedOn: "(來自環境變數)" };
}

export function hasPrices(): boolean {
	return envPrice() !== undefined || Object.keys(PRICES).length > 0;
}
