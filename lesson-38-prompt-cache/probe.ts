/**
 * Lesson 38's real measurement: what the provider actually charges.
 *
 * Runs the same five-turn conversation five ways and reports the cached tokens
 * the provider reports back. A key is required, because the whole question is
 * what a real cache does — `demo.ts` is the offline half.
 *
 *   PROVIDER=openai bun run lesson-38:probe
 *
 * The number comes from the provider's own usage object, never from us:
 * OpenAI reports `usage.prompt_tokens_details.cached_tokens`. That field is why
 * this lesson is measurable at all, and Lesson 26 already made the general point
 * that usage must be read rather than computed.
 *
 * ## A warning about reading these numbers
 *
 * A cache is shared state with a TTL, so this experiment is **not** perfectly
 * repeatable. Running it twice in a minute warms turn 1 of the second run.
 * The comparison that survives that is *between* configurations within one run,
 * which is why all five run back to back here rather than as separate programs.
 */

import OpenAI from "openai";
import { BUILDERS, TURNS } from "./turns.ts";
import type { RequestShape } from "./prefix.ts";

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;

if (typeof process.loadEnvFile === "function") {
	try {
		process.loadEnvFile(new URL("../.env", import.meta.url).pathname);
	} catch {
		// No .env is normal.
	}
}

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) throw new Error("OPENAI_API_KEY is required. This lesson measures a real provider's cache.");

const client = new OpenAI({ apiKey });
const model = process.env.MODEL ?? "gpt-5";

/** Flatten our neutral message shape into the provider's. Only text is needed here. */
function toOpenAiMessages(shape: RequestShape) {
	const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
		{ role: "system", content: shape.system },
	];
	for (const message of shape.messages) {
		if (message.role === "user") messages.push({ role: "user", content: message.text });
		else if (message.role === "assistant") {
			const text = message.blocks.map((b) => (b.type === "text" ? b.text : "")).join("");
			messages.push({ role: "assistant", content: text || "(no text)" });
		}
	}
	return messages;
}

interface TurnResult {
	prompt: number;
	cached: number;
}

async function runTurn(shape: RequestShape): Promise<TurnResult> {
	const response = await client.chat.completions.create({
		model,
		messages: toOpenAiMessages(shape),
		tools: shape.tools.map((tool) => ({
			type: "function" as const,
			function: { name: tool.name, description: tool.description, parameters: tool.parameters },
		})),
		max_completion_tokens: 200,
	});
	const usage = response.usage as
		| { prompt_tokens: number; prompt_tokens_details?: { cached_tokens?: number } }
		| undefined;
	return { prompt: usage?.prompt_tokens ?? 0, cached: usage?.prompt_tokens_details?.cached_tokens ?? 0 };
}

console.log(bold("Lesson 38: what the provider actually caches"));
console.log(dim(`model: ${model}  turns per configuration: ${TURNS}\n`));
console.log(
	dim("Turn 1 is cold in every row by construction — it is the first time that prefix exists.\n" +
		"The row is about turns 2 to 5.\n"),
);

console.log(`  ${"configuration".padEnd(20)}${"prompt".padStart(8)}${"cached 2-5".padStart(12)}${"hit rate".padStart(10)}  from`);
console.log(dim(`  ${"─".repeat(78)}`));

const summary: Array<{ id: string; rate: number }> = [];

for (const builder of BUILDERS) {
	const results: TurnResult[] = [];
	for (let turn = 1; turn <= TURNS; turn++) {
		results.push(await runTurn(builder.build(turn)));
	}

	// Turn 1 cannot hit — exclude it, or every row is penalised for the same thing.
	const later = results.slice(1);
	const cached = later.reduce((sum, r) => sum + r.cached, 0);
	const prompt = later.reduce((sum, r) => sum + r.prompt, 0);
	const rate = prompt === 0 ? 0 : cached / prompt;
	summary.push({ id: builder.id, rate });

	const rendered = `${(rate * 100).toFixed(0)}%`.padStart(10);
	console.log(
		`  ${builder.label.padEnd(20)}${String(results[0]?.prompt ?? 0).padStart(8)}${String(cached).padStart(12)}` +
			`${rate > 0.5 ? green(rendered) : red(rendered)}  ${dim(builder.from)}`,
	);
}

const stable = summary.find((s) => s.id === "stable")?.rate ?? 0;
const fixed = summary.find((s) => s.id === "fixed")?.rate ?? 0;
const memory = summary.find((s) => s.id === "memory")?.rate ?? 0;

console.log(bold("\nIn one sentence"));
if (fixed > memory) {
	console.log(
		dim(
			"The same information, moved from the front of the request to the back, is the\n" +
				"difference between paying full price every turn and paying it once.\n",
		),
	);
} else {
	console.log(
		dim(
			"This run did not reproduce the expected gap. Before writing anything down,\n" +
				"check whether a previous run warmed the cache — see the warning at the top.\n",
		),
	);
}
console.log(dim(`stable=${(stable * 100).toFixed(0)}%  volatile-last=${(fixed * 100).toFixed(0)}%  memory-first=${(memory * 100).toFixed(0)}%`));
