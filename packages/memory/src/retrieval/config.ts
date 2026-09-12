import type { MemoryType, RerankMode } from "@yumeoi/domain";

export type RetrievalConfig = {
	readonly rrfK: number;
	readonly weights: {
		readonly fts: number;
		readonly vector: number;
		readonly graph: number;
		readonly recent: number;
	};
	readonly halfLifeDays: Record<MemoryType, number>;
	readonly rerankBlend: { readonly rerank: number; readonly fused: number };
	readonly mmrLambda: number;
	readonly defaultRerank: RerankMode;
	readonly ftsLimit: number;
	readonly vectorTopK: number;
	readonly termCoverageFloor: number;
	readonly kwOnlyPenalty: number;
	readonly unmatchedSpecificPenalty: number;
	readonly scoreFloorRatio: number;
	readonly minPackScore: number;
};

export const defaultRetrievalConfig: RetrievalConfig = {
	rrfK: 60,
	weights: { fts: 0.9, vector: 1.25, graph: 0.7, recent: 0.5 },
	halfLifeDays: { episodic: 30, semantic: 365, procedural: Number.POSITIVE_INFINITY },
	rerankBlend: { rerank: 0.65, fused: 0.35 },
	mmrLambda: 0.7,
	defaultRerank: "cross",
	ftsLimit: 50,
	vectorTopK: 100,
	termCoverageFloor: 0.2,
	kwOnlyPenalty: 0.45,
	unmatchedSpecificPenalty: 0.4,
	scoreFloorRatio: 0.22,
	minPackScore: 0,
};

export const retrievalConfigForQuery = (
	config: RetrievalConfig,
	multiConcept: boolean,
): RetrievalConfig =>
	multiConcept
		? {
				...config,
				rerankBlend: { rerank: 0.72, fused: 0.28 },
				weights: { ...config.weights, fts: 0.8, vector: 1.35 },
			}
		: config;
