import { ALPHABET, CODE_LENGTH, MAX_ENTRIES } from "./config.ts";

/** code -> original url */
const entries = new Map<string, string>();

export function generateCode(): string {
	let code = "";
	for (let i = 0; i < CODE_LENGTH; i++) {
		code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
	}
	return code;
}

export function save(url: string): string {
	let code = generateCode();
	while (entries.has(code.toLowerCase())) {
		code = generateCode();
	}

	// Keep memory bounded: drop the oldest entry once we are full.
	if (entries.size >= MAX_ENTRIES) {
		const oldest = entries.keys().next().value;
		if (oldest !== undefined) {
			entries.delete(oldest);
		}
	}

	entries.set(code, url);
	return code;
}

export function lookup(code: string): string | undefined {
	// Codes are case-insensitive so they survive being copied out of
	// emails, chat apps, and printed material.
	return entries.get(code.toLowerCase());
}

export function size(): number {
	return entries.size;
}
