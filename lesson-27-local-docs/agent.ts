/**
 * Lesson 27 - the downstream damage of the relevance floor
 *
 * Step 3 already proved deterministically that the floor blocks things: querying "how do you choose chunk size"
 * with no floor puts **a sous vide cooking guide in 4th place**.
 *
 * But ranking is an intermediate product. The real question is the next step:
 *
 *     once the model has those 8 results (3 about robots, 1 about sous vide),
 *     **does it actually cite them?**
 *
 * This lesson's local corpus is this repo's own documents and the web corpus is about robotics.
 * So for "how do you choose chunk size", **any web citation is wrong**.
 * The verdict is therefore deterministic: does an http URL appear in the answer.
 *
 * Run:
 *   PROVIDER=gemini bun run lesson-27:agent              # with the floor
 *   FLOOR=off PROVIDER=gemini bun run lesson-27:agent    # without it
 */

import { hybridSearch } from "./hybrid.ts";
import { selectStreamingProvider } from "../shared/streaming/index.ts";
import type { Message, StreamingProvider } from "../shared/streaming/types.ts";

const FLOOR = (process.env.FLOOR ?? "on").toLowerCase() !== "off";

/**
 * Only the local documents can answer this question (the web corpus is entirely robotics).
 * So it is a clean "one side is wholly irrelevant" scenario.
 */
const QUESTION = "How do I choose a chunk size?";

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;

async function main(): Promise<void> {
	const result = await hybridSearch(QUESTION, 8, { disableFloor: !FLOOR });

	const webHits = result.hits.filter((h) => h.kind === "web");

	console.log(bold(`\nthe downstream damage of the relevance floor   floor ${FLOOR ? green("on") : red("off")}`));
	console.log(dim("─".repeat(66)));
	console.log(dim(`retrieved ${result.hits.length} hits, ${webHits.length} of them from the web corpus`));
	for (const hit of result.hits) {
		const tag = hit.kind === "web" ? red("[web]  ") : dim("[local]");
		console.log(dim(`  ${hit.rank}. `) + tag + dim(` ${hit.source}`));
	}
	if (webHits.length > 0) {
		console.log(
			yellow(`  ⚠ The web corpus is about robots and is wholly irrelevant here. Citing any of it is wrong.`),
		);
	}
	console.log(dim("─".repeat(66)));

	const context = result.hits
		.map((h) => `[${h.source}] ${h.title}\n${h.snippet}`)
		.join("\n\n");

	const model: StreamingProvider = process.env.PROVIDER
		? selectStreamingProvider()
		: scriptedProvider(webHits.map((h) => h.source));

	console.log(`\n${bold("Q: ")}${QUESTION}`);
	console.log(bold("A:"));

	let answer = "";
	let stopReason = "?";
	for await (const event of model.stream({
		system:
			"Answer the user's question using only the retrieved sources below. " +
			"Cite the source identifier in brackets after each claim.\n\n" +
			context,
		messages: [{ role: "user", text: QUESTION } satisfies Message],
		tools: [],
		maxTokens: 2000,
	})) {
		if (event.type === "text_delta") {
			answer += event.delta;
			process.stdout.write(event.delta);
		}
		if (event.type === "done") {
			stopReason = event.response.stopReason;
			const text = event.response.blocks
				.filter((b) => b.type === "text")
				.map((b) => b.text)
				.join("");
			if (text) answer = text;
		}
	}

	// ── the deterministic verdict ───────────────────────────────
	//
	// No LLM judge (Lesson 25's position). The web corpus is uniformly irrelevant to this question,
	// so "does the answer contain a web source" is a string comparison.
	const citedWeb = webHits.map((h) => h.source).filter((url) => answer.includes(url));

	const localCount = result.hits.length - webHits.length;

	console.log(bold("\n\nVerdict"));
	console.log(
		dim(`  8 slots: ${localCount} local, ${webHits.length} irrelevant web`) +
			(webHits.length > 0
				? red(` (${webHits.length} relevant local documents were pushed out)`)
				: green(" (every slot went to a relevant source)")),
	);
	if (citedWeb.length > 0) {
		console.log(`  ${red("✗ cited an irrelevant source")}:`);
		for (const url of citedWeb) console.log(red(`     ${url}`));
	} else if (webHits.length > 0) {
		console.log(`  ${yellow("○ the model avoided it itself")}: the irrelevant source entered the context but was not cited`);
		console.log(dim("     Note that this is not the floor protecting you; the model simply did not take the bait."));
	} else {
		console.log(`  ${green("✓ the irrelevant source never entered the context")}`);
	}
	console.log(dim(`  provider: ${model.name} / ${model.model}  stopReason=${stopReason}`));

	// Lesson 15's lesson: a negative result must first rule out "the reply never finished".
	if (citedWeb.length === 0 && stopReason !== "end") {
		console.log(yellow(`  ⚠ the reply did not end cleanly (${stopReason}), so this result is not trustworthy; run it again`));
	}
}

/** The scripted provider used without a key: it shows what the output looks like and is not evidence. */
function scriptedProvider(webSources: string[]): StreamingProvider {
	const text =
		"Chunk size is a trade-off between semantic completeness and the context budget." +
		(webSources[0] ? ` See also [${webSources[0]}].` : "");
	const response = {
		blocks: [{ type: "text" as const, text }],
		raw: null,
		stopReason: "end" as const,
	};
	return {
		name: "fake",
		model: "scripted-floor (not evidence)",
		async *stream() {
			yield { type: "text_start" };
			yield { type: "text_delta", delta: text };
			yield { type: "text_end" };
			yield { type: "done", response };
		},
		async call() {
			return response;
		},
	};
}

await main();
