/**
 * 一個刻意很小的 processor pipeline。
 *
 * Processor 不知道 agent loop 怎麼跑。它只看得到一份即將跨過某個邊界的
 * payload，然後回傳改寫後的 payload 與不含原文的 findings。
 *
 * 對照：mastra/packages/core/src/processors/ 與
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
		// 呼叫端可能還要把原始 tool result 送去別的邊界；不能就地改掉它。
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
 * 教學用的確定性 secret redactor。
 *
 * 這不是完整的 secret scanner。真正系統還要處理 provider-specific token、
 * 熵值、allowlist 與 false positive。這裡只留下足以證明「邊界位置」的機制。
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
				// replace() 最後兩個參數是 offset 與完整 input；前面的才是 capture groups。
				const groups = rest.slice(0, Math.max(0, rest.length - 2)).map(String);
				return rule.replace(String(match), groups);
			});
			if (count > 0) findings.push({ processor: this.id, type: rule.type, count });
		}

		return { payload: { ...payload, content }, findings };
	}
}

/** 每個 sink 都拿原始值，並在自己的邊界執行 pipeline。 */
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
