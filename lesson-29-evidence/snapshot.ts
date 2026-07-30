/**
 * Snapshot：用一個「影子 git」記錄 workspace 真正變成什麼樣子。
 *
 * 這是 Lesson 29 唯一的機制，而它的全部價值在一句話：
 *
 *   > assistant 的文字是模型說的，tool result 是工具說的，
 *   > **只有 snapshot 是檔案系統說的。**
 *
 * 對照 opencode：`packages/opencode/src/snapshot/index.ts`
 *   - `:318` `track()`   → 初始化影子 repo、`add --all`、`write-tree`（`:341`）
 *   - `:349` `patch()`   → `git diff --cached --name-only <hash>`
 *
 * ⚠️ **關鍵設計：影子 git 不是使用者的 git。**
 *
 * 這一課原本的規劃寫「用 `git stash create` 算 patch 就夠了，不用抄那 807 行」。
 * **那個規劃是錯的**，而且錯在最容易忽略的地方：`git stash create` 動的是
 * **使用者自己的 repo 和 index**。你要記錄的是 agent 做了什麼，
 * 代價卻是動到使用者正在工作的那份 git 狀態（暫存區、reflog、stash 列表）。
 *
 * opencode 的做法是把 `--git-dir` 指到別的地方
 * （`index.ts:70` 的 `Global.Path.data/snapshot/...`），work-tree 才指向專案：
 *
 *   git --git-dir=<影子> --work-tree=<workspace> add --all
 *   git --git-dir=<影子> --work-tree=<workspace> write-tree
 *
 * 兩個副作用都消失了：
 *   1. 使用者的 `.git` 一個 byte 都不會被碰
 *   2. **workspace 根本不需要是一個 git repo**（我們的 workspace 就不是，
 *      它只是主 repo 裡的一個子目錄）
 *
 * 順帶一個第二個好處：主 repo 根目錄的 `.gitignore` 在 work-tree 之外，
 * 所以不會意外把 agent 改的檔案排除掉。
 */

import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export interface Patch {
	/** 對照的基準（`write-tree` 算出來的 tree hash）。 */
	hash: string;
	/** 相對於 workspace 的路徑，已排序。 */
	files: string[];
}

export interface SnapshotOptions {
	/** 被觀察的目錄。不需要是 git repo。 */
	workspace: string;
	/** 影子 git 目錄。**一定要在 workspace 外面**，否則它會記錄自己。 */
	gitdir: string;
}

export class Snapshot {
	readonly workspace: string;
	readonly gitdir: string;

	constructor(options: SnapshotOptions) {
		this.workspace = options.workspace;
		this.gitdir = options.gitdir;

		// 影子 gitdir 放在 workspace 裡面會發生什麼：`add --all` 會把 gitdir
		// 自己的物件檔一起加進索引，每次 track 都會「有變化」。
		// 這種錯不會爆，只會讓 patch 永遠不是空的 —— 設計原則 7 的典型形狀，
		// 所以在建構的時候就擋掉。
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
	 * 記一個基準點，回傳 tree hash。
	 *
	 * 呼叫時機是這一課最容易寫錯的地方，見 `loop.ts` 的註解和 README Step 4。
	 */
	async track(): Promise<string> {
		await this.init();
		await this.add();
		const { stdout } = await this.git(["write-tree"]);
		return stdout.trim();
	}

	/**
	 * 從基準點到現在，**檔案系統上實際變了哪些檔案**。
	 *
	 * 注意這裡要先 `add` 再 `diff --cached`。直接 `git diff <hash>` 比的是
	 * 索引，不是工作目錄，新建的檔案會完全看不到（untracked）。
	 * 「新檔案不會出現在 patch 裡」也是一個不會報錯的失敗。
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

	/** 逐行的差異，只在需要給人看的時候用。判定一律用 `patch()`。 */
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
		// 跟 opencode 一樣關掉會改寫內容的設定（`index.ts:330-333`）。
		// autocrlf 會讓「同一份檔案」在不同平台算出不同 hash。
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
		// `--all` 才會記到刪除。少了它，「agent 把檔案刪掉」在 patch 裡看不見。
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
