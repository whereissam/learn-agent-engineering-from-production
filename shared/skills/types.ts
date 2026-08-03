/**
 * A skill's format.
 *
 * Memory (Lesson 15) records **facts**; a skill records **how to do something**.
 *
 * A skill is one Markdown file (Hermes calls it SKILL.md) with YAML frontmatter on top:
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
 * Why files rather than a database? The same reason as Lesson 15's MEMORY.md:
 * you can read them, diff them, version them, and the agent can read and write them too.
 *
 * Source: hermes-agent/agent/skill_utils.py
 */

/**
 * A skill's metadata.
 *
 * `description`'s 60-character limit is **not a cosmetic matter** but an architectural one.
 * See the progressive disclosure explanation in store.ts.
 */
export interface SkillFrontmatter {
	/** Lowercase with hyphens, used as the id. */
	name: string;
	/**
	 * One sentence. **A 60-character limit.**
	 *
 * Hermes's authoring standard is especially strict about this; in the original:
	 *   > This is the most-violated rule and it is NOT cosmetic: the
	 *   > system-prompt skill index truncates the description to 60 chars and
	 *   > loads it every session, so anything past char 60 is silently cut
	 *   > and never routes.
	 *
	 * That is: anything past 60 characters is silently cut, and **the model never learns
	 * what this skill can do**, so it never invokes it.
	 */
	description: string;
	version: string;
	/**
	 * The author.
	 *
	 * Hermes requires this to be a **fixed value** and forbids filling it from environment variables,
	 * git config or a login account. The reason is that skills get shared, and a name derived from
	 * the environment is a privacy leak the user never agreed to.
	 */
	author: string;
	/** Restricted to a platform. Omitted means cross-platform. */
	platforms?: Array<"macos" | "linux" | "windows">;
	tags?: string[];
}

/** Who created this skill. **This field is Lesson 16's core.** */
export type SkillOrigin =
	/** Written by a human; trusted by default. */
	| "human"
	/** Proposed by the agent and not yet reviewed. **Never loaded.** */
	| "proposed"
	/** Proposed by the agent and reviewed by a human. */
	| "approved";

export interface Skill {
	frontmatter: SkillFrontmatter;
	/** The Markdown body beneath the frontmatter. */
	body: string;
	origin: SkillOrigin;
	/** The proposal's origin, for traceability. */
	proposedFrom?: {
		sessionId: string;
		/** What kind of conversation this skill was extracted from. */
		summary: string;
		createdAt: string;
	};
	/** The review record. */
	review?: {
		decidedBy: string;
		decidedAt: string;
		note?: string;
	};
}

/** Parse a SKILL.md. */
export function parseSkill(raw: string, origin: SkillOrigin = "human"): Skill {
	const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
	if (!match?.[1]) {
		throw new Error("SKILL.md must start with YAML frontmatter (wrapped in ---)");
	}

	const [, front, body = ""] = match;
	const fm: Record<string, unknown> = {};

		// Minimal YAML: only key: value and key: [a, b] are supported.
		// Use a yaml package in a real system; this avoids a dependency.
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
		throw new Error("Skill frontmatter is missing name or description");
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

/** The hard limit on a description. Beyond it, it is never routed to. */
export const MAX_DESCRIPTION_CHARS = 60;

export interface ValidationIssue {
	field: string;
	message: string;
	/** true = must fix, false = should fix. */
	blocking: boolean;
}

/**
 * Check whether a skill meets the standard.
 *
 * **This is the first gate when skills are generated automatically.** Models are very good at writing
 * descriptions like "A comprehensive skill that seamlessly...",
 * which exceed 60 characters, get truncated, and never state a capability.
 */
export function validateSkill(skill: Skill): ValidationIssue[] {
	const issues: ValidationIssue[] = [];
	const fm = skill.frontmatter;

	if (!/^[a-z0-9-]+$/.test(fm.name)) {
		issues.push({ field: "name", message: "Only lowercase letters, digits and hyphens", blocking: true });
	}

	if (fm.description.length > MAX_DESCRIPTION_CHARS) {
		issues.push({
			field: "description",
			message:
				`${fm.description.length} characters, over the ${MAX_DESCRIPTION_CHARS} limit. ` +
				"The overflow is silently cut, and this skill may never be invoked.",
			blocking: true,
		});
	}

	if (!fm.description.trim().endsWith(".") && !fm.description.trim().endsWith("。")) {
		issues.push({ field: "description", message: "The description should be a complete sentence", blocking: false });
	}

		// Marketing language means the description says "how good it is" rather than "what it does"
	const marketing = ["powerful", "comprehensive", "seamless", "advanced", "robust"];
	const hit = marketing.filter((w) => fm.description.toLowerCase().includes(w));
	if (hit.length > 0) {
		issues.push({
			field: "description",
			message: `Contains marketing words (${hit.join(", ")}). A description states capability, not quality.`,
			blocking: false,
		});
	}

	if (fm.description.toLowerCase().includes(fm.name.replace(/-/g, " "))) {
		issues.push({
			field: "description",
			message: "Do not repeat the skill name in the description (wasted characters)",
			blocking: false,
		});
	}

	if (!skill.body.trim()) {
		issues.push({ field: "body", message: "The body is empty", blocking: true });
	}

	return issues;
}
