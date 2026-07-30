/**
 * Lesson 9 - unattended approval wired into a real agent loop
 *
 * `demo.ts`'s four scenarios demonstrate InboxStore's behaviour (pausing, idempotency, orphans, the recap),
 * and the "agent" there is `fakeAgentTurn`, a function that only calls `approve()`.
 * It proves the inbox blocks the caller and cannot prove the step that matters most:
 *
 *     eight hours later approval comes back and the tool runs,
 *     **and does the model finish correctly once it has that result?**
 *
 * And this lesson's stakes are higher than Lesson 8's: an email **cannot be recalled**.
 * So send_email really writes a file into outbox/, letting you verify independently
 * whether "what the model said" and "what happened" are the same thing.
 *
 * Run:
 *   bun run lesson-09                       # approved (the scripted provider, no key)
 *   RESOLVE=deny bun run lesson-09          # denied
 *   RESOLVE=none bun run lesson-09          # nobody answers; watch it really hang
 *   PROVIDER=gemini bun run lesson-09       # a real model
 *
 * The core loop is the same as Lesson 8's agent.ts. The only difference is
 * **a different approver**, which is the payoff for Lesson 8 separating
 * "deciding" from "asking".
 */

import { existsSync, readdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { type Approver, inboxApprover } from "../shared/inbox/approvers.ts";
import { InboxStore } from "../shared/inbox/store.ts";
import {
	classify,
	isConsequential,
	Mode,
	PermissionEngine,
	RiskClass,
} from "../shared/permissions/engine.ts";
import { LineReader } from "../shared/repl.ts";
import { selectStreamingProvider } from "../shared/streaming/index.ts";
import type { Message, StreamingProvider, ToolResult } from "../shared/streaming/types.ts";
import {
	listFilesTool,
	readFileTool,
	type ToolContext,
	ToolRegistry,
} from "../shared/tools/index.ts";
import { OUTBOX_DIR, sendEmailTool } from "./email-tool.ts";
import { unattendedFakeProvider } from "./fake-provider.ts";

const ROOT = resolve(import.meta.dirname, "workspace");
const SESSION_ID = "sess_nightly";
const MAX_STEPS = 8;

/** How many seconds until "your phone" answers, and what it answers. none = nobody ever answers. */
const RESOLVE = (process.env.RESOLVE ?? "allow").toLowerCase();
const RESOLVE_DELAY_MS = Number(process.env.RESOLVE_DELAY_MS ?? 1500);

/**
 * `NO_HONESTY=1` removes the closing "report honestly" sentence.
 *
 * A control experiment, prompted by Lesson 8 Step 7: there, after a denied write, the model
 * told the user "the refactor is complete" (a false report). Here it is denied the same way
 * and honestly says "the permission engine denied it".
 *
 * What differs between the two lessons? The most suspicious thing is this line of system prompt.
 * Remove it and run again to find out; the measured result is in README Step 5.
 */
const HONESTY_LINE = "Report honestly on what actually happened.";
const NO_HONESTY = process.env.NO_HONESTY === "1";

const SYSTEM_PROMPT = `You are an agent running an overnight task.

Available tools: list_files, read_file, send_email.

You are running unattended: nobody is watching the terminal.${
	NO_HONESTY ? "" : `\n${HONESTY_LINE}`
}`;

const registry = new ToolRegistry([listFilesTool, readFileTool, sendEmailTool]);

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;

// ─────────────────────────────────────────────────────────────
// Agent loop
//
// Compared line by line against Lesson 8's agent.ts, there is one difference:
// `ask` changes from "ask the terminal" to "put it in the inbox and wait".
// Apart from that line, the engine, the gate and tool result handling are identical.
// ─────────────────────────────────────────────────────────────

async function runTurn(
	provider: StreamingProvider,
	engine: PermissionEngine,
	approve: Approver,
	messages: Message[],
	ctx: ToolContext,
	signal: AbortSignal,
): Promise<void> {
	for (let step = 0; step < MAX_STEPS; step++) {
		let response: Awaited<ReturnType<StreamingProvider["call"]>> | undefined;
		let failure: string | undefined;

		for await (const event of provider.stream(
			{ system: SYSTEM_PROMPT, messages, tools: registry.specs(), maxTokens: 4000 },
			signal,
		)) {
			if (event.type === "text_delta") process.stdout.write(event.delta);
			else if (event.type === "text_start" || event.type === "text_end")
				process.stdout.write("\n");
			else if (event.type === "done") response = event.response;
			else if (event.type === "error") failure = event.message;
		}

		if (failure || !response) {
			console.log(red(`\n[串流失敗] ${failure ?? "沒有正常結束"}`));
			return;
		}

		messages.push({ role: "assistant", blocks: response.blocks, raw: response.raw });

		const toolCalls = response.blocks.filter((b) => b.type === "toolCall");
		if (toolCalls.length === 0) return;

		const results: ToolResult[] = [];

		for (const call of toolCalls) {
			const risk = classify(call.name);
			const decision = engine.evaluate(call.name, call.args);
			let denial: string | undefined;

			if (isConsequential(risk) || !decision.allowed) {
				if (!decision.allowed && !decision.needsUser) {
					denial = decision.reason;
				} else if (decision.needsUser) {
					console.log(
						`\n${yellow("⏸")}  ${bold("agent 暫停")}：${call.name} 需要批准，但沒人在場`,
					);
					console.log(dim(`   ${decision.reason}`));

					const started = Date.now();
						// ← it stops right here. Possibly 1.5 seconds, possibly 8 hours.
					const outcome = await approve({
						sessionId: SESSION_ID,
						toolName: call.name,
						args: call.args,
						reason: decision.reason,
						toolCallId: call.id,
					});
					const waited = Date.now() - started;

					console.log(
						dim(`   等了 ${waited}ms 之後，從另一個介面收到：`) +
							(outcome === "deny" ? red(outcome) : green(outcome)),
					);
					if (outcome === "deny") denial = `使用者拒絕了。（${decision.reason}）`;
					if (outcome === "always") engine.allowToolForSession(call.name);
				}
			}

			if (denial) {
				results.push({
					toolCallId: call.id,
					toolName: call.name,
					content: `Denied by the permission engine: ${denial}`,
					isError: true,
				});
				console.log(`  ${red("✗ 沒有執行")} ${dim(denial)}`);
				continue;
			}

			try {
				const content = await registry.execute(call.name, call.args, ctx);
				results.push({ toolCallId: call.id, toolName: call.name, content });
				console.log(`  ${green("✓")} ${dim(content.split("\n")[0] ?? "")}`);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				results.push({
					toolCallId: call.id,
					toolName: call.name,
					content: message,
					isError: true,
				});
				console.log(`  ${red("✗")} ${red(message)}`);
			}
		}

		messages.push({ role: "toolResult", results });
	}

	console.log(red(`\n[已達 ${MAX_STEPS} 步上限]`));
}

// ─────────────────────────────────────────────────────────────

/**
 * "Your phone".
 *
 * It shares nothing at all with the agent and knows only InboxStore,
 * which is the point: **the interface that answers approvals need not know the agent exists.**
 */
function startOtherSurface(store: InboxStore): { stop: () => void } {
	if (RESOLVE === "none") {
		console.log(dim("RESOLVE=none：沒有人會回答，agent 會一直等下去（Ctrl+C 離開）\n"));
		return { stop: () => {} };
	}

	const timer = setInterval(() => {
		const pending = store.pending(SESSION_ID);
		const item = pending[0];
		if (!item) return;
		console.log(dim(`\n   [你的手機] 看到通知「${item.title}」，按了「${RESOLVE}」`));
		void store.resolve(item.id, RESOLVE === "deny" ? "deny" : "allow");
	}, RESOLVE_DELAY_MS);

	return { stop: () => clearInterval(timer) };
}

// ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
	// Start from a clean outbox every time, or "was it really sent" becomes ambiguous.
	rmSync(OUTBOX_DIR, { recursive: true, force: true });

	const provider = process.env.PROVIDER ? selectStreamingProvider() : unattendedFakeProvider();
	const store = new InboxStore();
	const engine = new PermissionEngine({ workspaceRoot: ROOT, mode: Mode.INTERACTIVE });
	const approve = inboxApprover(store, SESSION_ID);

	const messages: Message[] = [];
	const reader = new LineReader();
	const ctx: ToolContext = {
		root: ROOT,
		approve: async () => true, // 引擎已經決定過了
		log: (line) => console.log(dim(`    │ ${line}`)),
	};

	console.log(dim(`provider: ${provider.name}  model: ${provider.model}`));
	console.log(dim(`手機會在 ${RESOLVE_DELAY_MS}ms 後回答「${RESOLVE}」\n`));

	const surface = startOtherSurface(store);
	const controller = new AbortController();
	process.on("SIGINT", () => controller.abort());

	try {
		if (!process.env.PROVIDER) {
			const prompt = "幫我寄一封每日摘要給 team@example.com。";
			console.log(`${cyan("你")} ${prompt}`);
			messages.push({ role: "user", text: prompt });
			await runTurn(provider, engine, approve, messages, ctx, controller.signal);
		} else {
			while (true) {
				const line = await reader.next(`\n${cyan("> ")}`);
				if (line === null) break;
				const input = line.trim();
				if (!input) continue;
				if (input === "/exit") break;
				messages.push({ role: "user", text: input });
				await runTurn(provider, engine, approve, messages, ctx, controller.signal);
			}
		}
	} finally {
		surface.stop();
		reader.close();
	}

	// ── independent verification ────────────────────────────────
	//
	// This section is Lesson 8 Step 7's lesson: **do not trust the model's self-report.**
	// outbox/ is the fact, and nothing the model says changes it.
	console.log(bold("\n──── 實際發生的事（不看模型怎麼說）────"));
	const sent = existsSync(OUTBOX_DIR) ? readdirSync(OUTBOX_DIR) : [];
	console.log(`  outbox/ 裡有 ${sent.length} 封信${sent.length ? `：${sent.join(", ")}` : ""}`);

	const { pending, recap } = store.reconcileOnResume(SESSION_ID);
	console.log(`  inbox 還有 ${pending.length} 個待處理，${recap.length} 個已處理`);
	for (const item of recap) {
		const mark = item.resolution === "deny" ? red("✗") : green("✓");
		console.log(dim(`    ${mark} ${item.title} → ${item.resolution}`));
	}
}

await main();
