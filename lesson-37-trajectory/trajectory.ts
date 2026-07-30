/**
 * Trajectory：append-only 的事件流，加上**算得出來的**查詢。
 *
 * 這個檔案是這一課的主張所在。它只有兩百行，但每一個函式都在示範
 * 同一件事：**換了資料結構之後，原本要靠讀字才能回答的問題變成集合運算。**
 *
 *   conflicts()     agent 宣稱成功，環境說失敗   → 對得起來
 *   failureKinds()  三種失敗分得開                → 分得開
 *   batches()       哪些動作是同一次回應發的      → 數得出來
 *   view()          LLM 看得到的那一份            → 算得出來，而不是改寫出來
 *
 * 最後一個順帶解掉 Lesson 5 的一個缺陷：壓縮完之後看不出壓縮過。
 *
 * > **trajectory 是事實的完整紀錄，view 是給模型看的投影。**
 * > 兩者分開之後，壓縮就不再是一次破壞性的改寫。
 */

import type { ActionEvent, TrajectoryEvent } from "./events.ts";

export class Trajectory {
	private readonly events: TrajectoryEvent[] = [];

	/** append-only。**沒有 update、沒有 delete，這是刻意的。** */
	add(event: TrajectoryEvent): void {
		this.events.push(event);
	}

	all(): readonly TrajectoryEvent[] {
		return this.events;
	}

	/**
	 * LLM 看得到的那一份：套用所有 condensation 之後的投影。
	 *
	 * 對照 `condensation-event.ts:12-14` 的註解
	 * （`removed from the View given to the LLM`）。
	 */
	view(): TrajectoryEvent[] {
		const forgotten = new Set<string>();
		for (const event of this.events) {
			if (event.kind === "condensation") {
				for (const id of event.forgottenIds) forgotten.add(id);
			}
		}
		return this.events.filter((event) => !forgotten.has(event.id));
	}

	/**
	 * **把 trajectory 攤平成聊天記錄** —— 也就是 Lesson 1-28 的形狀。
	 *
	 * 這個函式存在的唯一目的是**示範它會丟掉什麼**：
	 * 三種失敗全部變成一段字串、source 消失、llmResponseId 消失。
	 * `demo.ts` 用它跟 trajectory 做對照。
	 */
	toChatHistory(): { role: "user" | "assistant" | "toolResult"; content: string }[] {
		const out: { role: "user" | "assistant" | "toolResult"; content: string }[] = [];
		for (const event of this.view()) {
			switch (event.kind) {
				case "message":
					out.push({ role: event.source === "user" ? "user" : "assistant", content: event.text });
					break;
				case "action":
					out.push({
						role: "assistant",
						content: `${event.thought}\n[tool ${event.toolName} ${JSON.stringify(event.args)}]`,
					});
					break;
				case "observation":
					out.push({ role: "toolResult", content: event.content });
					break;
				// ⚠️ 這兩行就是資訊遺失發生的地方：三種不同性質的失敗
				// 被壓成同一種東西（一段字串），而且看不出是誰說的。
				case "user-reject":
					out.push({ role: "toolResult", content: `Error: ${event.rejectionReason}` });
					break;
				case "agent-error":
					out.push({ role: "toolResult", content: `Error: ${event.error}` });
					break;
				case "condensation":
					out.push({ role: "assistant", content: event.summary });
					break;
			}
		}
		return out;
	}

	// ───────────────────────────────────────────────────────────
	// 查詢
	// ───────────────────────────────────────────────────────────

