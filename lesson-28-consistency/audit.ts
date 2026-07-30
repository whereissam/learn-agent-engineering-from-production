/**
 * 稽核：把一份**已經存下來的** session 讀進來，問它有沒有說謊。
 *
 * 為什麼稽核的對象是存檔而不是記憶體裡的物件：中斷的重點就是
 * 「進程沒了之後，留下來的東西還能不能相信」。記憶體裡的狀態下一秒就消失，
 * 存檔會活到你下次 `--resume`。
 *
 * 五條規則，每一條都對應一種**不會丟例外**的壞掉方式（設計原則 7）。
 * 這一課的整個判定就是這五條，沒有 LLM 裁判。
 */

import { isInFlight, type AssistantMessage, type Part } from "./parts.ts";

export type ViolationKind =
	/** 存檔裡還有 pending / running 的東西。 */
	| "in-flight-in-storage"
	/** 有開始時間、沒有結束時間。 */
	| "unfinished-span"
	/** 訊息自己沒有結束時間 → session 永遠是 busy。 */
	| "message-never-completed"
	/** 終局狀態，但沒有任何結果內容。 */
	| "terminal-without-result"
	/** 檔案系統說變了，session 說沒有。 */
	| "unrecorded-patch";

export interface Violation {
	kind: ViolationKind;
	where: string;
	detail: string;
}

export interface AuditInput {
	message: AssistantMessage;
	/**
	 * 外面的世界說哪些檔案變了。
	 *
	 * 刻意是參數而不是在這裡算：這一課的主題是「紀錄一致不一致」，
	 * 「怎麼知道檔案真的變了」是 [Lesson 29](../lesson-29-evidence/) 的題目。
	 * 那一課的 `snapshot.patch()` 就是這個參數的真實版本。
	 */
	changedFiles?: string[];
}

export function audit({ message, changedFiles }: AuditInput): Violation[] {
	const out: Violation[] = [];

	for (const part of message.parts) {
		// ── 1. 存檔裡不該有「正在進行」的東西 ──────────────────
		//
		// 這是最重要的一條。一個 pending 的工具在畫面上會長成一個
		// 轉圈圈的 spinner，而那個 spinner 會轉到宇宙盡頭 ——
		// 因為要負責把它變成 completed 的那個進程已經不在了。
		if (part.type === "tool" && (part.state.status === "pending" || part.state.status === "running")) {
			out.push({
				kind: "in-flight-in-storage",
				where: `${part.type}:${part.id}`,
				detail: `工具 ${part.name} 存檔時是 ${part.state.status}，沒有人會再把它推進下一個狀態`,
			});
		}

		// ── 2. 有開始沒有結束 ────────────────────────────────
		if (isInFlight(part) && part.type !== "tool") {
			out.push({
				kind: "unfinished-span",
				where: `${part.type}:${part.id}`,
				detail: `${part.type} 有 created 沒有 completed，下游算不出它花了多久`,
			});
		}
		if (part.type === "tool" && part.time.ran !== undefined && part.time.completed === undefined) {
			out.push({
				kind: "unfinished-span",
				where: `tool:${part.id}`,
				detail: `工具開始執行了（ran）但沒有 completed`,
			});
		}

		// ── 3. 終局狀態卻沒有結果 ────────────────────────────
		//
		// 這一條擋的是「把狀態改成 error 就當作處理完了」。
		// 沒有內容的 error 對下游（和使用者）等於沒有訊息。
		if (part.type === "tool") {
			if (part.state.status === "completed" && part.state.output.trim() === "") {
				out.push({
					kind: "terminal-without-result",
					where: `tool:${part.id}`,
					detail: `completed 但 output 是空的`,
				});
			}
			if (part.state.status === "error" && part.state.error.trim() === "") {
				out.push({
					kind: "terminal-without-result",
					where: `tool:${part.id}`,
					detail: `error 但沒有錯誤訊息`,
				});
			}
		}
	}

	// ── 4. 訊息本身沒有結束 ────────────────────────────────
	if (message.time.completed === undefined) {
		out.push({
			kind: "message-never-completed",
			where: `message:${message.id}`,
			detail: "訊息沒有 completed 時間：載回來之後這個 session 會被當成還在跑",
		});
	}

	// ── 5. 檔案變了但沒記 ──────────────────────────────────
	if (changedFiles !== undefined && changedFiles.length > 0) {
		const recorded = new Set(message.snapshot?.files ?? []);
		for (const file of changedFiles) {
			if (!recorded.has(file)) {
				out.push({
					kind: "unrecorded-patch",
					where: `file:${file}`,
					detail: `${file} 真的變了，但這一輪的紀錄裡沒有它`,
				});
			}
		}
	}

	return out;
}

/** 印表格用。 */
export function summarise(violations: Violation[]): string {
	if (violations.length === 0) return "—";
	const counts = new Map<ViolationKind, number>();
	for (const violation of violations) {
		counts.set(violation.kind, (counts.get(violation.kind) ?? 0) + 1);
	}
	return [...counts.entries()].map(([kind, n]) => (n > 1 ? `${kind}×${n}` : kind)).join(", ");
}
