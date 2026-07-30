/**
 * Citation verification: does that page really say this sentence?
 *
 * Lesson 24 already blocks half the problem: a learning may only cite URLs that were **really fetched**.
 * But one error remains unblocked, and it appeared in a report really produced here:
 *
 *   "its pretrained weights carry a non-commercial licence"
 *    (github.com/kinelabs/humanoid-mimic, discourse.ros.org/t/...45211, blog.kinelabs.dev/...)」
 *
 * One of the first two URLs never mentions licensing. **The URL is real, fetched and existing,
 * and it does not support the sentence.** This is called citation grafting,
 * and it is more dangerous than a wholesale hallucination, because it looks entirely compliant.
 *
 * ## How to verify it without an LLM judge
 *
 * "Is this sentence supported by this page" sounds like a semantic judgement, and reaching for a
 * model to score it is tempting.
 * But Lesson 7's principle holds here too: **scoring must be deterministic**, or you cannot answer
 * "did that prompt change make things worse" — because the judge drifts as well.
 * The method used here is crude, and it catches the real problems:
 *
 *   1. extract **checkable atoms** from the sentence: numbers, versions, dates, identifiers, licence names
 *   2. look for those atoms in each cited source's body text
 *   3. a source where not one atom is found → that citation is grafted
 *   4. an atom found in no source at all → that number was invented
 *
 * ## This method's limits (stated up front)
 *
 * **It checks no semantics, only whether these specific things are present.**
 *
 *   ✗ misses: subjective sentences with no atoms, like "A is better than B"
 *   ✗ misses: all atoms present but the sentence reverses the causality
 *   ✗ false positive: the source happens to contain the same number somewhere unrelated
 *
 * So why is it worth doing? Because **the class of error it catches is the most common one in
 * measurement**: a model attaching a real number to a source that never said it.
 * And it is cheap, reproducible and CI-able.
 *
 * > Better a deterministic check that catches 70% of problems
 * > than an LLM judge claiming 95% whose results differ every run.
 */

/** One checkable atom. */
export interface Atom {
	/** The normalised value, used for comparison. */
	value: string;
	/** What it looked like in the original, for humans. */
	raw: string;
	kind: "number" | "identifier";
}

const STOPWORDS = new Set([
	"http", "https", "www", "com", "org", "net", "github", "html", "the", "and", "for",
	"with", "this", "that", "from", "url", "sources", "source",
]);

/**
 * Normalise a number.
 *
 * `06` and `6`, and `0.80` and `0.8`, must count as the same,
 * or "2026-06-30" will not line up with "June 2026".
 */
function normalizeNumber(text: string): string {
	const value = Number(text);
	return Number.isFinite(value) ? String(value) : text.toLowerCase();
}

/**
 * Extract checkable atoms.
 *
 * Two kinds:
 *
 *   numbers      17, 0.8, 2026, 50, 23      ← versions, dates and measurements all live here
 *   identifiers  MIT, Apache-2.0, URDF, left_knee, humanoid-mimic, RTX
 *
 * An identifier must contain a digit, a hyphen/underscore/dot, or be all caps —
 * that is what catches proper nouns rather than ordinary English words. Chinese is not extracted,
 * because Chinese segmentation is too unreliable and yields more noise than signal in comparison.
 */
export function extractAtoms(text: string): Atom[] {
	const atoms: Atom[] = [];
	const seen = new Set<string>();

	const add = (value: string, raw: string, kind: Atom["kind"]) => {
		const key = `${kind}:${value}`;
		if (!value || seen.has(key) || STOPWORDS.has(value)) return;
		seen.add(key);
		atoms.push({ value, raw, kind });
	};

		// A URL is not an atom (it is the citation itself, not the cited content)
	const body = text.replace(/https?:\/\/\S+/g, " ");

	for (const match of body.matchAll(/\d+(?:\.\d+)?/g)) {
		add(normalizeNumber(match[0]), match[0], "number");
	}

	for (const match of body.matchAll(/[A-Za-z][A-Za-z0-9]*(?:[-_.\/][A-Za-z0-9]+)*/g)) {
		const token = match[0];
		const interesting =
			/[-_.\/]/.test(token) || /\d/.test(token) || (token.length >= 3 && token === token.toUpperCase());
		if (!interesting || token.length < 2) continue;
		add(token.toLowerCase(), token, "identifier");
	}

	return atoms;
}

