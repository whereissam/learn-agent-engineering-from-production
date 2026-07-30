/**
 * Lesson 31：把 runTurn 裡的 if 搬到 processor pipeline。
 *
 * 不需要 API key。這個實驗不問模型會不會聽話，只驗證資料到底跨過了哪些邊界。
 *
 * 執行：bun run lesson-31
 */

import {
	type Boundary,
	fanOutToolResult,
	ProcessorPipeline,
	SecretRedactor,
} from "./processor.ts";

// 全部是假資料。刻意長得像真的，才能讓 detector 走過真實路徑。
const FAKE_KEY = "sk-proj-DEMOONLY0000000000000000";
const TOOL_RESULT = [
	`OPENAI_API_KEY=${FAKE_KEY}`,
	"DATABASE_URL=postgres://demo:demo-password@db.invalid/app",
	"FEATURE_FLAG=true",
].join("\n");

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;

const empty = () => new ProcessorPipeline();
const protectedBoundary = () => new ProcessorPipeline([new SecretRedactor()]);

async function scenario(
	title: string,
	pipelines: Record<Boundary, ProcessorPipeline>,
): Promise<void> {
	console.log(bold(`\n${title}`));
	const results = await fanOutToolResult(TOOL_RESULT, pipelines);

	for (const boundary of ["model", "trace", "memory"] as const) {
		const result = results[boundary];
		const leaked = result.payload.content.includes(FAKE_KEY);
		const status = leaked ? red("LEAK") : green("safe");
		const changed = result.findings.reduce((sum, finding) => sum + finding.count, 0);
		console.log(`  ${boundary.padEnd(6)} ${status}  redactions=${changed}`);
		for (const line of result.payload.content.split("\n")) console.log(dim(`           ${line}`));
	}
}

console.log(bold("Lesson 31：Processor pipeline"));
console.log(dim("read_file(.env) → tool result → model / trace / memory"));
console.log(dim("以下 token 是 DEMOONLY 假資料，不是從專案根目錄的 .env 讀取。"));

await scenario("情境 1：沒有 processor", {
	model: empty(),
	trace: empty(),
	memory: empty(),
});

await scenario("情境 2：只保護送進模型的 input", {
	model: protectedBoundary(),
	trace: empty(),
	memory: empty(),
});

await scenario("情境 3：三個邊界各自保護", {
	model: protectedBoundary(),
	trace: protectedBoundary(),
	memory: protectedBoundary(),
});

console.log(bold("\n一句話總結"));
console.log(dim("模型沒看到 secret，不代表系統沒保存 secret；每個持久化邊界都要自己守。\n"));

