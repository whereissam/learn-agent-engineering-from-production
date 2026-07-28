import type { IncomingMessage, ServerResponse } from "node:http";
import { log } from "../logger.ts";
import { save } from "../store.ts";
import { validateUrl } from "../validate.ts";
import { json, readBody } from "./http.ts";

/**
 * POST /shorten
 *
 * Body: { "url": "https://example.com/very/long/path" }
 * 201:  { "code": "aB3xY9" }
 */
export async function createLink(req: IncomingMessage, res: ServerResponse): Promise<void> {
	const body = await readBody(req);

	let payload: { url?: unknown };
	try {
		payload = JSON.parse(body);
	} catch {
		return json(res, 400, { error: "invalid JSON body" });
	}

	const invalid = validateUrl(payload.url);
	if (invalid) {
		return json(res, 400, { error: invalid.message, field: invalid.field });
	}

	const code = save(payload.url as string);
	log.info("created link", { code });

	return json(res, 201, { code });
}
