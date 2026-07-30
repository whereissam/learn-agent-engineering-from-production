/**
 * The permission engine's decision order (Lesson 8).
 *
 * This group guards **the order of the checks**. A wrong order is a security hole,
 * and a wrong order breaks nothing, so only a test can catch it.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { Mode, PermissionEngine, hasShellOperators } from "../shared/permissions/engine.ts";
import { classify, isConsequential, RiskClass } from "../shared/permissions/risk.ts";

const ROOT = "/tmp/agent-lessons-perm-root";

function engine(mode: Mode) {
	return new PermissionEngine({
		workspaceRoot: ROOT,
		mode,
		allowedCommands: ["git status", "ls"],
		autoAllowTools: ["write_file"],
	});
}

describe("風險分級（Lesson 8）", () => {
	test("內建工具照名稱分級", () => {
		assert.equal(classify("read_file"), RiskClass.READ);
		assert.equal(classify("write_file"), RiskClass.WRITE_LOCAL);
		assert.equal(classify("run_command"), RiskClass.EXEC);
		assert.equal(classify("send_email"), RiskClass.EXTERNAL);
	});

	test("未知工具預設為 READ", () => {
		assert.equal(classify("something_new"), RiskClass.READ);
	});

	test("requiresApproval 的未知工具視為 EXTERNAL", () => {
		assert.equal(classify("mcp_thing", { requiresApproval: true }), RiskClass.EXTERNAL);
	});

	test("使用者覆寫優先於內建表", () => {
		const overrides = (name: string) => (name === "run_command" ? RiskClass.READ : undefined);
		assert.equal(classify("run_command", undefined, overrides), RiskClass.READ);
	});

	test("只有 READ 不需要引擎過目", () => {
		assert.equal(isConsequential(RiskClass.READ), false);
		assert.equal(isConsequential(RiskClass.WRITE_LOCAL), true);
		assert.equal(isConsequential(RiskClass.EXEC), true);
		assert.equal(isConsequential(RiskClass.EXTERNAL), true);
	});
});

describe("AUTO 模式擋不住路徑逃逸（Lesson 8 Step 3）", () => {
	test("AUTO 允許 root 內的寫入", () => {
		const d = engine(Mode.AUTO).evaluate("write_file", { path: "report.md" });
		assert.equal(d.allowed, true);
	});

	test("AUTO 仍然擋掉 root 外的寫入", () => {
		const d = engine(Mode.AUTO).evaluate("write_file", { path: "../../.ssh/id_rsa" });
		assert.equal(d.allowed, false, "提高自主程度不該擴大沙箱邊界");
	});

	test("路徑逃逸是拒絕，不是「去問人」", () => {
		const d = engine(Mode.INTERACTIVE).evaluate("write_file", { path: "/etc/hosts" });
		assert.equal(d.allowed, false);
		assert.equal(d.needsUser, false, "硬性邊界問使用者也不該放行");
	});

	test("四種模式都擋得住路徑逃逸", () => {
		for (const mode of [Mode.PLAN, Mode.INTERACTIVE, Mode.CUSTOM, Mode.AUTO]) {
			const d = engine(mode).evaluate("write_file", { path: "../escape.txt" });
			assert.equal(d.allowed, false, `${mode} 模式沒擋住`);
		}
	});
});

describe("唯讀模式（Lesson 8）", () => {
	test("PLAN 拒絕所有有副作用的操作，且不詢問", () => {
		for (const tool of ["write_file", "run_command", "send_email"]) {
			const d = engine(Mode.PLAN).evaluate(tool, { path: "a.md", command: "ls", to: "x@y.z" });
			assert.equal(d.allowed, false, `${tool} 應該被拒絕`);
			assert.equal(d.needsUser, false, "唯讀模式不該去問人");
		}
	});

	test("PLAN 仍然允許讀取", () => {
		const d = engine(Mode.PLAN).evaluate("read_file", { path: "a.md" });
		assert.equal(d.allowed, true);
	});
});

describe("shell 元字元（Lesson 2 練習 5 / Lesson 8 Step 4）", () => {
	test("偵測會串接指令的元字元", () => {
		for (const cmd of ["ls; rm -rf ~", "ls && rm", "cat a | sh", "echo x > f", "`whoami`", "$(id)"]) {
			assert.equal(hasShellOperators(cmd), true, `沒抓到：${cmd}`);
		}
	});

	test("乾淨的指令不誤判", () => {
		for (const cmd of ["git status", "ls -la", "npm run build"]) {
			assert.equal(hasShellOperators(cmd), false, `誤判：${cmd}`);
		}
	});

	test("允許清單上的乾淨指令自動放行", () => {
		const d = engine(Mode.INTERACTIVE).evaluate("run_command", { command: "git status" });
		assert.equal(d.allowed, true);
	});

	test("允許清單前綴 + 元字元要降級成詢問", () => {
		const d = engine(Mode.INTERACTIVE).evaluate("run_command", { command: "git status; rm -rf ~" });
		assert.equal(d.allowed, false);
		assert.equal(d.needsUser, true, "應該是詢問而不是直接拒絕");
	});
});

describe("「都允許」的邊界（Lesson 8 Step 5）", () => {
	test("一般工具可以整個放行", () => {
		const e = engine(Mode.INTERACTIVE);
		e.allowToolForSession("write_file");
		const d = e.evaluate("write_file", { path: "a.md" });
		assert.equal(d.allowed, true);
	});

	test("connector 工具不能整個放行", () => {
		const e = engine(Mode.INTERACTIVE);
		e.allowToolForSession("post_slack_message");
		const d = e.evaluate("post_slack_message", { channel: "#all" }, { category: "connector" });
		assert.equal(d.allowed, false, "「允許這個工具」不該等於「發到任何頻道」");
		assert.equal(d.needsUser, true);
	});

	test("綁定目標的規則只對該目標生效", () => {
		const e = engine(Mode.INTERACTIVE);
		e.addTaskRule("send_email", "team@example.com");

		const ok = e.evaluate("send_email", { to: "team@example.com" }, { category: "connector" });
		assert.equal(ok.allowed, true);
		assert.ok(ok.rule?.includes("team@example.com"));

		const no = e.evaluate("send_email", { to: "everyone@example.com" }, { category: "connector" });
		assert.equal(no.allowed, false, "換個收件人就該重問");
	});

	test("exec 風險不能有綁定目標的規則", () => {
		const e = engine(Mode.INTERACTIVE);
		e.addTaskRule("run_command", "deploy.sh");
		const d = e.evaluate("run_command", { command: "deploy.sh" });
		assert.equal(d.allowed, false, "shell 要問到底");
	});
});
