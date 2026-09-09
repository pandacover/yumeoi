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
};

export const defaultRetrievalConfig: RetrievalConfig = {
	rrfK: 60,
	weights: { fts: 1, vector: 1.15, graph: 0.7, recent: 0.5 },
	halfLifeDays: { episodic: 30, semantic: 365, procedural: Number.POSITIVE_INFINITY },
	rerankBlend: { rerank: 0.6, fused: 0.4 },
	mmrLambda: 0.7,
	defaultRerank: "cross",
	ftsLimit: 50,
	vectorTopK: 100,
};
