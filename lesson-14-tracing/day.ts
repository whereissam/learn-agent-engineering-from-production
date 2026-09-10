/**
 * One morning in the life of an agent that serves more than one person.
 *
 * Four things happen and they **overlap in time**, which is the property the
 * whole lesson turns on:
 *
 *   08:00  a cron run summarises overnight alerts     (Lesson 18)
 *   08:01  Dana asks for a refund to be processed     — delegates to a subagent (Lesson 19)
 *   08:01  Sam asks for the deploy status             — starts while Dana's is still running
 *   08:02  Dana asks something else in a second tab   — two open requests, one person
 *
 * Nothing here is adversarial and nothing fails in an interesting way. It is an
 * ordinary morning, and an ordinary morning is already enough to make a flat log
 * unable to answer the questions in `demo.ts`.
 *
 * The fourth line was added after the first draft measured wrong. With one
 * request per person, `actor` is a usable stand-in for `request` and summing the
 * log by actor produces the right answer by accident — so the demo was claiming
 * the log could not do something the data said it could. A scenario that does
 * not contain the failing case cannot demonstrate the failure.
 *
 * The token and cost numbers are invented. What is not invented is the shape:
 * requests interleaved, one delegating, one tool retried, one person with two
 * things open.
 */

import { Recorder } from "./trace.ts";

const T = (minutes: number, seconds = 0) => 1_800_000_000_000 + minutes * 60_000 + seconds * 1000;

export interface Day {
	recorder: Recorder;
	/** The root span of each request, so the demo can ask about them by name. */
	roots: { cron: string; dana: string; danaSecond: string; sam: string };
}

export function simulateMorning(): Day {
	const recorder = new Recorder();

	// ── 08:00 the scheduled run ──────────────────────────────
	const cron = recorder.start({
		traceId: "t-cron",
		type: "agent_run",
		name: "cron: summarise overnight alerts",
		at: T(0),
		actor: "system",
	});
	const cronModel = recorder.start({
		traceId: "t-cron",
		parentSpanId: cron,
		type: "model_generation",
		name: "model: summarise",
		at: T(0, 5),
		actor: "system",
		attributes: { tokens: 4200, costCents: 3 },
	});
	recorder.end(cronModel, T(0, 20));

	// ── 08:01 Dana's refund, which delegates ─────────────────
	const dana = recorder.start({
		traceId: "t-dana",
		type: "agent_run",
		name: "dana: process the refund on ch_4471",
		at: T(1),
		actor: "dana",
	});
	const danaPlan = recorder.start({
		traceId: "t-dana",
		parentSpanId: dana,
		type: "model_generation",
		name: "model: plan the refund",
		at: T(1, 2),
		actor: "dana",
		attributes: { tokens: 3100, costCents: 2 },
	});
	recorder.end(danaPlan, T(1, 10));

	// The subagent is where flat logs lose the thread: its work is real, it is
	// expensive, and nothing in a log line says whose request paid for it.
	const danaSub = recorder.start({
		traceId: "t-dana",
		parentSpanId: dana,
		type: "subagent_run",
		name: "subagent: verify the charge is refundable",
		at: T(1, 12),
		actor: "dana",
	});
	const subModel = recorder.start({
		traceId: "t-dana",
		parentSpanId: danaSub,
		type: "model_generation",
		name: "model: verify",
		at: T(1, 14),
		actor: "dana",
		attributes: { tokens: 38_400, costCents: 27 },
	});
	recorder.end(subModel, T(2, 30));
	const subTool = recorder.start({
		traceId: "t-dana",
		parentSpanId: danaSub,
		type: "tool_call",
		name: "tool: stripe_list_charges",
		at: T(2, 31),
		actor: "dana",
		attributes: { tool: "stripe_list_charges", tokens: 900, costCents: 1 },
	});
	recorder.end(subTool, T(2, 40));
	recorder.end(danaSub, T(2, 41));

	// ── 08:01 Sam's question, overlapping Dana's ─────────────
	const sam = recorder.start({
		traceId: "t-sam",
		type: "agent_run",
		name: "sam: what is the deploy status?",
		at: T(1, 30),
		actor: "sam",
	});
	const samModel = recorder.start({
		traceId: "t-sam",
		parentSpanId: sam,
		type: "model_generation",
		name: "model: answer",
		at: T(1, 32),
		actor: "sam",
		attributes: { tokens: 2200, costCents: 1 },
	});
	recorder.end(samModel, T(1, 40));
	const samTool = recorder.start({
		traceId: "t-sam",
		parentSpanId: sam,
		type: "tool_call",
		name: "tool: github_list_deployments",
		at: T(1, 41),
		actor: "sam",
		attributes: { tool: "github_list_deployments" },
	});
	recorder.end(samTool, T(1, 45));
	recorder.end(sam, T(1, 50));

	// ── 08:02 Dana opens a second tab ────────────────────────
	//
	// This is what makes "sum the log by actor" wrong rather than merely fragile.
	// With one request each, actor is a usable proxy for request and the log gets
	// the right answer by accident. Two concurrent requests from one person is the
	// ordinary case for any chat interface, and it is the case the proxy cannot
	// survive — so the scenario has to contain it or the comparison is rigged.
	const danaSecond = recorder.start({
		traceId: "t-dana-2",
		type: "agent_run",
		name: "dana: and what did we spend on AWS last month?",
		at: T(2, 0),
		actor: "dana",
	});
	const danaSecondModel = recorder.start({
		traceId: "t-dana-2",
		parentSpanId: danaSecond,
		type: "model_generation",
		name: "model: answer the AWS question",
		at: T(2, 2),
		actor: "dana",
		attributes: { tokens: 12_800, costCents: 9 },
	});
	recorder.end(danaSecondModel, T(2, 25));
	recorder.end(danaSecond, T(2, 28));

	// ── back to Dana's refund: an approval, then a tool that has to be retried ──
	const approval = recorder.start({
		traceId: "t-dana",
		parentSpanId: dana,
		type: "approval",
		name: "approval: stripe_create_refund",
		at: T(2, 42),
		actor: "dana",
		attributes: { decision: "asked", rule: "EXTERNAL requires approval" },
	});
	recorder.end(approval, T(3, 10));

	// Three attempts at one logical step. In a log this is three identical lines.
	for (let attempt = 1; attempt <= 3; attempt++) {
		const call = recorder.start({
			traceId: "t-dana",
			parentSpanId: dana,
			type: "tool_call",
			name: "tool: stripe_create_refund",
			at: T(3, 10 + attempt * 5),
			actor: "dana",
			attributes: {
				tool: "stripe_create_refund",
				attempt,
				...(attempt < 3 ? { error: "429 rate limited" } : {}),
			},
		});
		recorder.end(call, T(3, 12 + attempt * 5));
	}
	recorder.end(dana, T(3, 30));
	recorder.end(cron, T(3, 40));

	return { recorder, roots: { cron, dana, danaSecond, sam } };
}
