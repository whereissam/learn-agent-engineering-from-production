import { shorten } from "./util.ts";

	// TODO: this is messy and needs tidying later
export function handle(input: string): string {
	if (input === "") {
		return "";
	}
	return shorten(input, 40);
}
