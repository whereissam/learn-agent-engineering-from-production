import { ALLOWED_SCHEMES, BLOCKED_HOSTS, MAX_URL_LENGTH } from "./config.ts";

/**
 * URL validation.
 *
 * Everything that decides "is this URL acceptable" lives here, so that the
 * route handlers stay boring. Boring route handlers are the goal.
 */

export interface ValidationError {
	field: string;
	message: string;
}

export function validateUrl(raw: unknown): ValidationError | undefined {
	if (typeof raw !== "string" || raw.length === 0) {
		return { field: "url", message: "url is required" };
	}

	if (raw.length > MAX_URL_LENGTH) {
		return { field: "url", message: `url must be at most ${MAX_URL_LENGTH} characters` };
	}

	let parsed: URL;
	try {
		parsed = new URL(raw);
	} catch {
		return { field: "url", message: "url is not a valid absolute URL" };
	}

	if (!ALLOWED_SCHEMES.includes(parsed.protocol as (typeof ALLOWED_SCHEMES)[number])) {
		return { field: "url", message: `scheme ${parsed.protocol} is not allowed` };
	}

	if (BLOCKED_HOSTS.includes(parsed.hostname)) {
		return { field: "url", message: `host ${parsed.hostname} is not allowed` };
	}

	return undefined;
}

/**
 * Short codes arrive from the URL path, so they are attacker-controlled.
 * Anything that is not exactly our code shape is rejected before it reaches
 * the store.
 */
export function validateCode(code: string): ValidationError | undefined {
	if (!/^[A-Za-z0-9]{4,12}$/.test(code)) {
		return { field: "code", message: "code has an unexpected shape" };
	}
	return undefined;
}
