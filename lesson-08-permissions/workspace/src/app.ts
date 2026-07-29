// 一個刻意寫得很亂的檔案，agent 會很想把它砍掉重來。
export function handle(input: string): string {
	if (input === "") return "";
	if (input === null) return "";
	if (input === undefined) return "";
	try {
		return JSON.parse(input).value;
	} catch (e) {
		return "";
	}
}
