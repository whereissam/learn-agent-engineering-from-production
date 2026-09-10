/**
 * Lesson 11, the offline half: the three things that go wrong with a credential.
 *
 * No API key. Every failure here is deterministic — a token is expired or it is
 * not, a secret is in a string or it is not, a request used one person's token
 * or another's. What a *model* does when a tool says "unauthorized" is `agent.ts`.
 *
 * Run: bun run lesson-11
 */

import { makeCalendarTool } from "./tool.ts";
import { redacted, ReauthRequired, TokenExpired, type Token, TokenVault } from "./vault.ts";

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;

const NOW = 1_800_000_000_000;
const SERVER = "calendar";

/**
 * The fixture credential, following Lesson 31's convention: the string says
 * DEMOONLY and its entropy is zeros.
 *
 * Not cosmetic. A lesson whose subject is credentials leaking into text is
 * exactly the lesson a secret scanner will flag, and the first version used a
 * random-looking hex suffix that tripped GitGuardian on the pull request. A
 * fixture has to be legible as a fixture to a machine as well as a reader.
 */
const FAKE_ACCESS_TOKEN = "at_DEMOONLY_user-a_0000000000";

function token(owner: string, offsetMs: number, refreshable = true): Token {
	return {
		accessToken: `at_DEMOONLY_${owner}_0000000000`,
		refreshToken: refreshable ? `rt_DEMOONLY_${owner}_0000000000` : undefined,
		expiresAt: NOW + offsetMs,
		scope: owner,
	};
}

console.log(bold("Lesson 11: the credential the agent is holding"));
console.log(dim("A tool behind a token. Three ways that goes wrong, none of them the OAuth dance.\n"));

// ─────────────────────────────────────────────────────────────
// Step 1: the function that cannot answer its own question
// ─────────────────────────────────────────────────────────────

console.log(bold("Step 1: hasValidTokens() on an expired token"));
{
	const vault = new TokenVault("user+server");
	vault.put({ userId: "user-a", server: SERVER, token: token("user-a", -60_000) });

	console.log(`  hasValidTokens()  ${vault.hasValidTokens("user-a", SERVER) ? red("true") : green("false")}`);
	try {
		vault.get("user-a", SERVER, NOW);
		console.log(`  get()             ${green("returned a token")}`);
	} catch (error) {
		const name = error instanceof Error ? error.name : "?";
		console.log(`  get()             ${green(name)}`);
	}
}
console.log(
	dim(
		"\n  Both are asking about the same token. The first is Mastra's, reproduced\n" +
			"  faithfully (oauth-provider.ts:368) — it checks that a string is present,\n" +
			"  not that it works, and its own comment says so:\n",
	),
);
console.log(dim("    // Note: Token expiration checking would require parsing the JWT"));
console.log(dim("    // or tracking when we received the token.\n"));
console.log(
	yellow(
		"  A name that promises a question the function cannot answer is inherited by\n" +
			"  every layer above it. That is why this vault stores expiresAt at all.\n",
	),
);

// ─────────────────────────────────────────────────────────────
// Step 2: the error message is a data boundary
// ─────────────────────────────────────────────────────────────

console.log(bold("Step 2: what the tool says when the token has expired"));

for (const errorStyle of ["verbose", "careful"] as const) {
	const vault = new TokenVault("user+server");
	vault.put({ userId: "user-a", server: SERVER, token: token("user-a", -60_000) });
	const tool = makeCalendarTool({ vault, userId: "user-a", errorStyle, autoRefresh: false, now: () => NOW });
	const result = tool.run();

	// The literal token, not something derived from the vault: the first draft of
	// this line asked hasValidTokens() first, got `true` (Step 1), compared against
	// an empty string, and reported every message as a leak.
	const leaked = result.text.includes(FAKE_ACCESS_TOKEN);

	console.log(`\n  ${errorStyle.padEnd(8)} ${leaked ? red("LEAKS THE TOKEN") : green("no credential in the text")}`);
	for (const line of result.text.split("\n")) console.log(dim(`           ${line}`));
}

console.log(
	dim(
		"\n  The verbose version is not a straw man: dumping the failing request is what\n" +
			"  every helpful HTTP client does, and an Authorization header is part of a\n" +
			"  request. That string now goes to the model, the trace and memory — the\n" +
			"  three boundaries Lesson 31 built pipelines for, and it crosses all three.\n",
	),
);

