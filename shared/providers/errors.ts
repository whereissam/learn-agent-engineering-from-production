/**
 * Turning a provider's failure into a sentence you can act on.
 *
 * ## The failure this file exists because of
 *
 * Lesson 32's experiment reported this, twelve times in a row:
 *
 *     400 status code (no body)
 *
 * which is what the OpenAI SDK produces when it cannot find a message in the
 * error body. The body was not empty. Google's OpenAI-compatible endpoint had
 * answered:
 *
 *     [{"error": {"code": 400,
 *                 "message": "User location is not supported for the API use.",
 *                 "status": "FAILED_PRECONDITION"}}]
 *
 * A **JSON array**, where the SDK looks for `body.error.message` on an object.
 * So the one sentence that explains everything — it is a geography block, not a
 * bad key, and no amount of retrying or re-keying will help — was parsed,
 * attached to the exception as `.error`, and then thrown away at the point where
 * a human reads it.
 *
 * That cost this repo an hour and produced a wrong diagnosis in a written
 * report. Which is the general lesson, and it is not about Google:
 *
 * > **An error message is a product surface.** The agent loop hands provider
 * > failures to a person, or to a model, and both act on the text. "400 status
 * > code (no body)" tells you the shape of the failure and nothing about its
 * > cause, so whoever reads it invents a cause.
 *
 * Lesson 29's thesis, one layer down: a report must not be more confident than
 * the facts behind it.
 */

/** How deep to walk a provider's error body. Bodies are small; a cycle or a huge blob is not worth chasing. */
const MAX_DEPTH = 6;

/**
 * Pull the first human-readable message out of an arbitrarily shaped error body.
 *
 * Deliberately structure-agnostic. Every vendor nests it differently — and the
 * point of this file is that today's guess about the shape is tomorrow's
 * "(no body)".
 */
function findMessage(value: unknown, depth = 0): string | undefined {
	if (depth > MAX_DEPTH || value == null) return undefined;

	if (typeof value === "string") {
		const trimmed = value.trim();
		return trimmed.length > 0 ? trimmed : undefined;
	}

	if (Array.isArray(value)) {
		for (const item of value) {
			const found = findMessage(item, depth + 1);
			if (found) return found;
		}
		return undefined;
	}

	if (typeof value === "object") {
		const record = value as Record<string, unknown>;
		// `message` first, then the fields vendors use when they do not have one.
		for (const key of ["message", "detail", "description", "reason"]) {
			const found = findMessage(record[key], depth + 1);
			if (found) return found;
		}
		for (const key of ["error", "errors", "data", "body"]) {
			const found = findMessage(record[key], depth + 1);
			if (found) return found;
		}
	}

	return undefined;
}

/** Vendor status strings worth keeping alongside the message: they say whether retrying can possibly help. */
function findStatusHint(value: unknown, depth = 0): string | undefined {
	if (depth > MAX_DEPTH || value == null || typeof value !== "object") return undefined;

	if (Array.isArray(value)) {
		for (const item of value) {
			const found = findStatusHint(item, depth + 1);
			if (found) return found;
		}
		return undefined;
	}

	const record = value as Record<string, unknown>;
	for (const key of ["status", "type", "code"]) {
		const candidate = record[key];
		// A numeric code duplicates the HTTP status; only the symbolic ones add anything.
		if (typeof candidate === "string" && /^[A-Z][A-Z_]{2,}$/.test(candidate)) return candidate;
	}
	for (const key of ["error", "errors", "data", "body"]) {
		const found = findStatusHint(record[key], depth + 1);
		if (found) return found;
	}
	return undefined;
}

/**
 * Describe a provider failure in one line.
 *
 * Shape: `<http status> <message> [<VENDOR_STATUS>]`, falling back to whatever
 * the exception carries. Never throws — an error path that can fail is worse
 * than no error path.
 */
export function describeProviderError(error: unknown): string {
	if (!(error instanceof Error)) return String(error);

	const record = error as unknown as Record<string, unknown>;
	const status = typeof record.status === "number" ? record.status : undefined;

	let body: string | undefined;
	let hint: string | undefined;
	try {
		body = findMessage(record.error);
		hint = findStatusHint(record.error);
	} catch {
		// A pathological body is not worth losing the status over.
	}

	// The SDK's own message is usually right; it is only useless when it could
	// not find anything in the body, and that is exactly when `body` helps.
	const uninformative = !error.message || /\(no body\)|^\d{3} status code$/.test(error.message);
	const text = uninformative && body ? body : error.message || body;

	const parts: string[] = [];
	if (status !== undefined && text && !text.startsWith(String(status))) parts.push(String(status));
	if (text) parts.push(text);
	if (hint && text && !text.includes(hint)) parts.push(`[${hint}]`);

	return parts.length > 0 ? parts.join(" ") : String(error);
}
