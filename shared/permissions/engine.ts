/**
 * 權限引擎。
 *
 * 這個檔案最重要的一句話，來自 OpenWorker permissions.py 的 docstring：
 *
 *   > The engine only *decides*; the turn engine routes `needs_user` decisions
 *   > to a surface for approval and records the outcome.
 *
 * **引擎只負責「決定」，不負責「詢問」。**
 *
 * Lesson 2 把這兩件事混在一起：registry 一發現 mutating 就直接呼叫
 * ctx.approve()，也就是「決定」跟「怎麼問」綁死了。
 *
 * 拆開之後你才能做到：
 *   - 同一套規則，在 CLI 問終端機、在 GUI 跳對話框、無人值守時丟進 inbox
 *   - 決策可以單獨測試（不用 mock 一個假的使用者）
 *   - 決策可以記進 audit log（為什麼允許、依據哪條規則）
 *
 * Lesson 9 完全依賴這個拆分：無人值守模式改的是「去哪裡問」，
 * 完全不動這個引擎。
 *
 * 對照：openworker/coworker/permissions.py
 */

import { isAbsolute, relative, resolve } from "node:path";
import { classify, isConsequential, RiskClass, type RiskOverrides, type ToolRiskMetadata } from "./risk.ts";

/**
 * 模式決定「自主程度的天花板」。
 *
 * 注意模式跟風險是**兩個獨立的維度**：
 *   風險 = 這個操作有多危險（工具的屬性）
 *   模式 = 使用者現在願意給多少自主權（session 的屬性）
 *
 * 決策 = 兩者的交集。
 */
export enum Mode {
	/** 唯讀。任何有副作用的操作都直接拒絕，連問都不問。 */
	PLAN = "plan",

	/** 預設。讀取自動放行，其他要問。 */
	INTERACTIVE = "interactive",

	/** 全部放行。但注意：**路徑限制仍然有效**，見下面 evaluate。 */
	AUTO = "auto",

	/** interactive + 自動允許設定檔裡指定的工具。 */
	CUSTOM = "custom",
}

/** 唯讀模式。抽成常數是因為 OpenWorker 有兩個唯讀模式（discuss / plan）。 */
const READ_ONLY_MODES = new Set<Mode>([Mode.PLAN]);

/**
 * 一個決定。注意它是**資料**，不是動作。
 *
 * `reason` 不是給人看的除錯訊息，它會進 audit log，
 * 也會顯示在批准框上讓使用者知道「為什麼會問我」。
 */
export interface Decision {
	allowed: boolean;
	reason: string;
	/** true = 引擎不能自己決定，要去問人。 */
	needsUser: boolean;
	/** 如果是被某條 standing rule 放行的，記下是哪一條。 */
	rule?: string;
}

/** 可寫入的根目錄。分開 writable 是因為你可能想讓 agent 讀某個目錄但不能改。 */
export interface Root {
	path: string;
	writable: boolean;
}

export interface PermissionEngineOptions {
	workspaceRoot: string;
	mode?: Mode;
	/** 這些指令前綴不用問（例如 "git status", "ls"）。 */
	allowedCommands?: string[];
	/** CUSTOM 模式下自動允許的工具。 */
	autoAllowTools?: string[];
	/** 多根目錄。省略的話就只有 workspaceRoot 可寫。 */
	roots?: Root[];
	riskOverrides?: RiskOverrides;
}

/**
 * 會把一個「允許的指令」變成好幾個的 shell 元字元。
 *
 * 這正是 Lesson 2 練習 5 出的題目，OpenWorker 真的做了。
 *
 * 為什麼重要：假設你把 "ls" 加進允許清單，模型送來
 *
 *   ls; rm -rf ~
 *
 * 前綴比對會通過（開頭是 "ls"），但實際上跑了兩個指令。
 * 只要出現任何一個元字元，就取消自動放行、改成詢問。
 *
 * 涵蓋：串接（; & && ||）、管線（|）、重導向（> <）、
 * 指令替換（` $(）、群組（(）、換行。
 */
const SHELL_OPERATORS = [";", "&", "|", ">", "<", "`", "$(", "(", "\n", "\r"];

