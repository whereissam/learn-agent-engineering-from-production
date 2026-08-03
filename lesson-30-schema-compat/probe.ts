/**
 * Lesson 30's probe: one tool schema, and what different providers do with it.
 *
 *   PROVIDER=gemini bun run lesson-30:probe
 *   PROVIDER=openai bun run lesson-30:probe
 *
 * A key is required, because what is being measured is **how a real provider reacts**.
 *
 * ## Two completely different failures
 *
 * This is the lesson's spine and the easiest thing to confuse:
 *
 *   an API-layer failure    the request comes straight back (400). Loud, and at least you know
 *   a model-layer failure   the request passed, the model answered, **and the value violates the schema**. Silent
 *
 * The second is why this lesson exists. Your schema says `maxLength: 8`,
 * the API accepts it, the model returns a 20-character string, and **nothing raises an error**.
 *
 * ## Why "just be careful" cannot work here
 *
 * Lesson 12's MCP tools have schemas **written by somebody else** that you cannot change.
 * So a compatibility layer is not a matter of taste but necessary infrastructure.
 */

import { selectStreamingProvider } from "../shared/streaming/index.ts";
import type { StreamingProvider, ToolSpec } from "../shared/streaming/types.ts";
import { compatSchema, describeWith, targetFor } from "./compat.ts";

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;

export interface Case {
	key: string;
	/** Which JSON Schema construct this case tests. */
	construct: string;
	schema: Record<string, unknown>;
	/** The sentence that makes the model call the tool. */
	prompt: string;
	/**
	 * Returning undefined means it passed; a string says what did not conform.
	 *
	 * **Deliberately hand-written rather than using ajv**: what this lesson demonstrates is exactly
	 * "the provider did not validate for you", so the validation has to be code you can see.
	 */
	check(args: Record<string, unknown>): string | undefined;
}

export const CASES: Case[] = [
	{
		key: "nullable",
		construct: `type: ["string", "null"]`,
		schema: {
			type: "object",
			properties: { note: { type: ["string", "null"], description: "A note, or null" } },
			required: ["note"],
		},
		prompt: "Record an event with no note; set the note field to null.",
		check: (args) =>
			args.note === null || typeof args.note === "string"
				? undefined
				: `note should be string or null, got ${typeof args.note}`,
	},
	{
		key: "union",
		construct: "oneOf",
		schema: {
			type: "object",
			properties: {
				window: {
					oneOf: [
						{ type: "string", description: "ISO 8601 interval" },
						{
							type: "object",
							properties: { start: { type: "string" }, hours: { type: "number" } },
							required: ["start", "hours"],
						},
					],
				},
			},
			required: ["window"],
		},
		prompt: "Schedule a 3-hour window starting 2026-08-01T02:00:00Z. Use the object form.",
		check: (args) => {
			const w = args.window;
			if (typeof w === "string") return undefined;
			if (w && typeof w === "object") {
				const o = w as Record<string, unknown>;
				return typeof o.start === "string" && typeof o.hours === "number"
					? undefined
					: "window is an object but is missing start / hours";
			}
			return `window is neither a string nor a valid object (${typeof w})`;
		},
	},
	{
		key: "strlen",
		construct: "minLength / maxLength",
		schema: {
			type: "object",
			properties: {
				code: {
					type: "string",
					minLength: 8,
					maxLength: 8,
					description: "An identifier",
				},
			},
			required: ["code"],
		},
			// The sentence deliberately does not mention the length. Length is the schema's responsibility,
			// and stating it would turn this into a test of the prompt rather than the schema.
		prompt: "Generate an identifier for this incident.",
		check: (args) => {
			const code = args.code;
			if (typeof code !== "string") return `code is not a string (${typeof code})`;
			return code.length === 8 ? undefined : `code should be 8 long, got ${code.length} ("${code}")`;
		},
	},
	{
		key: "numrange",
		construct: "minimum / maximum",
		schema: {
			type: "object",
			properties: {
				severity: { type: "integer", minimum: 1, maximum: 5, description: "Severity" },
			},
			required: ["severity"],
		},
		prompt: "This is an extremely serious, catastrophic incident; give it a severity.",
		check: (args) => {
			const value = args.severity;
			if (typeof value !== "number" || !Number.isInteger(value)) {
				return `severity is not an integer (${JSON.stringify(value)})`;
			}
			return value >= 1 && value <= 5 ? undefined : `severity should be 1..5, got ${value}`;
		},
	},
	{
		key: "enum",
		construct: "enum",
		schema: {
			type: "object",
			properties: {
				status: { type: "string", enum: ["open", "mitigated", "closed"] },
			},
			required: ["status"],
		},
		prompt: "This incident has been handled and closed; set the status.",
		check: (args) =>
			["open", "mitigated", "closed"].includes(String(args.status))
				? undefined
				: `status is not in the enum: ${JSON.stringify(args.status)}`,
	},
	{
		key: "nested",
		construct: "nested object + optional field",
		schema: {
			type: "object",
			properties: {
				incident: {
					type: "object",
					properties: {
						id: { type: "string" },
						robot: {
							type: "object",
							properties: { id: { type: "string" }, site: { type: "string" } },
							required: ["id"],
						},
					},
					required: ["id", "robot"],
				},
			},
			required: ["incident"],
		},
		prompt: "Report an incident: id INC-9, robot R-204. The location is unknown.",
		check: (args) => {
			const incident = args.incident as Record<string, unknown> | undefined;
			if (!incident || typeof incident !== "object") return "incident is not an object";
			if (typeof incident.id !== "string") return "incident.id is missing";
			const robot = incident.robot as Record<string, unknown> | undefined;
			if (!robot || typeof robot !== "object") return "incident.robot is not an object";
			return typeof robot.id === "string" ? undefined : "incident.robot.id is missing";
		},
	},
];

