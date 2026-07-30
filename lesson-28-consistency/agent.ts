/**
 * Lesson 28 - interrupting a real stream
 *
 * `demo.ts`'s six cells use a hand-written stream, so the interruption point is precise to the event.
 * This one swaps in a real model, and it exposes something the demo hides:
 *
 * ⚠️ **Only two of the six cells can be reproduced with a real model, and the reason is in our own abstraction.**
 *
 * `shared/streaming/types.ts` has only the three `text_*` events plus `tool_call`,
 * with no reasoning stream and no "fragment of a tool's arguments". So:
 *
 *   text            ✅ measurable (abort after the Nth delta)
 *   tool_running    ✅ measurable (abort while the tool runs in the background)
 *   reasoning       ❌ invisible at our provider layer
 *   tool_input      ❌ likewise (`tool_call` is emitted only once the arguments are complete)
 *
 * **This is not "a real model is weaker" but our abstraction omitting those two positions.**
 * And what it omits happens to be the hardest place to clean up — which is this lesson's value:
 * it makes a normally invisible simplification visible.
 *
 * Run:
 *   PROVIDER=gemini bun run lesson-28:agent                 # interrupt during text
 *   INTERRUPT=tool PROVIDER=gemini bun run lesson-28:agent  # interrupt during tool execution
 *   CLEANUP=off INTERRUPT=tool PROVIDER=gemini bun run lesson-28:agent
 */

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { selectStreamingProvider } from "../shared/streaming/index.ts";
import type { ToolSpec } from "../shared/streaming/types.ts";
import { audit } from "./audit.ts";
import { describePart } from "./parts.ts";
import { SessionProcessor } from "./processor.ts";

const INTERRUPT = (process.env.INTERRUPT ?? "text").toLowerCase();
const CLEANUP_ON = process.env.CLEANUP !== "off";
/**
 * Abort after the Nth text delta.
 *
 * ⚠️ **Delta granularity is not yours to control.** The first version used 4, and Gemini finished
 * that sentence in two or three chunks, so the threshold was never reached and the interruption never happened.
 * Which is also why `demo.ts`'s matrix deserves to exist: **with a real model even "where the
 * interruption happens" is not entirely up to you.**
 */
const AFTER_DELTAS = Number(process.env.AFTER_DELTAS ?? 2);

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;

const TOOLS: ToolSpec[] = [
	{
		name: "write_file",
		description: "Write a text file, replacing its contents.",
		parameters: {
			type: "object",
			properties: { path: { type: "string" }, content: { type: "string" } },
			required: ["path", "content"],
		},
	},
];

/**
 * ⚠️ **This sentence's ordering is part of the experiment.**
 *
 * The first version said "change it to 2 and explain what you changed", and the model called the tool
 * immediately every time without a word first, so the `INTERRUPT=text` cell could never happen.
 * Interrupting "mid-text" requires the model to have text to emit first.
 */
const PROMPT =
	"先用一句話說明你打算怎麼做，再用 write_file 把 a.ts 的常數從 1 改成 2。";

