/**
 * 把串流事件變成 part，以及**被中斷時的收尾**。
 *
 * 對照 opencode：`session/processor.ts`。那個檔案 718 行，這個 200 出頭，
 * 差別幾乎都在事件種類（13 種）和儲存層，`cleanup()` 的形狀是一樣的。
 *
 * ⚠️ **這一課要先承認我們自己的抽象漏掉了什麼。**
 *
 * `shared/streaming/types.ts:44-51` 對 `tool_call` 寫了一段刻意的簡化：
 *
 *   > 注意：這是在參數「完整收到之後」才發出。
 *   > 有些 provider 會逐字串流工具參數，但半截的 JSON 對 UI 沒用，
 *   > 所以我們等它完整了再發。
 *
 * 那個決定對 Lesson 3-27 都是對的。但它讓「參數收到一半就被中斷」
 * **在型別上不可表示** —— 而那正是這一課矩陣裡的一行。
 * 所以這一課自己定義一組比較細的事件。
 *
 * > **一個好的抽象會藏起你不需要的東西；
 * > 你只會在需要它的那一天，才發現它藏了什麼。**
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { type AssistantMessage, type Clock, newMessage, type Part } from "./parts.ts";

/** 比 `shared/streaming` 細的一組事件，理由見檔頭。 */
export type SessionEvent =
	| { type: "reasoning_start"; id: string }
	| { type: "reasoning_delta"; id: string; delta: string }
	| { type: "reasoning_end"; id: string }
	| { type: "text_start"; id: string }
	| { type: "text_delta"; id: string; delta: string }
	| { type: "text_end"; id: string }
	/** 工具參數的一小塊。**半截的 JSON 就是從這裡來的。** */
	| { type: "tool_input_delta"; id: string; name: string; chunk: string }
	/** 參數收完了。 */
	| { type: "tool_call"; id: string; name: string; args: Record<string, unknown> }
	| { type: "step_finish" };

export interface ProcessorOptions {
	clock: Clock;
	execute: (name: string, args: Record<string, unknown>) => Promise<string>;
	/**
	 * 中斷之後要不要收尾。**false 是這一課要示範的錯誤版本**：
	 * 串流停了、進程結束了，但 part 全部停在中斷的那一刻。
	 */
	cleanup?: boolean;
	/**
	 * 給還在跑的工具多少毫秒把自己做完。
	 *
	 * opencode 給 250ms（`session/processor.ts:573`）。
	 * 這個窗口不是為了效能，是為了**正確性**：一個 20ms 後就會回來的工具
	 * 如果被標成 interrupted，那份紀錄就錯了 —— 它其實跑完了。
	 */
	graceMs?: number;
	/** 這一輪有哪些檔案變了。Lesson 29 的 `snapshot.patch()` 是它的真實版本。 */
	diff?: () => string[] | Promise<string[]>;
	log?: (line: string) => void;
}

export class SessionProcessor {
	readonly message: AssistantMessage;
	/** 還在跑的工具：part id → 它的 promise。 */
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
				// 第一塊參數到達時就建立 part。**這是刻意的**：
				// 如果等參數收完才建立，中斷在這個窗口裡就完全沒有紀錄，
				// 使用者會看到「什麼都沒發生」，而其實模型已經決定要呼叫工具了。
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

				// ⚠️ **不 await。** 工具在背景跑，串流繼續 ——
				// 這正是「中斷的時候有工具正在執行」得以發生的原因。
				// await 掉的話這一課的第三行矩陣就不存在了。
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
	 * 中斷（或錯誤）之後的收尾。**五件事，順序有意義。**
	 *
	 * 對照 `session/processor.ts:539-595` 的 `cleanup`。
	 */
	async cleanup(reason: AssistantMessage["finish"]): Promise<void> {
		if (this.options.cleanup === false) {
			// 錯誤版本：串流停了就結束。什麼都不做。
			this.options.log?.("  （CLEANUP=off：不收尾）");
			return;
		}

		// 1. 還在跑的工具。**正常結束和被中斷要用不同的等法。**
		//
		// ⚠️ 這一段第一版寫錯了，而且是真模型跑出來的：
		// 那次模型沒有先輸出文字就直接呼叫工具，於是串流正常結束、
		// 走進 `cleanup("end")`，而工具還在跑 → 250ms 寬限窗口到了 →
		// **一個成功的工具被標成 interrupted，而 finish 是 "end"**。
		// 一份自相矛盾的紀錄，而且不會有任何錯誤。
		//
		// 寬限窗口只屬於中斷路徑。正常結束時，「工具還沒回來」不是異常，
		// 只是還沒好 —— 那就等它。
		if (this.inFlight.size > 0) {
			if (reason === "end") {
				await Promise.allSettled([...this.inFlight.values()]);
				this.options.log?.("  （正常結束：等所有工具真的跑完）");
			} else {
				const grace = this.options.graceMs ?? 250;
				await Promise.race([
					Promise.allSettled([...this.inFlight.values()]),
					new Promise((resolve) => setTimeout(resolve, grace)),
				]);
				this.options.log?.(`  （中斷：等了 ${grace}ms 的寬限窗口）`);
			}
		}

		// 2. 沒趕上的：標成 error + interrupted，**不是**讓它停在 running。
		for (const part of this.message.parts) {
			if (part.type !== "tool") continue;
			if (part.state.status === "pending") {
				part.state = {
					status: "error",
					// 半截的 JSON parse 不了，所以這裡不能假裝有參數物件。
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

		// 3. 沒結束的 reasoning / text：補上結束時間，**內容留著**。
		//    半截的推理和半截的回答都是使用者已經看過的東西，丟掉等於畫面跟紀錄不一致。
		for (const part of this.message.parts) {
			if (part.type !== "tool" && part.time.completed === undefined) {
				part.time.completed = this.now;
			}
		}

		// 4. patch 照算。**被中斷的那一輪也可能改過檔案。**
		await this.recordDiff();

		// 5. 訊息收尾。少了這一行，載回來的 session 會被當成還在跑。
		this.message.time.completed = this.now;
		this.message.finish = reason;
	}

	private async recordDiff(): Promise<void> {
		if (!this.options.diff) return;
		this.message.snapshot = { files: await this.options.diff() };
	}

	/** 存檔。這一課稽核的對象是這個檔案，不是記憶體裡的物件。 */
	async persist(path: string): Promise<void> {
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, `${JSON.stringify(this.message)}\n`, "utf8");
	}

	static async load(path: string): Promise<AssistantMessage> {
		const raw = await readFile(path, "utf8");
		return JSON.parse(raw.trim()) as AssistantMessage;
	}
}
