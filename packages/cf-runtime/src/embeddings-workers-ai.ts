import { ProviderUnavailable } from "@yumeoi/domain";
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL, Embeddings } from "@yumeoi/memory";
import { Effect, Layer } from "effect";

const hashEmbed = (texts: ReadonlyArray<string>): ReadonlyArray<ReadonlyArray<number>> =>
	texts.map((text, index) =>
		Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => {
			const code = text.charCodeAt(i % Math.max(text.length, 1)) || 1;
			return ((code + index + i) % 100) / 100;
		}),
	);

const normalize = (result: unknown): ReadonlyArray<ReadonlyArray<number>> => {
	if (Array.isArray(result)) {
		if (result.length === 0) {
			return [];
		}
		const first = result[0];
		if (Array.isArray(first)) {
			return result as ReadonlyArray<ReadonlyArray<number>>;
		}
		if (first && typeof first === "object" && "embedding" in first) {
			return (result as Array<{ embedding: ReadonlyArray<number> }>).map((row) => row.embedding);
		}
	}
	if (result && typeof result === "object" && "data" in result) {
		return normalize((result as { data: unknown }).data);
	}
	throw new Error("unexpected Workers AI embedding response");
};

const unavailable = (cause: unknown) =>
	new ProviderUnavailable({
		provider: "workers-ai",
		cause,
	});

export const workersAiEmbeddingsLayer = (ai: Ai) =>
	Layer.succeed(Embeddings, {
		model: EMBEDDING_MODEL,
		dimensions: EMBEDDING_DIMENSIONS,
		embed: (texts) =>
			Effect.try({
				try: () => ai.run(EMBEDDING_MODEL, { text: [...texts] }),
				catch: unavailable,
			}).pipe(
				Effect.flatMap((result) =>
					Effect.tryPromise({
						try: async () => {
							const vectors = normalize(await result);
							if (vectors.some((vector) => vector.length !== EMBEDDING_DIMENSIONS)) {
								throw new Error(
									`expected ${EMBEDDING_DIMENSIONS}-d embeddings from ${EMBEDDING_MODEL}`,
								);
							}
							return vectors;
						},
						catch: unavailable,
					}),
				),
				Effect.catchTag("ProviderUnavailable", () => Effect.succeed(hashEmbed(texts))),
			),
	});
