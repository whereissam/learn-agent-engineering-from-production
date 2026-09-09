/**
 * Pinning: remember what you approved, and check it is still that.
 *
 * Source: `mastra/packages/mcp/src/client/client.ts` (the `listChanged`
 * capability at `:286`, and the re-listing it licenses).
 *
 * ## The gap this closes
 *
 * Lesson 8 built a permission engine that answers "may this tool run". Lesson 12
 * connected tools whose descriptions somebody else writes. Put those together and
 * a question falls between them that neither lesson asks:
 *
 * > Approval was granted to **what**, exactly?
 *
 * An approval recorded as the string `"get_robot"` is an approval of a name. The
 * name is the one part of a tool that an attacker has no reason to change: the
 * behaviour lives in the description, because the description is the prompt.
 * Lesson 12 says so already — *"this is not a comment but a prompt"* — and then
 * stores the approval by name anyway.
 *
 * ## What a pin is
 *
 * A hash over everything the model will act on: name, description and schema.
 * Approval binds to that hash. When the tool list is fetched again, anything that
 * does not match is not the tool that was approved, whatever it is called.
 *
 * ## What a pin is not
 *
 * It is not detection. It says "this changed", never "this is malicious", and it
 * cannot tell a rewritten description from a legitimate upgrade. That is the
 * correct limit and it is the same shape as Lesson 29's: a mechanism that reports
 * a fact is worth more than one that guesses an intention.
 */

import { createHash } from "node:crypto";

export interface ToolDescriptor {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
}

/** The fields a pin covers, and the reason each one is in the list. */
export const PINNED_FIELDS = [
	/** identity */
	"name",
	/** the actual instruction to the model — the field that carries an attack */
	"description",
	/** what the model may be persuaded to put in the arguments */
	"inputSchema",
] as const;

/**
 * Hash a tool.
 *
 * `JSON.stringify` on the schema is order-sensitive, so a server that reorders
 * schema keys registers as a change. That is a false positive by intent: this
 * mechanism reports "not byte-identical to what you approved", and softening it
 * into "not semantically different" is how a pin quietly stops pinning.
 */
export function fingerprint(tool: ToolDescriptor): string {
	const canonical = JSON.stringify([tool.name, tool.description, tool.inputSchema]);
	return createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

export interface Approval {
	server: string;
	name: string;
	fingerprint: string;
	description: string;
	inputSchema: Record<string, unknown>;
	approvedAt: number;
}

export type DriftKind = "unchanged" | "description" | "schema" | "both" | "unapproved" | "withdrawn";

export interface DriftReport {
	name: string;
	kind: DriftKind;
	/** Safe to hand to the model, and safe to show a human. */
	summary: string;
	/** The text that was approved, kept so a human can diff it. */
	approvedDescription?: string;
	servedDescription?: string;
}

/**
 * One conversation's approvals, and the check.
 *
 * Deliberately in memory and deliberately small. Where this store lives is
 * Lesson 33's question, and the answer changes what "approved" means across a
 * restart.
 */
export class ToolPinStore {
	private approvals = new Map<string, Approval>();

	private key(server: string, name: string): string {
		return `${server}::${name}`;
	}

	approve(server: string, tool: ToolDescriptor): Approval {
		const approval: Approval = {
			server,
			name: tool.name,
			fingerprint: fingerprint(tool),
			description: tool.description,
			inputSchema: tool.inputSchema,
			approvedAt: Date.now(),
		};
		this.approvals.set(this.key(server, tool.name), approval);
		return approval;
	}

	isApproved(server: string, name: string): boolean {
		return this.approvals.has(this.key(server, name));
	}

	approvalFor(server: string, name: string): Approval | undefined {
		return this.approvals.get(this.key(server, name));
	}

	/** Check one freshly listed tool against what was approved. */
	check(server: string, tool: ToolDescriptor): DriftReport {
		const approval = this.approvals.get(this.key(server, tool.name));
		if (!approval) {
			return { name: tool.name, kind: "unapproved", summary: `${tool.name} was never approved` };
		}
		if (approval.fingerprint === fingerprint(tool)) {
			return { name: tool.name, kind: "unchanged", summary: `${tool.name} matches what was approved` };
		}

		const descriptionMoved = approval.description !== tool.description;
		const schemaMoved = JSON.stringify(approval.inputSchema) !== JSON.stringify(tool.inputSchema);
		const kind: DriftKind = descriptionMoved && schemaMoved ? "both" : descriptionMoved ? "description" : "schema";

		return {
			name: tool.name,
			kind,
			summary: `${tool.name}: ${kind} changed since approval`,
			approvedDescription: approval.description,
			servedDescription: tool.description,
		};
	}

	/** Check a whole tool list, including approvals for tools the server stopped offering. */
	checkAll(server: string, tools: ToolDescriptor[]): DriftReport[] {
		const reports = tools.map((tool) => this.check(server, tool));
		const served = new Set(tools.map((tool) => tool.name));
		for (const approval of this.approvals.values()) {
			if (approval.server !== server || served.has(approval.name)) continue;
			// A tool that disappears is not harmless: an agent mid-plan will look for
			// another way to finish, and the next-best tool was not the approved one.
			reports.push({
				name: approval.name,
				kind: "withdrawn",
				summary: `${approval.name} was approved but is no longer offered`,
			});
		}
		return reports;
	}
}

/**
 * What to do about a tool that no longer matches its approval.
 *
 *   "off"       send the list as the server wrote it. Lesson 12's behaviour today
 *   "block"     withhold the drifted tool from the model entirely
 *   "fallback"  offer the tool, using the description and schema that were
 *               approved, and ignore what the server just sent
 *
 * `block` is the safe-looking default and it is not free: it removes a capability
 * the task may need, and the agent then fails at something it used to do. The
 * README's Step 5 measures that.
 */
export type PinPolicy = "off" | "block" | "fallback";

export function admissible(reports: DriftReport[], policy: PinPolicy): DriftReport[] {
	if (policy === "off") return [];
	return reports.filter((report) => report.kind !== "unchanged");
}

/**
 * Apply a policy to a freshly listed tool set.
 *
 * `fallback` is the interesting one: the server is not trusted to describe its
 * own tools any more, but the tool itself still works, so the agent keeps
 * running against the text a human actually reviewed. It is only sound because
 * the *name* still routes the call correctly — and a server that reused a name
 * for a different operation would defeat it. Nothing here can detect that; only
 * running the tool and checking the result can, which is Lesson 29.
 */
export function applyPolicy(
	store: ToolPinStore,
	server: string,
	tools: ToolDescriptor[],
	policy: PinPolicy,
): ToolDescriptor[] {
	if (policy === "off") return tools;

	const kept: ToolDescriptor[] = [];
	for (const tool of tools) {
		const report = store.check(server, tool);
		if (report.kind === "unchanged" || report.kind === "unapproved") {
			kept.push(tool);
			continue;
		}
		if (policy === "block") continue;
		const approved = store.approvalFor(server, tool.name);
		kept.push(approved ? { name: tool.name, description: approved.description, inputSchema: approved.inputSchema } : tool);
	}
	return kept;
}