/**
 * Tier two: harder constructs.
 *
 * Tier one's six cases pass on both providers, so that tier measures nothing.
 * **A test that cannot detect a difference does not "prove there is no problem"; the task is too easy**
 * (learned in Lesson 16 Step 2.5). So the difficulty goes up until the boundary appears.
 */
export const HARD_CASES: Case[] = [
	{
		key: "pattern",
		construct: "pattern (a regular expression)",
		schema: {
			type: "object",
			properties: {
				ticket: { type: "string", pattern: "^[A-Z]{3}-[0-9]{4}$", description: "Ticket id" },
			},
			required: ["ticket"],
		},
			// Deliberately silent about the format. The format is the schema's responsibility.
		prompt: "Open a ticket for this incident and give me the ticket number.",
		check: (args) =>
			/^[A-Z]{3}-[0-9]{4}$/.test(String(args.ticket))
				? undefined
				: `ticket does not match ^[A-Z]{3}-[0-9]{4}$: ${JSON.stringify(args.ticket)}`,
	},
	{
		key: "maxlen-tight",
		construct: "maxLength conflicts with the natural answer",
		schema: {
			type: "object",
			properties: {
				summary: { type: "string", maxLength: 20, description: "Summary of the incident" },
			},
			required: ["summary"],
		},
			// A request for a detailed explanation paired with a 20-character limit.
			// When schema and prompt contradict each other, who wins?
		prompt:
			"Describe this incident in detail: while walking in the east warehouse, R-204's left foot " +
			"slipped on standing water, the whole unit tipped forward-left into a shelving rack, and the " +
			"left arm's shell was damaged.",
		check: (args) => {
			const s = args.summary;
			if (typeof s !== "string") return `summary is not a string`;
			return s.length <= 20 ? undefined : `summary should be ≤ 20 long, got ${s.length}`;
		},
	},
	{
		key: "multipleof",
		construct: "multipleOf",
		schema: {
			type: "object",
			properties: {
				downtime_minutes: { type: "integer", multipleOf: 15, minimum: 15, maximum: 480 },
			},
			required: ["downtime_minutes"],
		},
		prompt: "The downtime was about an hour and ten minutes; record it.",
		check: (args) => {
			const v = args.downtime_minutes;
			if (typeof v !== "number") return "downtime_minutes is not a number";
			return v % 15 === 0 ? undefined : `should be a multiple of 15, got ${v}`;
		},
	},
	{
		key: "tuple",
		construct: "tuple (items is an array)",
		schema: {
			type: "object",
			properties: {
				coordinate: {
					type: "array",
					items: [{ type: "string" }, { type: "number" }, { type: "number" }],
					minItems: 3,
					maxItems: 3,
					description: "[site, x, y]",
				},
			},
			required: ["coordinate"],
		},
		prompt: "The incident location is warehouse-east, coordinates x=12.5, y=3.0.",
		check: (args) => {
			const c = args.coordinate;
			if (!Array.isArray(c)) return `coordinate is not an array (${typeof c})`;
			if (c.length !== 3) return `coordinate should have length 3, got ${c.length}`;
			if (typeof c[0] !== "string") return "coordinate[0] should be a string";
			if (typeof c[1] !== "number" || typeof c[2] !== "number")
				return "coordinate[1..2] should be numbers";
			return undefined;
		},
	},
	{
		key: "bigenum",
		construct: "a large enum (120 values)",
		schema: {
			type: "object",
			properties: {
				component: {
					type: "string",
					enum: Array.from({ length: 120 }, (_, i) => `component_${String(i).padStart(3, "0")}`),
				},
			},
			required: ["component"],
		},
		prompt: "The damaged part is component number 87; record it.",
		check: (args) => {
			const v = String(args.component);
			return /^component_\d{3}$/.test(v) && Number(v.slice(-3)) < 120
				? undefined
				: `component is not in the enum: ${JSON.stringify(args.component)}`;
		},
	},
	{
		key: "ref",
		construct: "$ref / $defs (recursive)",
		schema: {
			type: "object",
			$defs: {
				node: {
					type: "object",
					properties: {
						name: { type: "string" },
						children: { type: "array", items: { $ref: "#/$defs/node" } },
					},
					required: ["name"],
				},
			},
			properties: { tree: { $ref: "#/$defs/node" } },
			required: ["tree"],
		},
		prompt: "Record the affected-part tree: left_arm contains shell and servo.",
		check: (args) => {
			const tree = args.tree as Record<string, unknown> | undefined;
			if (!tree || typeof tree !== "object") return "tree is not an object";
			return typeof tree.name === "string" ? undefined : "tree.name is missing";
		},
	},
];

