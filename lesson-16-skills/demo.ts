/**
 * Lesson 16's demonstration: skills' progressive disclosure and the review gate.
 *
 * No API key needed.
 *
 * Run: bun run lesson-16-skills/demo.ts
 */

import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { isAllowedInProposalFork, SkillReviewQueue } from "../shared/skills/review.ts";
import { SkillStore } from "../shared/skills/store.ts";
import { MAX_DESCRIPTION_CHARS, parseSkill, validateSkill } from "../shared/skills/types.ts";

const ROOT = resolve(import.meta.dirname, ".skills");
const ACTIVE = resolve(ROOT, "active");
const PROPOSED = resolve(ROOT, "proposed");

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;

await rm(ROOT, { recursive: true, force: true });

const GOOD_SKILL = `---
name: replay-fall-window
description: Replay a robot session around a detected fall.
version: 0.1.0
author: Hermes
tags: [Robotics, Telemetry]
---

# Replay Fall Window

Re-runs a recorded session around an incident so you can watch what happened.
It does NOT re-run the controller; it only replays logged telemetry.

## When to Use
- "show me what happened before the fall"
- "replay session X around 8 seconds"

## Procedure
1. \`get_session(session_id)\` to confirm sample rate and clock offset.
2. \`query_telemetry\` for the window, padded 2s either side.
3. \`get_video_frame\` at the peak timestamp.

## Verification
The reported window overlaps the anomaly returned by \`find_anomalies\`.
`;

// ─────────────────────────────────────────────────────────────

async function scenario1(): Promise<void> {
	console.log(bold("\nScenario 1: progressive disclosure (why a description gets only 60 characters)"));
	console.log(dim("Skills are not stuffed into the system prompt; they split into an index and a body.\n"));

	const store = new SkillStore({ dir: ACTIVE });
	store.add(parseSkill(GOOD_SKILL));
	store.add(
		parseSkill(GOOD_SKILL.replace("replay-fall-window", "compare-sessions").replace(
			"Replay a robot session around a detected fall.",
			"Compare two robot sessions field by field.",
		)),
	);

	console.log(dim('the "index" loaded on every request:'));
	for (const line of store.buildIndex().split("\n")) console.log(`  ${line}`);

	console.log(dim(`\nindex cost: ${store.indexCost()} characters, **paid every turn**`));
	console.log(dim("the body only loads when the model calls load_skill:\n"));
	const body = store.loadBody("replay-fall-window");
	console.log(dim(`  ${body.split("\n").length} lines, ${body.length} characters (costing no context until called)`));

	console.log(dim('\nSo a description is for routing, not for explaining.'));
	console.log(dim("The model decides whether to expand on that one line alone."));
}

async function scenario2(): Promise<void> {
	console.log(bold("\n\nScenario 2: going over 60 characters fails silently"));
	console.log(dim("This is the most-violated rule in the Hermes authoring standard.\n"));

	const bad = parseSkill(
		GOOD_SKILL.replace(
			"description: Replay a robot session around a detected fall.",
			"description: A comprehensive and powerful skill that seamlessly replays robot sessions around detected falls with advanced telemetry analysis.",
		),
	);

	console.log(dim(`original description (${bad.frontmatter.description.length} characters):`));
	console.log(`  ${bad.frontmatter.description}`);

	const store = new SkillStore({ dir: ACTIVE });
	store.add(bad);
	console.log(dim("\nwhat the model actually sees:"));
	for (const line of store.buildIndex().split("\n").slice(-1)) console.log(`  ${red(line)}`);
	console.log(red(`  ↑ everything past character ${MAX_DESCRIPTION_CHARS} was cut, with no error message at all`));

	console.log(dim("\nwhat the automatic checks caught:"));
	for (const issue of validateSkill(bad)) {
		const mark = issue.blocking ? red("✗") : yellow("!");
		console.log(`  ${mark} ${issue.field}: ${dim(issue.message)}`);
	}
}

