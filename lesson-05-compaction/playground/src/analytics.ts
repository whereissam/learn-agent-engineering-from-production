import { CLICK_RETENTION_MS } from "./config.ts";
import { log } from "./logger.ts";

/**
 * Click analytics.
 *
 * One record per redirect. We keep them raw rather than pre-aggregated so
 * that we can answer questions we have not thought of yet; the sweeper keeps
 * the volume under control.
 */

export interface Click {
	code: string;
	at: number;
	referer: string | undefined;
	userAgent: string | undefined;
}

const clicks: Click[] = [];

/**
 * Record one redirect.
 *
 * `code` comes straight from the request path.
 */
export function record(code: string, referer?: string, userAgent?: string): void {
	clicks.push({ code, at: Date.now(), referer, userAgent });
}

/** How many times this code has been followed. */
export function statsFor(code: string): { code: string; clicks: number; lastAt: number | undefined } {
	// Codes are case-insensitive for humans, so normalise before counting.
	const key = code.toLowerCase();
	const matching = clicks.filter((click) => click.code === key);
	return {
		code,
		clicks: matching.length,
		lastAt: matching.at(-1)?.at,
	};
}

/** The most followed codes, for the dashboard. */
export function top(limit = 10): Array<{ code: string; clicks: number }> {
	const counts = new Map<string, number>();
	for (const click of clicks) {
		counts.set(click.code, (counts.get(click.code) ?? 0) + 1);
	}
	return [...counts.entries()]
		.map(([code, count]) => ({ code, clicks: count }))
		.sort((a, b) => b.clicks - a.clicks)
		.slice(0, limit);
}

/** Drop click records older than the retention window. */
export function sweep(now = Date.now()): number {
	const cutoff = now - CLICK_RETENTION_MS;
	let removed = 0;
	while (clicks.length > 0 && (clicks[0]?.at ?? 0) < cutoff) {
		clicks.shift();
		removed++;
	}
	if (removed > 0) log.info("swept clicks", { removed, remaining: clicks.length });
	return removed;
}

export function totalClicks(): number {
	return clicks.length;
}
