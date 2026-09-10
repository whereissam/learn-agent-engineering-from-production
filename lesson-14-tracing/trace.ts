/**
 * Two ways to write down what an agent did, from one set of calls.
 *
 * Source: `mastra/packages/core/src/observability/types/tracing.ts` — the
 * `SpanType` enum at `:35`, `traceId` at `:768`, `parent` at `:810` and
 * `isRootSpan` at `:834`.
 *
 * ## The question this exists for
 *
 * Lesson 8's Exercise 4 builds an audit log: every permission decision, with the
 * rule it relied on, appended to a file. It answers *what happened* completely.
 *
 * It cannot answer the question the operator actually asks a week later:
 *
 * > This `send_email` — whose request was it part of, and what did that request
 * > cost in total?
 *
 * Not because the log is missing a field, but because of what a log **is**. A log
 * line is an event with a timestamp. Two things happening on behalf of two
 * different people interleave in the file, and no amount of extra columns
 * reconstructs which caused which — the causal edge was never recorded, because
 * an append-only line has nowhere to put it.
 *
 * ## What a span adds, and it is exactly one thing
 *
 * `parentSpanId`. Everything else — durations, token counts, attributes — a log
 * line can carry too. The parent pointer is what turns a pile of events into a
 * tree, and the tree is what lets you sum a subtree and say "this request cost
 * that much".
 *
 * Mastra's taxonomy at `tracing.ts:35` is 20-odd span types, and the shape worth
 * copying is that `AGENT_RUN` and `WORKFLOW_RUN` are documented as *root* spans
 * while `TOOL_CALL`, `MODEL_GENERATION` and `MCP_TOOL_CALL` are not. That is the
 * distinction this file keeps and the rest of the taxonomy it drops.
 */

/** A deliberately small slice of Mastra's `SpanType`. */
export type SpanType =
	/** Root of one request. Mastra documents `AGENT_RUN` as "root span for agent processes". */
	| "agent_run"
	/** A delegated run. Its own subtree, still under the request that caused it (Lesson 19). */
	| "subagent_run"
	| "model_generation"
	| "tool_call"
	/** A permission decision — Lesson 8's audit line, as a span. */
	| "approval";

export interface SpanAttributes {
	/** Tokens attributed to this span alone, never to its children. */
	tokens?: number;
	costCents?: number;
	tool?: string;
	/** For approvals: what the engine decided, and on which rule. */
	decision?: "auto" | "asked" | "denied";
	rule?: string;
	/** Set when this span is a retry of an earlier attempt at the same logical step. */
	attempt?: number;
	error?: string;
}

export interface Span {
	id: string;
	/** Every span in one request shares this. */
	traceId: string;
	/** The one field a log line cannot carry. */
	parentSpanId?: string;
	type: SpanType;
	name: string;
	startedAt: number;
	endedAt?: number;
	/** Who this was done for. Not the agent — the person. */
	actor: string;
	attributes: SpanAttributes;
}

export interface LogLine {
	at: number;
	actor: string;
	message: string;
	attributes: SpanAttributes;
}

/**
 * Record a run twice, from the same calls.
 *
 * Both recorders see identical information. The comparison in `demo.ts` is
 * therefore about **structure**, not about one recorder being given more — which
 * is the only way the comparison is honest, because "logs are worse" is easy to
 * prove by writing worse logs.
 */
export class Recorder {
	readonly spans: Span[] = [];
	readonly log: LogLine[] = [];
	private counter = 0;

	private nextId(): string {
		this.counter += 1;
		return `s${String(this.counter).padStart(3, "0")}`;
	}

	/**
	 * Open a span and return its id, plus the log line the same event produces.
	 *
	 * A log line gets everything except the parent pointer. That omission is not
	 * a handicap imposed for the demonstration: a log line is a record of an
	 * event, and "which other event caused me" is not a property of an event.
	 */
	start(options: {
		traceId: string;
		parentSpanId?: string;
		type: SpanType;
		name: string;
		at: number;
		actor: string;
		attributes?: SpanAttributes;
	}): string {
		const id = this.nextId();
		const attributes = options.attributes ?? {};
		this.spans.push({
			id,
			traceId: options.traceId,
			parentSpanId: options.parentSpanId,
			type: options.type,
			name: options.name,
			startedAt: options.at,
			actor: options.actor,
			attributes,
		});
		this.log.push({ at: options.at, actor: options.actor, message: options.name, attributes });
		return id;
	}

	end(id: string, at: number): void {
		const span = this.spans.find((candidate) => candidate.id === id);
		if (span) span.endedAt = at;
	}

	/** Both records, sorted the way each is actually stored. */
	sortedLog(): LogLine[] {
		return [...this.log].sort((a, b) => a.at - b.at);
	}
}

// ─────────────────────────────────────────────────────────────
// Reading a span tree
// ─────────────────────────────────────────────────────────────

export function rootsOf(spans: Span[]): Span[] {
	return spans.filter((span) => span.parentSpanId === undefined);
}

export function childrenOf(spans: Span[], parentId: string): Span[] {
	return spans.filter((span) => span.parentSpanId === parentId);
}

/**
 * Everything under a span, including itself.
 *
 * This walk is the whole reason the parent pointer is worth its storage: it is
 * how "what did this request cost" becomes a computation rather than a guess.
 */
export function subtree(spans: Span[], rootId: string): Span[] {
	const collected: Span[] = [];
	const walk = (id: string) => {
		const span = spans.find((candidate) => candidate.id === id);
		if (!span) return;
		collected.push(span);
		for (const child of childrenOf(spans, id)) walk(child.id);
	};
	walk(rootId);
	return collected;
}

export function costOfSubtree(spans: Span[], rootId: string): number {
	return subtree(spans, rootId).reduce((total, span) => total + (span.attributes.costCents ?? 0), 0);
}

export function tokensOfSubtree(spans: Span[], rootId: string): number {
	return subtree(spans, rootId).reduce((total, span) => total + (span.attributes.tokens ?? 0), 0);
}

/** Render a tree, for the human half of "what did this agent do last week". */
export function renderTree(spans: Span[], rootId: string, depth = 0): string[] {
	const span = spans.find((candidate) => candidate.id === rootId);
	if (!span) return [];
	const cost = span.attributes.costCents ? ` ${span.attributes.costCents}c` : "";
	const tokens = span.attributes.tokens ? ` ${span.attributes.tokens}tok` : "";
	const attempt = span.attributes.attempt ? ` attempt=${span.attributes.attempt}` : "";
	const decision = span.attributes.decision ? ` ${span.attributes.decision}` : "";
	const lines = [`${"  ".repeat(depth)}${span.name}${cost}${tokens}${attempt}${decision}`];
	for (const child of childrenOf(spans, rootId)) lines.push(...renderTree(spans, child.id, depth + 1));
	return lines;
}
