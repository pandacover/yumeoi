import { RerankResult, rerankResultJsonSchema } from "@yumeoi/domain";
import { Effect } from "effect";
import { cosineSimilarity } from "../cosine.ts";
import { Llm } from "../llm.ts";
import { Reranker } from "../reranker.ts";
import type { RetrievalConfig } from "./config.ts";

export const blendRerank = (
	fused: Map<string, number>,
	reranked: ReadonlyArray<{ readonly id: string; readonly score: number }>,
	blend: RetrievalConfig["rerankBlend"],
): Map<string, number> => {
	const maxRerank = Math.max(...reranked.map((row) => row.score), 1e-9);
	const maxFused = Math.max(...fused.values(), 1e-9);
	const next = new Map(fused);
	for (const row of reranked) {
		const fusedScore = fused.get(row.id) ?? 0;
		next.set(
			row.id,
			blend.rerank * (row.score / maxRerank) + blend.fused * (fusedScore / maxFused),
		);
	}
	return next;
};

export const crossEncode = (
	query: string,
	ids: ReadonlyArray<string>,
	texts: ReadonlyMap<string, string>,
	fused: Map<string, number>,
	config: RetrievalConfig,
) =>
	Effect.gen(function* () {
		const reranker = yield* Reranker;
		const documents = ids.slice(0, 30).flatMap((id) => {
			const text = texts.get(id);
			return text ? [{ id, text }] : [];
		});
		if (documents.length === 0) {
			return fused;
		}
		const scored = yield* reranker
			.score(query, documents)
			.pipe(Effect.catchTag("ProviderUnavailable", () => Effect.succeed([])));
		if (scored.length === 0) {
			return fused;
		}
		return blendRerank(fused, scored, config.rerankBlend);
	});

export const llmRerank = (
	query: string,
	ids: ReadonlyArray<string>,
	texts: ReadonlyMap<string, string>,
) =>
	Effect.gen(function* () {
		if (ids.length <= 1) {
			return ids;
		}
		const llm = yield* Llm;
		const ranked = yield* llm.structured({
			job: "rerank",
			schema: RerankResult,
			schemaName: "rerank_result",
			jsonSchema: rerankResultJsonSchema(),
			system: "Reorder memory ids by relevance to the query. Return every id exactly once.",
			user: `Query: ${query}\n\n${ids.map((id) => `${id}: ${texts.get(id) ?? ""}`).join("\n")}`,
		});
		const order = new Map(ranked.ids.map((id, index) => [id, index]));
		return [...ids].sort((a, b) => (order.get(a) ?? 999) - (order.get(b) ?? 999));
	});

export const mmrDiversify = (
	ids: ReadonlyArray<string>,
	scores: Map<string, number>,
	vectors: ReadonlyMap<string, ReadonlyArray<number>>,
	lambda: number,
	limit: number,
): string[] => {
	const remaining = [...ids];
	const selected: string[] = [];
	while (remaining.length > 0 && selected.length < limit) {
		let bestId = remaining[0] ?? "";
		let best = Number.NEGATIVE_INFINITY;
		for (const id of remaining) {
			const relevance = scores.get(id) ?? 0;
			let maxSim = 0;
			const vector = vectors.get(id);
			if (vector) {
				for (const other of selected) {
					const otherVector = vectors.get(other);
					if (otherVector) {
						maxSim = Math.max(maxSim, cosineSimilarity(vector, otherVector));
					}
				}
			}
			const mmr = lambda * relevance - (1 - lambda) * maxSim;
			if (mmr > best) {
				best = mmr;
				bestId = id;
			}
		}
		selected.push(bestId);
		const index = remaining.indexOf(bestId);
		if (index >= 0) {
			remaining.splice(index, 1);
		}
	}
	return selected;
};
