/**
 * 一個**可以在指定位置被中斷**的串流。
 *
 * 這一課最先要解決的不是收尾邏輯，是**怎麼可靠地中斷一次串流**。
 * 這個問題比它看起來難，而且解錯了整課就沒有價值：
 *
 *   ❌ 用 setTimeout 在 30ms 之後 abort
 *      → 那 30ms 落在哪個事件之間是**運氣**。同一支測試今天中斷在
 *        reasoning，明天中斷在 tool，而你不會知道它換過。
 *
 *   ❌ 真的按 Ctrl-C
 *      → 位置更不可控，而且沒辦法寫成測試。
 *
 *   ✅ **讓串流自己在指定的位置 abort。**
 *      「中斷發生在哪裡」變成一個參數，矩陣的每一格都是可重現的。
 *
 * > 這條原則不只適用中斷：**任何「時序造成的 bug」，
 * > 都要先做出一個能指定時序的裝置，再開始修。**
 * > Lesson 18 的假時鐘、Lesson 29 的 `CAPTURE` 抓取點都是同一件事。
 */

import type { SessionEvent } from "./processor.ts";

export type InterruptPoint =
	/** 推理輸出到一半。 */
	| "reasoning"
	/** 工具參數收到一半（半截 JSON）。 */
	| "tool_input"
	/** 工具正在執行，而且不會在寬限窗口內結束。 */
	| "tool_running"
	/** 工具正在執行，但**會在寬限窗口內結束** —— 那它就該被記成 completed。 */
	| "tool_finishing"
	/** 回答輸出到一半。 */
	| "text"
	/** 檔案改完了，但 step_finish 還沒發出。 */
	| "before_step_finish"
	/** 不中斷，正常跑完（對照組）。 */
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

/** 這一格的工具要跑多久（毫秒）。寬限窗口是 250ms。 */
export function toolDuration(point: InterruptPoint): number {
	if (point === "tool_finishing") return 20; // 趕得上
	if (point === "tool_running") return 5_000; // 趕不上
	return 5;
}

/**
 * 照劇本吐事件，走到 `point` 的時候自己 abort。
 *
 * abort 之後**立刻停止 yield**，因為真實的 provider 就是這樣：
 * `text_end`、`step_finish` 這些「結束事件」永遠不會來了。
 * 這件事是整課的前提 —— 收尾之所以必須存在，就是因為沒有人會替你發結束事件。
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
	yield { type: "reasoning_delta", id: "r1", delta: "使用者要我改 src/a.ts。" };
	yield { type: "reasoning_delta", id: "r1", delta: "先讀檔，再決定改哪一行。" };
	if (stop("reasoning")) return;
	yield { type: "reasoning_end", id: "r1" };

	// 工具參數逐塊送來。第二塊送完之後那個字串是 `{"path":"src/a.ts","content` ——
	// **parse 不了**，這是 `pending.input` 為什麼是 string 的實證。
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

	// 工具現在在背景跑（processor 刻意不 await 它）。
	if (stop("tool_running")) return;
	if (stop("tool_finishing")) return;

	// 讓快的工具跑完，模擬真實的時間流動。
	await new Promise((resolve) => setTimeout(resolve, 30));

	yield { type: "text_start", id: "x1" };
	yield { type: "text_delta", id: "x1", delta: "已經把 src/a.ts 的常數改成 2" };
	yield { type: "text_delta", id: "x1", delta: "，並確認沒有其他地方引用舊值。" };
	if (stop("text")) return;
	yield { type: "text_end", id: "x1" };

	if (stop("before_step_finish")) return;
	yield { type: "step_finish" };
}