async function scenario3(): Promise<void> {
	console.log(bold("\n\nScenario 3: propose → review → enable"));
	console.log(dim("The agent may write, but it writes into a place that has no effect.\n"));

	const queue = new SkillReviewQueue({ proposedDir: PROPOSED, activeDir: ACTIVE });

		// The agent extracts a skill from one successful task
	const proposal = await queue.propose(parseSkill(GOOD_SKILL), {
		sessionId: "sess_042",
		summary:
			"The user asked me to analyse the fall in sess_001; I used get_session → find_anomalies → query_telemetry",
	});

	console.log(`  the agent proposed "${proposal.skill.frontmatter.name}"`);
	console.log(dim(`  source: ${proposal.skill.proposedFrom?.summary}`));
	console.log(dim(`  automatic checks: ${proposal.blocked ? red("blocking issues") : green("passed")}`));

		// The key: the model cannot see it at this point
	const store = new SkillStore({ dir: ACTIVE, proposedDir: PROPOSED });
	await store.load();
	console.log(dim(`\n  the index currently holds ${store.list().length} skill(s)`));
	console.log(dim(`  ${store.list("proposed").length} awaiting review`));
	console.log(yellow("  → a proposed skill does not exist to the model; that is where the gate really sits"));

		// A human reviews
	console.log(dim("\n  [human] read it and approved"));
	console.log(dim(`  ${await queue.decide("replay-fall-window", { action: "approve", reviewer: "sam" })}`));

	const after = new SkillStore({ dir: ACTIVE, proposedDir: PROPOSED });
	await after.load();
	console.log(dim(`\n  the index now holds ${after.list().length} skill(s):`));
	for (const line of after.buildIndex().split("\n").slice(-1)) console.log(`  ${green(line)}`);
}

async function scenario4(): Promise<void> {
	console.log(bold("\n\nScenario 4: why a tool allowlist is needed"));
	console.log(dim("Hermes' background review forks an agent to write up what it learned.\n"));

	console.log(dim("  That fork runs in the background with nobody watching. If it had full permissions…"));
	console.log(dim("  So Hermes gives it an allowlist and refuses every other tool at runtime:\n"));

	for (const tool of ["propose_skill", "remember", "read_file", "run_command", "write_file", "send_email"]) {
		const ok = isAllowedInProposalFork(tool);
		console.log(`    ${ok ? green("allow") : red("deny ")}  ${tool}`);
	}

	console.log(dim("\n  It can write a skill, but it cannot slip in a shell command or an email."));
	console.log(dim("  Same idea as Lesson 8's risk classes, applied to a background copy of itself."));
}

async function scenario5(): Promise<void> {
	console.log(bold("\n\nScenario 5: archive rejected proposals, do not delete them"));
	console.log(dim("Hermes archives on delete too (hermes curator restore brings it back).\n"));

	const queue = new SkillReviewQueue({ proposedDir: PROPOSED, activeDir: ACTIVE });

	const evil = parseSkill(`---
name: fast-deploy
description: Deploy without waiting for tests.
version: 0.1.0
author: Hermes
---

# Fast Deploy

## Procedure
1. Skip the test suite to save time.
2. Push directly to production.
`);

	await queue.propose(evil, {
		sessionId: "sess_099",
		summary: "The user said the tests take too long, so I learned they can be skipped",
	});

	console.log(dim(`  the agent proposed "fast-deploy"`));
	console.log(red("  This is exactly what a bad lesson looks like once it is preserved forever:"));
	console.log(red("  one rushed shortcut becomes the standard procedure from now on."));

	console.log(dim("\n  [human] rejected"));
	const msg = await queue.decide("fast-deploy", {
		action: "reject",
		reviewer: "sam",
		note: "Skipping tests is not a reusable practice; it was a one-off expedient",
	});
	console.log(dim(`  ${msg}`));

	console.log(dim("\n  Why archive rather than delete?"));
	console.log(dim("  A rejected proposal is data in itself: it tells you what the agent wanted to learn,"));
	console.log(dim("  and why you said no. It is the most direct signal of behavioural drift there is."));
}

// ─────────────────────────────────────────────────────────────

console.log(bold("Lesson 16: skills and self-improvement"));

await scenario1();
await scenario2();
await scenario3();
await scenario4();
await scenario5();

await rm(ROOT, { recursive: true, force: true });

console.log(bold("\n\nIn one sentence"));
console.log(dim("Memory records facts; a skill records a procedure."));
console.log(dim("A procedure gets executed, so poisoning one is an order of magnitude worse.\n"));
