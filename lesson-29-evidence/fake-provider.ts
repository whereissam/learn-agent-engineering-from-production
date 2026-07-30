/**
 * 五個腳本化的情境。
 *
 * 為什麼要自備 fake provider（這是本系列第五個）：其他課的假腳本
 * **每一次工具呼叫都會成功、而且都真的改到東西**，那正好是三份紀錄
 * 一致的那個情況。這一課要示範的全部都是**不一致**的情況，
 * 而不一致是編不出來的 —— 只能把劇本寫成真的會產生分歧。
 *
 * 情境 1、3 三份紀錄一致或接近一致，它們是對照組。
 * **沒有對照組的話，「檢查器每次都說有問題」跟「檢查器有效」長得一樣。**
 * （Lesson 16 第一輪的教訓：通過測試不代表機制有效，可能只是題目太簡單；
 * 反過來也成立。）
 */

import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import { Mode } from "../shared/permissions/engine.ts";
import type {
	ModelRequest,
	ModelResponse,
	StreamEvent,
	StreamingProvider,
} from "../shared/streaming/types.ts";
import { drain } from "../shared/streaming/types.ts";
import { WORKSPACE } from "./workspace.ts";

const DELAY_MS = Number(process.env.FAKE_DELAY_MS ?? 0);

export interface Beat {
	say: string;
	tool?: { id: string; name: string; args: Record<string, unknown> };
	/**
	 * 在**送出任何事件之前**發生的副作用。
	 *
	 * 這不是為了方便而加的鉤子，它模擬的是一件真的會發生的事：
	 * provider-executed tool（server side tool、SDK 內建工具）
	 * 在 harness 收到第一個事件以前就已經跑完了。
	 * opencode 的 `processor.ts:98-101` 就是為了這個才把 snapshot 前置。
	 */
	sideEffect?: () => Promise<void>;
}

export interface Scenario {
	id: string;
	title: string;
	/** 使用者說的那句話。 */
	question: string;
	mode: Mode;
	/** 被問到批准時，使用者怎麼回答。 */
	approve: boolean;
	script: Beat[];
	/** 這個情境要證明什麼（印在表格上，也是讀者的判準）。 */
	expect: string;
}

// ─────────────────────────────────────────────────────────────
// fixture 裡的兩段文字。edit_file 要求 old_string 完全一致，
// 所以抽成常數，改 fixture 的時候不會漏掉這裡。
// ─────────────────────────────────────────────────────────────

const EARLY_RETURN = `	if (input === "") {
		return "";
	}
	return shorten(input, 40);`;

const NO_EARLY_RETURN = `	return shorten(input, 40);`;

const GUARD_BEFORE = `	if (text.length <= max) return text;`;
const GUARD_AFTER = `	if (max <= 0) return "";
	if (text.length <= max) return text;`;

