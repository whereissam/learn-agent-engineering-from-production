/**
 * Lesson 17's demonstration: cross-session search, and two real ranking bugs.
 *
 * No API key needed.
 *
 * Run: bun run lesson-17-search/demo.ts
 */

import type { Message } from "../shared/providers/types.ts";
import { SessionSearchIndex, type SessionSource } from "../shared/search/index.ts";

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;

const user = (text: string): Message => ({ role: "user", text });
const assistant = (text: string): Message => ({
	role: "assistant",
	blocks: [{ type: "text", text }],
	raw: null,
});

function build(): SessionSearchIndex {
	const index = new SessionSearchIndex();

		// The user's real conversation: one of them, and exactly what they are looking for
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

		// Scheduled jobs: run daily, saying the same words, in volume
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

		// A subagent's work: it must not appear in the user's history
	index.addSession(
		{
			sessionId: "sess_sub",
			title: "subagent: check telemetry",
			source: "subagent",
			startedAt: "2026-07-21T10:00:00Z",
			messageCount: 2,
		},
		[user("check the telemetry sample rate"), assistant("Sample rate 50Hz.")],
	);

		// A compacted session: the summary lives as an ordinary message
	index.addSession(
		{
			sessionId: "sess_compacted",
			title: "a very long debugging conversation",
			source: "interactive",
			startedAt: "2026-07-19T14:00:00Z",
			messageCount: 3,
		},
		[
			user(
				"[The following is a summary of the earlier part of this conversation. " +
					"The original messages were dropped from the context to save space.]\n\n" +
					"- the user reported a telemetry sample-rate problem\n- checked config.ts, store.ts, server.ts\n" +
					"- found the sample rate hardcoded\n- tried three fixes\n- " +
					"(another 2000 words of summary would follow here…)",
			),
			user("so what was the conclusion"),
			assistant("The conclusion is that the sample rate should be read from metadata."),
		],
	);

	return index;
}

// ─────────────────────────────────────────────────────────────

function scenario1(): void {
	console.log(bold("\nScenario 1: three modes, one tool"));
	console.log(dim("Hermes' session_search has no mode parameter; it infers one from the arguments.\n"));

	const index = build();
	const s = index.stats();
	console.log(dim(`  index: ${s.sessions} sessions, ${s.messages} messages, ${s.terms} terms\n`));

	console.log(dim("  ① DISCOVERY  you give a query"));
	console.log(dim("  ② SCROLL     you give session_id + around_message_id"));
	console.log(dim("  ③ BROWSE     you give nothing\n"));

	console.log(dim("  what BROWSE returns (the most recent sessions):"));
	for (const meta of index.browse(4)) {
		console.log(`    ${cyan(meta.sessionId.padEnd(16))} ${dim(meta.source.padEnd(12))} ${meta.title}`);
	}
	console.log(dim("\n  Note that sess_sub (a subagent) is absent; it is not part of the user's history."));
}

function scenario2(): void {
	console.log(bold("\n\nScenario 2: recall blindness (a real bug)"));
	console.log(dim("Scheduled jobs say the same words every day, and bury the user's real conversation.\n"));

	const index = build();

	console.log(dim('  searching for "telemetry sample rate"'));
	console.log(dim("  the data holds 1 user conversation + 12 near-identical scheduled sessions\n"));

	const show = (label: string, list: ReturnType<typeof index.discover>) => {
		console.log(dim(`  ${label}`));
		for (const [i, r] of list.entries()) {
			const tag = r.hit.source === "interactive" ? green("interactive") : yellow("cron       ");
			console.log(
				`    ${i + 1}. ${tag}  ${r.hit.sessionTitle.padEnd(38)} ${dim(`score=${r.hit.score.toFixed(1)}`)}`,
			);
		}
		const top = list[0];
		const ok = top?.hit.source === "interactive";
		console.log(`    → the top hit is ${ok ? green("interactive ✓") : red("cron (recall blindness) ✗")}\n`);
	};

		// First the version without demotion, which is the bug itself
	show(
		"❌ every source weighted equally (the state of Hermes issue #19434):",
		index.discover("telemetry sample rate", 3, 2, { disableSourceWeighting: true }),
	);

	show("✅ cron down-weighted to 0.25:", index.discover("telemetry sample rate", 3));

	console.log(dim("\n  Hermes' fix is to **down-weight rather than exclude**:"));
	console.log(dim("    exclude    → cron content becomes unfindable forever"));
	console.log(dim("    down-weight → cron is still findable when it is the only hit, but interactive always wins a tie"));
}

