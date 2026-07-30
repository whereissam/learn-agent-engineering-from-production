import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	type Boundary,
	fanOutToolResult,
	type Payload,
	type Processor,
	ProcessorPipeline,
	SecretRedactor,
} from "../lesson-31-processors/processor.ts";

const SECRET = "sk-proj-DEMOONLY0000000000000000";
const TOOL_RESULT = `OPENAI_API_KEY=${SECRET}\nFEATURE_FLAG=true`;
const empty = () => new ProcessorPipeline();
const guarded = () => new ProcessorPipeline([new SecretRedactor()]);

describe("processor pipeline（Lesson 31）", () => {
	test("secret redactor 遮住 secret，但保留非敏感內容", async () => {
		const result = await guarded().run({
			content: TOOL_RESULT,
			kind: "tool-result",
			boundary: "model",
		});

		assert.ok(!result.payload.content.includes(SECRET));
		assert.ok(result.payload.content.includes("OPENAI_API_KEY=[REDACTED:secret]"));
		assert.ok(result.payload.content.includes("FEATURE_FLAG=true"));
		assert.equal(result.findings[0]?.type, "secret-env");
		assert.equal(result.findings[0]?.count, 1);
	});

	test("pipeline 不會就地修改呼叫端的 payload", async () => {
		const input: Payload = {
			content: TOOL_RESULT,
			kind: "tool-result",
			boundary: "model",
		};
		await guarded().run(input);
		assert.equal(input.content, TOOL_RESULT);
	});

	test("只保護 model，trace 和 memory 仍然會漏", async () => {
		const results = await fanOutToolResult(TOOL_RESULT, {
			model: guarded(),
			trace: empty(),
			memory: empty(),
		});

		assert.ok(!results.model.payload.content.includes(SECRET));
		assert.ok(results.trace.payload.content.includes(SECRET));
		assert.ok(results.memory.payload.content.includes(SECRET));
	});

	test("三個邊界要各自處理", async () => {
		const pipelines: Record<Boundary, ProcessorPipeline> = {
			model: guarded(),
			trace: guarded(),
			memory: guarded(),
		};
		const results = await fanOutToolResult(TOOL_RESULT, pipelines);

		for (const result of Object.values(results)) {
			assert.ok(!result.payload.content.includes(SECRET));
		}
	});

	test("processor 不能偷偷改變 boundary", async () => {
		const bad: Processor = {
			id: "bad",
			process(payload) {
				return {
					payload: { ...payload, boundary: "trace" },
					findings: [],
				};
			},
		};

		await assert.rejects(
			new ProcessorPipeline([bad]).run({
				content: "hello",
				kind: "user-input",
				boundary: "model",
			}),
			/不可以把 boundary/,
		);
	});
});

