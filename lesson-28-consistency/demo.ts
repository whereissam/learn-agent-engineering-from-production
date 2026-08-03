/**
 * Lesson 28 - after an interruption, the session must not lie
 *
 * One matrix: interrupting at six different points × with and without cleanup, with every cell persisted,
 * reloaded, and run through five audit rules.
 *
 * Run:
 *   bun run lesson-28                       # the whole matrix (no key)
 *   bun run lesson-28 tool_running          # one cell's details
 *   CLEANUP=off bun run lesson-28 tool_running
 *
 * The verdict is those five rules (`audit.ts`), with no LLM judge.
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

/** A fake clock: each read advances 1ms, so timestamps are stable and increasing. */
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
	// The tool **changes a file**: once it starts, the diff reports that file.
	// It changes it deliberately **before returning**, because that window is what this lesson demonstrates
	// (Lesson 34 returns to the same window, asking whether to re-run).
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

	// Persist → reload. **The audit targets the saved file, not the object in memory.**
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
	console.log(dim(`  finish=${cell.finish ?? "(none)"}`));
	console.log(dim("  the parts in the saved file:"));
	for (const part of cell.parts) console.log(`    ${part}`);

	console.log(dim("\n  audit:"));
	if (cell.violations.length === 0) {
		console.log(`    ${green("no violations")}`);
	}
	for (const violation of cell.violations) {
		console.log(`    ${red(`[${violation.kind}]`)} ${violation.where}`);
		console.log(dim(`      ${violation.detail}`));
	}
}

async function showMatrix(): Promise<void> {
	console.log(bold("\ninterruption point × cleanup or not"));
	console.log(dim("─".repeat(78)));
	console.log(
		dim("  interruption point  ") + dim("CLEANUP=on".padEnd(16)) + dim("CLEANUP=off"),
	);

	for (const point of INTERRUPT_POINTS) {
		const on = await runCell(point, true);
		const off = await runCell(point, false);
		const onText = on.violations.length === 0 ? green("clean") : red(summarise(on.violations));
		const offText = off.violations.length === 0 ? green("clean") : red(summarise(off.violations));
		console.log(`  ${point.padEnd(20)}${onText.padEnd(16 + 9)}${offText}`);
	}

	console.log(dim("─".repeat(78)));
	console.log(
		dim(
			"Every cell's failure is silent (design principle 7): a tool stuck pending forever,\n" +
				"a session that stays busy, a missed patch — none of them throw.",
		),
	);

	// One cell deserves stating separately: the tool that makes the grace window.
	const finishing = await runCell("tool_finishing", true);
	console.log(`\n${bold("Why there is a grace window")}`);
	console.log(
		dim("  In the tool_finishing cell the tool returns after 20ms, and the grace window is 250ms:\n") +
			`    ${finishing.parts.find((p) => p.startsWith("tool")) ?? ""}`,
	);
	console.log(
		yellow(
			"  It is recorded as completed, not interrupted — because it really did finish.\n" +
				"  Without the window the record would state something that never happened (a tool that succeeded, marked interrupted).",
		),
	);
}

async function main(): Promise<void> {
	await rm(STATE, { recursive: true, force: true });

	const only = process.argv[2] as InterruptPoint | undefined;
	if (only) {
		if (!INTERRUPT_POINTS.includes(only)) {
			console.error(`Unknown interruption point: ${only}. Available: ${INTERRUPT_POINTS.join(", ")}`);
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