export function hasShellOperators(command: string): boolean {
	return SHELL_OPERATORS.some((op) => command.includes(op));
}

export class PermissionEngine {
	readonly workspaceRoot: string;
	mode: Mode;

	private readonly allowedCommands: string[];
	private readonly autoAllowTools: Set<string>;
	private readonly riskOverrides?: RiskOverrides;
	private roots: Root[];

	/** 這一輪對話中，使用者選了「都允許」的工具與指令。 */
	private readonly sessionAllowTools = new Set<string>();
	private readonly sessionAllowCommands = new Set<string>();

	/**
	 * 任務層級的持久規則：{ 工具: 允許的目標 }。
	 *
	 * 跟 sessionAllowTools 的差別是它**綁定到特定目標**。
	 * 「允許 send_email」很危險，「允許 send_email 給 team@example.com」就還好。
	 * Lesson 9 會用到。
	 */
	private readonly taskRules = new Map<string, Set<string>>();

	constructor(options: PermissionEngineOptions) {
		this.workspaceRoot = resolve(options.workspaceRoot);
		this.mode = options.mode ?? Mode.INTERACTIVE;
		this.allowedCommands = options.allowedCommands ?? [];
		this.autoAllowTools = new Set(options.autoAllowTools ?? []);
		this.riskOverrides = options.riskOverrides;
		this.roots = options.roots ?? [{ path: this.workspaceRoot, writable: true }];
	}

	/**
	 * 決定一個工具呼叫該怎麼處理。
	 *
	 * **判斷順序是刻意的**，每一步都在縮小範圍。順序錯了會有安全漏洞，
	 * 下面每一段都寫了為什麼在這個位置。
	 */
	evaluate(
		toolName: string,
		args: Record<string, unknown>,
		metadata?: ToolRiskMetadata,
	): Decision {
		const risk = classify(toolName, metadata, this.riskOverrides);
		const consequential = isConsequential(risk);
		const isConnector = metadata?.category === "connector";

		// ── 1. 唯讀模式 ────────────────────────────────────
		// 最先檢查。使用者說了「只准看不准動」，那就沒有任何例外。
		if (READ_ONLY_MODES.has(this.mode) && consequential) {
			return {
				allowed: false,
				reason: `${this.mode} 模式是唯讀的`,
				needsUser: false, // 注意：不是「去問人」，是直接拒絕
			};
		}

		// ── 2. 路徑限制 ────────────────────────────────────
		//
		// **這一步在 AUTO 模式檢查之前，是刻意的。**
		//
		// AUTO 模式的意思是「不要一直問我」，不是「可以動我整台電腦」。
		// 沙箱邊界不該被自主程度的設定繞過。
		if (risk === RiskClass.WRITE_LOCAL) {
			const path = args.path;
			if (typeof path === "string" && !this.underWritableRoot(path)) {
				return {
					allowed: false,
					reason: `路徑不在可寫入的目錄內：${path}`,
					needsUser: false, // 這是硬性邊界，問使用者也不該放行
				};
			}
		}

		// ── 3. 純讀取 ──────────────────────────────────────
		if (!consequential) {
			return { allowed: true, reason: "低風險", needsUser: false };
		}

		// ── 4. AUTO 模式 ───────────────────────────────────
		// 走到這裡代表路徑檢查已經過了
		if (this.mode === Mode.AUTO) {
			return { allowed: true, reason: "完全存取", needsUser: false };
		}

		// ── 5. 指令允許清單 ────────────────────────────────
		if (risk === RiskClass.EXEC) {
			const command = String(args.command ?? "");
			if (this.commandAllowed(command)) {
				return { allowed: true, reason: "指令在允許清單上", needsUser: false };
			}
			if (command && this.sessionAllowCommands.has(command)) {
				return { allowed: true, reason: "這一輪已允許此指令", needsUser: false };
			}
		}

		// ── 6. 這一輪允許的工具 ────────────────────────────
		//
		// 注意 `!isConnector`：connector 工具（Slack、Gmail…）**不能**
		// 用「這個工具都允許」放行。
		//
		// 為什麼？「允許 send_slack_message」等於允許發訊息到任何頻道。
		// 使用者按「都允許」時想的是「發到剛剛那個頻道」，不是「發到全公司」。
		if (this.sessionAllowTools.has(toolName) && !isConnector) {
			return { allowed: true, reason: "這一輪已允許此工具", needsUser: false };
		}

		// ── 7. 綁定目標的持久規則 ──────────────────────────
		//
		// 這裡刻意「不」排除 connector，因為規則綁死了特定目標，
		// 那個綁定正是讓它安全的原因。
		const targets = this.taskRules.get(toolName);
		if (targets) {
			const target = standingRuleTarget(toolName, args, metadata, this.riskOverrides);
			if (target && targets.has(target)) {
				const rule = `${toolName} → ${target}`;
				return { allowed: true, reason: `符合持久規則：${rule}`, needsUser: false, rule };
			}
		}

		// ── 8. CUSTOM 模式的設定 ───────────────────────────
		if (this.mode === Mode.CUSTOM && this.autoAllowTools.has(toolName)) {
			return { allowed: true, reason: "設定檔自動允許", needsUser: false };
		}

		// ── 9. 都不符合 → 問人 ─────────────────────────────
		return { allowed: false, reason: "需要批准", needsUser: true };
	}

