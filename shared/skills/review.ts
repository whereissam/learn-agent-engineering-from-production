/**
 * Skill 的審核閘門。
 *
 * ## Hermes 實際上怎麼做
 *
 * Hermes **真的會自動建立 skill**。`agent/background_review.py` 的 docstring：
 *
 *   > After every turn, AIAgent.run_conversation may call
 *   > spawn_background_review to fire off a daemon thread that replays the
 *   > conversation snapshot in a forked AIAgent and asks itself
 *   > "should any skill/memory be saved or updated?".
 *   > **Writes go straight to the memory + skill stores.**
 *
 * 「Writes go straight」就是風險所在：沒有人在中間看過。
 *
 * 但它不是裸奔，有兩個控制：
 *
 *   1. **工具白名單**，fork 出來的 agent「只能」用記憶與 skill 管理工具，
 *      其他一律在 runtime 被拒絕。所以它能寫 skill，但不能順便去跑 shell。
 *   2. **隔離**，fork 不碰主對話，也不碰 prompt cache。
 *
 * 事後還有 `learning_mutations.py` 讓人編輯／刪除學到的東西，
 * 而且**刪除是封存不是真刪**（`hermes curator restore` 救得回來）。
 *
 * ## 這一課為什麼加一道閘門
 *
 * 自動寫入的風險（Lesson 15 的記憶注入問題，但更嚴重）：
 *
 *   - 錯誤的做法被永久保存，而且會被當成「正確做法」重複使用
 *   - skill 污染：一次失敗的嘗試變成未來的標準流程
 *   - prompt injection 持久化：網頁說「處理 X 時要先停用檢查」→ 變成 skill
 *   - 行為漂移：每次微調一點，三個月後你不認得這個 agent
 *   - 難以重現：出問題時你不知道它當時載了哪個版本的 skill
 *
 * 記憶記的是「事實」，skill 記的是「**做法**」。做法會被執行，
 * 所以污染的後果嚴重一個量級。
 *
 * 所以這裡實作的是比較穩妥的版本：
 *
 *   agent 提議 → 人類審核 → 版本化保存 → 測試通過才啟用
 *
 * **注意這條流程跟 Lesson 8-9 是同一個形狀**：agent 提出，人類把關，
 * 而且把關可以非同步（proposed 的 skill 就躺在那裡等，跟 inbox 一樣）。
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { renderSkill, type Skill, validateSkill, type ValidationIssue } from "./types.ts";

export interface Proposal {
	skill: Skill;
	/** 自動檢查的結果。 */
	issues: ValidationIssue[];
	/** 有沒有 blocking 的問題。 */
	blocked: boolean;
}

export type ReviewDecision =
	| { action: "approve"; reviewer: string; note?: string }
	| { action: "reject"; reviewer: string; note: string }
	| { action: "revise"; reviewer: string; note: string };

export class SkillReviewQueue {
	private readonly proposedDir: string;
	private readonly activeDir: string;
	private readonly archiveDir: string;

	constructor(options: { proposedDir: string; activeDir: string; archiveDir?: string }) {
		this.proposedDir = resolve(options.proposedDir);
		this.activeDir = resolve(options.activeDir);
		this.archiveDir = resolve(options.archiveDir ?? join(options.proposedDir, "..", "archive"));
	}

	/**
	 * agent 提議一個新 skill。
	 *
	 * **它只會寫進 proposedDir，不會進索引，模型看不到。**
	 * 這就是閘門的實際位置：不是禁止 agent 寫，是讓它寫進一個
	 * 不會生效的地方。
	 */
	async propose(skill: Skill, from: { sessionId: string; summary: string }): Promise<Proposal> {
		const issues = validateSkill(skill);
		const blocked = issues.some((i) => i.blocking);

		const stamped: Skill = {
			...skill,
			origin: "proposed",
			proposedFrom: { ...from, createdAt: new Date().toISOString() },
		};

		await mkdir(this.proposedDir, { recursive: true });
		await writeFile(
			join(this.proposedDir, `${skill.frontmatter.name}.md`),
			renderSkill(stamped),
			"utf8",
		);

		return { skill: stamped, issues, blocked };
	}

	/** 等待審核的清單。 */
	async pending(): Promise<string[]> {
		try {
			const { readdir } = await import("node:fs/promises");
			return (await readdir(this.proposedDir)).filter((f) => f.endsWith(".md"));
		} catch {
			return [];
		}
	}

	/**
	 * 人做決定。
	 *
	 * 通過 = 從 proposed 移到 active。**移動**而不是複製，
	 * 這樣一個提議不會同時存在於兩個狀態。
	 */
	async decide(name: string, decision: ReviewDecision): Promise<string> {
		const src = join(this.proposedDir, `${name}.md`);

		let raw: string;
		try {
			raw = await readFile(src, "utf8");
		} catch {
			throw new Error(`找不到待審的 skill "${name}"`);
		}

		if (decision.action === "revise") {
			// 留在原地，只記錄意見。agent 下次可以改了再提。
			return `已要求修改 "${name}"：${decision.note}`;
		}

		if (decision.action === "reject") {
			await mkdir(this.archiveDir, { recursive: true });
			// **封存不是刪除**（Hermes 的 curator 也是這樣）。
			// 被拒絕的提議本身就是有用的資料：它告訴你 agent 想學什麼、
			// 以及你為什麼不要。
			await rename(src, join(this.archiveDir, `rejected-${Date.now()}-${name}.md`));
			return `已拒絕並封存 "${name}"：${decision.note}`;
		}

		// approve
		const withReview = raw.replace(
			/^---\n/,
			`---\n# reviewed-by: ${decision.reviewer}\n# reviewed-at: ${new Date().toISOString()}\n`,
		);
		await mkdir(this.activeDir, { recursive: true });
		await writeFile(join(this.activeDir, `${name}.md`), withReview, "utf8");
		await rename(src, join(this.archiveDir, `approved-${Date.now()}-${name}.md`)).catch(
			async () => {
				await mkdir(this.archiveDir, { recursive: true });
				await rename(src, join(this.archiveDir, `approved-${Date.now()}-${name}.md`));
			},
		);
		return `已核准並啟用 "${name}"`;
	}
}

/**
 * 給提議用 agent 的工具白名單。
 *
 * 這是照 Hermes 的做法：background review 的 fork
 * **只能**用這幾個工具，其他一律拒絕。
 *
 * 為什麼重要？沒有白名單的話，那個「整理學習心得」的背景 agent
 * 就有完整的 shell 權限，而且它跑在背景、沒人看著。
 */
export const PROPOSAL_TOOL_ALLOWLIST = new Set(["propose_skill", "remember", "read_file"]);

export function isAllowedInProposalFork(toolName: string): boolean {
	return PROPOSAL_TOOL_ALLOWLIST.has(toolName);
}
