/**
 * Lesson 9's demonstration: the agent really does stop and wait.
 *
 * No API key needed. Three scenarios are simulated:
 *   1. unattended: the agent pauses → an answer arrives from "another interface" → the agent continues
 *   2. idempotency: answering the same item twice makes the second a no-op
 *   3. a deleted session: orphaned items must be cleaned up or the waiter hangs forever
 *
 * Run: bun run lesson-09-unattended/demo.ts
 */

import {
	type Approver,

	inboxApprover,
} from "../shared/inbox/approvers.ts";
import { InboxStore } from "../shared/inbox/store.ts";

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A fake agent: it needs approval to do anything. */
async function fakeAgentTurn(label: string, approve: Approver, sessionId: string): Promise<void> {
	console.log(dim(`  [${label}] the agent wants to email team@example.com…`));

	const started = Date.now();
	const outcome = await approve({
		sessionId,
		toolName: "send_email",
		args: { to: "team@example.com", subject: "Daily summary" },
		reason: "approval needed",
		toolCallId: "call_1",
	});
	const waited = Date.now() - started;

	if (outcome === "deny") {
		console.log(`  [${label}] ${red("✗")} declined, nothing sent (waited ${waited}ms)`);
		return;
	}
	console.log(`  [${label}] ${green("✓")} the message went out (waited ${waited}ms, outcome ${outcome})`);
}

// ─────────────────────────────────────────────────────────────

async function scenario1(): Promise<void> {
	console.log(bold("\nScenario 1: nobody is there, so the agent stops and waits"));
	console.log(dim("The schedule fires at 3am and you are asleep. The agent needs approval before sending.\n"));

	const store = new InboxStore();
	const sessionId = "sess_nightly";

	// The agent starts. Note it is **not awaited**, because it will block.
	const agentDone = fakeAgentTurn("agent", inboxApprover(store, sessionId), sessionId);

	// Give it a moment to reach the approval step
	await sleep(50);

	// At this point the agent is paused
	const pending = store.pending(sessionId);
	console.log(`  ${yellow("⏸")}  the agent is paused. The inbox holds ${pending.length} pending item(s):`);
	for (const item of pending) {
		console.log(`     ${cyan(item.id)}  ${item.title}`);
		console.log(`     ${dim(item.body.split("\n")[0] ?? "")}`);
	}

	console.log(dim("\n  …eight hours pass…\n"));
	await sleep(300);

	// You wake up and answer from your phone (another interface)
	console.log(dim('  [your phone] saw the notification and tapped "allow"'));
	const item = pending[0];
	if (item) await store.resolve(item.id, "allow");

	// The agent continues by itself
	await agentDone;

	console.log(dim("\n  The point: the agent did not time out, skip, or guess. It simply stopped there."));
}

async function scenario2(): Promise<void> {
	console.log(bold("\n\nScenario 2: the same item answered from two places"));
	console.log(dim("You tapped allow on your phone, forgot, and tapped again in the app.\n"));

	const store = new InboxStore();
	const sessionId = "sess_dup";

	const agentDone = fakeAgentTurn("agent", inboxApprover(store, sessionId), sessionId);
	await sleep(50);

	const item = store.pending(sessionId)[0];
	if (!item) return;

	console.log(dim(`  [phone] resolve("${item.id}", "allow")`));
	const first = await store.resolve(item.id, "allow");
	console.log(`         → ${first ? green("succeeded") : dim("no-op")}`);

	// Let the agent finish printing first, so the ordering on screen makes sense
	await agentDone;

	console.log(dim(`\n  [app  ] the same item answered again, this time trying to deny`));
	const second = await store.resolve(item.id, "deny");
	console.log(`         → ${second ? red("succeeded (should not happen!)") : dim("no-op (already answered)")}`);

	console.log(
		dim("\n  The point: the first answer wins. The second quietly becomes a no-op; it does not wake the agent twice,"),
	);
	console.log(dim("  and it cannot un-send a message that already went out."));
}

async function scenario3(): Promise<void> {
	console.log(bold("\n\nScenario 3: the session was deleted"));
	console.log(dim("Those waiting approvals can never be answered meaningfully.\n"));

	const store = new InboxStore();
	const sessionId = "sess_doomed";

	const agentDone = fakeAgentTurn("agent", inboxApprover(store, sessionId), sessionId);
	await sleep(50);

	console.log(`  ${yellow("⏸")}  the agent is paused, waiting for approval`);
	console.log(dim("  [user] deleted this session"));

	const closed = await store.resolveSession(sessionId, "session deleted");
	console.log(`  ${dim(`closed ${closed} orphaned item(s)`)}`);

	await agentDone;

	console.log(dim("\n  The point: without that, the agent stays stuck on the await forever,"));
	console.log(dim("  and the inbox fills with zombie items nobody will ever answer."));
}

async function scenario4(): Promise<void> {
	console.log(bold("\n\nScenario 4: you come back and take over"));
	console.log(dim("You open the app in the morning and need to know what happened while you slept.\n"));

	const store = new InboxStore();
	const sessionId = "sess_resume";

	// Simulate what happened overnight
	const a = await store.add({
		sessionId,
		kind: "approval",
		visibility: "inbox",
		title: "Run send_email?",
		body: "to: team@example.com",
	});
	await store.resolve(a.id, "allow");

	const b = await store.add({
		sessionId,
		kind: "approval",
		visibility: "inbox",
		title: "Run run_command?",
		body: "command: deploy.sh",
	});
	await store.resolve(b.id, "deny");

	await store.add({
		sessionId,
		kind: "approval",
		visibility: "inbox",
		title: "Run create_calendar_event?",
		body: "calendar_id: team",
	});

	const { pending, recap } = store.reconcileOnResume(sessionId);

	console.log(`  ${bold("still needs you")} (${pending.length}):`);
	for (const i of pending) console.log(`     ${yellow("●")} ${i.title}  ${dim(i.body)}`);

	console.log(`\n  ${bold("resolved while you slept")} (${recap.length}):`);
	for (const i of recap) {
		const mark = i.resolution === "allow" ? green("✓") : red("✗");
		console.log(`     ${mark} ${i.title}  ${dim(`→ ${i.resolution}`)}`);
	}

	console.log(dim("\n  The point: pending alone is not enough. If you do not know what happened overnight,"));
	console.log(dim("  you will not trust the agent. The recap is what trust rests on."));
}

// ─────────────────────────────────────────────────────────────

console.log(bold("Lesson 9: when nobody is there"));

await scenario1();
await scenario2();
await scenario3();
await scenario4();

console.log(
	bold("\n\nThe most important part: across all four scenarios, the agent loop did not change by one line.\n"),
);
console.log(dim("All that changed was one approver function. That is the payoff for Lesson 8 splitting"));
console.log(dim("deciding from asking.\n"));
