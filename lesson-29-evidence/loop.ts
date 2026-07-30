/**
 * Lesson 29 的 agent loop：跟 Lesson 8 同一個 loop，多了兩行 snapshot。
 *
 * 設計原則 6 在這一課特別好守。「完成的證據」聽起來像是要改 loop，
 * 實際上它只是**在 loop 兩端各加一次量測**：
 *
 *     base = await snapshot.track()      ← 串流開始之前
 *     …… 整輪照舊 ……
 *     patch = await snapshot.patch(base) ← 這一輪結束之後
 *
 * ⚠️ **第一行的位置是這一課最容易寫錯的地方。**
 *
 * opencode 把它放在 `SessionProcessor.create` 的最前面，而且留了註解說明
 * 為什麼不能等事件到了再抓（`session/processor.ts:98-101`）：
 *
 *   > Pre-capture snapshot before the LLM stream starts. The AI SDK
 *   > may execute tools internally before emitting start-step events,
 *   > so capturing inside the event handler can be too late.
 *
 * 也就是說：**provider 有可能在送出任何事件以前就已經動過檔案了**
 * （provider-executed tool、SDK 內建工具、背景 hook）。
 * 等 `tool_call` 事件到了再抓基準點，那次改動就落在基準點之前，
 * 於是它從 patch 裡消失 —— 而且不會有任何錯誤訊息。
 *
 * `CAPTURE=first-tool` 就是這個錯誤版本，情境 5 會把它跑出來。
 */

import type { Decision } from "../shared/permissions/engine.ts";
import {
	classify,
	isConsequential,
	PermissionEngine,
	type RiskClass,
} from "../shared/permissions/engine.ts";
import type { Message, StreamingProvider, ToolResult } from "../shared/streaming/types.ts";
import type { ToolContext, ToolRegistry } from "../shared/tools/index.ts";
import { compare, type Finding, type ToolRecord, type TurnRecord } from "./evidence.ts";
import type { Snapshot } from "./snapshot.ts";

export type Asker = (
	decision: Decision,
	toolName: string,
	args: Record<string, unknown>,
) => Promise<boolean>;

/** 什麼時候抓基準點。預設是對的那一個。 */
export type CapturePoint = "pre-stream" | "first-tool";

export interface RunOptions {
	provider: StreamingProvider;
	registry: ToolRegistry;
	engine: PermissionEngine;
	snapshot: Snapshot;
	messages: Message[];
	ctx: ToolContext;
	ask: Asker;
	signal: AbortSignal;
	system: string;
	capture?: CapturePoint;
	maxSteps?: number;
	/** 印不印串流過程。demo 要，測試不要。 */
	verbose?: boolean;
}

export interface TurnOutcome {
	record: TurnRecord;
	findings: Finding[];
	steps: number;
	/** 有沒有撞到步數上限（撞到的話 patch 只是「到目前為止」）。 */
	exhausted: boolean;
}

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;

