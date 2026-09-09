import {
	ExtractedMemories,
	type ExtractedMemory,
	extractedMemoriesJsonSchema,
	type ProviderUnavailable,
	type RateLimited,
	type SchemaViolation,
} from "@yumeoi/domain";
import { Context, Effect, Layer } from "effect";
import { Llm } from "./llm.ts";
import { coerceTypeKind } from "./types.ts";

export const EXTRACT_SYSTEM = `You extract atomic memories from a document chunk in one call.

Each memory is one of three types:
- semantic: a timeless fact, preference, relationship, or standing decision. Present tense, no date.
- episodic: a specific occurrence. Past tense with time. Must set eventAt (ISO-8601) when the chunk states when it happened.
- procedural: how to do something, or a rule. Steps, triggers, constraints, habits.

Decision procedure:
1. Instructions, a rule, or a repeatable how-to → procedural (kind procedure or rule).
2. Tied to a specific moment → episodic (kind event, decision, or task); set eventAt.
3. Otherwise → semantic (kind fact, preference, relationship, or decision).
4. A decision with both a moment and a standing outcome yields two memories.
5. importance is 0-1: how much a future assistant would need this (identity, standing preferences, commitments high).
6. confidence is 0-1. Do not invent details. entities and relations may be empty arrays.
7. Return as many distinct memories as the chunk supports, including none.`;

export class Extractor extends Context.Service<
	Extractor,
	{
		readonly extract: (
			chunkText: string,
			title: string,
		) => Effect.Effect<
			ReadonlyArray<ExtractedMemory>,
			ProviderUnavailable | RateLimited | SchemaViolation
		>;
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
					.pipe(
						Effect.map((result) =>
							result.memories.map((memory) => {
								const coerced = coerceTypeKind(memory.type, memory.kind);
								return { ...memory, ...coerced };
							}),
						),
					),
		};
	}),
);
