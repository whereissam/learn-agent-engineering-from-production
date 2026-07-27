/**
 * 風險分級。
 *
 * Lesson 2 用一個 boolean 決定要不要問使用者：
 *
 *   readonly mutating: boolean;
 *
 * 這太粗糙了。「寫一個檔案到工作目錄」跟「寄一封信給客戶」都是 mutating，
 * 但危險程度差很多：前者可以還原，後者收不回來。
 *
 * OpenWorker 用四個等級取代那個 boolean。而且它的 risk.py 開頭那句
 * docstring 講出了關鍵設計轉變：
 *
 *   > This replaces the hardcoded WRITE_TOOLS / SHELL_TOOL name sets the
 *   > permission engine used to carry inline: risk is now a declared property
 *   > a single classify reads.
 *
 * 也就是：風險從「權限引擎裡寫死的名單」變成「工具自己宣告的屬性」。
 * 這樣新增工具的人不用去改權限引擎，權限引擎也不用認得每一個工具。
 *
 * 對照：openworker/coworker/risk.py
 */

/**
 * 四個等級。順序有意義：越後面越危險。
 */
export enum RiskClass {
	/** 沒有副作用。永遠允許，不用問。 */
	READ = "read",

	/** 改動工作目錄裡的東西。可以還原，但要限制在允許的路徑內。 */
	WRITE_LOCAL = "write_local",

	/** 執行指令。你不知道它會做什麼，所以要問。 */
	EXEC = "exec",

	/**
	 * 副作用跑到機器外面：寄信、發訊息、呼叫別人的 API、改別人的資料。
	 *
	 * 這是最危險的一級，因為**收不回來**。你可以還原一個檔案，
	 * 但你收不回一封已經寄出的信。
	 *
	 * Lesson 9 會看到，這一級還有一個特別的性質：
	 * 它是「無人值守時要不要停下來」的判斷依據。
	 */
	EXTERNAL = "external",
}

/** 工具可以自己宣告風險等級。沒宣告的話下面的規則會推斷。 */
export interface ToolRiskMetadata {
	/** 工具自己宣告的等級。優先於推斷。 */
	risk?: RiskClass;
	/** 通用旗標（例如 MCP 工具會有）。true 就當成 EXTERNAL。 */
	requiresApproval?: boolean;
	/** 工具的分類，例如 "connector"。影響 Lesson 9 的 standing rule。 */
	category?: string;
}

/**
 * 使用者的本地覆寫。
 *
 * 為什麼需要？因為預設值必須保守，但保守的預設值會很煩。
 * 例如 MCP 工具預設全部當 EXTERNAL（因為你不知道它會做什麼），
 * 但使用者可能有一個只讀的 MCP 工具，每次都要批准很痛苦。
 *
 * 覆寫讓使用者可以說「這個我信任」，而不用改預設值。
 */
export type RiskOverrides = (toolName: string) => RiskClass | undefined;

/**
 * 內建工具的固定分級。
 *
 * 注意這是**資料**，不是散在程式碼裡的 if。
 * 想知道哪些工具會寫檔，看這張表就好。
 */
const BASE: Record<string, RiskClass> = {
	// 唯讀
	read_file: RiskClass.READ,
	list_files: RiskClass.READ,
	grep: RiskClass.READ,

	// 動到本機檔案
	write_file: RiskClass.WRITE_LOCAL,
	edit_file: RiskClass.WRITE_LOCAL,
	delete_file: RiskClass.WRITE_LOCAL,

	// 執行指令
	run_command: RiskClass.EXEC,

	// 副作用跑到機器外
	send_email: RiskClass.EXTERNAL,
	post_slack_message: RiskClass.EXTERNAL,
	create_calendar_event: RiskClass.EXTERNAL,
	create_github_issue: RiskClass.EXTERNAL,
};

/**
 * 算出一個工具呼叫的「實際」風險。
 *
 * 優先序（OpenWorker 的 classify 也是這個順序）：
 *   1. 使用者的本地覆寫
 *   2. 內建的名稱對照表
 *   3. 工具 metadata 自己宣告的
 *   4. metadata.requiresApproval → EXTERNAL
 *   5. 都沒有 → READ
 *
 * 最後一項值得討論：預設是 READ，也就是「預設允許」。
 * 這看起來跟 Lesson 2 的「預設拒絕」矛盾，但兩者管的是不同的事：
 *   - 這裡的預設是「這個工具有多危險」，不知道就當作不危險
 *   - Lesson 2 的預設是「使用者沒回答時怎麼辦」，不知道就當作拒絕
 *
 * 如果你的工具集包含不受信任的來源（例如任意 MCP server），
 * 應該把最後一項改成 EXTERNAL。OpenWorker 就是這樣做的
 * （靠 metadata.requiresApproval）。
 */
export function classify(
	toolName: string,
	metadata?: ToolRiskMetadata,
	overrides?: RiskOverrides,
): RiskClass {
	const override = overrides?.(toolName);
	if (override !== undefined) return override;

	const base = BASE[toolName];
	if (base !== undefined) return base;

	if (metadata?.risk !== undefined) return metadata.risk;
	if (metadata?.requiresApproval) return RiskClass.EXTERNAL;

	return RiskClass.READ;
}

/**
 * 除了純讀取之外，都需要權限引擎過目。
 *
 * 這個小函式讓呼叫端不用記得「READ 以外都要檢查」這條規則。
 */
export function isConsequential(risk: RiskClass): boolean {
	return risk !== RiskClass.READ;
}

/** 註冊一個工具的風險等級（給你自己的領域工具用）。 */
export function declareRisk(toolName: string, risk: RiskClass): void {
	BASE[toolName] = risk;
}
