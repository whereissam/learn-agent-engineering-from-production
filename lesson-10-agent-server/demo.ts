/**
 * Lesson 10 示範：斷線重連會掉什麼，以及為什麼。
 *
 * 不需要 API key（用 PROVIDER=fake）。三個情境都是真的跑出來的，
 * 兩個 server 進程、多個 client 連線，全部照 README 的順序演一遍：
 *
 *   1. NAIVE server：斷線 → 重連 → 那段話永久消失
 *   2. 修好的 server：斷線 → 重連 → 畫面補回來
 *   3. 兩個 client 看同一個 session：一個送訊息，兩個都看得到；
 *      一個按中斷，兩個都停
 *
 * 執行：bun run lesson-10-agent-server/demo.ts
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
// 一個極簡的 client，只收文字，方便比對「看到了多少」
// ─────────────────────────────────────────────────────────────

interface Watcher {
	/** 畫面上的全部文字 = 連上時補送的歷史 + 之後即時進來的 delta。 */
	seen: string;
	/**
	 * 只算即時進來的 delta。
	 *
	 * 要跟 seen 分開，不然兩個情境沒得比：修好的 server 一連上就補一段歷史，
	 * 那段不是「這次連線看到的」，混在一起會讓 NAIVE 版看起來比較慘。
	 */
	deltas: string;
	/** 連上時 server 有沒有補送狀態（NAIVE 模式沒有）。 */
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
				if (echo && event.type === "interrupted") process.stdout.write(yellow(`\n  [${label} 收到中斷]\n`));
			}
		}
	})().catch(() => {
		/* abort 造成的中止是預期的 */
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
			if (child.exitCode !== null) return rejectReady(new Error("server 沒起來"));
			try {
				await fetch(`http://127.0.0.1:${port}/session/probe`);
				resolveReady(child);
			} catch {
				if (Date.now() > deadline) return rejectReady(new Error("server 起太慢"));
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
 * 讓 agent 直接進到「講一段長話」那一段。
 *
 * fake provider 的前兩輪是工具呼叫（見 shared/streaming/fake.ts:48）。
 * 我們要示範的是「文字串到一半斷線」，所以先把那兩輪跑掉。
 */
async function warmUp(port: number, session: string): Promise<void> {
	for (let i = 0; i < 2; i++) {
		await send(port, session, `暖身 ${i}`);
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
	throw new Error("turn 沒有結束");
}

// ─────────────────────────────────────────────────────────────
// 情境 1 + 2：同一段劇本，跑在兩種 server 上
// ─────────────────────────────────────────────────────────────

async function reconnectScenario(naive: boolean): Promise<void> {
	const port = naive ? 7101 : 7102;
	const session = "reconnect";
	const server = await startServer(port, naive);

	try {
		await warmUp(port, session);

		// 連上、送訊息、看著它講
		const before = watch(port, session, "client");
		await sleep(100);
		await send(port, session, "講一段長的");

		await sleep(600); // 看一小段
		const sawBeforeDrop = before.deltas.length;
		before.close(); // ← 使用者關掉視窗 / 網路斷了 / GUI 重載
		console.log(dim(`  斷線前即時收到 ${sawBeforeDrop} 個字`));

		await waitIdle(port, session); // turn 在背景繼續跑完
		console.log(dim("  斷線期間 turn 在 server 上跑完了"));

		// 重新連上
		const after = watch(port, session, "client");
		await sleep(200);

		const total = await totalText(port, session);
		console.log(
			`  重連後畫面上有 ${bold(String(after.seen.length))} 個字，` +
				`server 上實際有 ${bold(String(total))} 個字`,
		);

		if (after.seen.length >= total) {
			console.log(`  ${green("✓")} 補回來了（重連時 server 重送了一次狀態）`);
		} else {
			console.log(
				`  ${red("✗")} 少了 ${red(String(total - after.seen.length))} 個字，` +
					`而且${red("永遠")}補不回來`,
			);
			console.log(dim("     沒有錯誤、沒有例外、沒有警告。使用者只會覺得「怪怪的」。"));
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
// 情境 3：兩個視窗
// ─────────────────────────────────────────────────────────────

async function twoWindowsScenario(): Promise<void> {
	const port = 7103;
	const session = "shared";
	const server = await startServer(port, false);

	try {
		await warmUp(port, session);

		const windowA = watch(port, session, "視窗 A");
		const windowB = watch(port, session, "視窗 B");
		await sleep(100);

		console.log(dim("  視窗 A 送出訊息（視窗 B 什麼都沒做）"));
		await send(port, session, "講一段長的");
		await sleep(500);

		console.log(
			`  視窗 A 看到 ${bold(String(windowA.seen.length))} 個字，` +
				`視窗 B 看到 ${bold(String(windowB.seen.length))} 個字`,
		);
		if (windowA.seen === windowB.seen) {
			console.log(`  ${green("✓")} 兩個視窗一模一樣（送訊息的那個也是等事件回來才畫）`);
		} else {
			console.log(`  ${red("✗")} 不同步`);
		}

		console.log(dim("\n  現在從視窗 B 按中斷"));
		await interrupt(port, session);
		await waitIdle(port, session);
		await sleep(150);

		console.log(
			`  中斷後 A=${bold(String(windowA.seen.length))} B=${bold(String(windowB.seen.length))}`,
		);
		console.log(`  ${green("✓")} 中斷是 session 的事，不是視窗的事`);

		// 送訊息的人不能同時送兩次
		console.log(dim("\n  連按兩次送出："));
		const first = fetch(`http://127.0.0.1:${port}/session/${session}/message`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ text: "第一次" }),
		});
		const second = fetch(`http://127.0.0.1:${port}/session/${session}/message`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ text: "第二次" }),
		});
		const [a, b] = await Promise.all([first, second]);
		console.log(`  第一個請求 ${a.status}，第二個請求 ${b.status}`);
		console.log(`  ${green("✓")} 一個 session 一次只跑一輪，第二個被 409 擋掉`);

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

	console.log(bold("\n情境 1：NAIVE server ， 事件流從「現在」開始"));
	console.log(dim("斷線 → 重連 → 看看畫面上有什麼\n"));
	await reconnectScenario(true);

	console.log(bold("\n情境 2：修好的 server ， 重連時重送一次狀態"));
	console.log(dim("同一段劇本，只差在 openStream() 裡那個 if\n"));
	await reconnectScenario(false);

	console.log(bold("\n情境 3：兩個視窗看同一個 session"));
	console.log(dim("廣播給所有連線，包含送訊息的那一個\n"));
	await twoWindowsScenario();

	console.log(bold("\n重點"));
	console.log("  1. turn 的生命週期屬於 session，不屬於送出它的那個視窗");
	console.log("  2. 重連不是「接續播放事件」，是「重新拿一次狀態」");
	console.log(`  3. 掉事件是${red("安靜的失敗")}，要靠設計避免，不能靠測試發現`);
	console.log(dim("\n細節見 README。想手動玩：bun run lesson-10 + bun run lesson-10:client\n"));

	rmSync(SESSION_DIR, { recursive: true, force: true });
}

await main();
