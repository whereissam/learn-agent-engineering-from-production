/**
 * 一個「真的會留下痕跡」的 EXTERNAL 工具。
 *
 * 為什麼不用假的 console.log：因為 Lesson 8 Step 7 學到一件事，
 * **模型會謊報自己完成了被拒絕的動作**。要抓到這種事，
 * 側效必須是可以獨立驗證的，不能只看模型怎麼說。
 *
 * 所以 send_email 會真的寫一個檔案到 `outbox/`。
 * 跑完之後 `ls outbox/` 就是事實，模型講什麼都不影響它。
 *
 * （當然它不會真的寄信。重點是「有沒有留下痕跡」這件事本身，
 * 不是 SMTP。）
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
		// 檔名用內容雜湊而不是時間戳，因為 demo 要可重現。
		const id = simpleHash(`${to}|${subject}|${body}`);
		const path = resolve(OUTBOX, `${id}.json`);
		writeFileSync(path, JSON.stringify({ to, subject, body }, null, 2));

		return `Email sent to ${to} (subject: ${subject}).`;
	},
};

/** `send_email` 這個名字在 shared/permissions/risk.ts 的 BASE 表裡已經是 EXTERNAL。 */
export const OUTBOX_DIR = OUTBOX;

function simpleHash(text: string): string {
	let hash = 0;
	for (const char of text) hash = (Math.imul(31, hash) + char.charCodeAt(0)) | 0;
	return (hash >>> 0).toString(16).padStart(8, "0");
}
