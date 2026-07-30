/**
 * The skill review gate.
 *
 * ## What Hermes actually does
 *
 * Hermes **really does create skills automatically**. From `agent/background_review.py`'s docstring:
 *
 *   > After every turn, AIAgent.run_conversation may call
 *   > spawn_background_review to fire off a daemon thread that replays the
 *   > conversation snapshot in a forked AIAgent and asks itself
 *   > "should any skill/memory be saved or updated?".
 *   > **Writes go straight to the memory + skill stores.**
 *
 * "Writes go straight" is where the risk lies: nobody looked in between.
 *
 * But it is not unguarded; there are two controls:
 *
 *   1. **a tool allowlist**: the forked agent may use *only* memory and skill management tools,
 *      and everything else is refused at runtime. So it can write a skill and cannot also run a shell.
 *   2. **isolation**: the fork touches neither the main conversation nor the prompt cache.
 *
 * Afterwards, `learning_mutations.py` lets a human edit or delete what was learned,
 * and **deletion is archival rather than real deletion** (`hermes curator restore` brings it back).
 *
 * ## Why this lesson adds a gate
 *
 * The risks of automatic writes (Lesson 15's memory injection problem, but worse):
 *
 *   - a wrong approach preserved permanently and reused as "the right approach"
 *   - skill contamination: one failed attempt becomes a future standard procedure
 *   - persistent prompt injection: a web page saying "disable the check first when handling X" → becomes a skill
 *   - behaviour drift: a small adjustment each time, and in three months you do not recognise this agent
 *   - hard to reproduce: when something breaks you do not know which version of the skill it loaded
 *
 * Memory records **facts** and a skill records a **procedure**. A procedure gets executed,
 * so contamination is an order of magnitude worse.
 *
 * So what is implemented here is the safer version:
 *
 *   the agent proposes → a human reviews → it is versioned → it activates only after tests pass
 *
 * **Note this flow has the same shape as Lessons 8-9**: the agent proposes, a human gates,
 * and the gate can be asynchronous (a proposed skill simply waits, like the inbox).
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { renderSkill, type Skill, validateSkill, type ValidationIssue } from "./types.ts";

export interface Proposal {
	skill: Skill;
	/** The automated checks' results. */
	issues: ValidationIssue[];
	/** Whether any blocking problem was found. */
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
		 * The agent proposes a new skill.
	 *
		 * **It only writes into proposedDir, never into the index, and the model cannot see it.**
		 * That is where the gate actually sits: not forbidding the agent to write, but making it write
		 * somewhere that has no effect.
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

		/** The list awaiting review. */
	async pending(): Promise<string[]> {
		try {
			const { readdir } = await import("node:fs/promises");
			return (await readdir(this.proposedDir)).filter((f) => f.endsWith(".md"));
		} catch {
			return [];
		}
	}

	/**
		 * A human decides.
	 *
		 * Approved = moved from proposed to active. **Moved** rather than copied,
		 * so one proposal never exists in two states at once.
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
				// Left in place with the comment recorded. The agent can revise and propose again.
			return `已要求修改 "${name}"：${decision.note}`;
		}

		if (decision.action === "reject") {
			await mkdir(this.archiveDir, { recursive: true });
				// **Archived, not deleted** (Hermes's curator does the same).
				// A rejected proposal is useful data in itself: it tells you what the agent wanted to learn,
				// and why you did not want it.
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
 * The tool allowlist for the proposing agent.
 *
 * This follows Hermes: the background review's fork
 * may use **only** these tools, and everything else is refused.
 *
 * Why it matters: without an allowlist, that "tidy up what was learned" background agent
 * has full shell access, and it runs in the background with nobody watching.
 */
export const PROPOSAL_TOOL_ALLOWLIST = new Set(["propose_skill", "remember", "read_file"]);

export function isAllowedInProposalFork(toolName: string): boolean {
	return PROPOSAL_TOOL_ALLOWLIST.has(toolName);
}
