import { shorten } from "./util.ts";

// TODO: 這裡很亂，之後要整理
export function handle(input: string): string {
	if (input === "") {
		return "";
	}
	return shorten(input, 40);
}
