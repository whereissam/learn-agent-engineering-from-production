/**
 * 路徑安全。
 *
 * 每一個碰檔案的工具都必須先過這裡。放在共用檔案而不是每個工具各寫一次，
 * 是因為「某個工具忘記檢查」就是一個完整的沙箱逃逸。
 */

import { resolve } from "node:path";

/**
 * 把模型給的相對路徑解析成絕對路徑，並確保它沒有跑出 root。
 *
 * 擋掉的包括：
 *   ../../../etc/passwd     一般的向上逃逸
 *   /etc/passwd             絕對路徑
 *   src/../../secrets.txt   繞一圈再逃
 *
 * resolve() 會先把 ".." 正規化掉，所以我們只要比對結果的前綴就夠了。
 */
export function resolveInRoot(root: string, path: unknown, label = "path"): string {
	if (typeof path !== "string" || path.length === 0) {
		throw new Error(`${label} must be a non-empty string`);
	}

	const target = resolve(root, path);

	if (target !== root && !target.startsWith(`${root}/`)) {
		throw new Error(`${label} escapes the project root: ${path}`);
	}

	return target;
}

/** 把絕對路徑轉回相對，用來顯示給人看（不要在訊息裡洩漏完整的機器路徑）。 */
export function relativeToRoot(root: string, absolute: string): string {
	if (absolute === root) return ".";
	return absolute.startsWith(`${root}/`) ? absolute.slice(root.length + 1) : absolute;
}
