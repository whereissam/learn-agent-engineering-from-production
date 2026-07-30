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
	console.log(dim(`  [${label}] agent 想要寄信給 team@example.com…`));

	const started = Date.now();
	const outcome = await approve({
		sessionId,
		toolName: "send_email",
		args: { to: "team@example.com", subject: "每日摘要" },
		reason: "需要批准",
		toolCallId: "call_1",
	});
	const waited = Date.now() - started;

	if (outcome === "deny") {
		console.log(`  [${label}] ${red("✗")} 被拒絕，不寄了（等了 ${waited}ms）`);
		return;
	}
	console.log(`  [${label}] ${green("✓")} 信寄出去了（等了 ${waited}ms,結果 ${outcome}）`);
}

// ─────────────────────────────────────────────────────────────

async function scenario1(): Promise<void> {
	console.log(bold("\n情境 1：無人值守，agent 停下來等"));
	console.log(dim("排程半夜三點跑，你在睡覺。agent 需要批准才能寄信。\n"));

	const store = new InboxStore();
	const sessionId = "sess_nightly";

	// The agent starts. Note it is **not awaited**, because it will block.
	const agentDone = fakeAgentTurn("agent", inboxApprover(store, sessionId), sessionId);

	// Give it a moment to reach the approval step
	await sleep(50);

	// At this point the agent is paused
	const pending = store.pending(sessionId);
	console.log(`  ${yellow("⏸")}  agent 暫停中。inbox 有 ${pending.length} 個待處理項目：`);
	for (const item of pending) {
		console.log(`     ${cyan(item.id)}  ${item.title}`);
		console.log(`     ${dim(item.body.split("\n")[0] ?? "")}`);
	}

	console.log(dim("\n  …八小時過去了…\n"));
	await sleep(300);

	// You wake up and answer from your phone (another interface)
	console.log(dim("  [你的手機] 看到通知，按了「允許」"));
	const item = pending[0];
	if (item) await store.resolve(item.id, "allow");

	// The agent continues by itself
	await agentDone;

	console.log(dim("\n  重點：agent 沒有逾時、沒有跳過、沒有自己猜。它就是停在那裡。"));
}

async function scenario2(): Promise<void> {
	console.log(bold("\n\n情境 2：從多個地方回答同一件事"));
	console.log(dim("你在手機按了允許，又忘記了，再從 App 按一次。\n"));

	const store = new InboxStore();
	const sessionId = "sess_dup";

	const agentDone = fakeAgentTurn("agent", inboxApprover(store, sessionId), sessionId);
	await sleep(50);

	const item = store.pending(sessionId)[0];
	if (!item) return;

	console.log(dim(`  [手機] resolve("${item.id}", "allow")`));
	const first = await store.resolve(item.id, "allow");
	console.log(`         → ${first ? green("成功") : dim("no-op")}`);

	// Let the agent finish printing first, so the ordering on screen makes sense
	await agentDone;

	console.log(dim(`\n  [App ] 同一個項目再回答一次，這次想改成拒絕`));
	const second = await store.resolve(item.id, "deny");
	console.log(`         → ${second ? red("成功（不該發生！）") : dim("no-op（已經被回答過了）")}`);

	console.log(
		dim("\n  重點：第一個回答的人贏。第二次安靜地變成 no-op,不會把 agent 叫醒兩次，"),
	);
	console.log(dim("  也不會把已經寄出的信「改成不寄」。"));
}

async function scenario3(): Promise<void> {
	console.log(bold("\n\n情境 3：session 被刪掉了"));
	console.log(dim("那些等待中的批准永遠不可能被有意義地回答。\n"));

	const store = new InboxStore();
	const sessionId = "sess_doomed";

	const agentDone = fakeAgentTurn("agent", inboxApprover(store, sessionId), sessionId);
	await sleep(50);

	console.log(`  ${yellow("⏸")}  agent 暫停中，等待批准`);
	console.log(dim("  [使用者] 刪掉了這個 session"));

	const closed = await store.resolveSession(sessionId, "session deleted");
	console.log(`  ${dim(`收掉了 ${closed} 個孤兒項目`)}`);

	await agentDone;

	console.log(dim("\n  重點：不收的話，那個 agent 會永遠卡在 await,"));
	console.log(dim("  而 inbox 會累積一堆永遠不會被回答的殭屍項目。"));
}

async function scenario4(): Promise<void> {
	console.log(bold("\n\n情境 4：你回來接手"));
	console.log(dim("早上打開 App,你需要知道「睡覺時發生了什麼」。\n"));

	const store = new InboxStore();
	const sessionId = "sess_resume";

	// Simulate what happened overnight
	const a = await store.add({
		sessionId,
		kind: "approval",
		visibility: "inbox",
		title: "執行 send_email？",
		body: "to: team@example.com",
	});
	await store.resolve(a.id, "allow");

	const b = await store.add({
		sessionId,
		kind: "approval",
		visibility: "inbox",
		title: "執行 run_command？",
		body: "command: deploy.sh",
	});
	await store.resolve(b.id, "deny");

	await store.add({
		sessionId,
		kind: "approval",
		visibility: "inbox",
		title: "執行 create_calendar_event？",
		body: "calendar_id: team",
	});

	const { pending, recap } = store.reconcileOnResume(sessionId);

	console.log(`  ${bold("還需要你處理")}（${pending.length}）：`);
	for (const i of pending) console.log(`     ${yellow("●")} ${i.title}  ${dim(i.body)}`);

	console.log(`\n  ${bold("睡覺時已經處理掉的")}（${recap.length}）：`);
	for (const i of recap) {
		const mark = i.resolution === "allow" ? green("✓") : red("✗");
		console.log(`     ${mark} ${i.title}  ${dim(`→ ${i.resolution}`)}`);
	}

	console.log(dim("\n  重點：只給 pending 是不夠的。你不知道夜裡發生什麼事的話，"));
	console.log(dim("  就不會信任這個 agent。recap 是信任的基礎。"));
}

// ─────────────────────────────────────────────────────────────

console.log(bold("Lesson 9：沒人在場的時候"));

await scenario1();
await scenario2();
await scenario3();
await scenario4();

console.log(
	bold("\n\n最重要的一件事：上面四個情境，agent loop 一行都沒有改。\n"),
);
console.log(dim("換掉的只是一個 approver 函式。這就是 Lesson 8 把"));
console.log(dim("「決定」跟「詢問」拆開的回報。\n"));
