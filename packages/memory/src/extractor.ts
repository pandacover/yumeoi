import {
	ExtractedMemories,
	type ExtractedMemory,
	extractedMemoriesJsonSchema,
	type ProviderUnavailable,
	type SchemaViolation,
} from "@yumeoi/domain";
import { Context, Effect, Layer } from "effect";
import { Llm } from "./llm.ts";

export const EXTRACT_SYSTEM = `You extract atomic memories from a document chunk.

Rules:
- Each memory is one self-contained statement that still makes sense without the chunk.
- Prefer facts, preferences, decisions, tasks, relationships, and events.
- Do not invent details that are not in the chunk.
- confidence is 0-1.
- validFrom is an ISO-8601 date when the chunk states one, otherwise null.
- Return as many distinct memories as the chunk supports, including none.`;

export class Extractor extends Context.Service<
	Extractor,
	{
		readonly extract: (
			chunkText: string,
			title: string,
		) => Effect.Effect<ReadonlyArray<ExtractedMemory>, ProviderUnavailable | SchemaViolation>;
	}
>()("@yumeoi/memory/Extractor") {}

export const extractorLayer = Layer.effect(
	Extractor,
	Effect.gen(function* () {
		const llm = yield* Llm;
		return {
			extract: (chunkText, title) =>
				llm
					.structured({
						job: "extract",
						schema: ExtractedMemories,
						schemaName: "extracted_memories",
						jsonSchema: extractedMemoriesJsonSchema(),
						system: EXTRACT_SYSTEM,
						user: `Title: ${title}\n\nChunk:\n${chunkText}`,
					})
					.pipe(Effect.map((result) => result.memories)),
		};
	}),
);
