/**
 * 假的 provider ， 不需要任何 API key。
 *
 * 它照一份寫死的腳本回應，讓你在還沒申請 key 之前就能跑起來、
 * 用 debugger 一步步走過整個 loop。
 *
 * 這不只是玩具：真實的 agent 專案都需要一個這樣的東西來寫測試，
 * 否則每跑一次測試就要付錢、而且結果不可重現。
 * 對照 Pi：packages/ai/src/providers/faux.ts
 *
 * 用法：PROVIDER=fake bun run lesson-01-agent-loop/agent.ts
 *
 * 腳本會依照「有哪些工具可用」自動切換：
 *   只有 read_file          → Lesson 1 的腳本
 *   有 write_file/edit_file → Lesson 2 的腳本（會觸發批准流程）
 */

import type { AssistantBlock, ModelRequest, ModelResponse, Provider } from "./types.ts";

export function fakeProvider(): Provider {
	// 第幾次被呼叫。腳本靠這個往下走。
	let step = 0;

	return {
		name: "fake",
		model: "scripted",

		async call(request: ModelRequest): Promise<ModelResponse> {
			const turn = step++;
			const toolNames = new Set(request.tools.map((t) => t.name));

			const script = toolNames.has("edit_file") ? lesson2Script : lesson1Script;
			return script(turn, request);
		},
	};
}

// ─────────────────────────────────────────────────────────────
// Lesson 1：只有 read_file
// ─────────────────────────────────────────────────────────────

function lesson1Script(turn: number, request: ModelRequest): ModelResponse {
	// 第 1 次：先看 README
	if (turn === 0) {
		return toolCalls([{ id: "call_1", name: "read_file", args: { path: "README.md" } }]);
	}

	// 第 2 次：一次讀兩個檔案。
	// 這示範「平行工具呼叫」， 一則 assistant 訊息裡有多個 tool call，
	// loop 必須全部執行完再一起回傳。
	if (turn === 1) {
		return toolCalls([
			{ id: "call_2", name: "read_file", args: { path: "src/store.ts" } },
			{ id: "call_3", name: "read_file", args: { path: "src/config.ts" } },
		]);
	}

	// 第 3 次：故意讀一個不存在的檔案，讓你看到錯誤怎麼回到模型手上。
	if (turn === 2) {
		return toolCalls([
			{ id: "call_4", name: "read_file", args: { path: "src/does-not-exist.ts" } },
		]);
	}

	// 第 4 次：講出結論，沒有 tool call → loop 結束。
	const readCount = request.messages.filter((m) => m.role === "toolResult").length;
	return text(
		`[fake provider] 我跑完了 ${readCount} 輪工具呼叫。\n\n` +
			`真正的模型會在這裡給出答案。想看真的推理，設一把 API key 再跑一次。`,
	);
}

// ─────────────────────────────────────────────────────────────
// Lesson 2：完整工具組，會走到批准流程
//
// 腳本刻意設計成「修掉大小寫 bug」的完整流程：
//   探索 → 讀檔 → 跑測試（失敗）→ 改檔（要批准）→ 再跑測試（通過）
// ─────────────────────────────────────────────────────────────

function lesson2Script(turn: number, _request: ModelRequest): ModelResponse {
	switch (turn) {
		case 0:
			return toolCalls([{ id: "c1", name: "list_files", args: {} }]);

		case 1:
			// 平行讀三個檔案
			return toolCalls([
				{ id: "c2", name: "read_file", args: { path: "src/store.ts" } },
				{ id: "c3", name: "read_file", args: { path: "src/config.ts" } },
			]);

		case 2:
			// 跑測試看現況 ， 第一次觸發批准（run_command 是 mutating）
			return toolCalls([{ id: "c4", name: "run_command", args: { command: "bun test" } }]);

		case 3:
			// 動手改 ， 第二次觸發批准（edit_file 是 mutating）
			return toolCalls([
				{
					id: "c5",
					name: "edit_file",
					args: {
						path: "src/store.ts",
						old_string: "\tentries.set(code, url);",
						new_string: "\tentries.set(code.toLowerCase(), url);",
					},
				},
			]);

		case 4:
			// 驗證修好了
			return toolCalls([{ id: "c6", name: "run_command", args: { command: "bun test" } }]);

		default:
			return text(
				"[fake provider] 腳本跑完了。\n\n" +
					"剛剛你看到的流程是：探索 → 讀檔 → 跑測試 → 改檔 → 再跑測試驗證。\n" +
					"其中 run_command 和 edit_file 都需要你批准，read_file 和 list_files 不用。\n\n" +
					"想看真的推理，設一把 API key 再跑一次。",
			);
	}
}

// ─────────────────────────────────────────────────────────────

function toolCalls(
	calls: Array<{ id: string; name: string; args: Record<string, unknown> }>,
): ModelResponse {
	return {
		blocks: calls.map((call) => ({ type: "toolCall" as const, ...call })),
		raw: null,
		stopReason: "tool_use",
	};
}

function text(body: string): ModelResponse {
	const blocks: AssistantBlock[] = [{ type: "text", text: body }];
	return { blocks, raw: null, stopReason: "end" };
}
