/**
 * Path safety.
 *
 * Every tool that touches files must pass through here. It lives in a shared file rather than being
 * rewritten per tool, because "one tool forgot to check" is a complete sandbox escape.
 */

import { realpathSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

/**
 * Resolve the model's relative path to an absolute one and ensure it did not leave root.
 *
 * What it blocks includes:
 *   ../../../etc/passwd     ordinary upward escape
 *   /etc/passwd             an absolute path
 *   src/../../secrets.txt   escaping the long way round
 *
 * resolve() normalises ".." away first, so the prefix comparison catches every spelling of "up".
 * It cannot see a symbolic link, though: `notes.md -> ../../.env` is inside root by name and
 * outside it on disk, and readFile follows the link. So the check runs a second time on where
 * the path really lands.
 */
export function resolveInRoot(root: string, path: unknown, label = "path"): string {
	if (typeof path !== "string" || path.length === 0) {
		throw new Error(`${label} must be a non-empty string`);
	}

	const target = resolve(root, path);

	if (target !== root && !target.startsWith(`${root}/`)) {
		throw new Error(`${label} escapes the project root: ${path}`);
	}

	const realRoot = realLocation(root);
	const real = realLocation(target);
	if (real !== realRoot && !real.startsWith(`${realRoot}/`)) {
		throw new Error(`${label} escapes the project root through a symbolic link: ${path}`);
	}

	return target;
}

/**
 * Where a path really lands once every symbolic link is followed. A path that does not exist yet
 * (a file about to be written) resolves through its nearest existing parent, because that parent
 * is what the write would follow.
 */
export function realLocation(absolute: string): string {
	try {
		return realpathSync(absolute);
	} catch {
		const parent = dirname(absolute);
		if (parent === absolute) return absolute;
		return resolve(realLocation(parent), basename(absolute));
	}
}

/** Turn an absolute path back into a relative one for display (never leak full machine paths in messages). */
export function relativeToRoot(root: string, absolute: string): string {
	if (absolute === root) return ".";
	return absolute.startsWith(`${root}/`) ? absolute.slice(root.length + 1) : absolute;
}
