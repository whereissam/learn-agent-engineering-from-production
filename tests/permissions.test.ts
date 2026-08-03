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

describe("risk classification (Lesson 8)", () => {
	test("built-in tools are classified by name", () => {
		assert.equal(classify("read_file"), RiskClass.READ);
		assert.equal(classify("write_file"), RiskClass.WRITE_LOCAL);
		assert.equal(classify("run_command"), RiskClass.EXEC);
		assert.equal(classify("send_email"), RiskClass.EXTERNAL);
	});

	test("an unknown tool defaults to READ", () => {
		assert.equal(classify("something_new"), RiskClass.READ);
	});

	test("an unknown tool with requiresApproval counts as EXTERNAL", () => {
		assert.equal(classify("mcp_thing", { requiresApproval: true }), RiskClass.EXTERNAL);
	});

	test("a user override beats the built-in table", () => {
		const overrides = (name: string) => (name === "run_command" ? RiskClass.READ : undefined);
		assert.equal(classify("run_command", undefined, overrides), RiskClass.READ);
	});

	test("only READ skips the engine", () => {
		assert.equal(isConsequential(RiskClass.READ), false);
		assert.equal(isConsequential(RiskClass.WRITE_LOCAL), true);
		assert.equal(isConsequential(RiskClass.EXEC), true);
		assert.equal(isConsequential(RiskClass.EXTERNAL), true);
	});
});

describe("AUTO mode still blocks path escapes (Lesson 8 Step 3)", () => {
	test("AUTO allows writes inside root", () => {
		const d = engine(Mode.AUTO).evaluate("write_file", { path: "report.md" });
		assert.equal(d.allowed, true);
	});

	test("AUTO still blocks writes outside root", () => {
		const d = engine(Mode.AUTO).evaluate("write_file", { path: "../../.ssh/id_rsa" });
		assert.equal(d.allowed, false, "raising autonomy must not widen the sandbox boundary");
	});

	test("a path escape is a refusal, not a go-ask-a-human", () => {
		const d = engine(Mode.INTERACTIVE).evaluate("write_file", { path: "/etc/hosts" });
		assert.equal(d.allowed, false);
		assert.equal(d.needsUser, false, "a hard boundary must not be unlocked by asking the user");
	});

	test("all four modes block path escapes", () => {
		for (const mode of [Mode.PLAN, Mode.INTERACTIVE, Mode.CUSTOM, Mode.AUTO]) {
			const d = engine(mode).evaluate("write_file", { path: "../escape.txt" });
			assert.equal(d.allowed, false, `${mode} mode did not block it`);
		}
	});
});

describe("read-only mode (Lesson 8)", () => {
	test("PLAN refuses every side-effecting operation without asking", () => {
		for (const tool of ["write_file", "run_command", "send_email"]) {
			const d = engine(Mode.PLAN).evaluate(tool, { path: "a.md", command: "ls", to: "x@y.z" });
			assert.equal(d.allowed, false, `${tool} should have been refused`);
			assert.equal(d.needsUser, false, "read-only mode must not ask a human");
		}
	});

	test("PLAN still allows reads", () => {
		const d = engine(Mode.PLAN).evaluate("read_file", { path: "a.md" });
		assert.equal(d.allowed, true);
	});
});

describe("shell metacharacters (Lesson 2 exercise 5 / Lesson 8 Step 4)", () => {
	test("detects metacharacters that chain commands", () => {
		for (const cmd of ["ls; rm -rf ~", "ls && rm", "cat a | sh", "echo x > f", "`whoami`", "$(id)"]) {
			assert.equal(hasShellOperators(cmd), true, `missed: ${cmd}`);
		}
	});

	test("clean commands are not false-flagged", () => {
		for (const cmd of ["git status", "ls -la", "npm run build"]) {
			assert.equal(hasShellOperators(cmd), false, `false positive: ${cmd}`);
		}
	});

	test("a clean allowlisted command is auto-allowed", () => {
		const d = engine(Mode.INTERACTIVE).evaluate("run_command", { command: "git status" });
		assert.equal(d.allowed, true);
	});

	test("an allowlisted prefix plus a metacharacter downgrades to asking", () => {
		const d = engine(Mode.INTERACTIVE).evaluate("run_command", { command: "git status; rm -rf ~" });
		assert.equal(d.allowed, false);
		assert.equal(d.needsUser, true, "it should ask rather than refuse outright");
	});
});

describe('the limits of "always allow" (Lesson 8 Step 5)', () => {
	test("an ordinary tool can be unlocked wholesale", () => {
		const e = engine(Mode.INTERACTIVE);
		e.allowToolForSession("write_file");
		const d = e.evaluate("write_file", { path: "a.md" });
		assert.equal(d.allowed, true);
	});

	test("a connector tool cannot be unlocked wholesale", () => {
		const e = engine(Mode.INTERACTIVE);
		e.allowToolForSession("post_slack_message");
		const d = e.evaluate("post_slack_message", { channel: "#all" }, { category: "connector" });
		assert.equal(d.allowed, false, '"allow this tool" must not mean "post to any channel"');
		assert.equal(d.needsUser, true);
	});

	test("a target-bound rule applies only to that target", () => {
		const e = engine(Mode.INTERACTIVE);
		e.addTaskRule("send_email", "team@example.com");

		const ok = e.evaluate("send_email", { to: "team@example.com" }, { category: "connector" });
		assert.equal(ok.allowed, true);
		assert.ok(ok.rule?.includes("team@example.com"));

		const no = e.evaluate("send_email", { to: "everyone@example.com" }, { category: "connector" });
		assert.equal(no.allowed, false, "a different recipient should be asked about again");
	});

	test("exec risk cannot hold a target-bound rule", () => {
		const e = engine(Mode.INTERACTIVE);
		e.addTaskRule("run_command", "deploy.sh");
		const d = e.evaluate("run_command", { command: "deploy.sh" });
		assert.equal(d.allowed, false, "shell asks every time");
	});
});
