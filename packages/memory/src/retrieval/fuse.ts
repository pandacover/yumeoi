import type { Memory, QueryPlan } from "@yumeoi/domain";
import { useFactor } from "../retention.ts";
import type { CandidateLists } from "./candidates.ts";
import type { RetrievalConfig } from "./config.ts";
import { freshness } from "./plan.ts";

export const weightedRrf = (
	lists: ReadonlyArray<{ readonly ids: ReadonlyArray<string>; readonly weight: number }>,
	k = 60,
): Map<string, number> => {
	const scores = new Map<string, number>();
	for (const list of lists) {
		list.ids.forEach((id, rank) => {
			scores.set(id, (scores.get(id) ?? 0) + list.weight / (k + rank + 1));
		});
	}
	return scores;
};

export const validAt = (memory: Memory, asOf: number | null): boolean => {
	if (asOf == null) {
		return memory.state === "active" && memory.validTo === null;
	}
	const observed = memory.observedAt ?? 0;
	if (observed > asOf) {
		return false;
	}
	if (memory.validFrom) {
		const from = Date.parse(memory.validFrom);
		if (Number.isFinite(from) && from > asOf) {
			return false;
		}
	}
	if (memory.validTo) {
		const to = Date.parse(memory.validTo);
		if (Number.isFinite(to) && to <= asOf) {
			return false;
		}
	}
	return memory.state !== "forgotten" && memory.state !== "archived";
};

export const fuseMemories = (input: {
	readonly lists: CandidateLists;
	readonly memories: ReadonlyArray<Memory>;
	readonly plan: QueryPlan;
	readonly config: RetrievalConfig;
	readonly now?: number;
	readonly feedbackById?: ReadonlyMap<string, number>;
}): Map<string, number> => {
	const now = input.now ?? Date.now();
	const fused = weightedRrf(
		[
			{ ids: input.lists.fts, weight: input.config.weights.fts },
			{ ids: input.lists.vector, weight: input.config.weights.vector },
			{ ids: input.lists.graph, weight: input.config.weights.graph },
			{ ids: input.lists.recent, weight: input.config.weights.recent },
		],
		input.config.rrfK,
	);
	const byId = new Map(input.memories.map((memory) => [memory.id, memory]));
	const asOf = input.plan.asOf;
	const adjusted = new Map<string, number>();
	for (const [id, score] of fused) {
		const memory = byId.get(id);
		if (!memory || !validAt(memory, asOf)) {
			continue;
		}
		const ageMs = now - (memory.eventAt ?? memory.observedAt ?? now);
		const fresh = freshness(memory.type, ageMs, input.config.halfLifeDays);
		const typeWeight = input.plan.typeWeights[memory.type];
		const use =
			input.feedbackById === undefined
				? 1
				: Math.max(0.05, useFactor(memory.accessCount, input.feedbackById.get(id) ?? 0));
		adjusted.set(
			id,
			score *
				(0.5 + 0.5 * memory.confidence) *
				(0.7 + 0.6 * memory.importance) *
				fresh *
				typeWeight *
				use,
		);
	}
	return adjusted;
};

export const whyFor = (
	id: string,
	lists: CandidateLists,
): Array<"kw" | "vec" | "graph" | "recent"> => {
	const why: Array<"kw" | "vec" | "graph" | "recent"> = [];
	if (lists.fts.includes(id)) {
		why.push("kw");
	}
	if (lists.vector.includes(id)) {
		why.push("vec");
	}
	if (lists.graph.includes(id)) {
		why.push("graph");
	}
	if (lists.recent.includes(id)) {
		why.push("recent");
	}
	return why;
};
