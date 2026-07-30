/**
 * Lesson 28 - 中斷一個真的串流
 *
 * `demo.ts` 的六格用的是我自己寫的串流，所以「中斷位置」精準到事件之間。
 * 這一支換成真的模型，而它會暴露一件 demo 藏起來的事：
 *
 * ⚠️ **六格裡只有兩格能用真模型重現，而原因在我們自己的抽象。**
 *
 * `shared/streaming/types.ts` 只有 `text_*` 和 `tool_call` 三種事件，
 * 沒有 reasoning 的串流、也沒有「工具參數的一小塊」。所以：
 *
 *   text            ✅ 量得到（在第 N 個 delta 之後 abort）
 *   tool_running    ✅ 量得到（工具在背景跑的時候 abort）
 *   reasoning       ❌ 我們的 provider 層看不到
 *   tool_input      ❌ 同上（`tool_call` 是參數收完才發的）
 *
 * **這不是「真模型比較弱」，是我們的抽象漏掉了那兩個位置。**
 * 而漏掉的地方剛好就是最難收尾的地方 —— 那也是這一課的價值：
 * 它讓一個平常看不見的簡化變得看得見。
 *
 * 執行：
 *   PROVIDER=gemini bun run lesson-28:agent                 # 中斷在 text
 *   INTERRUPT=tool PROVIDER=gemini bun run lesson-28:agent  # 中斷在工具執行中
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
 * 第幾個 text delta 之後 abort。
 *
 * ⚠️ **delta 的顆粒度不是你能控制的。** 第一版設 4，結果 Gemini 把
 * 那一句話切成兩三塊就講完了，於是門檻永遠沒到、中斷從來沒發生。
 * 這也是為什麼 `demo.ts` 的矩陣值得存在：**真模型連「中斷在哪裡」
 * 都不完全由你決定。**
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
 * ⚠️ **這句話的順序是實驗的一部分。**
 *
 * 第一版寫「請把它改成 2，然後說明你改了什麼」，模型每次都直接呼叫工具、
 * 一個字都不先講，於是 `INTERRUPT=text` 那一格永遠不會發生。
 * 要中斷「文字輸出到一半」，得先讓模型真的有文字要輸出。
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
			// 刻意慢：這樣「中斷的時候工具正在跑」才有機會發生。
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
				// 工具已經在背景跑了（processor 沒有 await 它），現在中斷。
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

	// 檔案系統怎麼說（Lesson 29 的立場：只有它說了算）。
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