const MONTHS: Record<string, string> = {
	january: "1", february: "2", march: "3", april: "4", may: "5", june: "6",
	july: "7", august: "8", september: "9", october: "10", november: "11", december: "12",
};

/**
 * Normalising a source's body text. **Numbers and identifiers need different normalisation.**
 *
 * This was forced out by measurement. Both used to share one "strip all whitespace" text, and:
 *
 *   the source "released June 2026" → month to a number → "6 2026" → whitespace stripped → "62026"
 *   the report's atom "6" matched against `(?<!\d)6(?!\d)` → followed by 2 → **judged unsourced**
 *
 * The same collision also made 2004 in "January 2004" unfindable.
 * Both are false positives, and in the worst direction: **they send you to fix something that is not broken.**
 *
 * The right approach is to separate them:
 *
 *   identifiers → strip whitespace (so "Apache-2.0" and "Apache - 2.0" count as one)
 *   numbers     → keep a single space as a boundary (so adjacent numbers do not glue together)
 */
interface NormalizedSource {
	/** For identifier matching: all whitespace removed. */
	packed: string;
	/** For number matching: whitespace collapsed to one, keeping boundaries. */
	spaced: string;
}

function normalizeSource(text: string): NormalizedSource {
	let normalized = text.toLowerCase();
	for (const [name, number] of Object.entries(MONTHS)) {
		normalized = normalized.replaceAll(name, ` ${number} `);
	}
	const spaced = normalized.replace(/\s+/g, " ");
	return { packed: spaced.replaceAll(" ", ""), spaced };
}

function containsAtom(source: NormalizedSource, atom: Atom): boolean {
	if (atom.kind === "number") {
			// A number must avoid "1" matching the 1 inside "2026", so no digit may adjoin it
		const pattern = new RegExp(`(?<!\\d)0*${escapeRegex(atom.value)}(?!\\d)`);
		return pattern.test(source.spaced);
	}
	return source.packed.includes(atom.value);
}

function escapeRegex(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ─────────────────────────────────────────────────────────────

export interface SourceVerdict {
	url: string;
		/** How many atoms this source supports. 0 = this citation is grafted. */
	supported: number;
		/** Whether this source is in the corpus we fetched. false = worse; the URL was invented. */
	known: boolean;
}

export interface ClaimVerdict {
	claim: string;
	atoms: Atom[];
	sources: SourceVerdict[];
		/** Atoms supported by no source at all. These are the altered or invented numbers. */
	unsupportedAtoms: Atom[];
		/** Sources that were cited and support not one atom. */
	graftedSources: string[];
}

/**
 * Verify one claim.
 *
 * `corpus` maps URL → body text. Only genuinely fetched pages are in it,
 * so "cited a URL that does not exist" is caught here as well.
 */
export function verifyClaim(
	claim: string,
	sources: string[],
	corpus: Map<string, string>,
): ClaimVerdict {
	const atoms = extractAtoms(claim);

	const verdicts: SourceVerdict[] = sources.map((url) => {
		const text = corpus.get(url);
		if (text === undefined) return { url, supported: 0, known: false };
		const normalized = normalizeSource(text);
		return {
			url,
			supported: atoms.filter((atom) => containsAtom(normalized, atom)).length,
			known: true,
		};
	});

	const supportedValues = new Set<string>();
	for (const source of verdicts) {
		const text = corpus.get(source.url);
		if (!text) continue;
		const normalized = normalizeSource(text);
		for (const atom of atoms) {
			if (containsAtom(normalized, atom)) supportedValues.add(`${atom.kind}:${atom.value}`);
		}
	}

	return {
		claim,
		atoms,
		sources: verdicts,
		unsupportedAtoms: atoms.filter((a) => !supportedValues.has(`${a.kind}:${a.value}`)),
			// Grafting can only be judged accurately when the sentence has something checkable in it.
			// A sentence with no atoms (pure subjective narration) must not be judged grafted for lack of support.
		graftedSources:
			atoms.length === 0 ? [] : verdicts.filter((s) => s.supported === 0).map((s) => s.url),
	};
}
