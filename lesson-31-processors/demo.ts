/**
 * Lesson 31: moving the ifs out of runTurn into a processor pipeline.
 *
 * No API key needed. This experiment does not ask whether the model obeys; it verifies which boundaries the data crossed.
 *
 * Run: bun run lesson-31
 */

import {
	type Boundary,
	fanOutToolResult,
	ProcessorPipeline,
	SecretRedactor,
} from "./processor.ts";

// Everything is fake data, deliberately shaped like the real thing so the detector walks a real path.
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

console.log(bold("Lesson 31: Processor pipeline"));
console.log(dim("read_file(.env) → tool result → model / trace / memory"));
console.log(dim("The tokens below are DEMOONLY fakes, not read from the project root's .env."));

await scenario("Scenario 1: no processor", {
	model: empty(),
	trace: empty(),
	memory: empty(),
});

await scenario("Scenario 2: only the model input is protected", {
	model: protectedBoundary(),
	trace: empty(),
	memory: empty(),
});

await scenario("Scenario 3: all three boundaries protected separately", {
	model: protectedBoundary(),
	trace: protectedBoundary(),
	memory: protectedBoundary(),
});

console.log(bold("\nIn one sentence"));
console.log(dim("The model not seeing a secret does not mean the system did not store one; every persistence boundary defends itself.\n"));

