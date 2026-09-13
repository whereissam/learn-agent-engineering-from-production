/**
 * A REPL lesson must exit when its input ends.
 *
 * Why this test exists: `bun run lesson-01 < /dev/null` hung forever. The cause
 * was `question()` from `node:readline/promises`, which at EOF never settles —
 * the `close` event fires, the awaited promise does not, and the `catch` that
 * was supposed to break the loop is unreachable. Bun waits for it forever; Node
 * exits but warns "unsettled top-level await", so the bug hides on one runtime.
 *
 * `shared/repl.ts` already solved this for every other lesson, and its own
 * docstring records finding the same class of bug in Lesson 4 by measurement.
 * Lesson 1 was the one file still calling readline directly.
 *
 * Run: bun test
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, test } from "node:test";

const ROOT = resolve(import.meta.dirname, "..");

/** Run a lesson with stdin already at EOF and report whether it ended on its own. */
function runWithNoInput(entry: string, timeoutMs: number): Promise<"exited" | "hung"> {
	return new Promise((done) => {
		const child = spawn("bun", [entry], {
			cwd: ROOT,
			env: { ...process.env, PROVIDER: "fake" },
			stdio: ["ignore", "ignore", "ignore"],
		});
		const timer = setTimeout(() => {
			child.kill("SIGKILL");
			done("hung");
		}, timeoutMs);
		child.on("exit", () => {
			clearTimeout(timer);
			done("exited");
		});
	});
}

describe("a REPL lesson ends when its input ends", () => {
	test("Lesson 1 exits at EOF instead of waiting forever", async () => {
		// Well under the runner's own per-test timeout (5s in Bun), so a hang is
		// reported by this assertion rather than as a timeout with a killed child.
		// It exits in ~40ms when correct.
		const result = await runWithNoInput("lesson-01-agent-loop/agent.ts", 2_500);
		assert.equal(result, "exited");
	});

	/**
	 * The guard that outlives the fix above. `question()` is the only readline API
	 * with this behaviour; the callback API (`node:readline`) reports EOF through
	 * its `close` event, which is what LineReader is built on.
	 */
	test("no lesson reaches for readline/promises again", () => {
		const offenders: string[] = [];
		for (const dir of readdirSync(ROOT).filter((d) => d.startsWith("lesson-"))) {
			for (const file of readdirSync(resolve(ROOT, dir))) {
				if (!file.endsWith(".ts")) continue;
				const text = readFileSync(resolve(ROOT, dir, file), "utf8");
				if (text.includes("node:readline/promises")) offenders.push(`${dir}/${file}`);
			}
		}
		assert.deepEqual(offenders, [], `use shared/repl.ts instead: ${offenders.join(", ")}`);
	});
});
