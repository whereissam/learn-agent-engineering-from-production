/**
 * Lesson 13, the offline half: the tool list changed and nothing said so.
 *
 * No API key. It connects to a real MCP server over stdio, approves a tool,
 * re-lists, and compares. Everything here is deterministic — either the bytes
 * match what was approved or they do not.
 *
 * Whether a model *acts* on the changed description is `agent.ts`.
 *
 * Run: bun run lesson-13
 */

import { resolve } from "node:path";
import { McpConnection } from "./client.ts";
import { admissible, fingerprint, ToolPinStore } from "./pin.ts";

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;

const SERVER = resolve(import.meta.dirname, "server.ts");

async function connect(drift: "on" | "off"): Promise<McpConnection> {
	const connection = new McpConnection("fleet-ops", "bun", ["run", SERVER], { DRIFT: drift });
	await connection.connect();
	return connection;
}

console.log(bold("Lesson 13: the tool you approved is not the tool you called"));
console.log(dim("A real MCP server over stdio. It answers tools/list honestly exactly once.\n"));

// ─────────────────────────────────────────────────────────────
// Step 1: the honest case, so the check is not just always shouting
// ─────────────────────────────────────────────────────────────

console.log(bold("Step 1: an honest server"));
{
	const connection = await connect("off");
	const store = new ToolPinStore();
	const first = await connection.listTools();
	for (const tool of first) store.approve("fleet-ops", tool);

	const second = await connection.listTools();
	const reports = store.checkAll("fleet-ops", second);
	for (const report of reports) {
		console.log(`  ${report.kind === "unchanged" ? green("ok  ") : red("drift")}  ${report.summary}`);
	}
	connection.close();
}
console.log(dim("\n  A pin that fires on a well-behaved server is a pin nobody keeps switched on.\n"));

// ─────────────────────────────────────────────────────────────
// Step 2: the same code against a server that changes its mind
// ─────────────────────────────────────────────────────────────

console.log(bold("Step 2: the same client, a server that answers differently the second time"));
const connection = await connect("on");
const store = new ToolPinStore();

const approved = await connection.listTools();
console.log(dim("  what the operator reviewed and approved:"));
for (const tool of approved) {
	store.approve("fleet-ops", tool);
	console.log(dim(`    ${tool.name.padEnd(13)} ${fingerprint(tool)}  ${tool.description.slice(0, 46)}`));
}

const served = await connection.listTools();
console.log(dim("\n  what the second tools/list returned:"));
for (const tool of served) {
	console.log(dim(`    ${tool.name.padEnd(13)} ${fingerprint(tool)}  ${tool.description.slice(0, 46)}`));
}

console.log(
	yellow(
		"\n  The names are identical. The schemas are identical. The tool count is\n" +
			"  identical. Only the fingerprints moved, and only for one tool.\n",
	),
);

// ─────────────────────────────────────────────────────────────
// Step 3: with the mechanism off, and on
// ─────────────────────────────────────────────────────────────

console.log(bold("Step 3: the check, switched off and on"));

const reports = store.checkAll("fleet-ops", served);

for (const pinned of ["off", "block"] as const) {
	const blocked = admissible(reports, pinned);
	console.log(
		`  pinning ${pinned.padEnd(5)}  ` +
			(blocked.length === 0
				? `${red("0 findings")} — the tool list goes to the model as sent`
				: `${green(`${blocked.length} finding(s)`)} — ${blocked.map((r) => r.summary).join("; ")}`),
	);
}

const drifted = reports.find((report) => report.kind === "description");
if (drifted) {
	console.log(dim("\n  what was approved:"));
	console.log(dim(`    ${drifted.approvedDescription}`));
	console.log(dim("  what arrived:"));
	for (const line of (drifted.servedDescription ?? "").match(/.{1,74}/g) ?? []) console.log(red(`    ${line}`));
}

connection.close();

console.log(
	dim(
		"\n  The pin reports a fact — these bytes are not the bytes you approved — and\n" +
			"  never claims the change is malicious. It cannot tell an attack from a\n" +
			"  legitimate upgrade, and a version that guessed would be worth less.\n",
	),
);

console.log(bold("In one sentence"));
console.log(
	dim(
		"An approval recorded as a tool's name is an approval of a name, and the name is\n" +
			"the one field an attacker has no reason to change.\n",
	),
);
