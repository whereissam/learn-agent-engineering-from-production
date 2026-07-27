/**
 * create_incident_report：這一課唯一會產生副作用的工具。
 *
 * 它示範另一個領域工具的設計重點：**用 schema 強迫模型結構化思考。**
 *
 * 如果只給模型一個 write_file，它會寫出一段散文。散文沒辦法：
 *   - 程式化地檢查（Lesson 7 的評估要用）
 *   - 存進資料庫、串到 dashboard
 *   - 保證它真的有引用證據
 *
 * 把「結論」「信心」「證據」拆成必填欄位之後，模型就不能含糊帶過。
 * 這比在 prompt 裡拜託它「請附上證據」有效得多。
 */

import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Tool } from "../../shared/tools/registry.ts";

const REPORT_DIR = resolve(import.meta.dirname, "../reports");

/** 分類是固定選項，不是自由文字。這樣下游才能統計。 */
const CLASSIFICATIONS = [
	"fall",
	"near_miss",
	"external_collision",
	"nominal",
	"inconclusive",
] as const;

export const createIncidentReportTool: Tool = {
	name: "create_incident_report",
	mutating: true,
	description:
		"Write an incident report for a session. " +
		"Every claim must be backed by evidence you actually retrieved from a tool. " +
		"If the data does not support a conclusion, use classification 'inconclusive' " +
		"rather than guessing.",
	parameters: {
		type: "object",
		properties: {
			session_id: { type: "string" },
			classification: {
				type: "string",
				enum: [...CLASSIFICATIONS],
				description:
					"fall = robot fell and did not recover. " +
					"near_miss = destabilised but recovered. " +
					"external_collision = hit by something external. " +
					"nominal = nothing happened. " +
					"inconclusive = the data cannot support a conclusion.",
			},
			window_start_ms: {
				type: "number",
				description: "Start of the incident window in telemetry time. Omit if nominal.",
			},
			window_end_ms: { type: "number", description: "End of the incident window." },
			confidence: {
				type: "string",
				enum: ["high", "medium", "low"],
				description: "How confident you are. Use low when data quality is poor.",
			},
			summary: { type: "string", description: "One or two sentences on what happened." },
			evidence: {
				type: "array",
				description:
					"Concrete measurements supporting the classification. " +
					"Each entry must cite a real number you obtained from a tool.",
				items: { type: "string" },
			},
			caveats: {
				type: "array",
				description: "Data quality problems or things you could not verify. Empty array if none.",
				items: { type: "string" },
			},
			next_steps: {
				type: "array",
				description: "What a human should check next.",
				items: { type: "string" },
			},
		},
		required: ["session_id", "classification", "confidence", "summary", "evidence"],
	},

	async execute(args) {
		const sessionId = String(args.session_id ?? "");
		const classification = String(args.classification ?? "");

		// enum 驗證要自己做。模型「大部分時候」會遵守 schema，但不保證,
		// 而且不同 provider 的遵守程度不一樣。
		if (!CLASSIFICATIONS.includes(classification as (typeof CLASSIFICATIONS)[number])) {
			throw new Error(
				`Invalid classification "${classification}". Must be one of: ${CLASSIFICATIONS.join(", ")}`,
			);
		}

		const evidence = Array.isArray(args.evidence) ? args.evidence.map(String) : [];

		// 「有結論就必須有證據」這條規則用程式強制，不是用 prompt 請求。
		// 這是 harness 在替你把關模型的輸出品質。
		if (classification !== "nominal" && evidence.length === 0) {
			throw new Error(
				`A "${classification}" classification requires at least one evidence entry. ` +
					"Go back and query the telemetry, then cite the specific numbers you found.",
			);
		}

		const report = {
			session_id: sessionId,
			classification,
			confidence: String(args.confidence ?? "low"),
			window_start_ms: typeof args.window_start_ms === "number" ? args.window_start_ms : null,
			window_end_ms: typeof args.window_end_ms === "number" ? args.window_end_ms : null,
			summary: String(args.summary ?? ""),
			evidence,
			caveats: Array.isArray(args.caveats) ? args.caveats.map(String) : [],
			next_steps: Array.isArray(args.next_steps) ? args.next_steps.map(String) : [],
			// 這個欄位讓報告可追溯。真實系統還會記 model id、prompt 版本、資料版本。
			generated_at: new Date().toISOString(),
		};

		await mkdir(REPORT_DIR, { recursive: true });
		const path = resolve(REPORT_DIR, `${sessionId}.json`);
		await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, "utf8");

		return [
			`Report written for ${sessionId}`,
			`  classification: ${report.classification} (confidence: ${report.confidence})`,
			`  window: ${report.window_start_ms ?? "n/a"}..${report.window_end_ms ?? "n/a"}ms`,
			`  evidence: ${report.evidence.length} item(s)`,
			`  caveats: ${report.caveats.length} item(s)`,
		].join("\n");
	},
};

export { REPORT_DIR };
