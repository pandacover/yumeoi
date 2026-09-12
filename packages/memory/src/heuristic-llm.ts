import {
	type ConsolidateDecision,
	defaultLlmConfig,
	type ExtractedMemories,
	type ExtractedMemory,
	type QueryPlan,
	type RerankResult,
	type ResolveDecision,
	SchemaViolation,
	type SummaryResult,
} from "@yumeoi/domain";
import { Effect, Layer, Schema } from "effect";
import { heuristicClassify, heuristicExtract } from "./heuristic-extract.ts";
import { Llm } from "./llm.ts";
import { detectIntent, planQueryFast, tokenizeQuery } from "./retrieval/plan.ts";

export { heuristicClassify, heuristicExtract } from "./heuristic-extract.ts";

const sharedPrefix = (left: string, right: string): string => {
	const max = Math.min(left.length, right.length);
	let i = 0;
	while (i < max && left[i] === right[i]) {
		i += 1;
	}
	return left
		.slice(0, i)
		.replace(/[\s,;:.-]+$/u, "")
		.trim();
};

/** Deterministic stand-in for the summarize job so CI can run without keys. */
export const heuristicSummary = (user: string): string => {
	const correction = user.match(/Correction:\s*([\s\S]+?)(?:\n\nQuery that missed:|\s*$)/i)?.[1];
	if (correction && correction.trim().length > 0) {
		return correction.replace(/\s+/g, " ").trim().slice(0, 400);
	}
	const evidenceIndex = user.search(/Evidence:\s*/i);
	const body = evidenceIndex >= 0 ? user.slice(evidenceIndex).replace(/^Evidence:\s*/i, "") : user;
	const lines = body
		.split("\n")
		.map((line) => line.replace(/^[-*]\s*/, "").trim())
		.filter((line) => line.length > 0 && !/^Type:|^Kind:/i.test(line));
	if (lines.length === 0) {
		return user.replace(/\s+/g, " ").trim().slice(0, 240);
	}
	if (lines.length === 1) {
		return (lines[0] ?? "").slice(0, 400);
	}
	let prefix = lines[0] ?? "";
	for (const line of lines.slice(1)) {
		prefix = sharedPrefix(prefix, line);
		if (prefix.length < 24) {
			break;
		}
	}
	if (prefix.length >= 24) {
		return prefix.slice(0, 400);
	}
	return (lines[0] ?? "").slice(0, 400);
};

export const heuristicLlmLayer = Layer.succeed(Llm, {
	config: defaultLlmConfig,
	drainUsage: () => Effect.succeed([]),
	structured: ({ schema, schemaName, user }) =>
		Effect.gen(function* () {
			let payload:
				| ExtractedMemories
				| ConsolidateDecision
				| RerankResult
				| ExtractedMemory
				| QueryPlan
				| ResolveDecision
				| SummaryResult;
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
			} else if (schemaName === "query_plan") {
				const fast = planQueryFast({ query: user });
				payload = {
					...fast,
					terms: tokenizeQuery(user),
					intent: detectIntent(user),
				};
			} else if (schemaName === "resolve_decision") {
				payload = { same: false, reason: "heuristic-conservative" };
			} else if (schemaName === "summary") {
				payload = { text: heuristicSummary(user) };
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
