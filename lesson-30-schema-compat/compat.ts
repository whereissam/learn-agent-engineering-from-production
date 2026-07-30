/**
 * The schema compatibility layer.
 *
 * What the probe measured (see the README) falls into two classes with completely different fixes:
 *
 *   an unsupported structure   the provider returns 400. **Rewrite it into an equivalent form it accepts**
 *   an unenforced constraint   the API accepts it and nobody enforces it. **Move the constraint into the description**
 *
 * The second is this lesson's core. `multipleOf: 15` sits in the schema,
 * OpenAI's model happens to honour it, Gemini's does not, and **neither API raises an error**.
 * The only thing you can do is say it to the model.
 *
 * Which is exactly what mastra's provider-compat files do. Its google.ts has a comment
 * that states it plainly:
 *
 *   > Google models support these properties but the model doesn't respect
 *   > them, but it respects them when they're added to the tool description
 *
 * Source: `mastra/packages/schema-compat/src/provider-compats/`
 */

/** What a provider accepts and what it honours. */
export interface CompatTarget {
	name: string;
	/**
		 * Whether tuple-form `items: [A, B, C]` is supported.
	 *
		 * Gemini's OpenAI-compatible endpoint returns 400 outright (measured).
	 */
	tupleItems: boolean;
	/**
		 * Whether the model honours numeric constraints (multipleOf / minimum / maximum).
	 *
		 * Note this is **not** "does the API support it". Both APIs accept them;
		 * the difference is whether the model obeys (measured: Gemini does not).
	 */
	enforcesNumeric: boolean;
		/** Whether the model honours string constraints (minLength / maxLength / pattern). */
	enforcesString: boolean;
}

/**
 * The measured table.
 *
 * ⚠️ **This table will go stale.** It was measured in 2026-07 against gemini-3.6-flash and gpt-5,
 * and a model revision can change it. So what belongs in version control is not this table but
 * `bun run lesson-30:probe`: **a measurement you can re-run is an asset; a constant you copied is not.**
 *
 * The same lesson as Lesson 22's wrong dedup threshold and Lesson 27's wrongly copied relevance threshold.
 */
export const TARGETS: Record<string, CompatTarget> = {
	gemini: { name: "gemini", tupleItems: false, enforcesNumeric: false, enforcesString: true },
	openai: { name: "openai", tupleItems: true, enforcesNumeric: true, enforcesString: true },
		/** Anything unmeasured is treated most conservatively. **Defaults are for people who have not measured yet.** */
	unknown: { name: "unknown", tupleItems: false, enforcesNumeric: false, enforcesString: false },
};

export function targetFor(providerName: string): CompatTarget {
	return TARGETS[providerName] ?? (TARGETS.unknown as CompatTarget);
}

export interface CompatResult {
	schema: Record<string, unknown>;
	/**
		 * Constraints that were moved into the description.
	 *
		 * They are returned rather than silently inserted, so the caller **can see what was done**.
		 * A function that quietly rewrites your schema is the next hard-to-find bug.
	 */
	notes: string[];
}

const NUMERIC_KEYS = ["multipleOf", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum"];
const STRING_KEYS = ["minLength", "maxLength", "pattern", "format"];

/**
 * Rewrite a schema into a form a given provider accepts, with its constraints stated.
 *
 * **The input is never modified.** This lesson's whole subject is "somebody else's schema is not yours",
 * and rewriting it in place would silently deform the caller's data.
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
			// ── structural fix: tuple ───────────────────────────
		//
			// `items: [A, B, C]` is draft-04's tuple form. A provider that does not support it
			// returns 400 outright, so it is rewritten as "an array whose elements are A|B|C" plus a length limit,
			// with the positional meaning written into the description (because anyOf cannot express order).
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

		// ── moving constraints ───────────────────────────────
	//
		// They stay in the schema (harmless, and a supporting provider uses them),
		// **and** go into notes, for the caller to attach to the description.
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

/** Append the notes to a tool description. */
export function describeWith(description: string, notes: string[]): string {
	if (notes.length === 0) return description;
	return `${description}\n\nConstraints you must follow exactly:\n${notes
		.map((note) => `- ${note}`)
		.join("\n")}`;
}
