import { defaultLlmConfig, type ExtractedMemory, SchemaViolation } from "@yumeoi/domain";
import {
	EMBEDDING_DIMENSIONS,
	EMBEDDING_MODEL,
	Embeddings,
	Llm,
	VectorIndex,
} from "@yumeoi/memory";
import { Effect, Layer, Schema } from "effect";

export const FakeLlm = Layer.succeed(Llm, {
	config: defaultLlmConfig,
	structured: ({ schema }) =>
		Effect.gen(function* () {
			const sample: ExtractedMemory = {
				kind: "fact",
				text: "yumeoi M0 skeleton is running.",
				confidence: 1,
				validFrom: null,
			};
			return yield* Schema.decodeUnknownEffect(schema)(sample).pipe(
				Effect.mapError(
					(issues) =>
						new SchemaViolation({
							message: "fake llm schema mismatch",
							issues,
						}),
				),
			);
		}),
});

export const FakeEmbeddings = Layer.succeed(Embeddings, {
	model: EMBEDDING_MODEL,
	dimensions: EMBEDDING_DIMENSIONS,
	embed: (texts) =>
		Effect.succeed(
			texts.map((text, index) => {
				const values = Array.from(
					{ length: EMBEDDING_DIMENSIONS },
					(_, i) => ((text.charCodeAt(i % text.length) + index + i) % 100) / 100,
				);
				return values;
			}),
		),
});

export const FakeVectorIndex = Layer.succeed(VectorIndex, {
	upsert: () => Effect.void,
	query: () => Effect.succeed([]),
});
