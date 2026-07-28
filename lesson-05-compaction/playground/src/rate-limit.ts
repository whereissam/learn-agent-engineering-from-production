import { RATE_LIMIT, RATE_WINDOW_MS } from "./config.ts";
import { log } from "./logger.ts";

/**
 * Fixed-window rate limiting, in memory.
 *
 * Fixed window (rather than sliding) is a deliberate trade: it allows a burst
 * of up to 2x the limit across a window boundary, but it costs one integer per
 * client instead of a list of timestamps. At our traffic that trade is fine.
 *
 * In-memory means every process has its own counter. With more than one
 * process this becomes advisory rather than enforcing.
 */

interface Window {
	count: number;
	resetAt: number;
}

const windows = new Map<string, Window>();

export function allow(clientId: string, now = Date.now()): boolean {
	const existing = windows.get(clientId);

	if (!existing || now >= existing.resetAt) {
		windows.set(clientId, { count: 1, resetAt: now + RATE_WINDOW_MS });
		return true;
	}

	existing.count += 1;
	if (existing.count > RATE_LIMIT) {
		log.warn("rate limited", { clientId, count: existing.count });
		return false;
	}
	return true;
}

/** Drop expired windows so the map does not grow without bound. */
export function sweep(now = Date.now()): number {
	let removed = 0;
	for (const [clientId, window] of windows) {
		if (now >= window.resetAt) {
			windows.delete(clientId);
			removed++;
		}
	}
	return removed;
}

export function remaining(clientId: string, now = Date.now()): number {
	const window = windows.get(clientId);
	if (!window || now >= window.resetAt) return RATE_LIMIT;
	return Math.max(0, RATE_LIMIT - window.count);
}
