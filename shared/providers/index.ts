/**
 * 挑一個 provider。
 *
 * 優先序：
 *   1. PROVIDER 環境變數（anthropic | openai | gemini | fake）
 *   2. 哪個 API key 有設就用哪個
 *
 * MODEL 環境變數可以覆寫預設 model。如果預設的 model id 對你的帳號
 * 回 404 / not found，就設 MODEL=<你有權限的 model> 再跑一次。
 *
 * 沒有任何 key？用 PROVIDER=fake，不需要網路也不需要付錢。
 */

import { resolve } from "node:path";
import { anthropicProvider } from "./anthropic.ts";
import { fakeProvider } from "./fake.ts";
import { openaiProvider } from "./openai.ts";
import type { Provider } from "./types.ts";

// 從專案根目錄的 .env 讀 API key，這樣你不用每開一個 terminal 就 export 一次。
// 已經設在環境變數裡的值優先，.env 不會覆蓋它。
//
// process.loadEnvFile 是 Node 20.12+ 的內建功能，不需要 dotenv 套件。
// Bun 沒有這個 API，但它本來就會自動讀 .env，所以直接跳過即可。
if (typeof process.loadEnvFile === "function") {
	try {
		process.loadEnvFile(resolve(import.meta.dirname, "../../.env"));
	} catch {
		// 沒有 .env 檔很正常 ， 直接用環境變數就好
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
				// Gemini 的相容層吃 max_tokens
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
