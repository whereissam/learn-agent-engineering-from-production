/**
 * 一輪 assistant 訊息的內部結構：**part，而不是一段字串。**
 *
 * Lesson 1-27 的 history 長這樣：
 *
 *   { role: "assistant", blocks: [...] }   ← 一輪結束之後才寫進去
 *
 * 這在正常結束時完全夠用，因為「一輪結束」和「寫進 history」是同一件事。
 * **被中斷的時候它們不是同一件事**，於是你需要一個能表達「還沒結束」的形狀。
 *
 * 對照 opencode：`packages/schema/src/session-message.ts`
 *
 * ⚠️ 這個檔案最值得抄的一個決定在 `ToolState`：
 *
 *   pending    input 是 **string**       ← 參數還在串流，可能不是合法 JSON
 *   running    input 是 Record           ← 參數收完了、也 parse 過了
 *   completed  input + output
 *   error      input + error
 *
 * `pending.input` 是字串不是物件，這件事在型別上就講清楚了一個事實：
 * **工具參數是逐字送來的，中途中斷會留下半截 JSON。**
 * 用同一個 `input?: Record` 表示四種狀態的話，這個事實就不見了，
 * 而它不見的那天你會拿到一個 `JSON.parse` 例外，或者更糟 —— 一個空物件。
 *
 * 對照 `session-message.ts:81-119`（四個 state 各有自己的欄位）。
 */

export interface TimeSpan {
	created: number;
	/** 沒有 completed = **還沒結束**。這個 undefined 是資訊，不是缺資料。 */
	completed?: number;
}

export type ToolState =
	/** 參數還在串流。`input` 是原始字串，可能是半截 JSON。 */
	| { status: "pending"; input: string }
	/** 參數收完了，工具正在跑。 */
	| { status: "running"; input: Record<string, unknown> }
	| { status: "completed"; input: Record<string, unknown>; output: string }
	| {
			status: "error";
			input: Record<string, unknown>;
			error: string;
			/**
			 * ⚠️ **「被中斷」跟「工具自己壞了」不是同一件事。**
			 *
			 * opencode 把中斷的工具標成 `{ ...metadata, interrupted: true }`
			 * （`session/processor.ts:589`），而不是讓它永遠停在 running。
			 * 兩者都是 error status，但下游要分得出來：
			 * 工具壞了值得重試，被使用者中斷不值得。
			 */
			interrupted?: boolean;
	  };

export type Part =
	| { type: "reasoning"; id: string; text: string; time: TimeSpan }
	| { type: "text"; id: string; text: string; time: TimeSpan }
	| {
			type: "tool";
			id: string;
			name: string;
			state: ToolState;
			/**
			 * 三個時間點，不是兩個（`session-message.ts:132-137`）：
			 *   created  看到這個工具呼叫
			 *   ran      開始執行
			 *   completed 執行結束
			 *
			 * 中間那個容易被省略，但少了它就分不出
			 * 「參數還沒收完」和「跑很久」——而那是兩種完全不同的卡住。
			 */
			time: TimeSpan & { ran?: number };
	  };

export interface AssistantMessage {
	id: string;
	parts: Part[];
	/**
	 * 這一輪對 workspace 做了什麼（Lesson 29 的 patch）。
	 *
	 * 這裡刻意只存檔名，而且**允許 undefined 跟空陣列是不同的意思**：
	 *   undefined  還沒算過
	 *   []         算過了，沒有變更
	 */
	snapshot?: { files: string[] };
	/** 為什麼結束：正常、被中斷、出錯。 */
	finish?: "end" | "interrupted" | "error";
	time: TimeSpan;
}

// ─────────────────────────────────────────────────────────────
// 建構子。把「現在幾點」集中在一處，測試才控制得住時間。
// ─────────────────────────────────────────────────────────────

export type Clock = () => number;

export function newMessage(id: string, now: number): AssistantMessage {
	return { id, parts: [], time: { created: now } };
}

export function isInFlight(part: Part): boolean {
	if (part.type === "tool") {
		return part.state.status === "pending" || part.state.status === "running";
	}
	return part.time.completed === undefined;
}

/** 給人看的一行摘要。 */
export function describePart(part: Part): string {
	if (part.type === "tool") {
		// error 的時候顯示錯誤訊息而不是 input：被中斷的 pending 工具的
		// input 是 `{}`（半截 JSON parse 不了），真正的資訊在訊息裡。
		if (part.state.status === "error") {
			const flag = part.state.interrupted ? " (interrupted)" : "";
			return `tool ${part.name} [error${flag}] ${part.state.error.slice(0, 72)}`;
		}
		const input = JSON.stringify(part.state.input).slice(0, 44);
		return `tool ${part.name} [${part.state.status}] ${input}`;
	}
	const done = part.time.completed === undefined ? "…" : "";
	return `${part.type} ${JSON.stringify(part.text.slice(0, 36))}${done}`;
}
