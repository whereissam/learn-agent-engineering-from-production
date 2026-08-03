/**
 * The provider contract test.
 *
 * ## Why this test exists
 *
 * This repo hit the same family of error three times:
 *
 *   Lesson 7   the presence of `mustMention` was used as a proxy for "there is a data quality problem"
 *   Lesson 25  the evaluation read `index.json` while the agent read `fetchPage`'s long document
 *   shared     `usage` was added to the shared type and only the streaming implementation filled it
 *
 * What they share: **one thing has two implementations, and their understanding of it quietly diverged**.
 * Nothing raised an error in any of the three: types checked, tests were green, programs ran through,
 * and the behaviour differed.
 *
 * "Be more careful next time" is not a fix. The fix is **writing one set of assertions and running it
 * across every implementation** — something turns red the moment they diverge.
 *
 * ## What this tests and does not test
 *
 * It tests **the contract** (what must hold for every implementation), not behaviour
 * (what the model said). So it needs no API key and does not need the model to be clever.
 *
 * The part only a real model can verify (does usage really come back) is in the last section,
 * and runs only with a key. Running the first half in CI is enough to block divergence.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { ModelRequest, ModelResponse, Provider } from "../shared/providers/types.ts";
import { drain } from "../shared/streaming/types.ts";
import type { StreamingProvider } from "../shared/streaming/types.ts";

/**
 * The fake provider pauses 25ms per character by default (for a human-visible typewriter effect).
 *
 * In a test that runs straight into the 5-second timeout — **and it did on the very first run**.
 * `DELAY_MS` is read at module load, so it has to be set before the import,
 * which means a dynamic import is the only option.
 *
 * That is a small lesson in itself: **reading env at module level makes tests hard to write.**
 */
process.env.FAKE_DELAY_MS = "0";

const { fakeProvider } = await import("../shared/providers/fake.ts");
const { fakeStreamingProvider } = await import("../shared/streaming/fake.ts");

const REQUEST: ModelRequest = {
	system: "You are a test harness.",
	messages: [{ role: "user", text: "hello" }],
	tools: [
		{
			name: "read_file",
			description: "Read a file",
			parameters: {
				type: "object",
				properties: { path: { type: "string" } },
				required: ["path"],
			},
		},
	],
	maxTokens: 500,
};

const VALID_STOP_REASONS = new Set(["end", "tool_use", "max_tokens", "refusal"]);

/**
 * What must hold for every provider.
 *
 * Note this does **not** require usage to exist — the fake provider makes no real API call,
 * and demanding it fabricate a usage would only make the test a lie.
 * What is required: **when it exists, the numbers must be self-consistent.**
 */
function assertResponseContract(response: ModelResponse, label: string): void {
	assert.ok(Array.isArray(response.blocks), `${label}: blocks must be an array`);
	assert.ok(
		VALID_STOP_REASONS.has(response.stopReason),
		`${label}: stopReason "${response.stopReason}" is not a legal value`,
	);
	assert.ok("raw" in response, `${label}: raw must be preserved (the provider's native message)`);

	for (const block of response.blocks) {
		if (block.type === "toolCall") {
			assert.equal(typeof block.id, "string", `${label}: a tool call needs an id`);
			assert.ok(block.name.length > 0, `${label}: a tool call needs a name`);
			assert.equal(typeof block.args, "object", `${label}: args must be an object (already parsed)`);
			assert.ok(block.args !== null, `${label}: args must not be null`);
		} else {
			assert.equal(typeof block.text, "string", `${label}: a text block needs a string`);
		}
	}

	if (response.usage) {
		const { input, output, total } = response.usage;
		for (const [name, value] of Object.entries({ input, output, total })) {
			assert.ok(Number.isFinite(value) && value >= 0, `${label}: usage.${name} must be a non-negative number`);
		}
			// ⚠️ Not `total === input + output`.
			// Gemini's thinking tokens are outside output and inside total (measured in Lesson 26),
			// so the contract can only require total to be no less than their sum.
		assert.ok(
			total >= input + output,
			`${label}: total (${total}) must not be less than input + output (${input + output})`,
		);
	}
}

describe("provider contract: must hold for every implementation", () => {
	const nonStreaming: Array<[string, Provider]> = [["fake (non-streaming)", fakeProvider()]];
	const streaming: Array<[string, StreamingProvider]> = [
		["fake (streaming)", fakeStreamingProvider()],
	];

	for (const [label, provider] of nonStreaming) {
		test(`${label} returns a legal ModelResponse`, async () => {
			assertResponseContract(await provider.call(REQUEST), label);
		});
	}

	for (const [label, provider] of streaming) {
		test(`${label} returns a legal ModelResponse`, async () => {
			assertResponseContract(await drain(provider.stream(REQUEST)), label);
		});

		test(`${label} emits a legal event order`, async () => {
			const events: string[] = [];
			for await (const event of provider.stream(REQUEST)) events.push(event.type);

				// Every text_start must have a text_end, and they must not overlap
			let open = false;
			for (const type of events) {
				if (type === "text_start") {
					assert.ok(!open, `${label}: text_start opened twice`);
					open = true;
				}
				if (type === "text_end") {
					assert.ok(open, `${label}: text_end with no matching text_start`);
					open = false;
				}
			}
			assert.ok(!open, `${label}: text_start was never closed`);

				// It must end with done or error, and may not simply stop
			const last = events.at(-1);
			assert.ok(
				last === "done" || last === "error",
				`${label}: the stream ended on "${last}", so the caller gets no result`,
			);
		});

		test(`${label}: call() and stream() give the same result`, async () => {
				// This one exists to block "two entry points quietly diverging" —
				// `call()` in a real provider wraps `drain(stream())`,
				// and if somebody ever adds something to one side, this goes red.
			const viaStream = await drain(provider.stream(REQUEST));
			const viaCall = await provider.call(REQUEST);
			assert.equal(viaCall.stopReason, viaStream.stopReason);
			assert.equal(viaCall.blocks.length, viaStream.blocks.length);
		});
	}
});

/**
 * The part only a real model can verify.
 *
 * Skipped without `PROVIDER` — **and the skip must be stated**, or you will think it ran.
 * Which is why this uses `test.skip` rather than an early `return`.
 */
describe("provider contract: real models (needs a key)", () => {
	const requested = process.env.PROVIDER?.toLowerCase();
	const live = requested && requested !== "fake";

	if (!live) {
		test.skip("only runs with PROVIDER=openai|gemini|anthropic (this costs real money)", () => {});
		return;
	}

	test("the streaming version reports usage", async () => {
		const { selectStreamingProvider } = await import("../shared/streaming/index.ts");
		const response = await drain(selectStreamingProvider().stream(REQUEST));
		assertResponseContract(response, `${requested} (streaming)`);
		assert.ok(response.usage, "a real provider must report usage, or cost cannot be computed");
	});

	test("the non-streaming version reports usage too", async () => {
			// This one exists to block Lesson 26's "only the streaming implementation was changed" error.
		const { selectProvider } = await import("../shared/providers/index.ts");
		const response = await selectProvider().call(REQUEST);
		assertResponseContract(response, `${requested} (non-streaming)`);
		assert.ok(
			response.usage,
			"The non-streaming version must report usage too: what the shared type promises, every implementation delivers",
		);
	});
});
