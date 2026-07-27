/**
 * 融合、去重、品質訊號、來源多樣性。
 *
 * 這個檔案是「排序」真正的樣子。很多人以為排序就是算分數然後 sort，
 * 但實務上分數只是第一步，後面全是**修正**：
 *
 *   兩份幾乎一樣的內容佔掉兩個名額 → 去重
 *   兩年前的懶人包還排在前面       → 新鮮度
 *   關鍵字塞好塞滿的農場排第一     → 反作弊
 *   前五名全部來自同一個站         → 來源多樣性
 *
 * 每一條都是有人被真實結果坑過之後加上去的。
 */

import type { IndexedPage } from "../../lesson-20-search-agent/corpus/generate.ts";

// ─────────────────────────────────────────────────────────────
// 1. RRF：把兩份排名合成一份
// ─────────────────────────────────────────────────────────────

/**
 * Reciprocal Rank Fusion。
 *
 *   score(d) = Σ  1 / (K + rank_i(d))
 *
 * 關鍵在於它**只看名次，不看分數**。這一點很重要，因為 BM25 的分數
 * （2.771）跟 cosine 相似度（0.83）根本不在同一個尺度上，
 * 硬要加權相加就得先做正規化，而正規化的方式又會變成另一個要調的參數。
 *
 * RRF 直接繞過這個問題：**你在 BM25 排第一、在 dense 排第三，
 * 那就是 1/61 + 1/63。** 沒有需要調的權重，通常也打得贏調過的加權和。
 *
 * K=60 是原論文（Cormack et al., 2009）用的值，實務上大家幾乎都照抄。
 * K 越大，名次之間的差距越平緩。
 */
export function rrf(lists: string[][], k = 60): Map<string, number> {
	const scores = new Map<string, number>();
	for (const list of lists) {
		list.forEach((id, index) => {
			scores.set(id, (scores.get(id) ?? 0) + 1 / (k + index + 1));
		});
	}
	return scores;
}

// ─────────────────────────────────────────────────────────────
// 2. 近似重複
// ─────────────────────────────────────────────────────────────

/**
 * 把文字切成連續 n 個詞的片段（shingle）。
 *
 * 為什麼不用「兩篇的詞集合有多像」？因為那樣「我愛你」和「你愛我」
 * 會被判成完全一樣。**shingle 保留了詞序**，這對偵測抄襲／鏡像站很關鍵。
 */
function shingles(text: string, n = 3): Set<string> {
	const words = text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
	const set = new Set<string>();
	for (let i = 0; i + n <= words.length; i++) {
		set.add(words.slice(i, i + n).join(" "));
	}
	return set;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
	if (a.size === 0 || b.size === 0) return 0;
	let shared = 0;
	for (const item of a) if (b.has(item)) shared++;
	return shared / (a.size + b.size - shared);
}

export interface DuplicateGroup {
	kept: string;
	dropped: string[];
	similarity: number;
}

/**
 * 找出近似重複，每一組只留一個。
 *
 * 留哪一個？**排名比較前面的那個**（呼叫端已經排好序了）。
 * 這比「留比較長的」或「留比較新的」都好，因為前面的階段已經
 * 綜合考慮過相關性了，這裡不該推翻它，只該砍掉多餘的。
 *
 * ## 門檻 0.15 是量出來的，而且我第一次猜錯了
 *
 * 我原本憑印象寫 0.5，想說「鏡像站應該有一半以上一樣吧」。實際量：
 *
 *   shingle 長度   鏡像對   第二相似的一對   差距
 *        2         0.346       0.118       0.228
 *        3         0.266       0.065       0.201
 *        4         0.215       0.048       0.167
 *        5         0.174       0.040       0.133
 *
 * **鏡像對只有 0.17-0.35，遠低於直覺。** 因為語料裡的 docs 站不是複製貼上，
 * 是改寫過的精簡版（7 段變 5 段，句子也剪短了）——真實世界的鏡像
 * 大多是這樣，逐字複製反而少見。
 *
 * 門檻 0.5 的結果是**去重階段一次都沒有生效**，而 nDCG 完全不會告訴你
 * 這件事，因為「沒做事」跟「做了但沒差」在平均分數上長得一模一樣。
 *
 * 選 n=3 是因為它的差距夠大（0.266 vs 0.065，四倍），門檻放 0.15
 * 兩邊都很安全。
 *
 * > 真實系統不會像這樣兩兩比對（O(n²)），會用 SimHash 或 MinHash + LSH
 * > 把候選先縮到很小的桶裡。14 篇文件不需要，但概念是一樣的：
 * > **先用便宜的方法縮小範圍。**
 */