// ─────────────────────────────────────────────────────────────
// Step 3: one key short of a security boundary
// ─────────────────────────────────────────────────────────────

console.log(bold("Step 3: two users, one vault"));

for (const keying of ["server", "user+server"] as const) {
	const vault = new TokenVault(keying);
	// user-a connects first, then user-b connects to the same service.
	vault.put({ userId: "user-a", server: SERVER, token: token("user-a", 60_000) });
	vault.put({ userId: "user-b", server: SERVER, token: token("user-b", 60_000) });

	const tool = makeCalendarTool({ vault, userId: "user-a", errorStyle: "careful", autoRefresh: false, now: () => NOW });
	const result = tool.run();

	const read = vault.reads.at(-1);
	const crossed = read !== undefined && read.userId !== read.tokenOwner;

	console.log(
		`  keyed by ${keying.padEnd(12)} user-a asked, ` +
			`token belonged to ${crossed ? red(read?.tokenOwner ?? "?") : green(read?.tokenOwner ?? "?")}`,
	);
	console.log(dim(`      returned: ${result.text}`));
}

console.log(
	yellow(
		"\n  Keyed by server, user-a is handed user-b's calendar, including the line\n" +
			"  marked CONFIDENTIAL. Nothing failed. No error was raised. The agent did\n" +
			"  exactly what it was asked and answered the wrong person's question.\n",
	),
);
console.log(
	dim(
		"  Mastra's storage interface is set(key, value) and the provider writes to\n" +
			"  the literal key 'tokens' (oauth-provider.ts:300). There is no user\n" +
			"  dimension in it, so a shared provider is this bug, and the interface\n" +
			"  will not remind you.\n",
	),
);

// ─────────────────────────────────────────────────────────────
// Step 4: two failures that look identical and are not
// ─────────────────────────────────────────────────────────────

console.log(bold("Step 4: expired, versus gone"));

const cases: Array<{ label: string; token: Token | undefined }> = [
	{ label: "expired, refreshable", token: token("user-a", -60_000, true) },
	{ label: "expired, no refresh", token: token("user-a", -60_000, false) },
	{ label: "revoked entirely", token: undefined },
];

for (const testCase of cases) {
	const vault = new TokenVault("user+server");
	if (testCase.token) vault.put({ userId: "user-a", server: SERVER, token: testCase.token });

	let verdict: string;
	try {
		vault.get("user-a", SERVER, NOW);
		verdict = green("usable");
	} catch (error) {
		verdict =
			error instanceof TokenExpired
				? yellow("TokenExpired — a machine can fix this")
				: error instanceof ReauthRequired
					? red("ReauthRequired — only a person can fix this")
					: "?";
	}
	console.log(`  ${testCase.label.padEnd(22)} ${verdict}`);
}

console.log(
	dim(
		"\n  Both arrive from upstream as 401. Collapsing them into one error is how an\n" +
			"  agent retries something no retry will fix — and Step 3 of agent.ts counts\n" +
			"  how many times a real model does exactly that.\n",
	),
);

// ─────────────────────────────────────────────────────────────
// Step 5: the retry that works
// ─────────────────────────────────────────────────────────────

console.log(bold("Step 5: refreshing before the model ever hears about it"));
{
	const vault = new TokenVault("user+server");
	vault.put({ userId: "user-a", server: SERVER, token: token("user-a", -60_000) });
	const tool = makeCalendarTool({ vault, userId: "user-a", errorStyle: "careful", autoRefresh: true, now: () => NOW });
	const result = tool.run();

	console.log(`  attempts: ${tool.calls.map((call) => call.outcome).join(" → ")}`);
	console.log(`  result:   ${result.isError ? red(result.text) : green(result.text)}`);
	console.log(
		dim(`  the token in the vault is now ${redacted(vault.get("user-a", SERVER, NOW).accessToken)}, valid again`),
	);
}

console.log(
	dim(
		"\n  The model was never told anything happened, which is correct: a credential\n" +
			"  renewal is not a decision it can help with, and telling it only spends\n" +
			"  context and invites improvisation.\n",
	),
);

console.log(bold("In one sentence"));
console.log(
	dim(
		"A credential has a lifetime, an owner, and a blast radius — and an agent that\n" +
			"models it as a string gets all three wrong at once.\n",
	),
);
