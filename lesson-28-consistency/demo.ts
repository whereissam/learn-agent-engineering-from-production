/**
 * Lesson 28 - 中斷之後，session 不能說謊
 *
 * 一張矩陣：在六個不同的位置中斷 × 有沒有收尾，每一格都存檔、
 * 重新載入、然後跑五條稽核規則。
 *
 * 執行：
 *   bun run lesson-28                       # 整張矩陣（不用金鑰）
 *   bun run lesson-28 tool_running          # 只看一格的細節
 *   CLEANUP=off bun run lesson-28 tool_running
 *
 * 判定是那五條規則（`audit.ts`），沒有 LLM 裁判。
 */

import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { audit, summarise, type Violation } from "./audit.ts";
import { describePart } from "./parts.ts";
import {
	INTERRUPT_POINTS,
	type InterruptPoint,
	interruptibleStream,
	toolDuration,
} from "./fake-provider.ts";
import { SessionProcessor } from "./processor.ts";

const STATE = resolve(import.meta.dirname, ".sessions");
const CLEANUP_ON = process.env.CLEANUP !== "off";

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;

/** 假時鐘：每次讀取往前 1ms，時間戳才穩定又遞增。 */
function tickingClock() {
	let t = 1_000_000;
	return () => (t += 1);
}

interface CellResult {
	point: InterruptPoint;
	cleanup: boolean;
	violations: Violation[];
	parts: string[];
	finish?: string;
}

async function runCell(point: InterruptPoint, cleanup: boolean): Promise<CellResult> {
	const controller = new AbortController();
	// 工具會「改到檔案」：一旦它開始跑，diff 就會回報那個檔案。
	// 刻意在**回傳之前**就改，因為那個窗口正是這一課要示範的東西
	// （Lesson 34 會再回到同一個窗口，那邊問的是要不要重跑）。
	let touched = false;

	const processor = new SessionProcessor("msg_1", {
		clock: tickingClock(),
		cleanup,
		graceMs: 250,
		diff: () => (touched ? ["src/a.ts"] : []),
		execute: async () => {
			touched = true;
			await new Promise((r) => setTimeout(r, toolDuration(point)));
			return "Wrote src/a.ts (1 line)";
		},
	});

	for await (const event of interruptibleStream(point, controller)) {
		await processor.handle(event);
	}

	if (controller.signal.aborted) {
		await processor.cleanup("interrupted");
	} else {
		await processor.cleanup("end");
	}

	// 存檔 → 重新載入。**稽核的對象是存檔，不是記憶體裡的物件。**
	const path = resolve(STATE, `${point}-${cleanup ? "on" : "off"}.json`);
	await processor.persist(path);
	const loaded = await SessionProcessor.load(path);

	return {
		point,
		cleanup,
		violations: audit({ message: loaded, changedFiles: touched ? ["src/a.ts"] : [] }),
		parts: loaded.parts.map(describePart),
		finish: loaded.finish,
	};
}

async function showDetail(point: InterruptPoint): Promise<void> {
	const cell = await runCell(point, CLEANUP_ON);

	console.log(`\n${bold(`── ${point}`)}  ${dim(`CLEANUP=${CLEANUP_ON ? "on" : "off"}`)}`);
	console.log(dim(`  finish=${cell.finish ?? "（沒有）"}`));
	console.log(dim("  存檔裡的 parts："));
	for (const part of cell.parts) console.log(`    ${part}`);

	console.log(dim("\n  稽核："));
	if (cell.violations.length === 0) {
		console.log(`    ${green("沒有違規")}`);
	}
	for (const violation of cell.violations) {
		console.log(`    ${red(`[${violation.kind}]`)} ${violation.where}`);
		console.log(dim(`      ${violation.detail}`));
	}
}

async function showMatrix(): Promise<void> {
	console.log(bold("\n中斷位置 × 有沒有收尾"));
	console.log(dim("─".repeat(78)));
	console.log(
		dim("  中斷位置            ") + dim("CLEANUP=on".padEnd(16)) + dim("CLEANUP=off"),
	);

	for (const point of INTERRUPT_POINTS) {
		const on = await runCell(point, true);
		const off = await runCell(point, false);
		const onText = on.violations.length === 0 ? green("乾淨") : red(summarise(on.violations));
		const offText = off.violations.length === 0 ? green("乾淨") : red(summarise(off.violations));
		console.log(`  ${point.padEnd(20)}${onText.padEnd(16 + 9)}${offText}`);
	}

	console.log(dim("─".repeat(78)));
	console.log(
		dim(
			"每一格的失敗都是安靜的（設計原則 7）：永久 pending 的工具、\n" +
				"永遠 busy 的 session、漏記的 patch，全部不會丟例外。",
		),
	);

	// 一格特別值得單獨講：趕得上寬限窗口的工具。
	const finishing = await runCell("tool_finishing", true);
	console.log(`\n${bold("為什麼要有寬限窗口")}`);
	console.log(
		dim("  tool_finishing 這一格的工具 20ms 後就會回來，寬限窗口 250ms：\n") +
			`    ${finishing.parts.find((p) => p.startsWith("tool")) ?? ""}`,
	);
	console.log(
		yellow(
			"  它被記成 completed，不是 interrupted —— 因為它真的跑完了。\n" +
				"  沒有這個窗口，紀錄會說一件沒發生的事（一個其實成功了的工具被標成中斷）。",
		),
	);
}

async function main(): Promise<void> {
	await rm(STATE, { recursive: true, force: true });

	const only = process.argv[2] as InterruptPoint | undefined;
	if (only) {
		if (!INTERRUPT_POINTS.includes(only)) {
			console.error(`不認得的中斷位置：${only}。可用：${INTERRUPT_POINTS.join(", ")}`);
			process.exitCode = 1;
			return;
		}
		await showDetail(only);
	} else {
		await showMatrix();
	}

	await rm(STATE, { recursive: true, force: true });
}

await main();
