/**
 * A tool behind a credential, and the two ways its failures reach the model.
 *
 * The tool itself is trivial — it reads a calendar. Everything interesting is in
 * what comes back when the token does not work, because that text goes straight
 * into the model's context, and from there into the trace and the memory
 * (Lesson 31's three boundaries).
 */

import { redacted, ReauthRequired, TokenExpired, type TokenVault } from "./vault.ts";

export interface ToolResult {
	text: string;
	isError: boolean;
	/** Set when the caller must stop and get a human. Never inferred from the text. */
	needsHuman?: boolean;
}

/**
 * How much the error message says.
 *
 *   "verbose"  include the request that failed, the way a helpful HTTP client does
 *   "careful"  say what went wrong and nothing else
 *
 * This is the switch for Step 2, and it is not a straw man: dumping the failing
 * request is the default behaviour of most HTTP debugging helpers, and an
 * `Authorization` header is part of a request.
 */
export type ErrorStyle = "verbose" | "careful";

export interface CalendarOptions {
	vault: TokenVault;
	userId: string;
	errorStyle: ErrorStyle;
	/** Refresh once on expiry instead of surfacing it. The Step 1 switch. */
	autoRefresh: boolean;
	now?: () => number;
}

const SERVER = "calendar";

/** What the upstream service would return. Fixed text, so nothing here is model-dependent. */
function calendarFor(userId: string): string {
	const entries: Record<string, string> = {
		"user-a": "09:00 standup; 14:00 1:1 with Dana; 16:30 board prep (CONFIDENTIAL)",
		"user-b": "10:00 dentist; 13:00 lunch with Sam",
	};
	return entries[userId] ?? "(no events)";
}

export interface CallRecord {
	attempt: number;
	outcome: "ok" | "expired" | "reauth";
	/** The token actually presented upstream. Recorded so Step 3 can compare it to the caller. */
	presentedFor?: string;
}

/**
 * `read_calendar`, with the credential lifecycle wired in.
 *
 * Returns rather than throws, because a tool that throws takes the agent loop
 * down with it — Lesson 2's rule. The interesting question is what the returned
 * text contains.
 */
export function makeCalendarTool(options: CalendarOptions) {
	const now = options.now ?? Date.now;
	const calls: CallRecord[] = [];

	function run(): ToolResult {
		for (let attempt = 1; attempt <= 2; attempt++) {
			try {
				const token = options.vault.get(options.userId, SERVER, now());
				calls.push({ attempt, outcome: "ok", presentedFor: token.scope });
				return { text: calendarFor(token.scope), isError: false };
			} catch (error) {
				if (error instanceof TokenExpired) {
					calls.push({ attempt, outcome: "expired" });
					if (options.autoRefresh && attempt === 1) {
						options.vault.refresh(options.userId, SERVER, now());
						continue;
					}
					return {
						text:
							options.errorStyle === "verbose"
								? // The shape a helpful client produces, and the reason Step 2 exists.
									`401 Unauthorized calling GET https://calendar.example/v1/events\n` +
									`request headers: {"Authorization":"Bearer ${lastToken(options)}","Accept":"application/json"}\n` +
									`hint: the access token has expired; refresh it and retry`
								: "The calendar credential has expired. It is being renewed; retry this tool once.",
						isError: true,
					};
				}

				if (error instanceof ReauthRequired) {
					calls.push({ attempt, outcome: "reauth" });
					return {
						text: "The calendar connection needs the user to sign in again. This cannot be retried.",
						isError: true,
						// A flag, not a phrase. Lesson 37's point: the harness must not
						// have to parse prose to know what happened.
						needsHuman: true,
					};
				}
				throw error;
			}
		}
		return { text: "unreachable", isError: true };
	}

	return { name: "read_calendar", run, calls };
}

/**
 * The expired token's own text, for the verbose error path.
 *
 * Reaching back into the vault for a credential purely in order to put it in an
 * error message is exactly the mistake being demonstrated, so it is isolated
 * here rather than spread through the tool.
 */
function lastToken(options: CalendarOptions): string {
	try {
		// Far enough in the past that the vault will hand back the expired record.
		return options.vault.get(options.userId, SERVER, 0).accessToken;
	} catch {
		return "at_DEMOONLY_expired_0000000000";
	}
}

export { redacted, SERVER };
