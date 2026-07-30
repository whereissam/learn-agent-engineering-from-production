/**
 * 建立排程時就擋掉的那一類工作：**會殺掉跑排程的那個東西**。
 *
 * 這不是假想威脅，是 Hermes 的一個真實 issue（`cron/lifecycle_guard.py`
 * 的 docstring 標了 #30719），而且它的因果鏈值得整條念一遍：
 *
 *   agent 排了一個「重啟 gateway」的工作
 *   → 工作觸發，gateway 死掉
 *   → 監管者（launchd KeepAlive / systemd Restart=）把它救活
 *   → auto-resume 撿回那個 session
 *   → 那一輪重跑同樣的邏輯
 *   → 又排一次 / 又重啟一次……每 ~10 秒一輪，直到有人手動介入
 *
 * **每一個環節單獨看都是對的設計**：排程、監管者自動重啟、
 * 中斷後自動恢復，三個都是你會想要的功能。
 * 迴圈是它們**相乘**出來的。
 *
 * ⚠️ 兩個抄自原始碼的判斷，兩個都很容易做錯：
 *
 * 一、**比對要是「指令形狀」，不能是關鍵字。**
 * cron 的 prompt 是餵給模型的，不是餵給 shell 的。用英文子字串比對
 * （"restart"、"gateway"）會把「幫我研究 Kong API gateway 的
 * autoscaling 和 restart 行為」這種正常需求擋掉，而且**擋不住真的那個**。
 *
 * 二、**`start` 刻意不擋。** 在 gateway 裡面啟動 gateway 是無害的
 * （不是 no-op 就是「已經在跑了」），而且合法的工作可能要啟動另一個 profile。
 * 一個把 start 也擋掉的守衛會製造無法解釋的失敗。
 *
 * > **能擋的東西比會擋的東西多，這正是守衛難寫的地方。**
 */

/** 這一課的 workspace 裡，「跑排程的那個東西」叫做 agentd。 */
const LIFECYCLE_PATTERN = new RegExp(
	[
		// A：直接對 agentd 下 restart / stop —— 最經典的那個。
		String.raw`(?:agentd\s+(?:restart|stop))`,
		// B：launchctl 對 agentd 的 label 動手。要求出現 agentd 這個識別字，
		//    否則會擋到不相干的服務。
		String.raw`(?:launchctl\s+(?:kickstart|unload|load|stop|restart)\b[^\n]*\bagentd)`,
		// C：systemctl 對 agentd 的 unit 動手。
		String.raw`(?:systemctl\s+(?:-\S+\s+)*(?:restart|stop|start)\b[^\n]*\bagentd)`,
		// D：pkill / kill 打進程。兩種詞序都要，因為真實案例兩種都出現過。
		String.raw`(?:p?kill\b[^\n]*\bagentd)`,
		String.raw`(?:p?kill\b[^\n]*\bagent\b[^\n]*\bd(?:aemon)?\b)`,
	].join("|"),
	"i",
);

export class LifecycleBlocked extends Error {
	constructor(message: string) {
		super(message);
		this.name = "LifecycleBlocked";
	}
}

export function containsLifecycleCommand(text: string): boolean {
	if (!text) return false;
	return LIFECYCLE_PATTERN.test(text);
}

/**
 * 建立工作之前檢查。prompt 和 script **要合起來看**，
 * 否則把指令拆成兩半就繞過去了。
 */
export function checkLifecycle(prompt: string, script?: string): void {
	const combined = script ? `${prompt}\n${script}` : prompt;
	if (!containsLifecycleCommand(combined)) return;

	// 錯誤訊息要講清楚**為什麼**、以及**怎麼做才對**。
	// 這段字會變成 tool result 回到模型手上（Lesson 8 的教訓：
	// 那是模型唯一的資訊來源），只寫「不允許」它只會換句話再試一次。
	throw new LifecycleBlocked(
		"Blocked: this scheduled job contains a command that stops or restarts " +
			"the agent daemon (agentd). Scheduling it would create a restart loop: " +
			"the job kills the daemon, the supervisor revives it, auto-resume replays " +
			"the same turn, and the job fires again. " +
			"If you need to restart the daemon, do it from a shell outside it — " +
			"a scheduled job is never the right place.",
	);
}
