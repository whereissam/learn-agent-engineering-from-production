/**
 * The schema compatibility layer's contract test.
 *
 * Split in two for the same reason as `provider-contract.test.ts`:
 *
 *   no key needed   the compatibility layer's **structural rewriting** is a pure function and can be tested fully
 *   key needed      whether a provider accepts it and whether the model honours it can only be learned by asking
 *
 * The second half runs `bun run lesson-30:probe` and is not in CI.
 * **CI guards against "the compatibility layer broke", not "the provider changed again"**;
 * the latter cannot be guarded, only re-measured periodically.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { compatSchema, describeWith, TARGETS, targetFor } from "../lesson-30-schema-compat/compat.ts";

const TUPLE_SCHEMA = {
	type: "object",
	properties: {
		coordinate: {
			type: "array",
			items: [{ type: "string" }, { type: "number" }, { type: "number" }],
			minItems: 3,
			maxItems: 3,
		},
	},
	required: ["coordinate"],
};

const NUMERIC_SCHEMA = {
	type: "object",
	properties: {
		downtime_minutes: { type: "integer", multipleOf: 15, minimum: 15, maximum: 480 },
	},
	required: ["downtime_minutes"],
};

describe("相容層：結構改寫", () => {
	test("不支援 tuple 的 target：items 陣列改成 anyOf", () => {
		const { schema } = compatSchema(TUPLE_SCHEMA, TARGETS.gemini!);
		const coordinate = (schema.properties as Record<string, any>).coordinate;
		assert.ok(!Array.isArray(coordinate.items), "items 不該還是陣列");
		assert.equal(coordinate.items.anyOf.length, 3);
			// The length limit must survive, or the rewrite loses a constraint.
		assert.equal(coordinate.minItems, 3);
		assert.equal(coordinate.maxItems, 3);
	});

	test("支援 tuple 的 target：原封不動", () => {
		const { schema } = compatSchema(TUPLE_SCHEMA, TARGETS.openai!);
		const coordinate = (schema.properties as Record<string, any>).coordinate;
		assert.ok(Array.isArray(coordinate.items));
	});

	test("改寫 tuple 時要留下順序的說明", () => {
		const { notes } = compatSchema(TUPLE_SCHEMA, TARGETS.gemini!);
			// anyOf cannot express order, so the order has to come back as text.
		assert.ok(
			notes.some((note) => note.includes("tuple")),
			`notes 應該提到 tuple，實際是 ${JSON.stringify(notes)}`,
		);
	});

	test("**不會修改輸入**", () => {
		const before = JSON.stringify(TUPLE_SCHEMA);
		compatSchema(TUPLE_SCHEMA, TARGETS.gemini!);
		assert.equal(JSON.stringify(TUPLE_SCHEMA), before, "輸入的 schema 被就地改掉了");
	});
});

describe("相容層：約束搬家", () => {
	test("不遵守數值約束的 target：搬進 notes", () => {
		const { notes } = compatSchema(NUMERIC_SCHEMA, TARGETS.gemini!);
		assert.ok(
			notes.some((note) => note.includes("multipleOf")),
			`notes 應該提到 multipleOf，實際是 ${JSON.stringify(notes)}`,
		);
	});

	test("會遵守的 target：不用搬", () => {
		const { notes } = compatSchema(NUMERIC_SCHEMA, TARGETS.openai!);
		assert.equal(notes.length, 0);
	});

	test("約束搬走之後**仍然留在 schema 裡**", () => {
			// Moving it into the description is "saying it twice", not "switching to saying it".
			// Removing the schema constraint would take it away from providers that do support it.
		const { schema } = compatSchema(NUMERIC_SCHEMA, TARGETS.gemini!);
		const field = (schema.properties as Record<string, any>).downtime_minutes;
		assert.equal(field.multipleOf, 15);
	});
});

describe("相容層：目標選擇", () => {
	test("沒量過的 provider 一律當成最保守", () => {
		const target = targetFor("some-new-provider");
		assert.equal(target.tupleItems, false);
		assert.equal(target.enforcesNumeric, false);
		assert.equal(target.enforcesString, false);
	});

	test("每個已知目標都要有完整欄位", () => {
		for (const [key, target] of Object.entries(TARGETS)) {
			assert.equal(typeof target.tupleItems, "boolean", `${key}.tupleItems`);
			assert.equal(typeof target.enforcesNumeric, "boolean", `${key}.enforcesNumeric`);
			assert.equal(typeof target.enforcesString, "boolean", `${key}.enforcesString`);
		}
	});
});

describe("describeWith", () => {
	test("沒有 notes 就不動描述", () => {
		assert.equal(describeWith("Record an incident.", []), "Record an incident.");
	});

	test("有 notes 就接在後面", () => {
		const out = describeWith("Record an incident.", ["a must be even"]);
		assert.ok(out.startsWith("Record an incident."));
		assert.ok(out.includes("a must be even"));
	});
});
