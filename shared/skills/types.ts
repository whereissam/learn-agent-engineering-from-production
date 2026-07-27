/**
 * Skill 的格式。
 *
 * 記憶（Lesson 15）記的是「事實」，skill 記的是「怎麼做」。
 *
 * 一個 skill 就是一個 Markdown 檔（Hermes 叫 SKILL.md），前面帶 YAML frontmatter：
 *
 *   ---
 *   name: arxiv-search
 *   description: Search arXiv papers by keyword, author, or ID.
 *   version: 0.1.0
 *   ---
 *
 *   # ArXiv Search
 *   ## When to Use
 *   ...
 *
 * 為什麼是檔案而不是資料庫？跟 Lesson 15 的 MEMORY.md 一樣：
 * 你看得懂、能 diff、能進版控、agent 自己也能讀寫。
 *
 * 對照：hermes-agent/agent/skill_utils.py
 */

/**
 * Skill 的中繼資料。
 *
 * `description` 的 60 字元上限**不是美觀問題**，是架構問題。
 * 見 store.ts 的 progressive disclosure 說明。
 */
export interface SkillFrontmatter {
	/** 小寫連字號，當作 id。 */
	name: string;
	/**
	 * 一句話。**上限 60 字元。**
	 *
	 * Hermes 的 authoring standard 對這條特別嚴格，原文：
	 *   > This is the most-violated rule and it is NOT cosmetic: the
	 *   > system-prompt skill index truncates the description to 60 chars and
	 *   > loads it every session, so anything past char 60 is silently cut
	 *   > and never routes.
	 *
	 * 也就是：超過 60 字的部分會被靜靜切掉，而且**模型永遠不會知道
	 * 這個 skill 能做什麼**，於是它永遠不會被叫用。
	 */
	description: string;
	version: string;
	/**
	 * 作者。
	 *
	 * Hermes 規定這裡**永遠是固定值**，不准從環境變數、git config
	 * 或登入帳號填。理由是 skill 會被分享出去，從環境推導出來的名字
	 * 是使用者沒同意過的隱私外洩。
	 */
	author: string;
	/** 限定平台。省略代表跨平台。 */
	platforms?: Array<"macos" | "linux" | "windows">;
	tags?: string[];
}

/** 這個 skill 是誰造的。**這個欄位是 Lesson 16 的核心。** */
export type SkillOrigin =
	/** 人寫的，預設信任。 */
	| "human"
	/** agent 提議、還沒被審核。**不會載入。** */
	| "proposed"
	/** agent 提議、人審過了。 */
	| "approved";

export interface Skill {
	frontmatter: SkillFrontmatter;
	/** frontmatter 底下的 Markdown 本文。 */
	body: string;
	origin: SkillOrigin;
	/** 提議的來源，用來追溯。 */
	proposedFrom?: {
		sessionId: string;
		/** 這個 skill 是從什麼樣的對話萃取出來的。 */
		summary: string;
		createdAt: string;
	};
	/** 審核紀錄。 */
	review?: {
		decidedBy: string;
		decidedAt: string;
		note?: string;
	};
}

/** 解析 SKILL.md。 */
export function parseSkill(raw: string, origin: SkillOrigin = "human"): Skill {
	const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
	if (!match?.[1]) {
		throw new Error("SKILL.md 必須以 YAML frontmatter 開頭（--- 包起來）");
	}

	const [, front, body = ""] = match;
	const fm: Record<string, unknown> = {};

	// 極簡 YAML：只支援 key: value 跟 key: [a, b]。
	// 真實系統請用 yaml 套件，這裡是為了不引相依。
	for (const line of front.split("\n")) {
		const kv = line.match(/^([a-z_.]+):\s*(.*)$/i);
		if (!kv?.[1]) continue;
		const [, key, value = ""] = kv;
		const trimmed = value.trim().replace(/^["']|["']$/g, "");
		fm[key] = trimmed.startsWith("[")
			? trimmed
					.slice(1, -1)
					.split(",")
					.map((s) => s.trim())
					.filter(Boolean)
			: trimmed;
	}

	if (!fm.name || !fm.description) {
		throw new Error("skill frontmatter 缺少 name 或 description");
	}

	return {
		frontmatter: {
			name: String(fm.name),
			description: String(fm.description),
			version: String(fm.version ?? "0.1.0"),
			author: String(fm.author ?? "unknown"),
			platforms: fm.platforms as SkillFrontmatter["platforms"],
			tags: fm.tags as string[] | undefined,
		},
		body: body.trim(),
		origin,
	};
}

export function renderSkill(skill: Skill): string {
	const fm = skill.frontmatter;
	const lines = [
		"---",
		`name: ${fm.name}`,
		`description: ${fm.description.includes(":") ? `"${fm.description}"` : fm.description}`,
		`version: ${fm.version}`,
		`author: ${fm.author}`,
	];
	if (fm.platforms?.length) lines.push(`platforms: [${fm.platforms.join(", ")}]`);
	if (fm.tags?.length) lines.push(`tags: [${fm.tags.join(", ")}]`);
	lines.push("---", "", skill.body);
	return lines.join("\n");
}

/** description 的硬性上限。超過就永遠不會被路由到。 */
export const MAX_DESCRIPTION_CHARS = 60;

export interface ValidationIssue {
	field: string;
	message: string;
	/** true = 一定要修，false = 建議修。 */
	blocking: boolean;
}

/**
 * 檢查 skill 是否符合規範。
 *
 * **這是自動產生 skill 時的第一道閘門。** 模型很會寫出
 * 「A comprehensive skill that seamlessly...」這種描述，
 * 那種東西超過 60 字、會被截斷、而且沒有講清楚能力。
 */
export function validateSkill(skill: Skill): ValidationIssue[] {
	const issues: ValidationIssue[] = [];
	const fm = skill.frontmatter;

	if (!/^[a-z0-9-]+$/.test(fm.name)) {
		issues.push({ field: "name", message: "只能用小寫、數字與連字號", blocking: true });
	}

	if (fm.description.length > MAX_DESCRIPTION_CHARS) {
		issues.push({
			field: "description",
			message:
				`${fm.description.length} 字元，超過 ${MAX_DESCRIPTION_CHARS}。` +
				"超出的部分會被靜靜切掉，這個 skill 可能永遠不會被叫用。",
			blocking: true,
		});
	}

	if (!fm.description.trim().endsWith(".") && !fm.description.trim().endsWith("。")) {
		issues.push({ field: "description", message: "描述要是完整的一句話", blocking: false });
	}

	// 行銷詞代表描述在講「多好」而不是「能做什麼」
	const marketing = ["powerful", "comprehensive", "seamless", "advanced", "robust", "強大", "全面"];
	const hit = marketing.filter((w) => fm.description.toLowerCase().includes(w));
	if (hit.length > 0) {
		issues.push({
			field: "description",
			message: `含行銷詞（${hit.join(", ")}）。描述要講能力，不是講品質。`,
			blocking: false,
		});
	}

	if (fm.description.toLowerCase().includes(fm.name.replace(/-/g, " "))) {
		issues.push({ field: "description", message: "不要在描述裡重複 skill 名稱（浪費字元）", blocking: false });
	}

	if (!skill.body.trim()) {
		issues.push({ field: "body", message: "本文是空的", blocking: true });
	}

	return issues;
}
