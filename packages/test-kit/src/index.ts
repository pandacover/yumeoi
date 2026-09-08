import { defaultLlmConfig, type ExtractedMemory, SchemaViolation } from "@yumeoi/domain";
import {
	EMBEDDING_DIMENSIONS,
	EMBEDDING_MODEL,
	Embeddings,
	heuristicLlmLayer,
	Llm,
	VectorIndex,
} from "@yumeoi/memory";
import { Effect, Layer, Schema } from "effect";

export const FakeLlm = heuristicLlmLayer;

export const FakeEmbeddings = Layer.succeed(Embeddings, {
	model: EMBEDDING_MODEL,
	dimensions: EMBEDDING_DIMENSIONS,
	embed: (texts) =>
		Effect.succeed(
			texts.map((text, index) => {
				const values = Array.from(
					{ length: EMBEDDING_DIMENSIONS },
					(_, i) => ((text.charCodeAt(i % Math.max(text.length, 1)) + index + i) % 100) / 100,
				);
				return values;
			}),
		),
});

export const FakeVectorIndex = Layer.succeed(VectorIndex, {
	upsert: () => Effect.void,
	query: () => Effect.succeed([]),
});

export { defaultLlmConfig, Effect, Layer, Llm, Schema, SchemaViolation };
export type { ExtractedMemory };
export * from "./memory-store.ts";
