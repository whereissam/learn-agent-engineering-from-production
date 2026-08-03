/**
 * Turning stream events into parts, and **cleaning up after an interruption**.
 *
 * Against opencode's `session/processor.ts`. That file is 718 lines and this is a little over 200;
 * the difference is almost entirely event kinds (13 of them) and the storage layer, and `cleanup()` has the same shape.
 *
 * ⚠️ **This lesson has to start by admitting what our own abstraction hides.**
 *
 * `shared/streaming/types.ts:44-51` states a deliberate simplification about `tool_call`:
 *
 *   > Note: this is emitted only once the arguments are complete.
 *   > Some providers stream tool arguments character by character, but half a JSON document
 *   > is useless to a UI, so we wait for it to be complete.
 *
 * That decision is right for Lessons 3-27. And it makes "interrupted mid-arguments"
 * **unrepresentable in the type system** — which is one row of this lesson's matrix.
 * So this lesson defines its own finer-grained events.
 *
 * > **A good abstraction hides what you do not need;
 * > you only discover what it hid on the day you need it.**
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { type AssistantMessage, type Clock, newMessage, type Part } from "./parts.ts";

/** A finer set of events than `shared/streaming`'s; see the file header for why. */
export type SessionEvent =
	| { type: "reasoning_start"; id: string }
	| { type: "reasoning_delta"; id: string; delta: string }
	| { type: "reasoning_end"; id: string }
	| { type: "text_start"; id: string }
	| { type: "text_delta"; id: string; delta: string }
	| { type: "text_end"; id: string }
	/** A fragment of a tool's arguments. **Half a JSON document comes from here.** */
	| { type: "tool_input_delta"; id: string; name: string; chunk: string }
	/** The arguments are complete. */
	| { type: "tool_call"; id: string; name: string; args: Record<string, unknown> }
	| { type: "step_finish" };

export interface ProcessorOptions {
	clock: Clock;
	execute: (name: string, args: Record<string, unknown>) => Promise<string>;
	/**
		 * Whether to clean up after an interruption. **false is the broken version this lesson demonstrates**:
		 * the stream stopped, the process ended, and every part is frozen at the moment of interruption.
	 */
	cleanup?: boolean;
	/**
		 * How many milliseconds a running tool gets to finish itself.
	 *
		 * opencode gives 250ms (`session/processor.ts:573`).
		 * That window is not for performance but for **correctness**: a tool that comes back after 20ms
		 * and gets marked interrupted makes the record wrong — it actually finished.
	 */
	graceMs?: number;
	/** Which files changed this turn. Lesson 29's `snapshot.patch()` is the real version. */
	diff?: () => string[] | Promise<string[]>;
	log?: (line: string) => void;
}

export class SessionProcessor {
	readonly message: AssistantMessage;
	/** Tools still running: part id → its promise. */
	private readonly inFlight = new Map<string, Promise<void>>();
	private readonly options: ProcessorOptions;

	constructor(id: string, options: ProcessorOptions) {
		this.options = options;
		this.message = newMessage(id, options.clock());
	}

	private get now(): number {
		return this.options.clock();
	}

	private find(id: string, type: Part["type"]): Part | undefined {
		return this.message.parts.find((part) => part.id === id && part.type === type);
	}

	async handle(event: SessionEvent): Promise<void> {
		const now = this.now;

		switch (event.type) {
			case "reasoning_start":
				this.message.parts.push({ type: "reasoning", id: event.id, text: "", time: { created: now } });
				return;

			case "reasoning_delta": {
				const part = this.find(event.id, "reasoning");
				if (part && part.type === "reasoning") part.text += event.delta;
				return;
			}

			case "reasoning_end": {
				const part = this.find(event.id, "reasoning");
				if (part) part.time.completed = now;
				return;
			}

			case "text_start":
				this.message.parts.push({ type: "text", id: event.id, text: "", time: { created: now } });
				return;

			case "text_delta": {
				const part = this.find(event.id, "text");
				if (part && part.type === "text") part.text += event.delta;
				return;
			}

			case "text_end": {
				const part = this.find(event.id, "text");
				if (part) part.time.completed = now;
				return;
			}

			case "tool_input_delta": {
					// The part is created when the first argument fragment arrives. **Deliberately**:
					// waiting for complete arguments would leave an interruption in this window with no record
					// at all, so the user sees "nothing happened" when the model had in fact decided to call a tool.
				const existing = this.find(event.id, "tool");
				if (existing && existing.type === "tool" && existing.state.status === "pending") {
					existing.state.input += event.chunk;
					return;
				}
				this.message.parts.push({
					type: "tool",
					id: event.id,
					name: event.name,
					state: { status: "pending", input: event.chunk },
					time: { created: now },
				});
				return;
			}

			case "tool_call": {
				let part = this.find(event.id, "tool");
				if (!part) {
					this.message.parts.push({
						type: "tool",
						id: event.id,
						name: event.name,
						state: { status: "pending", input: JSON.stringify(event.args) },
						time: { created: now },
					});
					part = this.find(event.id, "tool") as Part;
				}
				if (part.type !== "tool") return;

				part.state = { status: "running", input: event.args };
				part.time.ran = now;

					// ⚠️ **Not awaited.** The tool runs in the background while the stream continues —
					// which is exactly what makes "a tool executing at the moment of interruption" possible.
					// Await it and this lesson's third matrix row would not exist.
				const promise = this.options
					.execute(event.name, event.args)
					.then((output) => {
						const target = this.find(event.id, "tool");
						if (target?.type === "tool" && target.state.status === "running") {
							target.state = { status: "completed", input: event.args, output };
							target.time.completed = this.now;
						}
					})
					.catch((error: unknown) => {
						const target = this.find(event.id, "tool");
						if (target?.type === "tool" && target.state.status === "running") {
							target.state = {
								status: "error",
								input: event.args,
								error: error instanceof Error ? error.message : String(error),
							};
							target.time.completed = this.now;
						}
					})
					.finally(() => {
						this.inFlight.delete(event.id);
					});
				this.inFlight.set(event.id, promise);
				return;
			}

			case "step_finish":
				await this.recordDiff();
				return;
		}
	}

