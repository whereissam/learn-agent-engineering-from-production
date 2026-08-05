export function parseTokens(line: string): string[] {
	return line
		.split(",")
		.map((token) => token.trim())
		.filter((token) => token !== "");
}
