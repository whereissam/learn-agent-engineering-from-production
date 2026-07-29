/**
 * Schema 相容層。
 *
 * 探針量出來的東西（見 README）可以歸成兩類，而它們的修法完全不同：
 *
 *   結構不支援    provider 直接 400。要**改寫成它吃得下的等價形式**
 *   約束沒人管    API 收下了但沒人強制。要**把約束搬進 description**
 *
 * 第二類是這一課的核心。`multipleOf: 15` 寫在 schema 裡，
 * OpenAI 的模型剛好遵守，Gemini 的不遵守，而**兩邊的 API 都不會報錯**。
 * 你唯一能做的是把它講給模型聽。
 *
 * 這正是 mastra 那幾個 provider-compat 在做的事。它的 google.ts 有一句
 * 註解把這件事講得很清楚：
 *
 *   > Google models support these properties but the model doesn't respect
 *   > them, but it respects them when they're added to the tool description
 *
 * 對照：`mastra/packages/schema-compat/src/provider-compats/`
 */

/** 一個 provider 能吃什麼、會遵守什麼。 */
export interface CompatTarget {
	name: string;
	/**
	 * 支不支援 tuple 形式的 `items: [A, B, C]`。
	 *
	 * Gemini 的 OpenAI 相容端點會直接回 400（實測）。
	 */
	tupleItems: boolean;
	/**
	 * 數值約束（multipleOf / minimum / maximum）模型會不會遵守。
	 *
	 * 注意這**不是**「API 支不支援」。API 兩邊都收，
	 * 差別在模型有沒有照做（Gemini 實測沒有）。
	 */
	enforcesNumeric: boolean;
	/** 字串約束（minLength / maxLength / pattern）模型會不會遵守。 */
	enforcesString: boolean;
}

/**
 * 實測出來的表。
 *
 * ⚠️ **這張表會過期。** 它是 2026-07 對 gemini-3.6-flash 和 gpt-5 量的結果,
 * 模型改版就可能變。所以真正該進版控的不是這張表，是
 * `bun run lesson-30:probe`，**能重跑的量測才是資產，抄來的常數不是。**
 *
 * 這條跟 Lesson 22 猜錯去重門檻、Lesson 27 抄錯相關性門檻是同一個教訓。
 */
export const TARGETS: Record<string, CompatTarget> = {
	gemini: { name: "gemini", tupleItems: false, enforcesNumeric: false, enforcesString: true },
	openai: { name: "openai", tupleItems: true, enforcesNumeric: true, enforcesString: true },
	/** 沒量過的一律當成最保守。**預設值是給還沒量過的人用的。** */
	unknown: { name: "unknown", tupleItems: false, enforcesNumeric: false, enforcesString: false },
};

export function targetFor(providerName: string): CompatTarget {
	return TARGETS[providerName] ?? (TARGETS.unknown as CompatTarget);
}

export interface CompatResult {
	schema: Record<string, unknown>;
	/**
	 * 被搬進 description 的約束。
	 *
	 * 回傳它而不是靜靜塞進去，是為了讓呼叫端**看得到自己做了什麼**。
	 * 一個安靜地改寫你 schema 的函式，是下一個難查的 bug。
	 */
	notes: string[];
}

const NUMERIC_KEYS = ["multipleOf", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum"];
const STRING_KEYS = ["minLength", "maxLength", "pattern", "format"];

/**
 * 把一份 schema 改寫成某個 provider 吃得下、而且約束講得出來的形式。
 *
 * **不會修改輸入。** 這一課的整個主題就是「別人的 schema 不是你的」,
 * 就地改寫它會讓呼叫端的資料悄悄變形。
 */
export function compatSchema(
	schema: Record<string, unknown>,
	target: CompatTarget,
): CompatResult {
	const notes: string[] = [];
	const out = walk(schema, target, notes, "");
	return { schema: out as Record<string, unknown>, notes };
}

function walk(node: unknown, target: CompatTarget, notes: string[], path: string): unknown {
	if (Array.isArray(node)) return node.map((item) => walk(item, target, notes, path));
	if (!node || typeof node !== "object") return node;

	const input = node as Record<string, unknown>;
	const out: Record<string, unknown> = {};

	for (const [key, value] of Object.entries(input)) {
		// ── 結構修正：tuple ─────────────────────────────────
		//
		// `items: [A, B, C]` 是 draft-04 的 tuple 寫法。不支援的 provider
		// 會直接 400，所以改寫成「元素是 A|B|C 的陣列」+ 長度限制,
		// 再把位置的意義寫進 description（因為 anyOf 表達不了順序）。
		if (key === "items" && Array.isArray(value) && !target.tupleItems) {
			out.items = { anyOf: value.map((item) => walk(item, target, notes, path)) };
			const where = path || "(root)";
			notes.push(`${where} is a fixed-length tuple: [${value.map(describe).join(", ")}]`);
			continue;
		}

		if (key === "properties" && value && typeof value === "object") {
			const props: Record<string, unknown> = {};
			for (const [name, sub] of Object.entries(value as Record<string, unknown>)) {
				props[name] = walk(sub, target, notes, path ? `${path}.${name}` : name);
			}
			out.properties = props;
			continue;
		}

		out[key] = walk(value, target, notes, path);
	}

	// ── 約束搬家 ─────────────────────────────────────────
	//
	// 留在 schema 裡（不礙事，而且支援的 provider 會用），
	// **同時**寫進 notes，由呼叫端接到 description 上。
	if (!target.enforcesNumeric) collect(out, NUMERIC_KEYS, notes, path);
	if (!target.enforcesString) collect(out, STRING_KEYS, notes, path);

	return out;
}

function collect(
	node: Record<string, unknown>,
	keys: string[],
	notes: string[],
	path: string,
): void {
	const found = keys.filter((key) => node[key] !== undefined);
	if (found.length === 0 || !path) return;
	notes.push(`${path} must satisfy ${found.map((k) => `${k}=${JSON.stringify(node[k])}`).join(", ")}`);
}

function describe(item: unknown): string {
	const schema = item as Record<string, unknown>;
	return String(schema?.type ?? "any");
}

/** 把 notes 接到工具描述後面。 */
export function describeWith(description: string, notes: string[]): string {
	if (notes.length === 0) return description;
	return `${description}\n\nConstraints you must follow exactly:\n${notes
		.map((note) => `- ${note}`)
		.join("\n")}`;
}
