import { createServer } from "node:http";
import { PORT } from "./config.ts";
import { lookup, save, size } from "./store.ts";

const server = createServer(async (req, res) => {
	const path = req.url ?? "/";

	if (req.method === "POST" && path === "/shorten") {
		const body = await readBody(req);

		let url: string;
		try {
			url = JSON.parse(body).url;
		} catch {
			return json(res, 400, { error: "invalid JSON body" });
		}

		if (typeof url !== "string" || !url.startsWith("http")) {
			return json(res, 400, { error: "url must be an http(s) URL" });
		}

		const code = save(url);
		return json(res, 201, { code });
	}

	if (req.method === "GET" && path === "/health") {
		return json(res, 200, { ok: true, links: size() });
	}

	if (req.method === "GET") {
		const code = path.slice(1);
		const url = lookup(code);

		if (!url) {
			return json(res, 404, { error: "no such short link" });
		}

		res.writeHead(302, { Location: url });
		return res.end();
	}

	return json(res, 405, { error: "method not allowed" });
});

function readBody(req: import("node:http").IncomingMessage): Promise<string> {
	return new Promise((resolve) => {
		let data = "";
		req.on("data", (chunk) => {
			data += chunk;
		});
		req.on("end", () => resolve(data));
	});
}

function json(res: import("node:http").ServerResponse, status: number, payload: unknown): void {
	res.writeHead(status, { "Content-Type": "application/json" });
	res.end(JSON.stringify(payload));
}

server.listen(PORT, () => {
	console.log(`listening on http://localhost:${PORT}`);
});
