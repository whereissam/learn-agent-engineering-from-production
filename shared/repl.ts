/**
 * 一個能正確處理「管線輸入」的行讀取器。
 *
 * 為什麼不直接用 readline 的 question()？
 *
 * 因為連續呼叫兩次 question()（中間沒有 await 別的東西）時，
 * 第二次會漏掉已經在緩衝區裡的那一行。互動使用看不出來，人類打字很慢，
 * 每次都只有一行。但只要你用管線餵輸入（測試、CI、示範腳本），
 * 第二個指令就會消失，程式停在那裡等一個永遠不會來的輸入。
 *
 * 這個類別自己接管 "line" 事件，把每一行放進佇列。
 * 要不要有人在等，行都不會掉。
 *
 * 我是實測踩到才發現的：lesson-04-sessions 用管線餵 `/file` + `/exit`，
 * `/file` 執行了，`/exit` 石沉大海，程式掛在提示符號。
 */

import { createInterface, type Interface } from "node:readline";

export class LineReader {
	private readonly rl: Interface;
	/** 已經讀到、還沒被取走的行。 */
	private readonly buffered: string[] = [];
	/** 正在等下一行的人。 */
	private readonly waiting: Array<(line: string | null) => void> = [];
	private closed = false;

	constructor() {
		this.rl = createInterface({ input: process.stdin, output: process.stdout });

		this.rl.on("line", (line) => {
			const next = this.waiting.shift();
			if (next) {
				next(line);
			} else {
				// 沒人在等 → 先存起來。這一行就是修掉掉字問題的關鍵。
				this.buffered.push(line);
			}
		});

		this.rl.on("close", () => {
			this.closed = true;
			// 叫醒所有還在等的人，告訴他們沒有下一行了
			while (this.waiting.length > 0) {
				this.waiting.shift()?.(null);
			}
		});
	}

	/** 底層的 readline，需要接 SIGINT 時會用到。 */
	get raw(): Interface {
		return this.rl;
	}

	/**
	 * 讀下一行。輸入結束（EOF / Ctrl+D）時回傳 null。
	 *
	 * 回傳 null 而不是 throw，是因為「輸入結束」是正常情況，不是錯誤。
	 */
	async next(prompt: string): Promise<string | null> {
		const queued = this.buffered.shift();
		if (queued !== undefined) {
			// 已經有緩衝的行。還是把提示印出來，畫面才看得懂發生什麼事。
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
