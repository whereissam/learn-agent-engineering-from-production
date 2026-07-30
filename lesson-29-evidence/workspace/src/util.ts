export function shorten(text: string, max: number): string {
	if (text.length <= max) return text;
	return text.slice(0, max) + "…";
}