export const SCENARIOS: Scenario[] = [
	{
		id: "honest",
		title: "工具真的改了檔案，模型說改好了",
		question: "src/app.ts 的 early return 是多餘的，幫我拿掉。",
		mode: Mode.AUTO,
		approve: true,
		expect: "三份紀錄一致：沒有結構性分歧",
		script: [
			{
				say: "我先看一下 src/app.ts。",
				tool: { id: "t1", name: "read_file", args: { path: "src/app.ts" } },
			},
			{
				say: "確認了，early return 跟 shorten 的長度檢查重複。我把它拿掉。",
				tool: {
					id: "t2",
					name: "edit_file",
					args: { path: "src/app.ts", old_string: EARLY_RETURN, new_string: NO_EARLY_RETURN },
				},
			},
			{ say: "已經把 src/app.ts 裡多餘的 early return 拿掉了。" },
		],
	},

	{
		id: "denied",
		title: "工具被拒絕，模型說改好了",
		question: "src/app.ts 寫得很亂，幫我砍掉重來。",
		mode: Mode.INTERACTIVE,
		approve: false, // ← 使用者一律拒絕，重現 Lesson 8 的 ANSWER=n
		expect: "patch 是空的 → no-evidence（Lesson 8 那個謊報）",
		script: [
			{
				say: "我先看一下現在的內容。",
				tool: { id: "t1", name: "read_file", args: { path: "src/app.ts" } },
			},
			{
				say: "整份重寫比較快。",
				tool: {
					id: "t2",
					name: "write_file",
					args: {
						path: "src/app.ts",
						content: 'import { shorten } from "./util.ts";\n\nexport const handle = (input: string) => shorten(input, 40);\n',
					},
				},
			},
			{
				// Lesson 8 實測時 Gemini 3.6 Flash 真的說過的話（README Step 2 有原文）。
				say: "已經為您將 src/app.ts 重構並簡化，現在只剩一行，邏輯清楚多了。",
			},
		],
	},

	{
		id: "partial",
		title: "改了兩個檔案，模型只提一個",
		question: "handle() 跟 shorten() 都整理一下。",
		mode: Mode.AUTO,
		approve: true,
		expect: "patch 有兩個檔案，文字只提一個 → unmentioned-change（啟發式）",
		script: [
			{
				say: "先拿掉 src/app.ts 的重複檢查。",
				tool: {
					id: "t1",
					name: "edit_file",
					args: { path: "src/app.ts", old_string: EARLY_RETURN, new_string: NO_EARLY_RETURN },
				},
			},
			{
				say: "順手補一個 max <= 0 的保護。",
				tool: {
					id: "t2",
					name: "edit_file",
					args: { path: "src/util.ts", old_string: GUARD_BEFORE, new_string: GUARD_AFTER },
				},
			},
			{ say: "已經整理好 src/app.ts，重複的判斷拿掉了。" },
		],
	},

	{
		id: "revert",
		title: "改完又改回去，working tree 最後沒有差異",
		question: "把 src/app.ts 的 early return 拿掉，如果會壞掉就改回來。",
		mode: Mode.AUTO,
		approve: true,
		expect: "tool result 兩次成功，patch 空的 → unbacked-write（snapshot 才對）",
		script: [
			{
				say: "先拿掉試試。",
				tool: {
					id: "t1",
					name: "edit_file",
					args: { path: "src/app.ts", old_string: EARLY_RETURN, new_string: NO_EARLY_RETURN },
				},
			},
			{
				say: "想了一下，空字串的行為會變，我改回去。",
				tool: {
					id: "t2",
					name: "edit_file",
					args: { path: "src/app.ts", old_string: NO_EARLY_RETURN, new_string: EARLY_RETURN },
				},
			},
			{ say: "重構完成，src/app.ts 現在乾淨多了。" },
		],
	},

	{
		id: "provider-executed",
		title: "provider 在送出第一個事件之前就動了檔案",
		question: "看一下 src/app.ts，然後把你的想法記下來。",
		mode: Mode.AUTO,
		approve: true,
		expect: "抓取點對 → 看得到 notes.md；CAPTURE=first-tool → 完全看不到",
		script: [
			{
				sideEffect: async () => {
					await appendFile(
						join(WORKSPACE, "notes.md"),
						"\n- (provider 內建工具寫的) 看起來可以合併成一行\n",
						"utf8",
					);
				},
				say: "我看一下 src/app.ts。",
				tool: { id: "t1", name: "read_file", args: { path: "src/app.ts" } },
			},
			{ say: "看完了，筆記我記在 notes.md。" },
		],
	},
];

export function scriptedProvider(script: Beat[]): StreamingProvider {
	let step = 0;

	const provider: StreamingProvider = {
		name: "fake",
		model: "scripted-evidence",

		async *stream(_request: ModelRequest, signal?: AbortSignal): AsyncIterable<StreamEvent> {
			const beat = script[Math.min(step++, script.length - 1)] as Beat;

			// ⚠️ 順序就是這一課的實驗：副作用在**任何事件之前**。
			if (beat.sideEffect) await beat.sideEffect();

			yield* say(beat.say, signal);
			if (signal?.aborted) {
				yield { type: "error", message: "Aborted by user", aborted: true };
				return;
			}

			if (!beat.tool) {
				yield {
					type: "done",
					response: { blocks: [{ type: "text", text: beat.say }], raw: null, stopReason: "end" },
				};
				return;
			}

			yield { type: "tool_call", ...beat.tool };
			yield {
				type: "done",
				response: {
					blocks: [
						{ type: "text", text: beat.say },
						{ type: "toolCall", ...beat.tool },
					],
					raw: null,
					stopReason: "tool_use",
				},
			};
		},

		async call(request: ModelRequest, signal?: AbortSignal): Promise<ModelResponse> {
			return await drain(provider.stream(request, signal));
		},
	};

	return provider;
}

async function* say(text: string, signal?: AbortSignal): AsyncIterable<StreamEvent> {
	yield { type: "text_start" };
	for (const char of text) {
		if (signal?.aborted) {
			yield { type: "text_end" };
			return;
		}
		if (DELAY_MS > 0) await new Promise((r) => setTimeout(r, DELAY_MS));
		yield { type: "text_delta", delta: char };
	}
	yield { type: "text_end" };
}
