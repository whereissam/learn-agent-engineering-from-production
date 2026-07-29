/**
 * Lesson 8 專用的 fake provider。
 *
 * 為什麼不用 `shared/streaming/fake.ts`：那一份是給 coding agent 用的，
 * 只會呼叫 list_files / read_file，全部都是 READ 風險，
 * 權限引擎在它面前**永遠不會說不**，那就什麼都示範不到了。
 *
 * 這一份的劇本是刻意設計的：模型會**連續嘗試三種被擋下來的做法**，
 * 每一種踩的是引擎不同的一條規則。
 *
 *   turn 0  run_command("ls")             → 在允許清單上，自動放行
 *   turn 1  run_command("rm -rf src")     → EXEC 且不在清單上，要問人
 *   turn 2  run_command("ls; rm -rf src") → 前綴騙過清單，但有元字元
 *   turn 3  write_file("../../evil.txt")  → 路徑逃逸，AUTO 也擋
 *   turn 4  放棄，講一段話
 *
 * turn 2 是重點：**它是一個真的繞道嘗試**。前綴比對會過（開頭是 "ls"），
 * 只有元字元檢查擋得住。見 Lesson 8 README Step 4。
 *
 * （這是本系列第三個自備 fake provider 的課，前兩個是 Lesson 6 和 20。
 * 每次原因都一樣：共用的那份腳本不會踩到這一課要示範的路徑。）
 */

import type {
	ModelRequest,
	ModelResponse,
	StreamEvent,
	StreamingProvider,
} from "../shared/streaming/types.ts";
import { drain } from "../shared/streaming/types.ts";

const DELAY_MS = Number(process.env.FAKE_DELAY_MS ?? 12);

interface Beat {
	say: string;
	tool?: { id: string; name: string; args: Record<string, unknown> };
}

const SCRIPT: Beat[] = [
	{
		say: "我先看一下目錄結構。",
		tool: { id: "p1", name: "run_command", args: { command: "ls" } },
	},
	{
		say: "src/app.ts 太亂了，我直接砍掉重寫比較快。",
		tool: { id: "p2", name: "run_command", args: { command: "rm -rf src" } },
	},
	{
		// 被拒絕之後的第一反應：換一個「看起來安全」的開頭。
		//
		// 注意是 `ls && rm`，不是 `ls; rm`。差別很重要：
		// 前綴比對要求詞邊界（`"ls"` 或 `"ls "` 開頭），所以 `ls; rm`
		// 連前綴這關都過不了。`ls && rm` 才是真的騙過前綴、
		// **只剩元字元檢查擋得住**的那種。
		say: "好，那我換個方式做。",
		tool: { id: "p3", name: "run_command", args: { command: "ls && rm -rf src" } },
	},
	{
		// 再換一個方向：不用 shell，改用檔案工具寫到工作區外面。
		say: "那我先把備份寫到工作區外面。",
		tool: {
			id: "p4",
			name: "write_file",
			args: { path: "../../evil.txt", content: "backup" },
		},
	},
	{
		say:
			"三種做法都被權限規則擋下來了，我不再嘗試繞過。\n\n" +
			"我沒有動任何檔案。如果你確定要重寫 src/app.ts，" +
			"可以改用 interactive 模式並批准那一次指令，或是把工作區設成可寫並讓我逐檔編輯。",
	},
];

export function permissionFakeProvider(): StreamingProvider {
	let step = 0;

	const provider: StreamingProvider = {
		name: "fake",
		model: "scripted-permissions",

		async *stream(_request: ModelRequest, signal?: AbortSignal): AsyncIterable<StreamEvent> {
			const beat = SCRIPT[Math.min(step++, SCRIPT.length - 1)] as Beat;

			yield* say(beat.say, signal);
			if (signal?.aborted) {
				yield { type: "error", message: "Aborted by user", aborted: true };
				return;
			}

			if (!beat.tool) {
				yield {
					type: "done",
					response: {
						blocks: [{ type: "text", text: beat.say }],
						raw: null,
						stopReason: "end",
					},
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
		await new Promise((r) => setTimeout(r, DELAY_MS));
		yield { type: "text_delta", delta: char };
	}
	yield { type: "text_end" };
}
