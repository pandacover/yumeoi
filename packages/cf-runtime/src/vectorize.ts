import { ProviderUnavailable } from "@yumeoi/domain";
import { VectorIndex, type VectorRecord } from "@yumeoi/memory";
import { Effect, Layer } from "effect";

export const vectorizeLayer = (index: Vectorize) =>
	Layer.succeed(VectorIndex, {
		upsert: (records: ReadonlyArray<VectorRecord>) =>
			Effect.tryPromise({
				try: async () => {
					await index.upsert(
						records.map((record) => ({
							id: record.id,
							values: [...record.values],
							namespace: record.namespace,
							metadata: record.metadata,
						})),
					);
				},
				catch: (cause) =>
					new ProviderUnavailable({
						provider: "vectorize",
						cause,
					}),
			}),
		query: ({ values, namespace, topK }) =>
			Effect.tryPromise({
				try: async () => {
					const result = await index.query([...values], {
						namespace,
						topK,
						returnMetadata: "all",
					});
					return result.matches.map((match) => ({
						id: match.id,
						score: match.score,
						...(match.metadata ? { metadata: match.metadata as Record<string, unknown> } : {}),
					}));
				},
				catch: (cause) =>
					new ProviderUnavailable({
						provider: "vectorize",
						cause,
					}),
			}),
	});
