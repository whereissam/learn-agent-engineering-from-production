/**
 * Pick a streaming provider. The selection works exactly as the non-streaming version's does.
 */

import { resolve } from "node:path";
import { anthropicStreamingProvider } from "./anthropic.ts";
import { fakeStreamingProvider } from "./fake.ts";
import { openaiStreamingProvider } from "./openai.ts";
import type { StreamingProvider } from "./types.ts";

if (typeof process.loadEnvFile === "function") {
	try {
		process.loadEnvFile(resolve(import.meta.dirname, "../../.env"));
	} catch {
			// Having no .env is entirely normal
	}
}

const DEFAULT_MODELS = {
	anthropic: "claude-opus-5",
	openai: "gpt-5",
	gemini: "gemini-3.6-flash",
} as const;

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/";

export function selectStreamingProvider(): StreamingProvider {
	const requested = process.env.PROVIDER?.toLowerCase();
	const modelOverride = process.env.MODEL;
	const kind = requested ?? autoDetect();

	switch (kind) {
		case "fake":
			return fakeStreamingProvider();

		case "anthropic":
			requireKey("ANTHROPIC_API_KEY");
			return anthropicStreamingProvider(modelOverride ?? DEFAULT_MODELS.anthropic);

		case "openai":
			requireKey("OPENAI_API_KEY");
			return openaiStreamingProvider({ model: modelOverride ?? DEFAULT_MODELS.openai });

		case "gemini":
			requireKey("GEMINI_API_KEY");
			return openaiStreamingProvider({
				label: "gemini",
				model: modelOverride ?? DEFAULT_MODELS.gemini,
				apiKey: process.env.GEMINI_API_KEY,
				baseURL: GEMINI_BASE_URL,
				tokenParam: "max_tokens",
			});

		default:
			throw new Error(`Unknown PROVIDER: ${kind}. Use anthropic | openai | gemini | fake.`);
	}
}

function autoDetect(): string {
	if (process.env.ANTHROPIC_API_KEY) return "anthropic";
	if (process.env.OPENAI_API_KEY) return "openai";
	if (process.env.GEMINI_API_KEY) return "gemini";
	throw new Error(
		"No API key found. Set one of ANTHROPIC_API_KEY / OPENAI_API_KEY / GEMINI_API_KEY,\n" +
			"or run with PROVIDER=fake to use the scripted offline provider.",
	);
}

function requireKey(name: string): void {
	if (!process.env[name]) {
		throw new Error(`PROVIDER is set but ${name} is missing.`);
	}
}

export { drain } from "./types.ts";
export type { StreamEvent, StreamingProvider } from "./types.ts";