	/**
		 * Cleanup after an interruption (or an error). **Five things, in a meaningful order.**
	 *
		 * Against `cleanup` at `session/processor.ts:539-595`.
	 */
	async cleanup(reason: AssistantMessage["finish"]): Promise<void> {
		if (this.options.cleanup === false) {
				// The broken version: the stream stopped, so end. Do nothing.
			this.options.log?.("  (CLEANUP=off: no cleanup)");
			return;
		}

			// 1. Tools still running. **A normal finish and an interruption wait differently.**
		//
			// ⚠️ The first version got this wrong, and a real model exposed it:
			// the model called a tool without emitting text first, so the stream finished normally,
			// went into `cleanup("end")` with the tool still running → the 250ms grace window elapsed →
			// **a successful tool was marked interrupted while finish was "end"**.
			// A self-contradictory record, with no error anywhere.
		//
			// The grace window belongs to the interruption path only. On a normal finish, "the tool has
			// not come back" is not an anomaly, only not-yet-done — so wait for it.
		if (this.inFlight.size > 0) {
			if (reason === "end") {
				await Promise.allSettled([...this.inFlight.values()]);
				this.options.log?.("  (normal end: waiting for every tool to really finish)");
			} else {
				const grace = this.options.graceMs ?? 250;
				await Promise.race([
					Promise.allSettled([...this.inFlight.values()]),
					new Promise((resolve) => setTimeout(resolve, grace)),
				]);
				this.options.log?.(`  (interrupted: waited a ${grace}ms grace window)`);
			}
		}

			// 2. Those that did not make it: marked error plus interrupted, **not** left in running.
		for (const part of this.message.parts) {
			if (part.type !== "tool") continue;
			if (part.state.status === "pending") {
				part.state = {
					status: "error",
						// Half a JSON document cannot be parsed, so this must not pretend to have an arguments object.
					input: {},
					error: `Interrupted while its arguments were still streaming (partial: ${JSON.stringify(part.state.input)})`,
					interrupted: true,
				};
				part.time.completed = this.now;
			} else if (part.state.status === "running") {
				part.state = {
					status: "error",
					input: part.state.input,
					error: "Tool execution interrupted",
					interrupted: true,
				};
				part.time.completed = this.now;
			}
		}

			// 3. Unfinished reasoning / text: fill in an end time and **keep the content**.
			//    Half a thought and half an answer are things the user already saw; discarding them makes screen and record disagree.
		for (const part of this.message.parts) {
			if (part.type !== "tool" && part.time.completed === undefined) {
				part.time.completed = this.now;
			}
		}

			// 4. Compute the patch anyway. **An interrupted turn may also have changed files.**
		await this.recordDiff();

			// 5. Finish the message. Without this line, the reloaded session is treated as still running.
		this.message.time.completed = this.now;
		this.message.finish = reason;
	}

	private async recordDiff(): Promise<void> {
		if (!this.options.diff) return;
		this.message.snapshot = { files: await this.options.diff() };
	}

		/** Persist. What this lesson audits is this file, not the object in memory. */
	async persist(path: string): Promise<void> {
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, `${JSON.stringify(this.message)}\n`, "utf8");
	}

	static async load(path: string): Promise<AssistantMessage> {
		const raw = await readFile(path, "utf8");
		return JSON.parse(raw.trim()) as AssistantMessage;
	}
}
