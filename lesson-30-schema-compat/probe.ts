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
		prompt: "記錄一筆沒有備註的事件，備註欄請填 null。",
		check: (args) =>
			args.note === null || typeof args.note === "string"
				? undefined
				: `note 應該是 string 或 null，拿到 ${typeof args.note}`,
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
		prompt: "排一個從 2026-08-01T02:00:00Z 開始、3 小時的時段。用物件形式。",
		check: (args) => {
			const w = args.window;
			if (typeof w === "string") return undefined;
			if (w && typeof w === "object") {
				const o = w as Record<string, unknown>;
				return typeof o.start === "string" && typeof o.hours === "number"
					? undefined
					: "window 是物件但缺 start / hours";
			}
			return `window 既不是 string 也不是合法物件（${typeof w}）`;
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
		prompt: "幫這次事故產生一個識別碼。",
		check: (args) => {
			const code = args.code;
			if (typeof code !== "string") return `code 不是字串（${typeof code}）`;
			return code.length === 8 ? undefined : `code 長度應為 8，拿到 ${code.length}（"${code}"）`;
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
		prompt: "這是一起非常嚴重、災難級的事故，請給它一個嚴重度。",
		check: (args) => {
			const value = args.severity;
			if (typeof value !== "number" || !Number.isInteger(value)) {
				return `severity 不是整數（${JSON.stringify(value)}）`;
			}
			return value >= 1 && value <= 5 ? undefined : `severity 應在 1..5，拿到 ${value}`;
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
		prompt: "這起事故已經處理完畢並且結案了，請設定狀態。",
		check: (args) =>
			["open", "mitigated", "closed"].includes(String(args.status))
				? undefined
				: `status 不在 enum 內：${JSON.stringify(args.status)}`,
	},
	{
		key: "nested",
		construct: "巢狀物件 + 選填欄位",
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
		prompt: "回報一起事故：編號 INC-9，機器人 R-204。地點不知道。",
		check: (args) => {
			const incident = args.incident as Record<string, unknown> | undefined;
			if (!incident || typeof incident !== "object") return "incident 不是物件";
			if (typeof incident.id !== "string") return "incident.id 缺少";
			const robot = incident.robot as Record<string, unknown> | undefined;
			if (!robot || typeof robot !== "object") return "incident.robot 不是物件";
			return typeof robot.id === "string" ? undefined : "incident.robot.id 缺少";
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
		construct: "pattern（正規表示式）",
		schema: {
			type: "object",
			properties: {
				ticket: { type: "string", pattern: "^[A-Z]{3}-[0-9]{4}$", description: "Ticket id" },
			},
			required: ["ticket"],
		},
			// Deliberately silent about the format. The format is the schema's responsibility.
		prompt: "幫這次事故開一張工單，給我工單編號。",
		check: (args) =>
			/^[A-Z]{3}-[0-9]{4}$/.test(String(args.ticket))
				? undefined
				: `ticket 不符合 ^[A-Z]{3}-[0-9]{4}$：${JSON.stringify(args.ticket)}`,
	},
	{
		key: "maxlen-tight",
		construct: "maxLength 跟自然答案衝突",
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
			"詳細說明這起事故：R-204 在倉庫東側行走時，因為地面積水導致左腳打滑，" +
			"整台向左前方傾倒，撞到旁邊的貨架，左手臂外殼破損。",
		check: (args) => {
			const s = args.summary;
			if (typeof s !== "string") return `summary 不是字串`;
			return s.length <= 20 ? undefined : `summary 長度應 ≤ 20，拿到 ${s.length}`;
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
		prompt: "這次停機大概一小時又十分鐘，登記一下停機時間。",
		check: (args) => {
			const v = args.downtime_minutes;
			if (typeof v !== "number") return "downtime_minutes 不是數字";
			return v % 15 === 0 ? undefined : `應為 15 的倍數，拿到 ${v}`;
		},
	},
	{
		key: "tuple",
		construct: "tuple（items 是陣列）",
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
		prompt: "事故位置在 warehouse-east，座標 x=12.5、y=3.0。",
		check: (args) => {
			const c = args.coordinate;
			if (!Array.isArray(c)) return `coordinate 不是陣列（${typeof c}）`;
			if (c.length !== 3) return `coordinate 長度應為 3，拿到 ${c.length}`;
			if (typeof c[0] !== "string") return "coordinate[0] 應為 string";
			if (typeof c[1] !== "number" || typeof c[2] !== "number")
				return "coordinate[1..2] 應為 number";
			return undefined;
		},
	},
	{
		key: "bigenum",
		construct: "很大的 enum（120 個值）",
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
		prompt: "受損的是編號 87 的元件，登記一下。",
		check: (args) => {
			const v = String(args.component);
			return /^component_\d{3}$/.test(v) && Number(v.slice(-3)) < 120
				? undefined
				: `component 不在 enum 內：${JSON.stringify(args.component)}`;
		},
	},
	{
		key: "ref",
		construct: "$ref / $defs（遞迴）",
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
		prompt: "登記受影響的部位樹：left_arm 底下有 shell 和 servo。",
		check: (args) => {
			const tree = args.tree as Record<string, unknown> | undefined;
			if (!tree || typeof tree !== "object") return "tree 不是物件";
			return typeof tree.name === "string" ? undefined : "tree.name 缺少";
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
		console.log(red("這支程式要量的就是真 provider 的行為，所以需要 PROVIDER 和金鑰。"));
		console.log(dim("  PROVIDER=gemini bun run lesson-30:probe"));
		process.exit(1);
	}

	const provider = selectStreamingProvider();
	const compat = process.env.COMPAT === "1";
	console.log(
		bold(`\nSchema 相容性探針  ${provider.name} / ${provider.model}`) +
			(compat ? green("  [相容層開啟]") : dim("  [沒有相容層]")),
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
		const label = `${testCase.key.padEnd(10)} ${dim(testCase.construct.padEnd(26))}`;

		switch (outcome.kind) {
			case "ok":
				console.log(`  ${green("✓")} ${label} ${dim(JSON.stringify(outcome.args))}`);
				break;
			case "api-error":
				console.log(`  ${red("✗ API 拒絕")} ${label}`);
				console.log(red(`      ${outcome.message.split("\n")[0]}`));
				break;
			case "violation":
				console.log(`  ${yellow("⚠ 安靜地違反")} ${label}`);
				console.log(yellow(`      ${outcome.why}`));
				break;
			case "no-call":
				console.log(`  ${dim("－ 模型沒有呼叫工具")} ${label}`);
				break;
		}
	}

	console.log(dim("─".repeat(72)));
	console.log(dim("✗ = 請求被打回來（吵，看得見）"));
	console.log(dim("⚠ = 請求過了但值不對（安靜，這才是這一課的主題）"));
}

if (import.meta.main) await main();
