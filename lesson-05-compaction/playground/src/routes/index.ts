import type { IncomingMessage, ServerResponse } from "node:http";
import { createLink } from "./create.ts";
import { redirect } from "./redirect.ts";
import { linkStats, summary } from "./stats.ts";

/**
 * Route table.
 *
 * `server.ts` matches paths inline for speed on the hot path; this table
 * exists so that the endpoint list is discoverable in one place, and so that
 * tests can exercise handlers without starting a server.
 */

export interface Route {
	method: "GET" | "POST";
	/** Literal path, or a prefix ending in `/` for parameterised routes. */
	path: string;
	handler: string;
	description: string;
	/** Whether the handler counts against the per-IP rate limit. */
	rateLimited: boolean;
}

export const ROUTES: Route[] = [
	{
		method: "POST",
		path: "/shorten",
		handler: "createLink",
		description: "Create a short link from a long URL",
		rateLimited: true,
	},
	{
		method: "GET",
		path: "/health",
		handler: "inline",
		description: "Liveness probe with the current link count",
		rateLimited: false,
	},
	{
		method: "GET",
		path: "/stats",
		handler: "summary",
		description: "Service-wide totals and the most followed codes",
		rateLimited: true,
	},
	{
		method: "GET",
		path: "/stats/",
		handler: "linkStats",
		description: "Click count for one code",
		rateLimited: true,
	},
	{
		method: "GET",
		path: "/",
		handler: "redirect",
		description: "Follow a short code (the hot path)",
		rateLimited: true,
	},
];

export { createLink, linkStats, redirect, summary };

export type Handler = (req: IncomingMessage, res: ServerResponse, param: string) => unknown;
