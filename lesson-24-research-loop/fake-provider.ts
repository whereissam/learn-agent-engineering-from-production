/**
 * This lesson's fake provider.
 *
 * Earlier lessons' fake providers act out a scripted trajectory; this one is different:
 * the research loop makes **four different kinds of step**, so it has to recognise what it was asked
 * and return JSON of the matching shape.
 *
 * That fact alone shows the difference between a research loop and an agent loop:
 * an agent loop has one kind of call ("here is the history, what next"),
 * while a research loop has four independent, independently testable calls.
 *
 * **The sources it returns are URLs really pulled out of the prompt** rather than invented —
 * otherwise `extractLearnings`'s source filter would discard all of them (that filter is deliberate;
 * see steps.ts). A fake provider has to obey the real rules too.
 */

import type {
	ModelRequest,
	ModelResponse,
	StreamEvent,
	StreamingProvider,
} from "../shared/streaming/types.ts";
import { drain } from "../shared/streaming/types.ts";

const DELAY_MS = Number(process.env.FAKE_DELAY_MS ?? 0);

const QUERIES_LAYER_1 = [
	{ query: "open source video to humanoid motion retargeting unitree g1", goal: "find candidate projects" },
	{ query: "unitree g1 sdk joint ordering change 2026", goal: "confirm the root cause of the incompatibility" },
	{ query: "humanoid motion imitation project license maintained", goal: "confirm licensing and maintenance status" },
];

const QUERIES_LAYER_2 = [
	{ query: "retarget-anything g1 profile deprecated replacement", goal: "confirm the replacement after deprecation" },
	{ query: "humanoid-mimic foot sliding contact solver workaround", goal: "confirm the known limitations" },
];

export function fakeResearchProvider(): StreamingProvider {
	let queryRounds = 0;

	const provider: StreamingProvider = {
		name: "fake",
		model: "scripted-research",

		async *stream(request: ModelRequest): AsyncIterable<StreamEvent> {
			const prompt = request.messages.map((m) => (m.role === "user" ? m.text : "")).join("\n");
			let text: string;

			if (prompt.includes("follow-up questions that would")) {
				// clarify
				text = JSON.stringify([
					"Do you need something that runs on a physical G1, or is simulation acceptable?",
					"Is this commercial? (it decides whether non-commercially licensed model weights are acceptable)",
					"Do you need real-time streaming, or is offline batch processing enough?",
				]);
			} else if (prompt.includes("web search queries")) {
				// generateQueries
				text = JSON.stringify(queryRounds++ === 0 ? QUERIES_LAYER_1 : QUERIES_LAYER_2);
			} else if (prompt.includes("Extract up to")) {
					// extractLearnings: sources must use URLs that really appeared in the prompt
				const urls = [...prompt.matchAll(/<source url="([^"]+)"/g)].map((m) => m[1] ?? "");
				const first = urls[0] ?? "";
				const second = urls[1] ?? first;
				text = JSON.stringify({
					learnings: first
						? [
								{
									text: `According to the body of ${first}, this project's status differs from the impression the snippet gave (a canned conclusion from the fake provider).`,
									sources: [first],
								},
								{
									text: `${second} supplies version and licensing information, enough to judge commercial suitability.`,
									sources: [second],
								},
							]
						: [],
					followUps: ["When was this project last updated?", "Is there any record of hardware verification?"],
				});
			} else if (prompt.includes("Write a report")) {
				text =
					"(A report produced by the fake provider)\n\n" +
					"The evidence list above came from a real run of the whole pipeline: every item went through\n" +
					"search → rank → fetch → extract → distil, and every source URL passed the check that\n" +
					"only pages actually fetched may be cited.\n\n" +
					"The conclusion text is canned, because there is no real model. For a real report: `bun run lesson-24`.\n\n" +
					'What this lesson is really about is not the report but the "Actually spent" numbers above —\n' +
					"the research **finished**, and the cost was computable before it started.";
			} else {
				text = "(the fake provider does not recognise this prompt)";
			}

			yield { type: "text_start" };
			if (DELAY_MS > 0) await new Promise((r) => setTimeout(r, DELAY_MS));
			yield { type: "text_delta", delta: text };
			yield { type: "text_end" };
			yield {
				type: "done",
				response: { blocks: [{ type: "text", text }], raw: null, stopReason: "end" },
			};
		},

		async call(request: ModelRequest, signal?: AbortSignal): Promise<ModelResponse> {
			return await drain(provider.stream(request, signal));
		},
	};

	return provider;
}
