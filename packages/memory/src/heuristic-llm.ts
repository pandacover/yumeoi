import {
	type ConsolidateDecision,
	defaultLlmConfig,
	type ExtractedMemories,
	type ExtractedMemory,
	type RerankResult,
	SchemaViolation,
} from "@yumeoi/domain";
import { Effect, Layer, Schema } from "effect";
import { heuristicClassify, heuristicExtract } from "./heuristic-extract.ts";
import { Llm } from "./llm.ts";

export { heuristicClassify, heuristicExtract } from "./heuristic-extract.ts";

export const heuristicLlmLayer = Layer.succeed(Llm, {
	config: defaultLlmConfig,
	drainUsage: () => Effect.succeed([]),
	structured: ({ schema, schemaName, user }) =>
		Effect.gen(function* () {
			let payload: ExtractedMemories | ConsolidateDecision | RerankResult | ExtractedMemory;
			if (schemaName === "extracted_memories") {
				payload = { memories: heuristicExtract(user) };
			} else if (schemaName === "extracted_memory") {
				payload = heuristicClassify(user);
			} else if (schemaName === "consolidate_decision") {
				payload = { action: "new", targetId: null, mergedText: null, reason: "distinct" };
			} else if (schemaName === "rerank_result") {
				const ids = [...user.matchAll(/\b(?:[mer]_[0-9a-z]{12}|[0-9a-f-]{8,})\b/gi)].map(
					(match) => match[0] ?? "",
				);
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
