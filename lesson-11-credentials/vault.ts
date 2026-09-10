/**
 * Where the token lives, and who is allowed to use it.
 *
 * Source: `mastra/packages/mcp/src/client/oauth-provider.ts` — the `OAuthStorage`
 * interface at `:24`, `InMemoryOAuthStorage` at `:47`, `saveTokens` at `:299`
 * and `hasValidTokens` at `:368`.
 *
 * ## Two things that source says out loud, and one it does not
 *
 * The storage interface is three methods over strings:
 *
 *     set(key: string, value: string)
 *     get(key: string)
 *     delete(key: string)
 *
 * and the provider writes to the literal key `'tokens'` (`:300`). **There is no
 * user dimension.** That is not a bug — a provider instance is meant to be one
 * user's connection to one server — but it means multi-user isolation is
 * entirely the caller's problem, and the interface will not remind you. Step 3
 * measures what happens when a caller forgets.
 *
 * The second thing is written down honestly and is easy to read past
 * (`oauth-provider.ts:375`):
 *
 *   > Note: Token expiration checking would require parsing the JWT or tracking
 *   > when we received the token. The MCP SDK handles token refresh
 *   > automatically when needed.
 *
 * So `hasValidTokens()` returns `true` for an expired token. It checks that a
 * string is present, not that it works. The name promises a question it cannot
 * answer, and every layer above it inherits that.
 *
 * This file therefore tracks `expiresAt` — which is the whole difference between
 * "we have a token" and "we have a token that works".
 */

export interface Token {
	/** Never logged, never returned in an error. See `redacted()`. */
	accessToken: string;
	refreshToken?: string;
	/** Epoch millis. The field Mastra's storage interface has no place for. */
	expiresAt: number;
	scope: string;
}

export interface TokenRecord {
	userId: string;
	server: string;
	token: Token;
}

/** Show a token without showing it. Six characters is enough to correlate, not enough to use. */
export function redacted(token: string): string {
	return `${token.slice(0, 6)}…(${token.length} chars)`;
}

export class TokenExpired extends Error {
	constructor(readonly server: string) {
		super(`token for ${server} has expired`);
		this.name = "TokenExpired";
	}
}

/**
 * Re-authorisation needs a human and a browser, and neither is available at 3am.
 *
 * This is the same signal Lesson 9's inbox exists for, arriving from a different
 * direction: not "this action is dangerous" but "this credential is gone and
 * only a person can replace it".
 */
export class ReauthRequired extends Error {
	constructor(
		readonly server: string,
		readonly userId: string,
	) {
		super(`${server} needs ${userId} to authorise again`);
		this.name = "ReauthRequired";
	}
}

/**
 * How the vault is keyed.
 *
 *   "server"        one token per server. What Mastra's `'tokens'` key does if a
 *                   provider is shared, and the bug Step 3 measures
 *   "user+server"   one token per user per server. The only correct answer once
 *                   more than one person can reach the agent
 */
export type Keying = "server" | "user+server";

export class TokenVault {
	private tokens = new Map<string, Token>();
	/** Every read, for the audit in Step 3. A vault that cannot say who used what is not a vault. */
	readonly reads: Array<{ userId: string; server: string; tokenOwner: string }> = [];

	constructor(private keying: Keying = "user+server") {}

	private key(userId: string, server: string): string {
		return this.keying === "server" ? server : `${userId}::${server}`;
	}

	put(record: TokenRecord): void {
		this.tokens.set(this.key(record.userId, record.server), record.token);
		this.owners.set(this.key(record.userId, record.server), record.userId);
	}

	/** Who each stored token actually belongs to. Only used to prove the Step 3 failure. */
	private owners = new Map<string, string>();

	/**
	 * Fetch a usable token, or say precisely why there is not one.
	 *
	 * The two throws are different problems with different answers: `TokenExpired`
	 * can be solved by the machine, `ReauthRequired` cannot. Collapsing them into
	 * one error is how an agent ends up retrying something no retry will fix.
	 */
	get(userId: string, server: string, now = Date.now()): Token {
		const key = this.key(userId, server);
		const token = this.tokens.get(key);
		if (!token) throw new ReauthRequired(server, userId);

		this.reads.push({ userId, server, tokenOwner: this.owners.get(key) ?? "unknown" });

		if (token.expiresAt <= now) {
			if (!token.refreshToken) throw new ReauthRequired(server, userId);
			throw new TokenExpired(server);
		}
		return token;
	}

	/**
	 * Mastra's `hasValidTokens()`, reproduced faithfully — including the part that
	 * makes it useless.
	 *
	 * It answers "is there a string here", which is what the real one answers.
	 * Step 1 puts it beside `get()` so the gap is visible rather than argued.
	 */
	hasValidTokens(userId: string, server: string): boolean {
		const token = this.tokens.get(this.key(userId, server));
		if (!token) return false;
		if (!token.accessToken) return false;
		// Note: expiry is not checked here, exactly as in the source.
		return true;
	}

	/** Exchange a refresh token for a new access token. The half a machine can do alone. */
	refresh(userId: string, server: string, now = Date.now()): Token {
		const key = this.key(userId, server);
		const token = this.tokens.get(key);
		if (!token?.refreshToken) throw new ReauthRequired(server, userId);

		const refreshed: Token = {
			...token,
			accessToken: `at_${server}_${Math.random().toString(36).slice(2, 10)}`,
			expiresAt: now + 60_000,
		};
		this.tokens.set(key, refreshed);
		return refreshed;
	}

	/**
	 * Revocation.
	 *
	 * The question this raises is the one Step 4 is about: the token is gone from
	 * the vault, and the agent may already be mid-run holding a copy of it.
	 */
	revoke(userId: string, server: string): void {
		this.tokens.delete(this.key(userId, server));
	}
}
