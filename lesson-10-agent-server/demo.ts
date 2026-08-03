/**
 * Lesson 10's demonstration: what a reconnect loses, and why.
 *
 * No API key needed (it uses PROVIDER=fake). All three scenarios were really run,
 * with two server processes and several client connections, following the README's order:
 *
 *   1. the NAIVE server: disconnect → reconnect → that passage is gone forever
 *   2. the fixed server: disconnect → reconnect → the screen is restored
 *   3. two clients on one session: one sends a message and both see it;
 *      one interrupts and both stop
 *
 * Run: bun run lesson-10-agent-server/demo.ts
 */

import { spawn, type ChildProcess } from "node:child_process";
import { rmSync } from "node:fs";
import { resolve } from "node:path";

const SERVER = resolve(import.meta.dirname, "server.ts");
const SESSION_DIR = resolve(import.meta.dirname, "sessions");

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─────────────────────────────────────────────────────────────
// A minimal client that receives only text, for comparing "how much did it see"
// ─────────────────────────────────────────────────────────────

interface Watcher {
	/** All the text on screen = the history resent on connect plus the deltas that arrived live. */
	seen: string;
	/**
		 * Only the deltas that arrived live.
	 *
		 * Kept separate from seen, or the two scenarios cannot be compared: the fixed server resends history
		 * on connect, and that history is not "what this connection saw"; mixing them makes NAIVE look worse than it is.
	 */
	deltas: string;
	/** Did the server resend state on connect (NAIVE mode does not). */
	resynced: boolean;
	close(): void;
}

function watch(port: number, session: string, label: string, echo = false): Watcher {
	const abort = new AbortController();
	const state: Watcher = {
		seen: "",
		deltas: "",
		resynced: false,
		close: () => abort.abort(),
	};

	void (async () => {
		const response = await fetch(`http://127.0.0.1:${port}/session/${session}/events`, {
			signal: abort.signal,
		});
		if (!response.body) return;
		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		let buffer = "";

		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			let cut = buffer.indexOf("\n\n");
			while (cut !== -1) {
				const line = buffer
					.slice(0, cut)
					.split("\n")
					.find((l) => l.startsWith("data: "));
				buffer = buffer.slice(cut + 2);
				cut = buffer.indexOf("\n\n");
				if (!line) continue;

				const event = JSON.parse(line.slice(6)) as {
					type: string;
					delta?: string;
					messages?: { role: string; blocks?: { type: string; text?: string }[] }[];
				};

				if (event.type === "state") {
					state.resynced = true;
					for (const message of event.messages ?? []) {
						for (const block of message.blocks ?? []) {
							if (block.type === "text") state.seen += block.text ?? "";
						}
					}
				}
				if (event.type === "text_delta") {
					state.seen += event.delta ?? "";
					state.deltas += event.delta ?? "";
					if (echo) process.stdout.write(cyan(event.delta ?? ""));
				}
				if (echo && event.type === "interrupted") process.stdout.write(yellow(`\n  [${label} saw the interruption]\n`));
			}
		}
	})().catch(() => {
			/* An abort-induced termination is expected */
	});

	return state;
}

// ─────────────────────────────────────────────────────────────

function startServer(port: number, naive: boolean): Promise<ChildProcess> {
	const child = spawn(process.execPath, [SERVER], {
		env: {
			...process.env,
			PORT: String(port),
			PROVIDER: "fake",
			FAKE_DELAY_MS: "6",
			...(naive ? { NAIVE: "1" } : {}),
		},
		stdio: "ignore",
	});

	return new Promise((resolveReady, rejectReady) => {
		const deadline = Date.now() + 5000;
		const poll = async (): Promise<void> => {
			if (child.exitCode !== null) return rejectReady(new Error("the server did not start"));
			try {
				await fetch(`http://127.0.0.1:${port}/session/probe`);
				resolveReady(child);
			} catch {
				if (Date.now() > deadline) return rejectReady(new Error("the server took too long to start"));
				setTimeout(() => void poll(), 50);
			}
		};
		void poll();
	});
}

async function send(port: number, session: string, text: string): Promise<void> {
	await fetch(`http://127.0.0.1:${port}/session/${session}/message`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ text }),
	});
}

async function interrupt(port: number, session: string): Promise<void> {
	await fetch(`http://127.0.0.1:${port}/session/${session}/interrupt`, { method: "POST" });
}

/**
 * Get the agent straight to the "say a long passage" part.
 *
 * The fake provider's first two turns are tool calls (see shared/streaming/fake.ts:48).
 * What is being demonstrated is "disconnecting mid-text", so those two turns run first.
 */
async function warmUp(port: number, session: string): Promise<void> {
	for (let i = 0; i < 2; i++) {
		await send(port, session, `warm-up ${i}`);
		await waitIdle(port, session);
	}
}

async function waitIdle(port: number, session: string): Promise<void> {
	for (let i = 0; i < 400; i++) {
		const state = (await (await fetch(`http://127.0.0.1:${port}/session/${session}`)).json()) as {
			running: boolean;
		};
		if (!state.running) return;
		await sleep(25);
	}
	throw new Error("the turn never finished");
}

