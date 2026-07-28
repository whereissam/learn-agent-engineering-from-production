import type { IncomingMessage, ServerResponse } from "node:http";

/** Shared response helpers. Kept tiny on purpose. */

export function json(res: ServerResponse, status: number, payload: unknown): void {
	const body = JSON.stringify(payload);
	res.writeHead(status, {
		"Content-Type": "application/json",
		"Content-Length": Buffer.byteLength(body),
	});
	res.end(body);
}

export function readBody(req: IncomingMessage, limit = 64 * 1024): Promise<string> {
	return new Promise((resolve, reject) => {
		let data = "";
		req.on("data", (chunk) => {
			data += chunk;
			if (data.length > limit) {
				reject(new Error("body too large"));
				req.destroy();
			}
		});
		req.on("end", () => resolve(data));
		req.on("error", reject);
	});
}

export function clientId(req: IncomingMessage): string {
	const forwarded = req.headers["x-forwarded-for"];
	if (typeof forwarded === "string") return forwarded.split(",")[0]?.trim() ?? "unknown";
	return req.socket.remoteAddress ?? "unknown";
}
