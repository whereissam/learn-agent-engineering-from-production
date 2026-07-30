/**
 * create_incident_report: this lesson's only tool with a side effect.
 *
 * It demonstrates another key point in domain tool design: **use a schema to force structured thinking.**
 *
 * Given only a write_file, a model writes prose. Prose cannot:
 *   - be checked programmatically (needed by Lesson 7's evaluation)
 *   - go into a database or a dashboard
 *   - guarantee evidence was actually cited
 *
 * Split "conclusion", "confidence" and "evidence" into required fields and the model cannot be vague.
 * Far more effective than asking it in a prompt to "please attach evidence".
 */

import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Tool } from "../../shared/tools/registry.ts";

const REPORT_DIR = resolve(import.meta.dirname, "../reports");

/** The classification is a fixed set of options, not free text. That is what makes downstream statistics possible. */
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

			// Enum validation is your job. A model follows a schema **most of the time** without guaranteeing it,
			// and different providers follow it to different degrees.
		if (!CLASSIFICATIONS.includes(classification as (typeof CLASSIFICATIONS)[number])) {
			throw new Error(
				`Invalid classification "${classification}". Must be one of: ${CLASSIFICATIONS.join(", ")}`,
			);
		}

		const evidence = Array.isArray(args.evidence) ? args.evidence.map(String) : [];

			// "A conclusion requires evidence" is enforced by code rather than requested in a prompt.
			// This is the harness policing the model's output quality for you.
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
				// This field makes a report traceable. A real system also records the model id, prompt version and data version.
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
