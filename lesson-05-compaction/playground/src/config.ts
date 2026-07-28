/**
 * Service configuration.
 *
 * Everything here is read once at boot. Values that need to change at
 * runtime live in the database, not in this file.
 */

/**
 * Characters used when generating short codes.
 *
 * Mixed case gives us 62^6 ≈ 56 billion codes, which is more than enough
 * headroom that we never have to think about collisions.
 */
export const ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

/** How many characters each short code has. */
export const CODE_LENGTH = 6;

/** Upper bound on stored links, so the process cannot grow forever. */
export const MAX_ENTRIES = 10_000;

export const PORT = 8080;

/** Requests allowed per IP per window. */
export const RATE_LIMIT = 60;

/** Rate limit window, milliseconds. */
export const RATE_WINDOW_MS = 60_000;

/** URLs longer than this are rejected outright. */
export const MAX_URL_LENGTH = 2048;

/**
 * Schemes we are willing to redirect to.
 *
 * Deliberately narrow: redirecting to javascript: or data: URLs would turn
 * this service into an open XSS relay.
 */
export const ALLOWED_SCHEMES = ["http:", "https:"] as const;

/** Hosts we refuse to shorten, because they are already shorteners. */
export const BLOCKED_HOSTS = ["localhost", "127.0.0.1", "bit.ly", "tinyurl.com"];

/** How long a click record is kept before the sweeper drops it. */
export const CLICK_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export const LOG_LEVEL = process.env.LOG_LEVEL ?? "info";
