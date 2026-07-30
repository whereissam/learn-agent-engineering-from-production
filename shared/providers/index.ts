/**
 * Pick a provider.
 *
 * Priority:
 *   1. the PROVIDER environment variable (anthropic | openai | gemini | fake)
 *   2. whichever API key is set
 *
 * The MODEL environment variable overrides the default model. If the default model id returns
 * 404 / not found for your account, set MODEL=<a model you have access to> and run again.
 *
 * No key at all? Use PROVIDER=fake, which needs no network and costs nothing.
 */

import { resolve } from "node:path";
import { anthropicProvider } from "./anthropic.ts";
import { fakeProvider } from "./fake.ts";
import { openaiProvider } from "./openai.ts";
import type { Provider } from "./types.ts";

// Read API keys from the project root's .env, so you do not export them in every new terminal.
// Values already in the environment win; .env does not override them.
//
// process.loadEnvFile is built into Node 20.12+, so no dotenv package is needed.
// Bun does not have that API and reads .env automatically anyway, so it simply skips this.
if (typeof process.loadEnvFile === "function") {
	try {
		process.loadEnvFile(resolve(import.meta.dirname, "../../.env"));
	} catch {
			// Having no .env file is entirely normal — the environment variables are enough
	}
}

const DEFAULT_MODELS = {
	anthropic: "claude-opus-5",
	openai: "gpt-5",
	gemini: "gemini-3.6-flash",
} as const;

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/";

export function selectProvider(): Provider {
	const requested = process.env.PROVIDER?.toLowerCase();
	const modelOverride = process.env.MODEL;

	const kind = requested ?? autoDetect();

	switch (kind) {
		case "fake":
			return fakeProvider();

		case "anthropic":
			requireKey("ANTHROPIC_API_KEY");
			return anthropicProvider(modelOverride ?? DEFAULT_MODELS.anthropic);

		case "openai":
			requireKey("OPENAI_API_KEY");
			return openaiProvider({ model: modelOverride ?? DEFAULT_MODELS.openai });

		case "gemini":
			requireKey("GEMINI_API_KEY");
			return openaiProvider({
				label: "gemini",
				model: modelOverride ?? DEFAULT_MODELS.gemini,
				apiKey: process.env.GEMINI_API_KEY,
				baseURL: GEMINI_BASE_URL,
					// Gemini's compatibility layer takes max_tokens
				tokenParam: "max_tokens",
			});

		default:
			throw new Error(`Unknown PROVIDER: ${kind}. Use anthropic | openai | gemini.`);
	}
}

function autoDetect(): string {
	if (process.env.ANTHROPIC_API_KEY) return "anthropic";
	if (process.env.OPENAI_API_KEY) return "openai";
	if (process.env.GEMINI_API_KEY) return "gemini";

	throw new Error(
		"No API key found. Set one of ANTHROPIC_API_KEY / OPENAI_API_KEY / GEMINI_API_KEY,\n" +
			"or run with PROVIDER=fake to use the scripted offline provider.\n" +
			"See agent-lessons/README.md for setup.",
	);
}

function requireKey(name: string): void {
	if (!process.env[name]) {
		throw new Error(`PROVIDER is set but ${name} is missing.`);
	}
}

export type { Message, Provider, ToolResult, ToolSpec } from "./types.ts";
