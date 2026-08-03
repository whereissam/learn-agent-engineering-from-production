/**
 * A stream that **can be interrupted at a named point**.
 *
 * The first thing this lesson has to solve is not the cleanup logic but **how to interrupt a stream reliably**.
 * That is harder than it looks, and getting it wrong makes the whole lesson worthless:
 *
 *   ❌ abort after 30ms with setTimeout
 *      → which two events those 30ms land between is **luck**. The same test interrupts during
 *        reasoning today and during a tool tomorrow, and you will not know it changed.
 *
 *   ❌ actually press Ctrl-C
 *      → even less controllable, and impossible to write as a test.
 *
 *   ✅ **Have the stream abort itself at a named point.**
 *      "Where the interruption happens" becomes a parameter, and every cell of the matrix is reproducible.
 *
 * > The principle is not limited to interruption: **for any timing-caused bug,
 * > build an apparatus that can specify the timing before starting to fix it.**
 * > Lesson 18's fake clock and Lesson 29's `CAPTURE` points are the same thing.
 */

import type { SessionEvent } from "./processor.ts";

export type InterruptPoint =
	/** Mid-reasoning. */
	| "reasoning"
	/** Tool arguments half received (half a JSON document). */
	| "tool_input"
	/** A tool is executing and will not finish inside the grace window. */
	| "tool_running"
	/** A tool is executing and **will finish inside the grace window** — so it should be recorded completed. */
	| "tool_finishing"
	/** Mid-answer. */
	| "text"
	/** The file was changed and step_finish has not been emitted. */
	| "before_step_finish"
	/** No interruption; a normal finish (the control). */
	| "none";

export const INTERRUPT_POINTS: InterruptPoint[] = [
	"reasoning",
	"tool_input",
	"tool_running",
	"tool_finishing",
	"text",
	"before_step_finish",
	"none",
];

/** How long this cell's tool takes (milliseconds). The grace window is 250ms. */
export function toolDuration(point: InterruptPoint): number {
	if (point === "tool_finishing") return 20; // makes it in time
	if (point === "tool_running") return 5_000; // does not
	return 5;
}

/**
 * Emit events from the script, aborting at `point`.
 *
 * After aborting it **stops yielding immediately**, because that is what a real provider does:
 * `text_end` and `step_finish` are never coming.
 * That fact is the lesson's premise — cleanup has to exist precisely because nobody emits the finishing events for you.
 */
export async function* interruptibleStream(
	point: InterruptPoint,
	controller: AbortController,
): AsyncIterable<SessionEvent> {
	const stop = (at: InterruptPoint): boolean => {
		if (point !== at) return false;
		controller.abort();
		return true;
	};

	yield { type: "reasoning_start", id: "r1" };
	yield { type: "reasoning_delta", id: "r1", delta: "The user wants src/a.ts changed." };
	yield { type: "reasoning_delta", id: "r1", delta: " Read the file first, then decide which line." };
	if (stop("reasoning")) return;
	yield { type: "reasoning_end", id: "r1" };

		// Tool arguments arrive in fragments. After the second, the string is `{"path":"src/a.ts","content` —
		// **unparseable**, which is the demonstration of why `pending.input` is a string.
	yield { type: "tool_input_delta", id: "t1", name: "write_file", chunk: '{"path":"src/a.ts"' };
	yield { type: "tool_input_delta", id: "t1", name: "write_file", chunk: ',"content' };
	if (stop("tool_input")) return;
	yield { type: "tool_input_delta", id: "t1", name: "write_file", chunk: '":"export const a = 2;\\n"}' };
	yield {
		type: "tool_call",
		id: "t1",
		name: "write_file",
		args: { path: "src/a.ts", content: "export const a = 2;\n" },
	};

		// The tool is now running in the background (the processor deliberately does not await it).
	if (stop("tool_running")) return;
	if (stop("tool_finishing")) return;

		// Let the fast tool finish, simulating real time passing.
	await new Promise((resolve) => setTimeout(resolve, 30));

	yield { type: "text_start", id: "x1" };
	yield { type: "text_delta", id: "x1", delta: "Changed the constant in src/a.ts to 2" };
	yield { type: "text_delta", id: "x1", delta: ", and confirmed nothing else references the old value." };
	if (stop("text")) return;
	yield { type: "text_end", id: "x1" };

	if (stop("before_step_finish")) return;
	yield { type: "step_finish" };
}
