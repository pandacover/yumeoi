import { describe, expect, test } from "bun:test";
import { CLUSTER_COSINE_THRESHOLD, clusterByCosine } from "./cluster.ts";
import { cosineSimilarity } from "./cosine.ts";

describe("cosine clustering", () => {
	test("groups vectors at or above the 0.8 threshold", () => {
		const a = [1, 0, 0];
		const b = [0.95, 0.05, 0];
		const c = [0, 1, 0];
		expect(cosineSimilarity(a, b)).toBeGreaterThan(CLUSTER_COSINE_THRESHOLD);
		expect(cosineSimilarity(a, c)).toBeLessThan(CLUSTER_COSINE_THRESHOLD);
		const clusters = clusterByCosine([
			{ item: "a", values: a },
			{ item: "b", values: b },
			{ item: "c", values: c },
		]);
		const grouped = clusters.map((cluster) => [...cluster].sort().join(",")).sort();
		expect(grouped).toEqual(["a,b", "c"]);
	});

	test("keeps singleton items that share no neighbour", () => {
		const clusters = clusterByCosine([
			{ item: 1, values: [1, 0] },
			{ item: 2, values: [0, 1] },
		]);
		expect(clusters).toHaveLength(2);
	});
});
