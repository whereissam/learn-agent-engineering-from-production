import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { describeProviderError } from "../shared/providers/errors.ts";
import { fetchPreservingErrorBody } from "../shared/streaming/openai.ts";

/**
 * These protect one property, and it is not a cosmetic one: **a provider failure
 * must arrive as a sentence about its cause.**
 *
 * The regression they exist to stop already happened once. Lesson 32's first run
 * reported `400 status code (no body)` twelve times and the written conclusion
 * blamed an expired API key. The real answer — a geography block — was in the
 * response body the whole time.
 */

/** The shape the OpenAI SDK throws: an Error carrying `status` and the parsed body on `error`. */
function apiError(message: string, status: number, body?: unknown): Error {
	const error = new Error(message) as Error & { status: number; error?: unknown };
	error.status = status;
	if (body !== undefined) error.error = body;
	return error;
}

describe("describing a provider failure（shared/providers/errors.ts）", () => {
	test("recovers the message from a body the SDK could not read", () => {
		const error = apiError("400 status code (no body)", 400, {
			error: { code: 400, message: "User location is not supported for the API use.", status: "FAILED_PRECONDITION" },
		});
		const described = describeProviderError(error);
		assert.match(described, /User location is not supported/);
		assert.match(described, /FAILED_PRECONDITION/);
		assert.ok(!described.includes("no body"));
	});

	test("digs through an array-wrapped body, which is the shape that started this", () => {
		const error = apiError("400 status code (no body)", 400, [
			{ error: { message: "User location is not supported for the API use.", status: "FAILED_PRECONDITION" } },
		]);
		assert.match(describeProviderError(error), /User location is not supported/);
	});

	test("keeps the SDK's own message when it is already informative", () => {
		const error = apiError(
			"400 Invalid 'tools': array too long. Expected an array with maximum length 128, but got an array with length 200 instead.",
			400,
		);
		assert.match(describeProviderError(error), /array too long/);
	});

	test("never loses the HTTP status", () => {
		assert.match(describeProviderError(apiError("400 status code (no body)", 400)), /400/);
	});

	test("survives a body with no message at all", () => {
		const error = apiError("500 status code (no body)", 500, { weird: [1, 2, 3] });
		assert.match(describeProviderError(error), /500/);
	});

	test("does not throw on a self-referential body", () => {
		const cyclic: Record<string, unknown> = {};
		cyclic.error = cyclic;
		assert.doesNotThrow(() => describeProviderError(apiError("500 status code (no body)", 500, cyclic)));
	});

	test("passes a non-Error through rather than pretending it parsed one", () => {
		assert.equal(describeProviderError("plain string"), "plain string");
	});
});

describe("preserving the error body at the transport（shared/streaming/openai.ts）", () => {
	const originalFetch = globalThis.fetch;

	/** Swap in a fetch that answers with `body`, run the wrapper, restore. */
	async function withStubbedFetch(status: number, body: string, headers: Record<string, string> = {}) {
		globalThis.fetch = (async () =>
			new Response(body, { status, headers: { "content-type": "application/json", ...headers } })) as typeof fetch;
		try {
			return await fetchPreservingErrorBody("https://example.invalid/v1/chat/completions");
		} finally {
			globalThis.fetch = originalFetch;
		}
	}

	test("unwraps a single-element array body into the object the SDK expects", async () => {
		const response = await withStubbedFetch(
			400,
			JSON.stringify([{ error: { message: "User location is not supported for the API use." } }]),
		);
		const parsed = (await response.json()) as { error?: { message?: string } };
		assert.equal(parsed.error?.message, "User location is not supported for the API use.");
		assert.equal(response.status, 400);
	});

	test("leaves a conforming error body alone", async () => {
		const body = JSON.stringify({ error: { message: "Invalid 'tools': array too long." } });
		const response = await withStubbedFetch(400, body);
		assert.equal(await response.text(), body);
	});

	test("drops content-encoding, because the body handed back is already decoded", async () => {
		const response = await withStubbedFetch(400, JSON.stringify([{ error: { message: "nope" } }]), {
			"content-encoding": "gzip",
		});
		assert.equal(response.headers.get("content-encoding"), null);
	});

	test("hands back a non-JSON body unchanged rather than swallowing it", async () => {
		const response = await withStubbedFetch(502, "<html>upstream connect error</html>");
		assert.match(await response.text(), /upstream connect error/);
	});

	test("a successful response is passed straight through, unread", async () => {
		const response = await withStubbedFetch(200, JSON.stringify({ ok: true }));
		assert.equal(response.status, 200);
		assert.equal(response.bodyUsed, false);
	});
});
