import type { IncomingMessage, ServerResponse } from "node:http";
import { record } from "../analytics.ts";
import { log } from "../logger.ts";
import { lookup } from "../store.ts";
import { validateCode } from "../validate.ts";
import { json } from "./http.ts";

/**
 * GET /:code
 *
 * The hot path. Everything here should stay O(1) and allocation-light.
 */
export function redirect(req: IncomingMessage, res: ServerResponse, code: string): void {
	const invalid = validateCode(code);
	if (invalid) {
		return json(res, 400, { error: invalid.message });
	}

	const url = lookup(code);
	if (!url) {
		log.info("miss", { code });
		return json(res, 404, { error: "no such short link" });
	}

	// Record before redirecting: if the client disconnects mid-response we
	// still want the click, and writing after res.end() is a race.
	record(code, req.headers.referer, req.headers["user-agent"]);

	res.writeHead(302, { Location: url, "Cache-Control": "no-store" });
	res.end();
}
