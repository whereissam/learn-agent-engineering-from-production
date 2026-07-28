import type { ServerResponse } from "node:http";
import { statsFor, top, totalClicks } from "../analytics.ts";
import { lookup, size } from "../store.ts";
import { validateCode } from "../validate.ts";
import { json } from "./http.ts";

/**
 * GET /stats/:code   → click count for one link
 * GET /stats         → service-wide summary
 */
export function linkStats(res: ServerResponse, code: string): void {
	const invalid = validateCode(code);
	if (invalid) return json(res, 400, { error: invalid.message });

	if (!lookup(code)) {
		return json(res, 404, { error: "no such short link" });
	}

	return json(res, 200, statsFor(code));
}

export function summary(res: ServerResponse): void {
	return json(res, 200, {
		links: size(),
		clicks: totalClicks(),
		top: top(5),
	});
}
