import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { CATALOG, CATALOG_BY_NAME, TASKS } from "../lesson-32-tool-search/catalog.ts";
import {
	LOAD_TOOL_SPEC,
	SEARCH_TOOLS_SPEC,
	serialisedBytes,
	ToolIndex,
	ToolSearchSession,
	tokenize,
} from "../lesson-32-tool-search/tool-search.ts";

const specs = CATALOG.map(({ service: _service, ...spec }) => spec);
const index = new ToolIndex(specs);

describe("the catalogue（Lesson 32）", () => {
	test("has 200 tools across 20 services", () => {
		assert.equal(CATALOG.length, 200);
		assert.equal(new Set(CATALOG.map((t) => t.service)).size, 20);
	});

	test("every task's expected tool exists", () => {
		for (const task of TASKS) {
			assert.ok(CATALOG_BY_NAME.has(task.expected), `${task.expected} missing`);
		}
	});

	test("every tool name is legal for a provider's function-name rules", () => {
		for (const tool of CATALOG) {
			assert.match(tool.name, /^[a-zA-Z0-9_-]{1,64}$/);
		}
	});

	test("names are unique — two identical names silently shadow each other at the provider", () => {
		assert.equal(new Set(CATALOG.map((t) => t.name)).size, CATALOG.length);
	});
});

describe("tokenisation（Lesson 32）", () => {
	test("splits tool names on underscores, or a query for 'branch protection' cannot reach them", () => {
		assert.deepEqual(tokenize("github_update_branch_protection"), [
			"github",
			"update",
			"branch",
			"protection",
		]);
	});

	test("drops single characters but keeps no stopword list, mirroring Mastra's choice", () => {
		assert.deepEqual(tokenize("a the on call"), ["the", "on", "call"]);
	});
});

describe("BM25 over tool descriptions（Lesson 32）", () => {
	test("an exact tool name ranks itself first", () => {
		for (const name of ["stripe_create_refund", "aws_s3_get_bucket_size", "datadog_mute_monitor"]) {
			assert.equal(index.search(name, 1)[0]?.name, name);
		}
	});

	test("a query that tokenises to nothing returns nothing rather than everything", () => {
		assert.deepEqual(index.search("的了嗎"), []);
	});

	test("topK is respected", () => {
		assert.equal(index.search("send a message", 3).length, 3);
	});

	test("scores are non-increasing down the ranking", () => {
		const hits = index.search("refund a payment", 10);
		for (let i = 1; i < hits.length; i++) {
			assert.ok((hits[i - 1]?.score ?? 0) >= (hits[i]?.score ?? 0));
		}
	});
});

describe("the three phases（Lesson 32）", () => {
	test("the request always carries the two meta-tools, and nothing else until something is loaded", () => {
		const session = new ToolSearchSession(index);
		const tools = session.requestTools();
		assert.equal(tools.length, 2);
		assert.deepEqual(
			tools.map((t) => t.name),
			[SEARCH_TOOLS_SPEC.name, LOAD_TOOL_SPEC.name],
		);
	});

	test("a tool is only callable after load", () => {
		const session = new ToolSearchSession(index);
		assert.equal(session.isLoaded("stripe_create_refund"), false);
		session.load(["stripe_create_refund"]);
		assert.equal(session.isLoaded("stripe_create_refund"), true);
		assert.ok(session.requestTools().some((t) => t.name === "stripe_create_refund"));
	});

	test("loading a name that is not in the catalogue is reported, not silently ignored", () => {
		const session = new ToolSearchSession(index);
		const { loaded, rejected } = session.load(["stripe_create_refund", "stripe_invent_money"]);
		assert.deepEqual(loaded, ["stripe_create_refund"]);
		assert.deepEqual(rejected, ["stripe_invent_money"]);
	});

	test("a filter that refuses at `active` keeps the tool out of the request even once loaded", () => {
		const target = "aws_ec2_terminate_instance";
		const session = new ToolSearchSession(index, (name, phase) => !(name === target && phase === "active"));
		session.load([target]);
		assert.equal(session.active().some((t) => t.name === target), false);
	});

	/**
	 * The security note from the README's Step 5, pinned as a test: hiding a tool
	 * from search is not access control. A model that learns the name elsewhere —
	 * memory, a previous session, the user typing it — can still load it.
	 */
	test("refusing at `search` hides a tool but does NOT stop it being loaded by name", () => {
		const target = "aws_ec2_terminate_instance";
		const session = new ToolSearchSession(index, (name, phase) => !(name === target && phase === "search"));
		const hits = session.search("terminate an ec2 instance permanently");
		assert.equal(hits.hits.some((h) => h.name === target), false);

		const { loaded } = session.load([target]);
		assert.deepEqual(loaded, [target]);
	});

	test("descriptions handed back to the model are truncated to 150 characters, as Mastra does", () => {
		const session = new ToolSearchSession(index);
		for (const line of session.search("create an issue").text.split("\n")) {
			const description = line.slice(line.indexOf(": ") + 2);
			assert.ok(description.length <= 150, `${description.length} > 150`);
		}
	});
});

describe("what the mechanism is for（Lesson 32）", () => {
	test("the two meta-tools are more than an order of magnitude smaller than the catalogue", () => {
		const all = serialisedBytes(specs);
		const meta = serialisedBytes([SEARCH_TOOLS_SPEC, LOAD_TOOL_SPEC]);
		assert.ok(all / meta > 10, `ratio was ${(all / meta).toFixed(1)}x`);
	});

	/**
	 * Pinned deliberately low. The measured value on the raw user sentences is
	 * 7/12 (README Step 3), and this test exists to catch a change that breaks
	 * retrieval outright — not to assert that 7/12 is good.
	 */
	test("BM25 on the raw user sentence finds at least half the expected tools in the top 5", () => {
		const hits = TASKS.filter((task) => {
			const rank = index.rankOf(task.prompt, task.expected);
			return rank !== undefined && rank <= 5;
		});
		assert.ok(hits.length >= 6, `only ${hits.length}/${TASKS.length} in top 5`);
	});
});
