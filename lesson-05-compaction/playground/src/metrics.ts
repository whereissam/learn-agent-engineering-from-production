/**
 * In-process metrics.
 *
 * Counters and a coarse latency histogram, exposed in Prometheus text format.
 * Deliberately not a dependency: the whole surface we need is "add one" and
 * "observe a duration", and a real client library brings a lot more than that.
 */

const counters = new Map<string, number>();

/** Latency buckets in milliseconds. The last bucket is +Inf. */
const BUCKETS = [1, 5, 10, 25, 50, 100, 250, 500, 1000, Number.POSITIVE_INFINITY];
const histograms = new Map<string, number[]>();

export function increment(name: string, by = 1): void {
	counters.set(name, (counters.get(name) ?? 0) + by);
}

export function observe(name: string, ms: number): void {
	const buckets = histograms.get(name) ?? new Array(BUCKETS.length).fill(0);
	for (let i = 0; i < BUCKETS.length; i++) {
		if (ms <= (BUCKETS[i] ?? 0)) {
			buckets[i] = (buckets[i] ?? 0) + 1;
			break;
		}
	}
	histograms.set(name, buckets);
}

export function counterValue(name: string): number {
	return counters.get(name) ?? 0;
}

/** Prometheus text exposition format. */
export function render(): string {
	const lines: string[] = [];

	for (const [name, value] of counters) {
		lines.push(`# TYPE ${name} counter`);
		lines.push(`${name} ${value}`);
	}

	for (const [name, buckets] of histograms) {
		lines.push(`# TYPE ${name} histogram`);
		let cumulative = 0;
		for (let i = 0; i < BUCKETS.length; i++) {
			cumulative += buckets[i] ?? 0;
			const bound = BUCKETS[i] === Number.POSITIVE_INFINITY ? "+Inf" : String(BUCKETS[i]);
			lines.push(`${name}_bucket{le="${bound}"} ${cumulative}`);
		}
		lines.push(`${name}_count ${cumulative}`);
	}

	return `${lines.join("\n")}\n`;
}

export function reset(): void {
	counters.clear();
	histograms.clear();
}
