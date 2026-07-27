/**
 * Skill 儲存與 progressive disclosure。
 *
 * ## 為什麼 description 有 60 字元上限
 *
 * skill 不是「全部塞進 system prompt」。那樣的話 20 個 skill 就把
 * context 吃光了。做法是拆兩層：
 *
 *   索引（index）：每個 skill 一行 name + description，**每次都載入**
 *   本文（body）：完整的操作步驟，**模型要求時才載入**
 *
 * 這叫 progressive disclosure。所以：
 *
 *   description 是「路由用的」，不是「說明用的」。
 *
 * 模型只憑那一行決定要不要展開這個 skill。超過 60 字被截掉的部分，
 * 模型永遠看不到，那個 skill 就永遠不會被叫用，而且**你不會收到
 * 任何錯誤訊息**，它只是安靜地不被使用。
 *
 * 這也解釋了為什麼 Hermes 的 authoring standard 對這條這麼兇。
 *
 * 對照：hermes-agent/agent/skill_utils.py、agent/learn_prompt.py
 */

import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { ToolSpec } from "../providers/types.ts";
import { parseSkill, type Skill, type SkillOrigin } from "./types.ts";

export interface SkillStoreOptions {
	/** 已啟用的 skill 目錄。 */
	dir: string;
	/** 提議中、還沒審核的 skill 目錄。 */
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
	 * 給 system prompt 的索引。
	 *
	 * **只有已啟用的 skill 會出現。** proposed 的不會，
	 * 這就是審核閘門的實際執行點：沒過審的 skill 對模型不存在。
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

	/** 模型要求時才給本文。 */
	loadBody(name: string): string {
		const skill = this.skills.get(name);
		if (!skill) {
			const available = [...this.skills.keys()].join(", ");
			throw new Error(`沒有名為 "${name}" 的 skill。可用的：${available || "(無)"}`);
		}
		if (!this.matchesPlatform(skill)) {
			throw new Error(`skill "${name}" 不支援目前平台（${this.platform}）`);
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

	/** 直接放一個 skill 進來（示範與測試用）。 */
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
	 * 索引佔多少字元。
	 *
	 * 這個數字值得盯著：它是**每一次請求**都要付的固定成本。
	 * 100 個 skill × 每個 70 字元 = 7000 字元，每一輪都在燒。
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
		return out; // 目錄不存在很正常
	}

	for (const entry of entries) {
		if (entry.startsWith(".")) continue;
		try {
			const raw = await readFile(join(dir, entry, "SKILL.md"), "utf8");
			const skill = parseSkill(raw, origin);
			out.set(skill.frontmatter.name, skill);
		} catch {
			// 也支援直接放 <name>.md
			try {
				if (!entry.endsWith(".md")) continue;
				const raw = await readFile(join(dir, entry), "utf8");
				const skill = parseSkill(raw, origin);
				out.set(skill.frontmatter.name, skill);
			} catch {
				// 壞掉的 skill 檔跳過，不要讓整包載不進來
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
