/**
 * Evaluation cases.
 *
 * Each case = one input plus a set of expectations a program can check.
 *
 * The most important design decision here: **do not score by "is the model's output identical to a reference answer".**
 * Natural language has infinitely many correct phrasings, and string comparison only produces false failures.
 *
 * Check verifiable facts instead:
 *   - is the classification right (an enum, directly comparable)
 *   - does the time window cover the real event (a numeric range, computable)
 *   - does it cite numbers that really exist (checkable against the telemetry)
 *   - does it say "I do not know" when it should
 *
 * All deterministic checks, giving the same result a hundred runs in a row.
 */

/** The report's shape, matching the JSON create_incident_report writes. */
export interface IncidentReport {
	session_id: string;
	classification: string;
	confidence: string;
	window_start_ms: number | null;
	window_end_ms: number | null;
	summary: string;
	evidence: string[];
	caveats: string[];
	next_steps: string[];
}

export interface EvalCase {
	id: string;
	sessionId: string;
	/** The instruction given to the agent. Every case uses the same one, so nothing hints at the answer. */
	prompt: string;
	/** A human-readable statement of the truth. For you only; it never enters the prompt. */
	groundTruth: string;

	/** Acceptable classifications. Several are allowed, because some situations are genuinely ambiguous. */
	acceptableClassifications: string[];
	/** The ideal classification. Distinguishes "entirely right" from "acceptable". */
	idealClassification: string;

	/**
	 * The window in which the event really happened.
	 * The report's window must overlap it to count as having found the right place.
	 */
	trueWindow?: { start_ms: number; end_ms: number };

	/**
	 * Keywords the report's caveats or summary **must** mention (any one will do).
	 *
	 * ⚠️ This field only covers "was it mentioned"; it **does not mean this case has a data problem**.
	 * The two used to be tied together (the rubric took the presence of `mustMention` as a proxy
	 * for "the data has a problem"), and adding two-events blew that up:
	 * that case uses mustMention to check "did it mention the earlier stumble",
	 * and the agent lost points for "reporting high confidence when the data is clean".
	 *
	 * **Using one field's presence as a proxy for another thing blows up eventually.**
	 */
	mustMention?: string[];

	/**
	 * This session really has a data quality problem (a sampling gap, a clock offset…).
	 *
	 * Reporting high confidence when there is a problem is a calibration failure.
	 * That is a different matter from `mustMention`, so they are separate fields.
	 */
	dataQualityIssue?: boolean;

	/**
	 * Classifications that must **never** appear.
	 * The most important check: catching dangerous errors rather than merely imperfect answers.
	 */
	forbiddenClassifications?: string[];
}

/**
 * Seven cases.
 *
 *   1-3  is the judgement accurate
 *   4-5  does it know what it does not know
 *   6-7  does the tools' shape assume "one sudden event per session"
 *
 * 4-5 matter more than 1-3: an agent that honestly says "cannot determine" when data is thin
 * is far more useful than one that always produces a confident answer.
 *
 * 6-7 were added later, because the first five shared a blind spot — all of them were
 * "single, sudden" events, so the lazy approach of "copy find_anomalies's candidate window"
 * **never lost points** on the first five.
 */
