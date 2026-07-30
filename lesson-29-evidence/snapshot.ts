/**
 * Snapshot: recording what the workspace really became, using a shadow git.
 *
 * This is Lesson 29's only mechanism, and all of its value is in one sentence:
 *
 *   > The assistant's text is what the model said and a tool result is what the tool said;
 *   > **only the snapshot is what the filesystem said.**
 *
 * Against opencode: `packages/opencode/src/snapshot/index.ts`
 *   - `:318` `track()`   → initialise the shadow repo, `add --all`, `write-tree` (`:341`)
 *   - `:349` `patch()`   → `git diff --cached --name-only <hash>`
 *
 * ⚠️ **The key design: the shadow git is not the user's git.**
 *
 * This lesson's original plan said "computing the patch with `git stash create` is enough, without copying those 807 lines".
 * **That plan was wrong**, in the easiest place to overlook: `git stash create` operates on
 * **the user's own repo and index**. What you want to record is what the agent did,
 * and the price is touching the git state the user is working in (the staging area, the reflog, the stash list).
 *
 * opencode points `--git-dir` somewhere else
 * (`Global.Path.data/snapshot/...` at `index.ts:70`) and only the work-tree at the project:
 *
 *   git --git-dir=<shadow> --work-tree=<workspace> add --all
 *   git --git-dir=<shadow> --work-tree=<workspace> write-tree
 *
 * Both side effects disappear:
 *   1. the user's `.git` is never touched
 *   2. **the workspace does not need to be a git repo at all** (this lesson's is not;
 *      it is just a subdirectory of the main repo)
 *
 * And a second benefit in passing: the main repo's root `.gitignore` is outside the work-tree,
 * so files the agent changed cannot be excluded by accident.
 */

import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export interface Patch {
	/** The baseline being compared against (the tree hash from `write-tree`). */
	hash: string;
	/** Paths relative to the workspace, sorted. */
	files: string[];
}

export interface SnapshotOptions {
	/** The directory being observed. It need not be a git repo. */
	workspace: string;
	/** The shadow git directory. **It must be outside the workspace**, or it records itself. */
	gitdir: string;
}

export class Snapshot {
	readonly workspace: string;
	readonly gitdir: string;

	constructor(options: SnapshotOptions) {
		this.workspace = options.workspace;
		this.gitdir = options.gitdir;

			// What happens with the shadow gitdir inside the workspace: `add --all` adds the gitdir's
			// own object files to the index, so every track "has changes".
			// That error never throws; it merely means the patch is never empty — the classic shape of
			// design principle 7, so it is blocked at construction.
		const rel = relative(this.workspace, this.gitdir);
		const outside = rel === ".." || rel.startsWith(`..${sep}`);
		if (!outside) {
			throw new Error(
				`gitdir (${this.gitdir}) must live outside the workspace (${this.workspace}), ` +
					"otherwise the snapshot records itself",
			);
		}
	}

	/**
		 * Record a baseline and return the tree hash.
	 *
		 * When to call it is the easiest thing in this lesson to get wrong; see `loop.ts`'s comments and README Step 4.
	 */
	async track(): Promise<string> {
		await this.init();
		await this.add();
		const { stdout } = await this.git(["write-tree"]);
		return stdout.trim();
	}

	/**
		 * From the baseline to now, **which files really changed on the filesystem**.
	 *
		 * Note this must `add` before `diff --cached`. A bare `git diff <hash>` compares the index
		 * rather than the working directory, and new files are entirely invisible (untracked).
		 * "New files do not appear in the patch" is another failure that never raises an error.
	 */
	async patch(hash: string): Promise<Patch> {
		await this.init();
		await this.add();
		const { stdout } = await this.git([
			"diff",
			"--cached",
			"--no-ext-diff",
			"--name-only",
			hash,
			"--",
			".",
		]);
		const files = stdout
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean)
			.sort();
		return { hash, files };
	}

		/** A line-level diff, used only when a human needs to read it. The verdict always uses `patch()`. */
	async diff(hash: string): Promise<string> {
		await this.init();
		await this.add();
		const { stdout } = await this.git([
			"diff",
			"--cached",
			"--no-ext-diff",
			"--stat",
			hash,
			"--",
			".",
		]);
		return stdout.trimEnd();
	}

	// ───────────────────────────────────────────────────────────

	private async init(): Promise<void> {
		if (existsSync(join(this.gitdir, "HEAD"))) return;

		await mkdir(this.gitdir, { recursive: true });
		await run("git", ["init", "--quiet"], {
			env: { ...process.env, GIT_DIR: this.gitdir, GIT_WORK_TREE: this.workspace },
		});
			// As in opencode, disable settings that rewrite content (`index.ts:330-333`).
			// autocrlf would make "the same file" hash differently on different platforms.
		for (const [key, value] of [
			["core.autocrlf", "false"],
			["core.longpaths", "true"],
			["core.symlinks", "true"],
			["core.fsmonitor", "false"],
		]) {
			await this.git(["config", key as string, value as string]);
		}
	}

	private async add(): Promise<void> {
			// `--all` is what records deletions. Without it, "the agent deleted a file" is invisible in the patch.
		await this.git(["add", "--all", "."]);
	}

	private async git(args: string[]): Promise<{ stdout: string; stderr: string }> {
		return await run(
			"git",
			[
				"--git-dir",
				this.gitdir,
				"--work-tree",
				this.workspace,
				"-c",
				"core.quotepath=false",
				...args,
			],
			{ cwd: this.workspace, maxBuffer: 8 * 1024 * 1024 },
		);
	}
}