	// ── session / task 記憶 ──────────────────────────────

	allowToolForSession(toolName: string): void {
		this.sessionAllowTools.add(toolName);
	}

	allowCommandForSession(command: string): void {
		if (command) this.sessionAllowCommands.add(command);
	}

	/** 新增一條綁定目標的持久規則。 */
	addTaskRule(toolName: string, target: string): void {
		const existing = this.taskRules.get(toolName) ?? new Set<string>();
		existing.add(target);
		this.taskRules.set(toolName, existing);
	}

	setRoots(roots: Root[]): void {
		this.roots = roots;
	}

	// ── 內部 ─────────────────────────────────────────────

	private commandAllowed(command: string): boolean {
		const trimmed = command.trim();
		if (!trimmed) return false;

		// 有元字元就不能自動放行，不管前綴多乾淨
		if (hasShellOperators(trimmed)) return false;

		return this.allowedCommands.some(
			(prefix) => trimmed === prefix || trimmed.startsWith(`${prefix} `),
		);
	}

	private underWritableRoot(path: string): boolean {
		const candidate = isAbsolute(path) ? resolve(path) : resolve(this.workspaceRoot, path);
		return this.roots.some((root) => {
			if (!root.writable) return false;
			const rel = relative(resolve(root.path), candidate);
			// 空字串 = 就是那個目錄本身；開頭是 .. = 跑到外面去了
			return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
		});
	}
}

/**
 * 這個呼叫可不可以變成一條「綁定目標」的持久規則？
 *
 * 三個條件（照 OpenWorker 的 standing_rule_candidate）：
 *   1. 只有 EXTERNAL 風險可以。**exec 和 write_local 永遠要問。**
 *   2. 工具要有一個「目標」參數
 *   3. 這次呼叫真的有指定目標
 *
 * 第 1 點的理由很實際：shell 指令沒有「目標」可以綁。
 * 「允許 run_command 執行 X」跟「允許 run_command」幾乎一樣危險，
 * 因為 X 下次可能長得完全不同。所以 shell 就是問到底。
 */
const TARGET_ARG: Record<string, string> = {
	send_email: "to",
	post_slack_message: "channel",
	create_calendar_event: "calendar_id",
	create_github_issue: "repo",
};

export function standingRuleTarget(
	toolName: string,
	args: Record<string, unknown>,
	metadata?: ToolRiskMetadata,
	overrides?: RiskOverrides,
): string | undefined {
	if (classify(toolName, metadata, overrides) !== RiskClass.EXTERNAL) return undefined;

	const argName = TARGET_ARG[toolName];
	if (!argName) return undefined;

	const value = String(args[argName] ?? "").trim();
	return value || undefined;
}

export { RiskClass, classify, isConsequential };
export type { RiskOverrides, ToolRiskMetadata };