async function main(): Promise<void> {
	if (!process.env.PROVIDER) {
		console.log(
			yellow("這支程式要中斷一個真的串流，需要 PROVIDER。") +
				dim("\n離線的六格矩陣在 `bun run lesson-28`。"),
		);
		return;
	}

	const workspace = await mkdtemp(join(tmpdir(), "lesson-28-"));
	await writeFile(join(workspace, "a.ts"), "export const a = 1;\n", "utf8");

	const provider = selectStreamingProvider();
	const controller = new AbortController();
	let touched = false;

	const processor = new SessionProcessor("msg_live", {
		clock: () => Date.now(),
		cleanup: CLEANUP_ON,
		graceMs: 250,
		diff: () => (touched ? ["a.ts"] : []),
		execute: async (_name, args) => {
			touched = true;
			await writeFile(join(workspace, "a.ts"), String(args.content ?? ""), "utf8");
				// Deliberately slow, so "a tool is running at the moment of interruption" has a chance to happen.
			await new Promise((r) => setTimeout(r, 3_000));
			return "Wrote a.ts";
		},
	});

	console.log(dim(`provider: ${provider.name}  model: ${provider.model}`));
	console.log(
		dim(`INTERRUPT=${INTERRUPT}　CLEANUP=${CLEANUP_ON ? "on" : "off"}　workspace=${workspace}`),
	);
	console.log(`\n${cyan("你")} ${PROMPT}`);
	console.log();

	let deltas = 0;
	let textStarted = false;
	let abortedAt = "（沒有中斷）";

	for await (const event of provider.stream(
		{
			system:
				"You are a coding agent. The file a.ts is in the working directory. " +
				"Use write_file with path \"a.ts\".",
			messages: [{ role: "user", text: PROMPT }],
			tools: TOOLS,
			maxTokens: 2000,
		},
		controller.signal,
	)) {
		if (event.type === "text_start") {
			textStarted = true;
			await processor.handle({ type: "text_start", id: "x1" });
		}
		if (event.type === "text_delta") {
			process.stdout.write(dim(event.delta));
			await processor.handle({ type: "text_delta", id: "x1", delta: event.delta });
			deltas++;
			if (INTERRUPT === "text" && deltas >= AFTER_DELTAS) {
				abortedAt = `第 ${deltas} 個 text delta 之後`;
				controller.abort();
				break;
			}
		}
		if (event.type === "text_end") {
			await processor.handle({ type: "text_end", id: "x1" });
		}
		if (event.type === "tool_call") {
			console.log(`\n  ${cyan("→ write_file")} ${dim(JSON.stringify(event.args).slice(0, 60))}`);
			await processor.handle({
				type: "tool_call",
				id: event.id,
				name: event.name,
				args: event.args,
			});
			if (INTERRUPT === "tool") {
					// The tool is already running in the background (the processor does not await it); interrupt now.
				abortedAt = "工具開始執行之後";
				controller.abort();
				break;
			}
		}
		if (event.type === "done") {
			await processor.handle({ type: "step_finish" });
		}
		if (event.type === "error" && event.aborted) {
			abortedAt = "provider 回報 aborted";
		}
	}

	console.log(`\n\n${bold("中斷")} ${abortedAt}`);
	if (INTERRUPT === "text" && !textStarted) {
		console.log(
			yellow("  ⚠ 這一次模型沒有先輸出文字（直接呼叫工具），所以中斷點沒有發生。請重跑或改用 INTERRUPT=tool。"),
		);
	}

	await processor.cleanup(controller.signal.aborted ? "interrupted" : "end");

	const path = resolve(workspace, "session.json");
	await processor.persist(path);
	const loaded = await SessionProcessor.load(path);

	console.log(dim("\n存檔裡的 parts："));
	for (const part of loaded.parts) console.log(`  ${describePart(part)}`);
	console.log(dim(`finish=${loaded.finish ?? "（沒有）"}`));

	// What the filesystem says (Lesson 29's position: only it decides).
	const onDisk = await readFile(join(workspace, "a.ts"), "utf8");
	const changed = onDisk.trim() !== "export const a = 1;";
	console.log(
		dim(`檔案系統：a.ts ${changed ? "變了" : "沒變"}　內容 ${JSON.stringify(onDisk.trim())}`),
	);

	const violations = audit({ message: loaded, changedFiles: changed ? ["a.ts"] : [] });
	console.log(`\n${bold("稽核")}`);
	if (violations.length === 0) console.log(`  ${green("沒有違規")}`);
	for (const violation of violations) {
		console.log(`  ${red(`[${violation.kind}]`)} ${violation.where}　${dim(violation.detail)}`);
	}

	await rm(workspace, { recursive: true, force: true });
}

await main();
