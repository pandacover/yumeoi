import { ProviderUnavailable } from "@yumeoi/domain";
import { Reranker } from "@yumeoi/memory";
import { Effect, Layer } from "effect";

const unavailable = (cause: unknown) =>
	new ProviderUnavailable({
		provider: "workers-ai",
		cause,
	});

type RerankResponse = {
	readonly response?: ReadonlyArray<{ readonly id?: number; readonly score?: number }>;
};

export const workersAiRerankerLayer = (ai: Ai) =>
	Layer.succeed(Reranker, {
		score: (query, documents) =>
			Effect.tryPromise({
				try: async () => {
					if (documents.length === 0) {
						return [];
					}
					const result = (await ai.run("@cf/baai/bge-reranker-base" as never, {
						query,
						contexts: documents.map((document) => ({ text: document.text })),
					})) as RerankResponse;
					const rows = result.response ?? [];
					return documents.map((document, index) => ({
						id: document.id,
						score: rows[index]?.score ?? 0,
					}));
				},
				catch: unavailable,
			}),
	});