export const CASES: EvalCase[] = [
	{
		id: "real-fall",
		sessionId: "sess_001",
		prompt: "Analyse what happened in this session and write an incident report.",
		groundTruth:
			"Pitches forward from t=8200ms, all four feet leave the ground at 8600ms, torque spikes then drops to zero, and the robot lies flat without recovering",
		idealClassification: "fall",
		acceptableClassifications: ["fall"],
		trueWindow: { start_ms: 8200, end_ms: 9000 },
		// Calling a real fall nothing is the most dangerous error
		forbiddenClassifications: ["nominal", "near_miss"],
	},
	{
		id: "crouch-not-fall",
		sessionId: "sess_002",
		prompt: "Analyse what happened in this session and write an incident report.",
		groundTruth:
			"A fast crouch at t=5000ms. Pitch shoots to 36 degrees and looks like a fall, but all four feet stay down and it recovers 1.2s later",
		idealClassification: "near_miss",
		// nominal is acceptable too: nothing did in fact go wrong
		acceptableClassifications: ["near_miss", "nominal"],
		trueWindow: { start_ms: 5000, end_ms: 6200 },
		// A false positive test: calling a crouch a fall would generate a flood of false alarms
		forbiddenClassifications: ["fall"],
	},
	{
		id: "external-collision",
		sessionId: "sess_003",
		prompt: "Analyse what happened in this session and write an incident report.",
		groundTruth:
			"A sideways impact at t=6400ms, a 38-degree roll spike plus an acceleration spike; it staggers and recovers on its own",
		idealClassification: "external_collision",
		acceptableClassifications: ["external_collision", "near_miss"],
		trueWindow: { start_ms: 6400, end_ms: 7800 },
		forbiddenClassifications: ["fall", "nominal"],
	},
	{
		id: "missing-data",
		sessionId: "sess_004",
		prompt: "Analyse what happened in this session and write an incident report.",
		groundTruth:
			"No samples at all between t=4000-7000ms. What happened in that window cannot be judged from telemetry",
		idealClassification: "inconclusive",
		acceptableClassifications: ["inconclusive", "nominal"],
		// It must notice and state that the data has a hole
		mustMention: ["gap", "missing", "no data", "hole", "sampling", "absent"],
		dataQualityIssue: true,
		// Drawing a confident conclusion over a period with no data is the worst behaviour
		forbiddenClassifications: ["fall", "external_collision"],
	},
	{
		id: "clock-skew",
		sessionId: "sess_005",
		prompt: "Analyse what happened in this session and write an incident report.",
		groundTruth:
			"Telemetry shows an event at t=7000ms; the video clock runs 2300ms ahead of telemetry. The conversion has to be right",
		idealClassification: "near_miss",
		acceptableClassifications: ["near_miss", "fall", "external_collision", "inconclusive"],
		trueWindow: { start_ms: 7000, end_ms: 7400 },
		mustMention: ["offset", "clock", "skew", "2300"],
		dataQualityIssue: true,
	},

	// ── the two cases added later ──────────────────────────────
	//
	// The original five shared a shape: **one sudden event per session**.
	// That shape lets both the tools and the prompt be lazy, and real telemetry does not look like it.
	{
		id: "two-events",
		sessionId: "sess_006",
		prompt: "Analyse what happened in this session and write an incident report.",
		groundTruth:
			"Two events: a stagger with recovery at t≈3460ms, and a real fall at t≈9400ms. " +
			"find_anomalies offers both candidates; the question is whether the report writes up only the most severe one",
		idealClassification: "fall",
		acceptableClassifications: ["fall"],
		trueWindow: { start_ms: 9200, end_ms: 10000 },
		// The classification follows the most severe event, and **the earlier stumble must be mentioned too**.
		// Reporting only the most severe one is the failure this case exists to catch:
		// maintenance needs to know "it has already been unstable once today".
		mustMention: ["3460", "3500", "3.4", "3.5", "twice", "first", "earlier", "another"],
		forbiddenClassifications: ["nominal", "near_miss"],
	},
	{
		id: "slow-tip",
		sessionId: "sess_007",
		prompt: "Analyse what happened in this session and write an incident report.",
		groundTruth:
			"A slow tip-over from t=4000ms; pitch climbs to 55 degrees over 6 seconds and all four feet leave the ground at t=9500ms. " +
			"The point: find_anomalies' candidate only starts at t=7060ms (the threshold needs pitch>30 to fire), " +
			"three seconds after the event actually began",
		idealClassification: "fall",
		acceptableClassifications: ["fall"],
		// ⚠️ This window is deliberately set **before** the candidate window.
		//
		// Copying find_anomalies's 7060.. straight through fails here,
		// which is exactly what is being tested: **candidates are not the answer** (Lesson 6 Step 3
		// says so, and at the time no case would fail for it, so that principle was never verified).
		trueWindow: { start_ms: 4000, end_ms: 7000 },
		forbiddenClassifications: ["nominal"],
	},
];
