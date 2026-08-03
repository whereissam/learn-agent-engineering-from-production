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

describe("compat layer: structural rewrites", () => {
	test("a target without tuple support: the items array becomes anyOf", () => {
		const { schema } = compatSchema(TUPLE_SCHEMA, TARGETS.gemini!);
		const coordinate = (schema.properties as Record<string, any>).coordinate;
		assert.ok(!Array.isArray(coordinate.items), "items must no longer be an array");
		assert.equal(coordinate.items.anyOf.length, 3);
			// The length limit must survive, or the rewrite loses a constraint.
		assert.equal(coordinate.minItems, 3);
		assert.equal(coordinate.maxItems, 3);
	});

	test("a target with tuple support: left untouched", () => {
		const { schema } = compatSchema(TUPLE_SCHEMA, TARGETS.openai!);
		const coordinate = (schema.properties as Record<string, any>).coordinate;
		assert.ok(Array.isArray(coordinate.items));
	});

	test("rewriting a tuple leaves a note about the ordering", () => {
		const { notes } = compatSchema(TUPLE_SCHEMA, TARGETS.gemini!);
			// anyOf cannot express order, so the order has to come back as text.
		assert.ok(
			notes.some((note) => note.includes("tuple")),
			`notes should mention tuple; got ${JSON.stringify(notes)}`,
		);
	});

	test("**does not modify the input**", () => {
		const before = JSON.stringify(TUPLE_SCHEMA);
		compatSchema(TUPLE_SCHEMA, TARGETS.gemini!);
		assert.equal(JSON.stringify(TUPLE_SCHEMA), before, "the input schema was modified in place");
	});
});

describe("compat layer: constraint relocation", () => {
	test("a target that ignores numeric constraints: they move into notes", () => {
		const { notes } = compatSchema(NUMERIC_SCHEMA, TARGETS.gemini!);
		assert.ok(
			notes.some((note) => note.includes("multipleOf")),
			`notes should mention multipleOf; got ${JSON.stringify(notes)}`,
		);
	});

	test("a target that honours them: nothing moves", () => {
		const { notes } = compatSchema(NUMERIC_SCHEMA, TARGETS.openai!);
		assert.equal(notes.length, 0);
	});

	test("a relocated constraint **still stays in the schema**", () => {
			// Moving it into the description is "saying it twice", not "switching to saying it".
			// Removing the schema constraint would take it away from providers that do support it.
		const { schema } = compatSchema(NUMERIC_SCHEMA, TARGETS.gemini!);
		const field = (schema.properties as Record<string, any>).downtime_minutes;
		assert.equal(field.multipleOf, 15);
	});
});

describe("compat layer: target selection", () => {
	test("an unmeasured provider is treated as the most conservative", () => {
		const target = targetFor("some-new-provider");
		assert.equal(target.tupleItems, false);
		assert.equal(target.enforcesNumeric, false);
		assert.equal(target.enforcesString, false);
	});

	test("every known target has a complete set of fields", () => {
		for (const [key, target] of Object.entries(TARGETS)) {
			assert.equal(typeof target.tupleItems, "boolean", `${key}.tupleItems`);
			assert.equal(typeof target.enforcesNumeric, "boolean", `${key}.enforcesNumeric`);
			assert.equal(typeof target.enforcesString, "boolean", `${key}.enforcesString`);
		}
	});
});

describe("describeWith", () => {
	test("with no notes the description is untouched", () => {
		assert.equal(describeWith("Record an incident.", []), "Record an incident.");
	});

	test("with notes they are appended", () => {
		const out = describeWith("Record an incident.", ["a must be even"]);
		assert.ok(out.startsWith("Record an incident."));
		assert.ok(out.includes("a must be even"));
	});
});
