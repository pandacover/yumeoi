import { ProviderUnavailable } from "@yumeoi/domain";
import { VectorIndex, type VectorRecord } from "@yumeoi/memory";
import { Effect, Layer } from "effect";

const unavailable = (cause: unknown) =>
	new ProviderUnavailable({
		provider: "vectorize",
		cause,
	});

const runVectorize = <A>(tryFn: () => Promise<A>) =>
	Effect.try({
		try: tryFn,
		catch: unavailable,
	}).pipe(
		Effect.flatMap((result) =>
			Effect.tryPromise({
				try: () => result,
				catch: unavailable,
			}),
		),
	);

export const vectorizeLayer = (index: Vectorize) =>
	Layer.succeed(VectorIndex, {
		upsert: (records: ReadonlyArray<VectorRecord>) =>
			runVectorize(async () => {
				await index.upsert(
					records.map((record) => ({
						id: record.id,
						values: [...record.values],
						namespace: record.namespace,
						metadata: record.metadata,
					})),
				);
			}),
		query: ({ values, namespace, topK, filter }) =>
			runVectorize(async () => {
				const queryOptions: VectorizeQueryOptions = {
					namespace,
					topK,
					returnMetadata: "all",
				};
				if (filter) {
					queryOptions.filter = filter as VectorizeVectorMetadataFilter;
				}
				const result = await index.query([...values], queryOptions);
				return result.matches.map((match) => ({
					id: match.id,
					score: match.score,
					...(match.metadata ? { metadata: match.metadata as Record<string, unknown> } : {}),
				}));
			}),
	});
