import { Effect, Layer } from "effect";
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL, Embeddings } from "./embeddings.ts";

/** Deterministic embeddings so ingest/recall still run without Workers AI. */
export const hashEmbeddingsLayer = Layer.succeed(Embeddings, {
	model: `${EMBEDDING_MODEL}+hash`,
	dimensions: EMBEDDING_DIMENSIONS,
	embed: (texts) =>
		Effect.succeed(
			texts.map((text, index) =>
				Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => {
					const code = text.charCodeAt(i % Math.max(text.length, 1)) || 1;
					return ((code + index + i) % 100) / 100;
				}),
			),
		),
});