export function dedupe(
	orderedIds: string[],
	pages: Map<string, IndexedPage>,
	threshold = 0.15,
): { ids: string[]; groups: DuplicateGroup[] } {
	const kept: string[] = [];
	const groups: DuplicateGroup[] = [];
	const fingerprints = new Map<string, Set<string>>();

	for (const id of orderedIds) {
		const page = pages.get(id);
		if (!page) continue;
		const fingerprint = shingles(page.text);

		let duplicateOf: { id: string; similarity: number } | undefined;
		for (const keptId of kept) {
			const other = fingerprints.get(keptId);
			if (!other) continue;
			const similarity = jaccard(fingerprint, other);
			if (similarity >= threshold) {
				duplicateOf = { id: keptId, similarity };
				break;
			}
		}

		if (duplicateOf) {
			const group = groups.find((g) => g.kept === duplicateOf.id);
			if (group) group.dropped.push(id);
			else groups.push({ kept: duplicateOf.id, dropped: [id], similarity: duplicateOf.similarity });
			continue;
		}

		kept.push(id);
		fingerprints.set(id, fingerprint);
	}

	return { ids: kept, groups };
}

// ─────────────────────────────────────────────────────────────
// 3. 品質訊號
// ─────────────────────────────────────────────────────────────

/**
 * 「今天」是寫死的。
 *
 * 因為新鮮度會影響排名，如果用 `Date.now()`，這一課的評估數字
 * 每天都會不一樣，README 裡的表格明天就對不上了。
 *
 * 這不只是教學上的方便：**任何跟時間有關的排序，
 * 在測試裡都必須能固定時間**，不然回歸測試沒有意義。
 */
export const TODAY = new Date("2026-07-27T00:00:00Z").getTime();

/** 網域先驗權重。 */
const HOST_PRIOR: Record<string, number> = {
	"github.com": 0.9,
	"arxiv.org": 0.9,
	"unitree.com": 1.0,
	"www.unitree.com": 1.0,
	"discourse.ros.org": 0.7,
	"huggingface.co": 0.8,
	"openmotion.dev": 0.8,
	"blog.kinelabs.dev": 0.7,
	"robotblog.example.com": 0.3,
	"technews.example.com": 0.3,
	"top-robotics-tools.example.net": 0.1,
	"cookingwith.example.com": 0.3,
};

export interface Signals {
	/** 0-1，越新越高。 */
	freshness: number;
	/** 0-1，手動維護的網域先驗。 */
	authority: number;
	/** 0-1，關鍵字堆砌的程度，越高越可疑。 */
	stuffing: number;
}

export function signalsFor(page: IndexedPage): Signals {
	return {
		freshness: freshness(page.published),
		authority: HOST_PRIOR[hostOf(page.url)] ?? 0.5,
		stuffing: stuffing(page.text),
	};
}

function hostOf(url: string): string {
	try {
		return new URL(url).host;
	} catch {
		return "";
	}
}

/**
 * 新鮮度：半衰期 18 個月的指數衰減。
 *
 * 為什麼是衰減而不是「一年以上就丟掉」？因為舊不等於錯。
 * arXiv 論文放三年還是有用，SDK 文件過三個月就可能過期。
 * **衰減是一個溫和的偏好，不是一個門檻。**
 *
 * 真實系統還會分主題調：新聞的半衰期可能是幾天，
 * 數學定理的半衰期是無限大。
 */
function freshness(published: string): number {
	const days = (TODAY - new Date(published).getTime()) / 86_400_000;
	if (!Number.isFinite(days)) return 0.5;
	return Math.exp((-Math.LN2 * Math.max(days, 0)) / 540);
}

/**
 * 一個詞至少要重複這麼多次，才有資格被當成「堆砌」。
 *
 * **這個門檻是評估抓出來的，不是我一開始就想到的。**
 *
 * 第一版只看比例，結果 nDCG 平均從 0.720 升到 0.768（看起來很好），
 * 但其中一題從 1.000 崩到 0.131。去查才發現比例對**短文件有系統性偏誤**：
 *
 *   60 字的 SEO 農場    "retargeting" × 12 → 20.0%   ← 真的是堆砌
 *   28 字的資料集頁面    "clips"       ×  3 → 10.7%   ← 誤判
 *   25 字的 LICENSE     "license"     ×  4 → 16.0%   ← 誤判
 *
 * 一份 25 字的授權檔本來就會一直講 license，那不是作弊，是它就這麼短。
 * 加上「絕對次數」這個條件之後，兩個誤判都歸零，而農場照樣被抓到。
 *
 * 完整的過程在 README Step 5。這是這一課最重要的一段：
 * **平均分數上升，不代表沒有東西壞掉。**
 */
