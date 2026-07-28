import { LOG_LEVEL } from "./config.ts";

/**
 * The smallest logger that is still useful in production.
 *
 * Structured output (one JSON object per line) because grep on prose stops
 * working the moment you have more than one server.
 */

const LEVELS = ["debug", "info", "warn", "error"] as const;
export type Level = (typeof LEVELS)[number];

function enabled(level: Level): boolean {
	return LEVELS.indexOf(level) >= LEVELS.indexOf(LOG_LEVEL as Level);
}

function emit(level: Level, message: string, fields: Record<string, unknown>): void {
	if (!enabled(level)) return;
	const line = JSON.stringify({ level, message, ...fields, at: new Date().toISOString() });
	if (level === "error" || level === "warn") console.error(line);
	else console.log(line);
}

export const log = {
	debug: (message: string, fields: Record<string, unknown> = {}) => emit("debug", message, fields),
	info: (message: string, fields: Record<string, unknown> = {}) => emit("info", message, fields),
	warn: (message: string, fields: Record<string, unknown> = {}) => emit("warn", message, fields),
	error: (message: string, fields: Record<string, unknown> = {}) => emit("error", message, fields),
};

/** Times a block and logs how long it took. Used on every request. */
export async function timed<T>(name: string, fn: () => Promise<T> | T): Promise<T> {
	const started = Date.now();
	try {
		return await fn();
	} finally {
		log.debug("timing", { name, ms: Date.now() - started });
	}
}
