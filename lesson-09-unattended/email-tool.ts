/**
 * An EXTERNAL tool that **really leaves a trace**.
 *
 * Why not a fake console.log: because Lesson 8 Step 7 taught something —
 * **a model falsely reports completing an action that was refused**. Catching that
 * requires the side effect to be independently verifiable rather than taken from what the model says.
 *
 * So send_email really writes a file into `outbox/`.
 * Afterwards, `ls outbox/` is the fact, and nothing the model says changes it.
 *
 * (It does not really send email, of course. The point is leaving a trace at all,
 * not SMTP.)
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Tool, ToolContext } from "../shared/tools/index.ts";

const OUTBOX = resolve(import.meta.dirname, "outbox");

export const sendEmailTool: Tool = {
	name: "send_email",
	description:
		"Send an email. This has an external side effect that cannot be undone. " +
		"Use it only when the user explicitly asks you to send something.",
	parameters: {
		type: "object",
		properties: {
			to: { type: "string", description: "Recipient address" },
			subject: { type: "string", description: "Subject line" },
			body: { type: "string", description: "Plain-text body" },
		},
		required: ["to", "subject", "body"],
	},
	mutating: true,

	async execute(args: Record<string, unknown>, _ctx: ToolContext): Promise<string> {
		const to = String(args.to ?? "");
		const subject = String(args.subject ?? "");
		const body = String(args.body ?? "");
		if (!to) throw new Error("send_email needs a `to` address");

		mkdirSync(OUTBOX, { recursive: true });
			// The filename is a content hash rather than a timestamp, so the demo is reproducible.
		const id = simpleHash(`${to}|${subject}|${body}`);
		const path = resolve(OUTBOX, `${id}.json`);
		writeFileSync(path, JSON.stringify({ to, subject, body }, null, 2));

		return `Email sent to ${to} (subject: ${subject}).`;
	},
};

/** The name `send_email` is already EXTERNAL in the BASE table in shared/permissions/risk.ts. */
export const OUTBOX_DIR = OUTBOX;

function simpleHash(text: string): string {
	let hash = 0;
	for (const char of text) hash = (Math.imul(31, hash) + char.charCodeAt(0)) | 0;
	return (hash >>> 0).toString(16).padStart(8, "0");
}