	/**
	 * agent 宣稱成功，但環境說失敗。
	 *
	 * **這是這一課的核心查詢**，而它之所以寫得出來，只因為
	 * observation 的 `exitCode` 是一個欄位、`source` 是釘死的。
	 * 在聊天記錄上，同一個問題是一個自然語言理解問題（見 `demo.ts`）。
	 */
	conflicts(): { action: ActionEvent; exitCode: number; claim: string }[] {
		const out: { action: ActionEvent; exitCode: number; claim: string }[] = [];

		for (const event of this.events) {
			if (event.kind !== "observation") continue;
			if (event.exitCode === undefined || event.exitCode === 0) continue;

			const action = this.events.find(
				(candidate): candidate is ActionEvent =>
					candidate.kind === "action" && candidate.id === event.actionId,
			);
			if (!action) continue;

			// 這個動作之後，agent 有沒有說過話。
			const index = this.events.indexOf(event);
			const claim = this.events
				.slice(index + 1)
				.find((later) => later.kind === "message" && later.source === "agent");

			if (claim && claim.kind === "message") {
				out.push({ action, exitCode: event.exitCode, claim: claim.text });
			}
		}
		return out;
	}

	/** 三種失敗各自幾次。 */
	failureKinds(): { environment: number; rejected: number; scaffold: number } {
		let environment = 0;
		let rejected = 0;
		let scaffold = 0;
		for (const event of this.events) {
			if (event.kind === "observation" && event.exitCode !== undefined && event.exitCode !== 0) {
				environment++;
			}
			if (event.kind === "user-reject") rejected++;
			if (event.kind === "agent-error") scaffold++;
		}
		return { environment, rejected, scaffold };
	}

	/** 依 llmResponseId 分組的動作。一組 = 一次 LLM 回應。 */
	batches(): Map<string, ActionEvent[]> {
		const out = new Map<string, ActionEvent[]>();
		for (const event of this.events) {
			if (event.kind !== "action") continue;
			const group = out.get(event.llmResponseId) ?? [];
			group.push(event);
			out.set(event.llmResponseId, group);
		}
		return out;
	}

	/** 有沒有哪一個動作沒有對應的 observation（Lesson 3 的硬規則）。 */
	danglingActions(): ActionEvent[] {
		const answered = new Set<string>();
		for (const event of this.events) {
			if (event.kind === "observation" || event.kind === "user-reject") {
				answered.add(event.actionId);
			}
			if (event.kind === "agent-error") answered.add(event.toolCallId);
		}
		return this.events.filter(
			(event): event is ActionEvent => event.kind === "action" && !answered.has(event.id),
		);
	}

	/** JSONL：跟 Lesson 4 的 session 存檔同一個形狀，只是內容換了。 */
	toJSONL(): string {
		return this.events.map((event) => JSON.stringify(event)).join("\n");
	}

	static fromJSONL(text: string): Trajectory {
		const trajectory = new Trajectory();
		for (const line of text.split("\n")) {
			if (line.trim() === "") continue;
			trajectory.add(JSON.parse(line) as TrajectoryEvent);
		}
		return trajectory;
	}
}

// ─────────────────────────────────────────────────────────────
// 在聊天記錄上回答同一個問題（示範它為什麼不行）
// ─────────────────────────────────────────────────────────────

/**
 * 從聊天記錄找「宣稱成功但其實失敗」。
 *
 * 只能做字串比對，因為那個資料結構裡**沒有 exit code 這個概念** ——
 * 它被格式化進一段給人看的文字裡了。
 *
 * 這不是一個寫得比較差的實作，**這是那個資料結構能支援的上限。**
 */
export function conflictsFromChat(
	history: { role: string; content: string }[],
	failureMarkers = ["exit code 1", "FAIL", "error:"],
	successMarkers = ["都過", "通過", "all pass", "passing", "成功"],
): { failureSeen: boolean; claimSeen: boolean; confident: boolean } {
	const failureSeen = history.some(
		(message) =>
			message.role === "toolResult" &&
			failureMarkers.some((marker) => message.content.toLowerCase().includes(marker.toLowerCase())),
	);
	const claimSeen = history.some(
		(message) =>
			message.role === "assistant" &&
			successMarkers.some((marker) => message.content.toLowerCase().includes(marker.toLowerCase())),
	);
	return {
		failureSeen,
		claimSeen,
		// 永遠不 confident：兩邊都靠關鍵字猜，而關鍵字表是我編的。
		confident: false,
	};
}
