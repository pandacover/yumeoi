import {
	type ConsolidateDecision,
	defaultLlmConfig,
	type ExtractedMemories,
	type ExtractedMemory,
	type MemoryKind,
	type RerankResult,
	SchemaViolation,
} from "@yumeoi/domain";
import { Effect, Layer, Schema } from "effect";
import { Llm } from "./llm.ts";

const classify = (text: string): MemoryKind => {
	const lower = text.toLowerCase();
	if (/\b(prefer|prefers|likes|favorite|favourite)\b/.test(lower)) {
		return "preference";
	}
	if (/\b(decided|decision|chose|choose|will use|going with)\b/.test(lower)) {
		return "decision";
	}
	if (/\b(todo|need to|should|must|task)\b/.test(lower)) {
		return "task";
	}
	if (/\b(works with|reports to|manager|teammate|friend of)\b/.test(lower)) {
		return "relationship";
	}
	if (/\b(on |at |tomorrow|yesterday|scheduled|meeting)\b/.test(lower)) {
		return "event";
	}
	return "fact";
};

export const heuristicExtract = (text: string): ReadonlyArray<ExtractedMemory> => {
	const sentences = text
		.split(/(?<=[.!?])\s+/)
		.map((sentence) => sentence.replace(/\s+/g, " ").trim())
		.filter((sentence) => sentence.length > 24);
	const unique = [...new Set(sentences)].slice(0, 16);
	return unique.map((sentence) => ({
		kind: classify(sentence),
		text: sentence,
		confidence: 0.62,
		validFrom: null,
	}));
};

export const heuristicLlmLayer = Layer.succeed(Llm, {
	config: defaultLlmConfig,
	drainUsage: () => Effect.succeed([]),
	structured: ({ schema, schemaName, user }) =>
		Effect.gen(function* () {
			let payload: ExtractedMemories | ConsolidateDecision | RerankResult | ExtractedMemory;
			if (schemaName === "extracted_memories") {
				payload = { memories: heuristicExtract(user) };
			} else if (schemaName === "extracted_memory") {
				payload = heuristicExtract(user)[0] ?? {
					kind: "fact",
					text: user.slice(0, 180),
					confidence: 0.5,
					validFrom: null,
				};
			} else if (schemaName === "consolidate_decision") {
				payload = { action: "new", targetId: null };
			} else if (schemaName === "rerank_result") {
				const ids = [...user.matchAll(/\b[0-9a-f-]{8,}\b/gi)].map((match) => match[0] ?? "");
				payload = { ids: ids.filter((id) => id.length > 0) };
			} else {
				payload = { memories: heuristicExtract(user) };
			}
			return yield* Schema.decodeUnknownEffect(schema)(payload).pipe(
				Effect.mapError(
					(issues) =>
						new SchemaViolation({
							message: "heuristic llm schema mismatch",
							issues,
						}),
				),
			);
		}),
});
