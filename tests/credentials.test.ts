import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { makeCalendarTool } from "../lesson-11-credentials/tool.ts";
import { redacted, ReauthRequired, TokenExpired, type Token, TokenVault } from "../lesson-11-credentials/vault.ts";

const NOW = 1_800_000_000_000;
const SERVER = "calendar";

function token(owner: string, offsetMs: number, refreshable = true): Token {
	return {
		accessToken: `at_DEMOONLY_${owner}_0000000000`,
		refreshToken: refreshable ? `rt_DEMOONLY_${owner}_0000000000` : undefined,
		expiresAt: NOW + offsetMs,
		scope: owner,
	};
}

function vaultWith(keying: "server" | "user+server" = "user+server"): TokenVault {
	const vault = new TokenVault(keying);
	vault.put({ userId: "user-a", server: SERVER, token: token("user-a", 60_000) });
	return vault;
}

describe("token lifetime（Lesson 11）", () => {
	test("a live token is returned", () => {
		assert.equal(vaultWith().get("user-a", SERVER, NOW).scope, "user-a");
	});

	test("an expired token with a refresh token asks the machine to fix it", () => {
		const vault = new TokenVault();
		vault.put({ userId: "user-a", server: SERVER, token: token("user-a", -1) });
		assert.throws(() => vault.get("user-a", SERVER, NOW), TokenExpired);
	});

	test("an expired token with no refresh token asks for a human", () => {
		const vault = new TokenVault();
		vault.put({ userId: "user-a", server: SERVER, token: token("user-a", -1, false) });
		assert.throws(() => vault.get("user-a", SERVER, NOW), ReauthRequired);
	});

	test("a revoked token is not the same failure as an expired one", () => {
		const vault = vaultWith();
		vault.revoke("user-a", SERVER);
		assert.throws(() => vault.get("user-a", SERVER, NOW), ReauthRequired);
	});

	test("refresh produces a token that is actually usable", () => {
		const vault = new TokenVault();
		vault.put({ userId: "user-a", server: SERVER, token: token("user-a", -1) });
		const refreshed = vault.refresh("user-a", SERVER, NOW);
		assert.ok(refreshed.expiresAt > NOW);
		assert.notEqual(refreshed.accessToken, token("user-a", -1).accessToken);
		assert.doesNotThrow(() => vault.get("user-a", SERVER, NOW));
	});

	/**
	 * Mastra's `hasValidTokens` (`oauth-provider.ts:368`) checks that a string is
	 * present, not that it works, and says so in its own comment. Reproduced
	 * faithfully — this test exists so the gap cannot be quietly closed and the
	 * lesson's Step 1 left describing something that no longer happens.
	 */
	test("hasValidTokens() says true for an expired token, exactly as the source does", () => {
		const vault = new TokenVault();
		vault.put({ userId: "user-a", server: SERVER, token: token("user-a", -60_000) });
		assert.equal(vault.hasValidTokens("user-a", SERVER), true);
		assert.throws(() => vault.get("user-a", SERVER, NOW), TokenExpired);
	});
});

describe("who the token belongs to（Lesson 11）", () => {
	test("keyed by user+server, each caller gets their own token", () => {
		const vault = new TokenVault("user+server");
		vault.put({ userId: "user-a", server: SERVER, token: token("user-a", 60_000) });
		vault.put({ userId: "user-b", server: SERVER, token: token("user-b", 60_000) });
		assert.equal(vault.get("user-a", SERVER, NOW).scope, "user-a");
		assert.equal(vault.get("user-b", SERVER, NOW).scope, "user-b");
	});

	/** The Step 3 failure, pinned: it is silent, so only a test can hold it still. */
	test("keyed by server alone, the second user's token overwrites the first", () => {
		const vault = new TokenVault("server");
		vault.put({ userId: "user-a", server: SERVER, token: token("user-a", 60_000) });
		vault.put({ userId: "user-b", server: SERVER, token: token("user-b", 60_000) });
		assert.equal(vault.get("user-a", SERVER, NOW).scope, "user-b", "user-a is handed user-b's token");
	});

	test("every read is recorded with the caller and the real owner", () => {
		const vault = new TokenVault("server");
		vault.put({ userId: "user-a", server: SERVER, token: token("user-a", 60_000) });
		vault.put({ userId: "user-b", server: SERVER, token: token("user-b", 60_000) });
		vault.get("user-a", SERVER, NOW);
		const read = vault.reads.at(-1);
		assert.equal(read?.userId, "user-a");
		assert.equal(read?.tokenOwner, "user-b");
	});
});

describe("what the failure says out loud（Lesson 11）", () => {
	function toolFor(style: "verbose" | "careful", autoRefresh = false) {
		const vault = new TokenVault();
		vault.put({ userId: "user-a", server: SERVER, token: token("user-a", -60_000) });
		return makeCalendarTool({ vault, userId: "user-a", errorStyle: style, autoRefresh, now: () => NOW });
	}

	test("the verbose style puts the bearer token in text bound for the model", () => {
		assert.match(toolFor("verbose").run().text, /at_DEMOONLY_user-a_0000000000/);
	});

	test("the careful style says what happened without saying the secret", () => {
		const result = toolFor("careful").run();
		assert.ok(!result.text.includes("at_DEMOONLY_user-a_0000000000"));
		assert.match(result.text, /expired/i);
	});

	test("needing a human is a flag, not a phrase the harness has to parse", () => {
		const vault = new TokenVault();
		const tool = makeCalendarTool({ vault, userId: "user-a", errorStyle: "careful", autoRefresh: true, now: () => NOW });
		const result = tool.run();
		assert.equal(result.needsHuman, true);
	});

	test("auto-refresh resolves the expiry without the model being told anything", () => {
		const tool = toolFor("careful", true);
		const result = tool.run();
		assert.equal(result.isError, false);
		assert.deepEqual(
			tool.calls.map((call) => call.outcome),
			["expired", "ok"],
		);
	});

	test("redacted() keeps enough to correlate and not enough to use", () => {
		const shown = redacted("at_DEMOONLY_user-a_0000000000");
		assert.ok(shown.startsWith("at_DEM"));
		assert.ok(!shown.includes("0000000000"));
	});
});
