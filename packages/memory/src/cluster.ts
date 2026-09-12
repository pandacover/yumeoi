import { cosineSimilarity } from "./cosine.ts";

export const CLUSTER_COSINE_THRESHOLD = 0.8;

export type ClusterMember<T> = {
	readonly item: T;
	readonly values: ReadonlyArray<number>;
};

/**
 * Greedy connected components: two items share a cluster when cosine ≥ threshold.
 */
export const clusterByCosine = <T>(
	members: ReadonlyArray<ClusterMember<T>>,
	threshold = CLUSTER_COSINE_THRESHOLD,
): T[][] => {
	const n = members.length;
	if (n === 0) {
		return [];
	}
	const parent = Array.from({ length: n }, (_, i) => i);
	const find = (i: number): number => {
		let current = i;
		while (parent[current] !== current) {
			parent[current] = parent[parent[current] ?? current] ?? current;
			current = parent[current] ?? current;
		}
		return current;
	};
	const union = (a: number, b: number) => {
		const pa = find(a);
		const pb = find(b);
		if (pa !== pb) {
			parent[pa] = pb;
		}
	};
	for (let i = 0; i < n; i++) {
		for (let j = i + 1; j < n; j++) {
			const left = members[i];
			const right = members[j];
			if (!left || !right) {
				continue;
			}
			if (cosineSimilarity(left.values, right.values) >= threshold) {
				union(i, j);
			}
		}
	}
	const groups = new Map<number, T[]>();
	for (let i = 0; i < n; i++) {
		const root = find(i);
		const item = members[i]?.item;
		if (item === undefined) {
			continue;
		}
		const list = groups.get(root) ?? [];
		list.push(item);
		groups.set(root, list);
	}
	return [...groups.values()];
};
