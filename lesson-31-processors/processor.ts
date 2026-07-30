/**
 * A deliberately small processor pipeline.
 *
 * A processor knows nothing about how the agent loop runs. It sees only a payload about to cross
 * some boundary, and returns the rewritten payload plus findings that contain no original text.
 *
 * Source: mastra/packages/core/src/processors/ and
 *       processors/processors/pii-detector.ts
 */

export type Boundary = "model" | "trace" | "memory";
export type PayloadKind = "user-input" | "tool-result" | "assistant-output";

export interface Payload {
	content: string;
	kind: PayloadKind;
	boundary: Boundary;
	source?: string;
}

export interface Finding {
	processor: string;
	type: string;
	count: number;
}

export interface ProcessResult {
	payload: Payload;
	findings: Finding[];
}

export interface Processor {
	readonly id: string;
	process(payload: Readonly<Payload>): ProcessResult | Promise<ProcessResult>;
}

export class ProcessorPipeline {
	constructor(private readonly processors: readonly Processor[] = []) {}

	async run(payload: Readonly<Payload>): Promise<ProcessResult> {
			// The caller may still send the original tool result to another boundary; it must not be mutated in place.
		let current: Payload = { ...payload };
		const findings: Finding[] = [];

		for (const processor of this.processors) {
			const result = await processor.process(current);
			if (result.payload.boundary !== payload.boundary) {
				throw new Error(
					`processor "${processor.id}" 不可以把 boundary 從 ${payload.boundary} 改成 ${result.payload.boundary}`,
				);
			}
			current = { ...result.payload };
			findings.push(...result.findings);
		}

		return { payload: current, findings };
	}
}

interface SecretPattern {
	type: string;
	pattern: RegExp;
	replace: string | ((substring: string, groups: readonly string[]) => string);
}

/**
 * A deterministic secret redactor for teaching.
 *
 * Not a complete secret scanner. A real system also handles provider-specific tokens,
 * entropy, allowlists and false positives. Only enough mechanism to demonstrate **where the boundaries are** is kept here.
 */
export class SecretRedactor implements Processor {
	readonly id = "secret-redactor";

	private readonly patterns: readonly SecretPattern[] = [
		{
			type: "secret-env",
			pattern:
				/\b((?:[A-Z0-9_]*(?:API_KEY|TOKEN|SECRET|PASSWORD|PRIVATE_KEY)|DATABASE_URL)\s*=\s*)([^\s]+)/gi,
			replace: (_match, groups) => `${groups[0] ?? ""}[REDACTED:secret]`,
		},
		{
			type: "provider-token",
			pattern: /\b(?:sk|pk)-(?:proj-|live-|test-)?[A-Za-z0-9_-]{16,}\b/g,
			replace: "[REDACTED:provider-token]",
		},
	];

	process(payload: Readonly<Payload>): ProcessResult {
		let content = payload.content;
		const findings: Finding[] = [];

		for (const rule of this.patterns) {
			let count = 0;
			// RegExp with /g is stateful. replace() resets lastIndex, but making that
			// assumption in a security boundary is needless, so clone it per run.
			const pattern = new RegExp(rule.pattern.source, rule.pattern.flags);
			content = content.replace(pattern, (...args: unknown[]) => {
				count++;
				if (typeof rule.replace === "string") return rule.replace;
				const [match, ...rest] = args;
					// replace()'s last two arguments are the offset and the full input; the capture groups come before them.
				const groups = rest.slice(0, Math.max(0, rest.length - 2)).map(String);
				return rule.replace(String(match), groups);
			});
			if (count > 0) findings.push({ processor: this.id, type: rule.type, count });
		}

		return { payload: { ...payload, content }, findings };
	}
}

/** Every sink receives the original value and runs the pipeline at its own boundary. */
export async function fanOutToolResult(
	content: string,
	pipelines: Readonly<Record<Boundary, ProcessorPipeline>>,
	source = "read_file(.env)",
): Promise<Record<Boundary, ProcessResult>> {
	const entries = await Promise.all(
		(["model", "trace", "memory"] as const).map(async (boundary) => [
			boundary,
			await pipelines[boundary].run({ content, kind: "tool-result", boundary, source }),
		] as const),
	);
	return Object.fromEntries(entries) as Record<Boundary, ProcessResult>;
}
