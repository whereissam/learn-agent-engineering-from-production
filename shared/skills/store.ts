/**
 * Skill storage and progressive disclosure.
 *
 * ## Why a description has a 60-character limit
 *
 * Skills are not "stuff everything into the system prompt". That way 20 skills eat the whole
 * context. The approach splits into two layers:
 *
 *   the index: one line of name plus description per skill, **loaded every time**
 *   the body:  the full procedure, **loaded only when the model asks**
 *
 * This is called progressive disclosure. So:
 *
 *   a description is **for routing**, not for explaining.
 *
 * The model decides whether to expand a skill from that one line alone. Anything past 60 characters
 * is cut, the model never sees it, that skill is never invoked, and **you receive no error
 * message at all** — it is simply, silently unused.
 *
 * Which also explains why Hermes's authoring standard is so fierce about this.
 *
 * Source: hermes-agent/agent/skill_utils.py, agent/learn_prompt.py
 */

import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { ToolSpec } from "../providers/types.ts";
import { parseSkill, type Skill, type SkillOrigin } from "./types.ts";

export interface SkillStoreOptions {
	/** The directory of active skills. */
	dir: string;
	/** The directory of proposed, unreviewed skills. */
	proposedDir?: string;
	platform?: "macos" | "linux" | "windows";
}

export class SkillStore {
	private readonly dir: string;
	private readonly proposedDir?: string;
	private readonly platform: string;
	private skills = new Map<string, Skill>();
	private proposed = new Map<string, Skill>();

	constructor(options: SkillStoreOptions) {
		this.dir = resolve(options.dir);
		this.proposedDir = options.proposedDir ? resolve(options.proposedDir) : undefined;
		this.platform = options.platform ?? detectPlatform();
	}

	async load(): Promise<void> {
		this.skills = await loadDir(this.dir, "human");
		if (this.proposedDir) {
			this.proposed = await loadDir(this.proposedDir, "proposed");
		}
	}

	/**
		 * The index for the system prompt.
	 *
		 * **Only active skills appear.** Proposed ones do not,
		 * which is where the review gate actually executes: an unreviewed skill does not exist to the model.
	 */
	buildIndex(): string {
		const active = [...this.skills.values()].filter((s) => this.matchesPlatform(s));
		if (active.length === 0) return "";

		const lines = active.map(
			(s) => `- ${s.frontmatter.name}: ${truncate(s.frontmatter.description, 60)}`,
		);

		return (
			"## Available skills\n\n" +
			"Each line is name: what it does. Call load_skill(name) to get the full " +
			"instructions before attempting one of these tasks.\n\n" +
			lines.join("\n")
		);
	}

		/** The body, given only when the model asks. */
	loadBody(name: string): string {
		const skill = this.skills.get(name);
		if (!skill) {
			const available = [...this.skills.keys()].join(", ");
			throw new Error(`No skill named "${name}". Available: ${available || "(none)"}`);
		}
		if (!this.matchesPlatform(skill)) {
			throw new Error(`Skill "${name}" does not support the current platform (${this.platform})`);
		}
		return skill.body;
	}

	toolSpecs(): ToolSpec[] {
		if (this.skills.size === 0) return [];
		return [
			{
				name: "load_skill",
				description:
					"Load the full instructions for a skill listed in the skill index. " +
					"Do this before attempting a task the skill covers.",
				parameters: {
					type: "object",
					properties: { name: { type: "string", description: "The skill name from the index" } },
					required: ["name"],
				},
			},
		];
	}

	async handleToolCall(name: string, args: Record<string, unknown>): Promise<string> {
		if (name !== "load_skill") throw new Error(`Unknown skill tool: ${name}`);
		return this.loadBody(String(args.name ?? ""));
	}

	list(origin?: SkillOrigin): Skill[] {
		const source = origin === "proposed" ? this.proposed : this.skills;
		return [...source.values()];
	}

	get(name: string): Skill | undefined {
		return this.skills.get(name) ?? this.proposed.get(name);
	}

		/** Insert a skill directly (for demonstrations and tests). */
	add(skill: Skill): void {
		if (skill.origin === "proposed") this.proposed.set(skill.frontmatter.name, skill);
		else this.skills.set(skill.frontmatter.name, skill);
	}

	private matchesPlatform(skill: Skill): boolean {
		const platforms = skill.frontmatter.platforms;
		if (!platforms || platforms.length === 0) return true;
		return platforms.includes(this.platform as "macos");
	}

	/**
		 * How many characters the index occupies.
	 *
		 * This number is worth watching: it is a fixed cost paid on **every request**.
		 * 100 skills × 70 characters each = 7000 characters burning every turn.
	 */
	indexCost(): number {
		return this.buildIndex().length;
	}
}

async function loadDir(dir: string, origin: SkillOrigin): Promise<Map<string, Skill>> {
	const out = new Map<string, Skill>();
	let entries: string[];
	try {
		entries = await readdir(dir);
	} catch {
		return out; // a missing directory is perfectly normal
	}

	for (const entry of entries) {
		if (entry.startsWith(".")) continue;
		try {
			const raw = await readFile(join(dir, entry, "SKILL.md"), "utf8");
			const skill = parseSkill(raw, origin);
			out.set(skill.frontmatter.name, skill);
		} catch {
				// A plain <name>.md is supported too
			try {
				if (!entry.endsWith(".md")) continue;
				const raw = await readFile(join(dir, entry), "utf8");
				const skill = parseSkill(raw, origin);
				out.set(skill.frontmatter.name, skill);
			} catch {
					// Skip a broken skill file rather than failing the whole load
			}
		}
	}
	return out;
}

function truncate(text: string, max: number): string {
	return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function detectPlatform(): string {
	if (process.platform === "darwin") return "macos";
	if (process.platform === "win32") return "windows";
	return "linux";
}