export type Outcome =
	| { kind: "ok"; args: Record<string, unknown> }
		/** The API sent the request straight back. Loud, and visible. */
	| { kind: "api-error"; message: string }
		/** The request passed and the model answered with a value violating the schema. **This kind is silent.** */
	| { kind: "violation"; args: Record<string, unknown>; why: string }
		/** The model never called the tool. */
	| { kind: "no-call" };

export async function probeCase(
	provider: StreamingProvider,
	testCase: Case,
	transform: (schema: Record<string, unknown>) => Record<string, unknown> = (s) => s,
	extraDescription = "",
): Promise<Outcome> {
	const spec: ToolSpec = {
		name: "record_incident",
		description: `Record an incident.${extraDescription}`,
		parameters: transform(testCase.schema),
	};

	try {
		const response = await provider.call({
			system: "You record robot incidents. Always use the tool.",
			messages: [{ role: "user", text: testCase.prompt }],
			tools: [spec],
			maxTokens: 2000,
		});

		const call = response.blocks.find((b) => b.type === "toolCall");
		if (!call) return { kind: "no-call" };

		const why = testCase.check(call.args);
		return why ? { kind: "violation", args: call.args, why } : { kind: "ok", args: call.args };
	} catch (error) {
		return { kind: "api-error", message: error instanceof Error ? error.message : String(error) };
	}
}

// ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
	if (!process.env.PROVIDER) {
		console.log(red("This program measures a real provider's behaviour, so it needs PROVIDER and a key."));
		console.log(dim("  PROVIDER=gemini bun run lesson-30:probe"));
		process.exit(1);
	}

	const provider = selectStreamingProvider();
	const compat = process.env.COMPAT === "1";
	console.log(
		bold(`\nSchema compatibility probe  ${provider.name} / ${provider.model}`) +
			(compat ? green("  [compat layer on]") : dim("  [no compat layer]")),
	);

	const tier = (process.env.TIER ?? "all").toLowerCase();
	const cases =
		tier === "basic" ? CASES : tier === "hard" ? HARD_CASES : [...CASES, ...HARD_CASES];

	console.log(dim("─".repeat(72)));

	const target = targetFor(provider.name);

	for (const testCase of cases) {
		const outcome = compat
			? await probeCase(
					provider,
					testCase,
					(schema) => compatSchema(schema, target).schema,
					describeWith("", compatSchema(testCase.schema, target).notes),
				)
			: await probeCase(provider, testCase);
		const label = `${testCase.key.padEnd(14)} ${dim(testCase.construct.padEnd(42))}`;

		switch (outcome.kind) {
			case "ok":
				console.log(`  ${green("✓")} ${label} ${dim(JSON.stringify(outcome.args))}`);
				break;
			case "api-error":
				console.log(`  ${red("✗ rejected by the API")} ${label}`);
				console.log(red(`      ${outcome.message.split("\n")[0]}`));
				break;
			case "violation":
				console.log(`  ${yellow("⚠ silently violated")} ${label}`);
				console.log(yellow(`      ${outcome.why}`));
				break;
			case "no-call":
				console.log(`  ${dim("－ the model called no tool")} ${label}`);
				break;
		}
	}

	console.log(dim("─".repeat(72)));
	console.log(dim("✗ = the request was rejected (loud, visible)"));
	console.log(dim("⚠ = the request went through with a wrong value (silent, and the subject of this lesson)"));
}

if (import.meta.main) await main();
