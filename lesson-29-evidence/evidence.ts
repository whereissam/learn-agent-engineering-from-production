/**
 * 三份紀錄，跟它們之間的分歧。
 *
 * 一輪 agent turn 跑完之後，「發生了什麼」有三個互相獨立的來源：
 *
 *   claim        assistant 最後那段文字            模型說的
 *   toolResults  每個工具回報了什麼                 工具說的
 *   patch        workspace 實際變了哪些檔案         檔案系統說的
 *
 * Lesson 8 的實測就是這三者分歧的極端案例：權限引擎擋下每一次嘗試
 * （toolResults 全是拒絕）、檔案一個 byte 沒動（patch 是空的），
 * 而模型跟使用者說「已經為您將 src/app.ts 重構並簡化」（claim 說做完了）。
 *
 * **判定完全是確定性的，沒有 LLM 裁判。** 這一點跟 Lesson 25 的引用檢查
 * 同一個立場：要驗證一件事，就不要拿需要被驗證的東西來驗。
 */

import type { Patch } from "./snapshot.ts";

/** 一次工具呼叫的結果，加上它「聲稱動到哪個檔案」。 */
export interface ToolRecord {
	name: string;
	/**
	 * 這次呼叫的目標檔案（相對 workspace）。
	 *
	 * `undefined` 有意義，不是缺資料：`run_command("sh -c '…'")` 這種工具
	 * **本質上說不出它會改哪些檔案**。那正是 `unreported-change` 存在的理由。
	 */
	path?: string;
	/**
	 * 這個工具會不會改東西。
	 *
	 * ⚠️ 少了這個欄位，`read_file("src/app.ts")` 會被算成「聲稱改了 app.ts」，
	 * 然後每一次唯讀的探索都會生出一條假的 `unbacked-write`。
	 * **「提到一個檔案」跟「聲稱改了一個檔案」是兩件事。**
	 */
	mutating: boolean;
	ok: boolean;
	/** 工具回給模型的第一行，只為了印表格。 */
	summary: string;
}

export interface TurnRecord {
	/** assistant 最後那段文字（沒有就是空字串）。 */
	claim: string;
	toolResults: ToolRecord[];
	patch: Patch;
}

export type FindingKind =
	/** 工具說改了 F，snapshot 說 F 沒變。 */
	| "unbacked-write"
	/** F 變了，但沒有任何工具說過它會改 F。 */
	| "unreported-change"
	/** F 變了，最後那段文字沒提到它。 */
	| "unmentioned-change"
	/** 完全沒有變更，唯一的紀錄是模型自己的話。 */
	| "no-evidence";

export interface Finding {
	kind: FindingKind;
	/** 相關檔案；`no-evidence` 沒有檔案。 */
	file?: string;
	/** 這一條為什麼成立。 */
	detail: string;
	/**
	 * 這條發現有多硬。
	 *
	 * `structural` = 三份紀錄的集合運算，沒有猜測成分。
	 * `heuristic`  = 需要在自然語言裡找檔名，會有假陰性（見 README Step 6）。
	 *
	 * ⚠️ 這個欄位不是裝飾。混在一起報會讓最硬的那條（`unbacked-write`）
	 * 看起來跟最軟的那條（`unmentioned-change`）一樣可信。
	 */
	strength: "structural" | "heuristic";
}

/**
 * 比對三份紀錄。
 *
 * 回傳的順序是刻意的：結構性的發現排在啟發式的前面。
 */
export function compare(record: TurnRecord): Finding[] {
	const findings: Finding[] = [];
	const changed = new Set(record.patch.files);
	const successfulWrites = record.toolResults.filter(
		(r) => r.ok && r.mutating && r.path !== undefined,
	);

	// ── 1. 工具說改了，檔案系統說沒變 ──────────────────────────
	//
	// 這是四個情境裡最值錢的那一個（「改完又改回去」）：
	// tool result 有兩筆成功的編輯，patch 是空的，而 **snapshot 才對** ——
	// 使用者的檔案確實沒有任何淨變化。
	for (const result of successfulWrites) {
		const file = result.path as string;
		if (!changed.has(file)) {
			findings.push({
				kind: "unbacked-write",
				file,
				detail: `${result.name} 回報成功，但 ${file} 在 snapshot 之間沒有淨變化`,
				strength: "structural",
			});
		}
	}

	// ── 2. 檔案變了，沒有工具承認 ──────────────────────────────
	//
	// 這一條抓的是「經由 run_command / 編輯器 / 背景進程改掉的檔案」。
	// 它是 patch 存在的第二個理由：不只驗證模型的話，也驗證工具的話。
	const declared = new Set(successfulWrites.map((r) => r.path as string));
	for (const file of record.patch.files) {
		if (!declared.has(file)) {
			findings.push({
				kind: "unreported-change",
				file,
				detail: `${file} 變了，但沒有工具聲稱動過它`,
				strength: "structural",
			});
		}
	}

	// ── 3. 什麼都沒變 ───────────────────────────────────────────
	//
	// 注意這裡**不去判斷那段文字是不是在說「做完了」**。
	// 判斷語意就得引入一個判斷者，而這一課的整個主張就是
	// 「不要用模型的話當證據」。所以只報事實：沒有變更，
	// 而唯一的紀錄是模型自己的話。
	if (record.patch.files.length === 0 && record.claim.trim() !== "") {
		findings.push({
			kind: "no-evidence",
			detail: "patch 是空的：這一輪對 workspace 的唯一紀錄是模型自己的敘述",
			strength: "structural",
		});
	}

	// ── 4. 變了但沒提（啟發式） ─────────────────────────────────
	for (const file of record.patch.files) {
		if (!mentions(record.claim, file)) {
			findings.push({
				kind: "unmentioned-change",
				file,
				detail: `${file} 變了，但最後那段文字沒有提到它`,
				strength: "heuristic",
			});
		}
	}

	return findings;
}

/**
 * 那段文字有沒有提到這個檔案。
 *
 * 刻意只做兩種比對：完整路徑，以及不帶目錄的檔名。
 * 「模型用別的說法指到同一個檔案」抓不到 —— 那是這條之所以是
 * `heuristic` 的原因，README Step 6 把這個限制寫出來了。
 */
export function mentions(text: string, file: string): boolean {
	if (text.includes(file)) return true;
	const base = file.split("/").pop();
	return base !== undefined && base !== "" && text.includes(base);
}

/** 有沒有任何結構性的分歧。這是這一課的唯一判定條件。 */
export function hasStructuralDivergence(findings: Finding[]): boolean {
	return findings.some((f) => f.strength === "structural");
}
