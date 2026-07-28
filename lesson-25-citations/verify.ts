/**
 * 引用驗證：那一頁真的說了這句話嗎？
 *
 * Lesson 24 已經擋掉一半的問題：learning 只能引用**真的抓過**的網址。
 * 但還有一種錯沒擋到，而且它出現在我們真的跑出來的報告裡：
 *
 *   「其預訓練權重屬於非商業授權
 *    (github.com/kinelabs/humanoid-mimic, discourse.ros.org/t/...45211, blog.kinelabs.dev/...)」
 *
 * 前兩個網址其中一個根本沒提過授權。**網址是真的、抓過的、存在的，
 * 但它不支持這句話。** 這叫引用嫁接（citation grafting），
 * 而它比整段幻覺危險，因為它看起來完全合規。
 *
 * ## 怎麼驗，而且不用 LLM 當裁判
 *
 * 「這句話有沒有被這一頁支持」聽起來像語義判斷，很容易就想找個模型來評分。
 * 但 Lesson 7 那條原則在這裡一樣成立：**評分要是確定性的**，
 * 不然你沒辦法回答「改了 prompt 之後有沒有退步」——因為裁判自己也會飄。
 *
 * 這裡用的方法很土，但抓得到真正的問題：
 *
 *   1. 從句子裡抽出**可查核的原子**：數字、版本、日期、識別字、授權名稱
 *   2. 去每一個被引用的來源正文裡找這些原子
 *   3. 一個原子都找不到的來源 → 這個引用是嫁接的
 *   4. 所有來源都找不到的原子 → 這個數字是編的
 *
 * ## 這個方法的限制（要先講清楚）
 *
 * **它不檢查語義，只檢查「這些具體的東西在不在」。**
 *
 *   ✗ 抓不到：「A 比 B 好」這種沒有原子的主觀句
 *   ✗ 抓不到：原子都在，但句子把因果關係說反了
 *   ✗ 會誤判：來源剛好在無關的地方出現同一個數字
 *
 * 那為什麼還值得做？因為**它抓得到的那一類錯，正是實測最常見的那一類**：
 * 模型把一個真實的數字接到一個沒說過這件事的來源上。
 * 而且它便宜、可重現、可以進 CI。
 *
 * > 寧可要一個抓得到 70% 問題的確定性檢查，
 * > 也不要一個號稱抓得到 95% 但自己每次結果都不一樣的 LLM 裁判。
 */

/** 一個可查核的原子。 */
export interface Atom {
	/** 正規化後的值，用來比對。 */
	value: string;
	/** 原文長什麼樣，給人看的。 */
	raw: string;
	kind: "number" | "identifier";
}

const STOPWORDS = new Set([
	"http", "https", "www", "com", "org", "net", "github", "html", "the", "and", "for",
	"with", "this", "that", "from", "url", "sources", "source",
]);

/**
 * 把數字正規化。
 *
 * `06` 和 `6`、`0.80` 和 `0.8` 要算同一個，
 * 不然「2026-06-30」對不上「2026 年 6 月」。
 */
function normalizeNumber(text: string): string {
	const value = Number(text);
	return Number.isFinite(value) ? String(value) : text.toLowerCase();
}

/**
 * 抽出可查核的原子。
 *
 * 兩類：
 *
 *   數字      17、0.8、2026、50、23      ← 版本、日期、量測值都在這裡
 *   識別字    MIT、Apache-2.0、URDF、left_knee、humanoid-mimic、RTX
 *
 * 識別字的條件是「含數字、含連字號底線點、或全大寫」——
 * 這樣才會抓到專有名詞而不是一般英文單字。中文不抽，因為中文的
 * 斷詞太不可靠，抽出來的東西比對起來雜訊比訊號多。
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

	// 網址不算原子（它是引用本身，不是被引用的內容）
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
 * 來源正文正規化。**數字和識別字要用不同的正規化。**
 *
 * 這是實測逼出來的。原本兩者共用一份「全部空白拿掉」的文字，結果：
 *
 *   來源「released June 2026」→ 月份換成數字 →「6 2026」→ 去空白 →「62026」
 *   報告的原子「6」比對 `(?<!\d)6(?!\d)` → 後面接著 2 → **判定查無來源**
 *
 * 同樣的碰撞也讓「January 2004」裡的 2004 查不到。
 * 兩個都是誤判，而且誤判的方向最糟：**它會叫你去修一個沒壞的東西。**
 *
 * 正確的做法是分開：
 *
 *   識別字 → 去掉空白（這樣「Apache-2.0」和「Apache - 2.0」算同一個）
 *   數字   → 保留單一空白當邊界（這樣相鄰的數字不會黏成一串）
 */
interface NormalizedSource {
	/** 給識別字比對用：空白全部拿掉。 */
	packed: string;
	/** 給數字比對用：空白壓成一個，保留邊界。 */
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
		// 數字要避免「1」命中「2026」裡的 1，所以前後不能緊接其他數字
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
	/** 這個來源支持了幾個原子。0 = 這個引用是嫁接的。 */
	supported: number;
	/** 這個來源在不在我們抓過的語料裡。false = 更嚴重，網址是編的。 */
	known: boolean;
}

export interface ClaimVerdict {
	claim: string;
	atoms: Atom[];
	sources: SourceVerdict[];
	/** 完全沒有任何來源支持的原子。這些就是被改掉或編出來的數字。 */
	unsupportedAtoms: Atom[];
	/** 被引用但一個原子都不支持的來源。 */
	graftedSources: string[];
}

/**
 * 驗證一條 claim。
 *
 * `corpus` 是「網址 → 正文」。只有真的抓過的頁面在裡面，
 * 所以「引用了不存在的網址」也會在這裡被抓到。
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
		// 只有「這句話真的有東西可以查」的時候，嫁接才判得準。
		// 一條原子都沒有的句子（純主觀敘述）不該因為「沒支持」被判嫁接。
		graftedSources:
			atoms.length === 0 ? [] : verdicts.filter((s) => s.supported === 0).map((s) => s.url),
	};
}