export async function runTurn(options: RunOptions): Promise<TurnOutcome> {
	const {
		provider,
		registry,
		engine,
		snapshot,
		messages,
		ctx,
		ask,
		signal,
		system,
		capture = "pre-stream",
		maxSteps = 12,
		verbose = true,
	} = options;

	// ── 基準點 ────────────────────────────────────────────────
	let base = capture === "pre-stream" ? await snapshot.track() : undefined;

	const toolRecords: ToolRecord[] = [];
	let claim = "";
	let steps = 0;
	let exhausted = true;

	for (let step = 0; step < maxSteps; step++) {
		steps = step + 1;
		let response: Awaited<ReturnType<StreamingProvider["call"]>> | undefined;
		let streamError: { message: string; aborted: boolean } | undefined;

		for await (const event of provider.stream(
			{ system, messages, tools: registry.specs(), maxTokens: 8000 },
			signal,
		)) {
			switch (event.type) {
				case "text_start":
					if (verbose) process.stdout.write("\n");
					break;
				case "text_delta":
					if (verbose) process.stdout.write(event.delta);
					break;
				case "text_end":
					if (verbose) process.stdout.write("\n");
					break;
				case "tool_call":
					// 錯誤版本的抓取點：這時候 provider 可能已經動過檔案了。
					if (base === undefined) base = await snapshot.track();
					break;
				case "done":
					response = event.response;
					break;
				case "error":
					streamError = { message: event.message, aborted: event.aborted };
					break;
			}
		}

		if (streamError) {
			if (verbose) {
				console.log(red(`\n[${streamError.aborted ? "已中斷" : "串流失敗"}] ${streamError.message}`));
			}
			exhausted = false;
			break;
		}
		if (!response) {
			if (verbose) console.log(red("\n[串流沒有正常結束]"));
			exhausted = false;
			break;
		}

		messages.push({ role: "assistant", blocks: response.blocks, raw: response.raw });

		const text = response.blocks
			.filter((b) => b.type === "text")
			.map((b) => b.text)
			.join("");
		if (text.trim() !== "") claim = text;

		const toolCalls = response.blocks.filter((b) => b.type === "toolCall");
		if (toolCalls.length === 0) {
			exhausted = false;
			break;
		}

		const results: ToolResult[] = [];

		for (const call of toolCalls) {
			const risk = classify(call.name);
			const decision = engine.evaluate(call.name, call.args);
			const mutating = isConsequential(risk);
			const path = typeof call.args.path === "string" ? normalize(call.args.path) : undefined;

			const denial = await gate(engine, decision, risk, call.name, call.args, ask);

			if (verbose) console.log(dim(`  → ${call.name}(${summarize(call.args)})  [${risk}]`));

			if (denial) {
				// Lesson 3 的硬規則：每個 tool call 都必須有結果，否則下一次請求 400。
				results.push({
					toolCallId: call.id,
					toolName: call.name,
					content: denial,
					isError: true,
				});
				toolRecords.push({ name: call.name, path, mutating, ok: false, summary: firstLine(denial) });
				if (verbose) console.log(`  ${red("✗ 擋下來了")} ${dim(decision.reason)}`);
				continue;
			}

			try {
				const content = await registry.execute(call.name, call.args, ctx);
				results.push({ toolCallId: call.id, toolName: call.name, content });
				toolRecords.push({ name: call.name, path, mutating, ok: true, summary: firstLine(content) });
				if (verbose) console.log(`  ${green("✓")} ${dim(firstLine(content))}`);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				results.push({
					toolCallId: call.id,
					toolName: call.name,
					content: message,
					isError: true,
				});
				toolRecords.push({ name: call.name, path, mutating, ok: false, summary: firstLine(message) });
				if (verbose) console.log(`  ${red("✗ 執行失敗")} ${red(firstLine(message))}`);
			}
		}

		messages.push({ role: "toolResult", results });
	}

	// ── 收尾 ──────────────────────────────────────────────────
	//
	// `base` 還是 undefined 只可能發生在 `first-tool` 模式下模型一個工具都沒叫。
	// 那種情況「這一輪之前」就是現在，patch 一定是空的。
	if (base === undefined) base = await snapshot.track();

	const patch = await snapshot.patch(base);
	const record: TurnRecord = { claim, toolResults: toolRecords, patch };

	return { record, findings: compare(record), steps, exhausted };
}

// ─────────────────────────────────────────────────────────────

/** 跟 Lesson 8 同一個閘門，只是把 DENY_HINT 那個實驗拿掉了。 */
async function gate(
	_engine: PermissionEngine,
	decision: Decision,
	risk: RiskClass,
	toolName: string,
	args: Record<string, unknown>,
	ask: Asker,
): Promise<string | undefined> {
	if (!isConsequential(risk) && decision.allowed) return undefined;

	if (!decision.allowed && !decision.needsUser) {
		return `Denied by the permission engine: ${decision.reason}`;
	}

	if (decision.needsUser) {
		const approved = await ask(decision, toolName, args);
		if (!approved) {
			return `Denied by the permission engine: 使用者拒絕了。（${decision.reason}）`;
		}
	}

	return undefined;
}

function normalize(path: string): string {
	return path.replace(/^\.\//, "");
}

function summarize(args: Record<string, unknown>): string {
	return Object.entries(args)
		.map(([key, value]) => {
			const text = typeof value === "string" ? value : JSON.stringify(value);
			return `${key}: ${JSON.stringify(text.length > 32 ? `${text.slice(0, 32)}…` : text)}`;
		})
		.join(", ");
}

function firstLine(text: string): string {
	const line = text.split("\n")[0] ?? "";
	return line.length > 76 ? `${line.slice(0, 76)}…` : line;
}