function scenario3(): void {
	console.log(bold("\n\nScenario 3: the compaction-summary loop (another real bug)"));
	console.log(dim("A compaction summary is stored as an ordinary message, so search finds it.\n"));

	console.log(dim("  consider this loop:"));
	console.log(dim("    1. an old session is compacted, producing a long summary"));
	console.log(dim("    2. a new session searches history and finds that summary"));
	console.log(dim("    3. the summary is pushed into the new session's context"));
	console.log(dim("    4. the new session grows and is compacted in turn…"));
	console.log(red("\n  Search dragged back exactly what Lesson 5 worked to remove.\n"));

	const index = build();
	const results = index.discover("sample rate conclusion", 5);

	console.log(dim("  is a compaction summary among the results?"));
	const hasCompaction = results.some(
		(r) =>
			r.hit.snippet.includes("summary of the earlier part") ||
			r.bookendStart.some((m) => m.text.includes("summary of the earlier part")),
	);
	console.log(`    ${hasCompaction ? red("yes (the defence failed)") : green("no ✓")}`);

	const compacted = results.find((r) => r.hit.sessionId === "sess_compacted");
	if (compacted) {
		console.log(dim("\n  sess_compacted was found, but the bookend skipped the summary message:"));
		for (const m of compacted.bookendStart) {
			console.log(`    ${dim(`[${m.role}] ${m.text.slice(0, 50)}`)}`);
		}
	}
}

function scenario4(): void {
	console.log(bold("\n\nScenario 4: bookends give you your bearings"));
	console.log(dim("Given only the matching line, you cannot tell what that session was about.\n"));

	const index = build();
	const [result] = index.discover("sample_rate_hz hardcoded", 1);
	if (!result) return;

	console.log(`  ${bold(result.hit.sessionTitle)}  ${dim(result.hit.sessionId)}`);

	console.log(dim("\n  the start of the session (what this conversation was about):"));
	for (const m of result.bookendStart) console.log(`    ${dim(`[${m.role}] ${m.text.slice(0, 60)}`)}`);

	console.log(dim("\n  around the hit (what actually happened):"));
	for (const m of result.window) {
		const isHit = m.messageId === result.hit.messageId;
		const line = `    [${m.role}] ${m.text.slice(0, 60)}`;
		console.log(isHit ? green(line) : dim(line));
	}

	console.log(dim("\n  the end of the session (what the conclusion was):"));
	for (const m of result.bookendEnd) console.log(`    ${dim(`[${m.role}] ${m.text.slice(0, 60)}`)}`);

	console.log(dim("\n  Those three pieces together tell the model what happened last time, with no further digging."));
}

function scenario5(): void {
	console.log(bold("\n\nScenario 5: why there is no LLM here"));
	console.log(dim('I expected a two-stage "retrieve, then have an LLM judge relevance" design.\n'));

	console.log(dim("  Hermes' docstring:"));
	console.log(dim('    "No LLM calls anywhere - every shape returns actual messages from the DB."'));
	console.log(dim("\n  And the History note says it was **removed later**:"));
	console.log(dim('    "PR #20238 seeded a fast/summary dual-mode split; ...'));
	console.log(dim("     this module merges all of that into a single calling shape"));
	console.log(dim('     with no mode parameter, **no summary LLM path**..."'));

	console.log(dim("\n  Why? Because **the caller of this tool is already a model**."));
	console.log(dim("  It does not need another LLM to judge relevance; hand it the raw messages."));
	console.log(dim("  That middle summarising layer only adds cost, latency, and one more thing that can be wrong."));

	console.log(yellow("\n  The contrast with Lesson 6 is worth getting straight:"));
	console.log(dim("    Lesson 6  find_anomalies: rules handle recall, the model handles precision"));
	console.log(dim("              → because the model there is the agent making the judgement"));
	console.log(dim("    Lesson 17 session_search: rules handle everything; no model is added"));
	console.log(dim("              → because the results go to the agent anyway, and it judges for itself"));
	console.log(dim("\n  The criterion: **are you narrowing the field for the model, or deciding on its behalf?**"));
	console.log(dim("  The first is worth a layer; the second is not."));
}

// ─────────────────────────────────────────────────────────────

console.log(bold("Lesson 17: searching across sessions"));

scenario1();
scenario2();
scenario3();
scenario4();
scenario5();

console.log(bold("\n\nIn one sentence"));
console.log(dim("Search quality mostly does not come from adding a model; it comes from ranking hygiene:\n"));
console.log(dim("  which sources must not appear, which to down-weight, and which noise you generated yourself.\n"));
