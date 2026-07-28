import { createServer } from "node:http";
import { sweep as sweepClicks } from "./analytics.ts";
import { PORT } from "./config.ts";
import { log, timed } from "./logger.ts";
import { allow, sweep as sweepWindows } from "./rate-limit.ts";
import { createLink } from "./routes/create.ts";
import { clientId, json } from "./routes/http.ts";
import { redirect } from "./routes/redirect.ts";
import { linkStats, summary } from "./routes/stats.ts";
import { size } from "./store.ts";

/**
 * HTTP entry point.
 *
 * The router stays deliberately dumb: match the path, hand off to a handler.
 * Anything that needs a decision lives in the handler or in a module it calls.
 */

const server = createServer(async (req, res) => {
	const path = (req.url ?? "/").split("?")[0] ?? "/";
	const method = req.method ?? "GET";

	if (!allow(clientId(req))) {
		return json(res, 429, { error: "rate limit exceeded" });
	}

	try {
		await timed(`${method} ${path}`, async () => {
			if (method === "POST" && path === "/shorten") {
				return await createLink(req, res);
			}

			if (method === "GET" && path === "/health") {
				return json(res, 200, { ok: true, links: size() });
			}

			if (method === "GET" && path === "/stats") {
				return summary(res);
			}

			if (method === "GET" && path.startsWith("/stats/")) {
				return linkStats(res, path.slice("/stats/".length));
			}

			if (method === "GET" && path !== "/") {
				return redirect(req, res, path.slice(1));
			}

			return json(res, 404, { error: "not found" });
		});
	} catch (error) {
		log.error("unhandled", { path, error: String(error) });
		if (!res.headersSent) json(res, 500, { error: "internal error" });
	}
});

/** Housekeeping. Both sweepers are cheap and idempotent. */
const sweeper = setInterval(() => {
	sweepWindows();
	sweepClicks();
}, 60_000);
sweeper.unref();

server.listen(PORT, () => {
	log.info("listening", { port: PORT });
});
