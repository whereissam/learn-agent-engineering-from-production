/**
 * Lesson 17 - the downstream damage of recall blindness
 *
 * ⚠️ One thing first, because it is this lesson's thesis:
 *
 *     **The ranker contains no LLM, and should not.**
 *
 * This program changes not one line of ranking. The model sits **outside**,
 * as an agent that has search_sessions as a tool.
 * That does not contradict the lesson's position; it measures that position's cost.
 *
 * `demo.ts` already proved recall blindness exists with deterministic scores:
 *
 *     ❌ no demotion: cron ranks first
 *     ✅ demoted to 0.25: interactive ranks first
 *
 * But ranking is an intermediate product. The real damage is the next step:
 *
 *     the agent receives a pile of cron summaries and answers the user confidently.
 *     **It does not know what it did not see.**
 *
 * This program measures that step. The same question, corpus and model,
 * with the only difference being whether ranking demotes.
 *
 * Run:
 *   PROVIDER=gemini bun run lesson-17:agent              # with demotion
 *   DEMOTE=off PROVIDER=gemini bun run lesson-17:agent   # without
 */

import { SessionSearchIndex } from "../shared/search/index.ts";
import { selectStreamingProvider } from "../shared/streaming/index.ts";
import type { Message, StreamingProvider, ToolSpec } from "../shared/streaming/types.ts";

const DEMOTE = (process.env.DEMOTE ?? "on").toLowerCase() !== "off";

/**
 * What the user is looking for.
 *
 * The right answer exists only in **that one** interactive conversation:
 * the sample rate was hardcoded and should be read from the session metadata.
 *
 * The 12 cron summaries all say "the sample rate is normal, no anomalies".
 * So whatever the model answers directly reflects which side it retrieved.
 */
const QUESTION =
	"Did I look into a telemetry sample-rate problem before? If so, what was the conclusion?";

/** Words only obtainable by reading that real conversation. */
const CORRECT_SIGNALS = ["metadata", "hardcode", "sample_rate_hz", "meta."];
/** Words that only appear if it read the cron summaries. */
const BLIND_SIGNALS = ["normal", "nothing anomalous", "no problem", "no anomal"];

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

/** The same corpus as demo.ts, deliberately not shared so that changing one cannot break the other. */
function build(): SessionSearchIndex {
	const index = new SessionSearchIndex();

	index.addSession(
		{
			sessionId: "sess_real",
			title: "fixing the telemetry sample-rate bug",
			source: "interactive",
			startedAt: "2026-07-20T10:00:00Z",
			messageCount: 6,
		},
		[
			user("something looks wrong with our telemetry sample-rate setting"),
			assistant("Let me look at the config. sample_rate_hz is hardcoded to 50Hz right now."),
			user("right, but the go2-c unit actually runs at 100Hz"),
			assistant(
				"Found it. config.ts hardcodes the sample rate; it should read it from the session metadata. " +
					"I changed it to meta.sample_rate_hz, falling back to 50 when the value is missing.",
			),
			user("did you test it"),
			assistant("Ran bun test: 5 pass, 0 fail."),
		],
	);

	for (let day = 1; day <= 12; day++) {
		index.addSession(
			{
				sessionId: `sess_cron_${day}`,
				title: `daily telemetry summary ${day}`,
				source: "cron",
				startedAt: `2026-07-${String(day).padStart(2, "0")}T03:00:00Z`,
				messageCount: 2,
			},
			[
				user("generate the daily telemetry summary"),
				assistant(
					"Today's telemetry summary: sample rate normal, 14 sessions, " +
						"telemetry sample rate 50Hz, nothing anomalous. Telemetry data complete.",
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

	console.log(
		bold(`\nthe downstream damage of recall blindness   source demotion ${DEMOTE ? green("on") : red("off")}`),
	);
	console.log(dim(`corpus: 1 real user conversation + 12 cron summaries`));
	console.log(dim("─".repeat(66)));
	console.log(`${bold("Q: ")}${QUESTION}\n`);

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
					// ← the only variable. The ranker itself is unchanged.
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
							.join("\n\n") || "(no results)",
				};
			}),
		});
	}

	// ── the deterministic verdict ───────────────────────────────
	const correct = CORRECT_SIGNALS.filter((s) => answer.includes(s));
	const blind = BLIND_SIGNALS.filter((s) => answer.includes(s));

	console.log(bold("\n\nVerdict"));
	console.log(dim(`  the model searched ${searched.length} times: ${searched.join(" / ")}`));
	console.log(
		dim(`  final answer: ${answer.trim().length} characters`) +
			(answer.trim() ? "" : red(" (hit the step cap: it kept searching and never answered)")),
	);
	console.log(`  words only reachable from the real conversation: ${correct.length ? green(correct.join(", ")) : dim("none")}`);
	console.log(`  words that only come from the cron summaries: ${blind.length ? red(blind.join(", ")) : dim("none")}`);

	if (correct.length > 0) {
		console.log(`  ${green("✓ it found the real conversation")}`);
	} else {
		console.log(`  ${red("✗ recall blindness")}: the model never retrieved the conversation the user actually had`);
		console.log(dim("     Note how confident it sounds. It does not know what it missed."));
	}
	console.log(dim(`  provider: ${model.name} / ${model.model}  stopReason=${stopReason}`));

	// Lesson 15's lesson: a negative result must first rule out "the reply never finished".
	if (correct.length === 0 && stopReason !== "end") {
		console.log(yellow(`  ⚠ the reply did not end cleanly (${stopReason}), so this result is not trustworthy; run it again`));
	}
}

/** The scripted provider used without a key: it shows what the output looks like and is not evidence. */
function scriptedProvider(): StreamingProvider {
	const call = { id: "s1", name: "search_sessions", args: { query: "telemetry sample rate" } };
	let step = 0;
	const provider: StreamingProvider = {
		name: "fake",
		model: "scripted-recall (not evidence)",
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
				? "Yes. You found that config.ts hardcodes the sample rate, and concluded it should be read from the session metadata."
				: "Yes, and the conclusion at the time was that the sample rate was normal, nothing anomalous.";
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
