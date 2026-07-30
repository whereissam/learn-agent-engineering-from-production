/**
 * A line reader that handles piped input correctly.
 *
 * Why not readline's question() directly?
 *
 * Because calling question() twice in a row (with nothing else awaited in between)
 * makes the second call miss a line already sitting in the buffer. Interactively you never see it: humans type slowly
 * and there is only ever one line. But pipe the input in (tests, CI, demo scripts) and
 * the second command vanishes, with the program waiting for input that will never come.
 *
 * This class takes over the "line" event itself and queues every line.
 * Whether or not somebody is waiting, no line is lost.
 *
 * Found by measurement: lesson-04-sessions was piped `/file` plus `/exit`,
 * `/file` executed, `/exit` vanished, and the program hung at the prompt.
 */

import { createInterface, type Interface } from "node:readline";

export class LineReader {
	private readonly rl: Interface;
	/** Lines received and not yet taken. */
	private readonly buffered: string[] = [];
	/** Whoever is waiting for the next line. */
	private readonly waiting: Array<(line: string | null) => void> = [];
	private closed = false;

	constructor() {
		this.rl = createInterface({ input: process.stdin, output: process.stdout });

		this.rl.on("line", (line) => {
			const next = this.waiting.shift();
			if (next) {
				next(line);
			} else {
				// Nobody waiting → store it. This line is the fix for the lost-line problem.
				this.buffered.push(line);
			}
		});

		this.rl.on("close", () => {
			this.closed = true;
			// Wake everybody still waiting and tell them there is no next line
			while (this.waiting.length > 0) {
				this.waiting.shift()?.(null);
			}
		});
	}

	/** The underlying readline, needed when wiring up SIGINT. */
	get raw(): Interface {
		return this.rl;
	}

	/**
		 * Read the next line. Returns null at end of input (EOF / Ctrl+D).
	 *
		 * It returns null rather than throwing, because "input ended" is normal rather than an error.
	 */
	async next(prompt: string): Promise<string | null> {
		const queued = this.buffered.shift();
		if (queued !== undefined) {
				// A line is already buffered. Print the prompt anyway, so the screen makes sense.
			process.stdout.write(prompt + queued + "\n");
			return queued;
		}

		if (this.closed) return null;

		process.stdout.write(prompt);
		return await new Promise<string | null>((resolve) => {
			this.waiting.push(resolve);
		});
	}

	close(): void {
		this.rl.close();
	}
}