const MIN_REPEATS = 5;

/**
 * 關鍵字堆砌偵測。
 *
 * **重點：這個訊號是算出來的，不是我在語料裡標的。**
 *
 * 我很容易可以在 `pages.ts` 裡寫 `kind: "spam"` 然後在排序時看那個欄位，
 * 但那是作弊——真實的網頁不會自己承認是農場。所以這裡只用
 * 頁面本身算得出來的東西：**最高頻的那個詞重複幾次、佔了全文多少比例。**
 *
 * 正常文章大概 2-4%，農場會到 8% 以上，因為它整篇都在重複同一組關鍵字。
 * 門檻是量出來的，不是猜的（見 README Step 4、Step 5）。
 */
function stuffing(text: string): number {
	const words = text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3);
	if (words.length === 0) return 0;

	const counts = new Map<string, number>();
	for (const word of words) counts.set(word, (counts.get(word) ?? 0) + 1);
	const top = Math.max(...counts.values());

	// 重複次數不夠多就不算堆砌，不管比例多高。
	// 沒有這一行，短文件會被系統性地冤枉。
	if (top < MIN_REPEATS) return 0;

	const ratio = top / words.length;

	// 4% 以下當正常，10% 以上當滿分可疑，中間線性
	return Math.min(Math.max((ratio - 0.04) / 0.06, 0), 1);
}

// ─────────────────────────────────────────────────────────────
// 4. 把訊號加進分數
// ─────────────────────────────────────────────────────────────

export const WEIGHTS = { relevance: 1.0, freshness: 0.15, authority: 0.2, stuffing: 0.35 };

/**
 * 把 RRF 分數正規化到 0-1，再線性加上品質訊號。
 *
 * 為什麼要正規化？因為 RRF 的分數大約落在 0.016-0.033 之間，
 * 直接加上一個 0-1 的訊號會把相關性整個蓋掉。
 * **不同來源的分數要放在同一個尺度上才能相加**，這是加權相加最麻煩的地方，
 * 也是上面 RRF 選擇「只看名次」的原因。
 */
export function applySignals(
	fused: Map<string, number>,
	pages: Map<string, IndexedPage>,
): Array<{ id: string; score: number; signals: Signals; relevance: number }> {
	const values = [...fused.values()];
	const min = Math.min(...values);
	const max = Math.max(...values);
	const span = max - min || 1;

	return [...fused.entries()]
		.map(([id, raw]) => {
			const page = pages.get(id);
			const signals = page
				? signalsFor(page)
				: { freshness: 0.5, authority: 0.5, stuffing: 0 };
			const relevance = (raw - min) / span;
			const score =
				WEIGHTS.relevance * relevance +
				WEIGHTS.freshness * signals.freshness +
				WEIGHTS.authority * signals.authority -
				WEIGHTS.stuffing * signals.stuffing;
			return { id, score, signals, relevance };
		})
		.sort((a, b) => b.score - a.score);
}

// ─────────────────────────────────────────────────────────────
// 5. 來源多樣性
// ─────────────────────────────────────────────────────────────

/**
 * 同一個網域在前面最多出現幾次。
 *
 * 為什麼要限制？因為使用者問「有哪些專案」的時候，
 * 前五名全是同一個 repo 的五個頁面，資訊量等於一。
 *
 * 注意這是**刻意犧牲相關性**換取覆蓋率。被擠掉的那些頁面，
 * 分數可能真的比較高。這是一個產品決定，不是一個排序 bug。
 */
export function diversify<T extends { id: string }>(
	ranked: T[],
	pages: Map<string, IndexedPage>,
	maxPerHost = 2,
): T[] {
	const seen = new Map<string, number>();
	const kept: T[] = [];
	const overflow: T[] = [];

	for (const item of ranked) {
		const page = pages.get(item.id);
		const host = page ? hostOf(page.url) : "";
		const count = seen.get(host) ?? 0;
		if (count >= maxPerHost) {
			overflow.push(item);
			continue;
		}
		seen.set(host, count + 1);
		kept.push(item);
	}

	// 超額的不是丟掉，是往後排。使用者翻到第二頁還是看得到。
	return [...kept, ...overflow];
}