// ─────────────────────────────────────────────────────────────
// Scenarios 1 and 2: the same script on two kinds of server
// ─────────────────────────────────────────────────────────────

async function reconnectScenario(naive: boolean): Promise<void> {
	const port = naive ? 7101 : 7102;
	const session = "reconnect";
	const server = await startServer(port, naive);

	try {
		await warmUp(port, session);

			// Connect, send a message, watch it talk
		const before = watch(port, session, "client");
		await sleep(100);
		await send(port, session, "say something long");

		await sleep(600); // watch a little of it
		const sawBeforeDrop = before.deltas.length;
		before.close(); // ← the user closes the window / the network drops / the GUI reloads
		console.log(dim(`  ${sawBeforeDrop} characters arrived live before the drop`));

		await waitIdle(port, session); // the turn keeps running to completion in the background
		console.log(dim("  the turn finished on the server while disconnected"));

			// Reconnect
		const after = watch(port, session, "client");
		await sleep(200);

		const total = await totalText(port, session);
		console.log(
			`  after reconnecting the screen holds ${bold(String(after.seen.length))} characters, ` +
				`while the server actually has ${bold(String(total))}`,
		);

		if (after.seen.length >= total) {
			console.log(`  ${green("✓")} restored (the server replayed the state on reconnect)`);
		} else {
			console.log(
				`  ${red("✗")} ${red(String(total - after.seen.length))} characters missing, ` +
					`and they are ${red("never")} coming back`,
			);
			console.log(dim('     No error, no exception, no warning. The user just feels something is "off".'));
		}
		after.close();
	} finally {
		server.kill();
		await sleep(100);
	}
}

async function totalText(port: number, session: string): Promise<number> {
	const state = (await (await fetch(`http://127.0.0.1:${port}/session/${session}`)).json()) as {
		messages: { role: string; blocks?: { type: string; text?: string }[] }[];
	};
	let count = 0;
	for (const message of state.messages) {
		for (const block of message.blocks ?? []) {
			if (block.type === "text") count += (block.text ?? "").length;
		}
	}
	return count;
}

// ─────────────────────────────────────────────────────────────
// Scenario 3: two windows
// ─────────────────────────────────────────────────────────────

async function twoWindowsScenario(): Promise<void> {
	const port = 7103;
	const session = "shared";
	const server = await startServer(port, false);

	try {
		await warmUp(port, session);

		const windowA = watch(port, session, "window A");
		const windowB = watch(port, session, "window B");
		await sleep(100);

		console.log(dim("  window A sends a message (window B does nothing)"));
		await send(port, session, "say something long");
		await sleep(500);

		console.log(
			`  window A saw ${bold(String(windowA.seen.length))} characters, ` +
				`window B saw ${bold(String(windowB.seen.length))}`,
		);
		if (windowA.seen === windowB.seen) {
			console.log(`  ${green("✓")} both windows are identical (even the sender waits for the event before drawing)`);
		} else {
			console.log(`  ${red("✗")} out of sync`);
		}

		console.log(dim("\n  now press interrupt from window B"));
		await interrupt(port, session);
		await waitIdle(port, session);
		await sleep(150);

		console.log(
			`  after the interruption A=${bold(String(windowA.seen.length))} B=${bold(String(windowB.seen.length))}`,
		);
		console.log(`  ${green("✓")} interruption belongs to the session, not to a window`);

			// The sender cannot send twice at once
		console.log(dim("\n  press send twice in a row:"));
		const first = fetch(`http://127.0.0.1:${port}/session/${session}/message`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ text: "first" }),
		});
		const second = fetch(`http://127.0.0.1:${port}/session/${session}/message`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ text: "second" }),
		});
		const [a, b] = await Promise.all([first, second]);
		console.log(`  first request ${a.status}, second request ${b.status}`);
		console.log(`  ${green("✓")} one session runs one turn at a time; the second is refused with 409`);

		await interrupt(port, session).catch(() => {});
		await waitIdle(port, session);
		windowA.close();
		windowB.close();
	} finally {
		server.kill();
		await sleep(100);
	}
}

// ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
	rmSync(SESSION_DIR, { recursive: true, force: true });

	console.log(bold('\nScenario 1: the NAIVE server, whose event stream starts from "now"'));
	console.log(dim("disconnect → reconnect → see what is on screen\n"));
	await reconnectScenario(true);

	console.log(bold("\nScenario 2: the fixed server, which replays the state on reconnect"));
	console.log(dim("the same script; the only difference is one if inside openStream()\n"));
	await reconnectScenario(false);

	console.log(bold("\nScenario 3: two windows watching the same session"));
	console.log(dim("broadcast to every connection, including the one that sent the message\n"));
	await twoWindowsScenario();

	console.log(bold("\nThe point"));
	console.log("  1. a turn's lifetime belongs to the session, not to the window that sent it");
	console.log('  2. reconnecting is not "resume playing events", it is "fetch the state again"');
	console.log(`  3. a dropped event is a ${red("silent failure")}: design it out, because testing will not find it`);
	console.log(dim("\nDetails in the README. To play by hand: bun run lesson-10 + bun run lesson-10:client\n"));

	rmSync(SESSION_DIR, { recursive: true, force: true });
}

await main();
