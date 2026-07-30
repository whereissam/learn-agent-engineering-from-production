/**
 * Path safety.
 *
 * Every tool that touches files must pass through here. It lives in a shared file rather than being
 * rewritten per tool, because "one tool forgot to check" is a complete sandbox escape.
 */

import { resolve } from "node:path";

/**
 * Resolve the model's relative path to an absolute one and ensure it did not leave root.
 *
 * What it blocks includes:
 *   ../../../etc/passwd     ordinary upward escape
 *   /etc/passwd             an absolute path
 *   src/../../secrets.txt   escaping the long way round
 *
 * resolve() normalises ".." away first, so comparing the result's prefix is enough.
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

/** Turn an absolute path back into a relative one for display (never leak full machine paths in messages). */
export function relativeToRoot(root: string, absolute: string): string {
	if (absolute === root) return ".";
	return absolute.startsWith(`${root}/`) ? absolute.slice(root.length + 1) : absolute;
}
