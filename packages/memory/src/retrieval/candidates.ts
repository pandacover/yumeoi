import type { QueryPlan, RecallQuery, SearchQuery } from "@yumeoi/domain";
import { Effect } from "effect";
import { graphCandidateIds } from "../graph/expand.ts";
import { MemoryRepo, type RankedId, type SearchFilters } from "../memory-repo.ts";
import { ftsMatchQuery, ftsMatchWeighted } from "../rrf.ts";
import { VALID_TO_SENTINEL, VectorIndex } from "../vector-index.ts";
import { defaultRetrievalConfig, type RetrievalConfig } from "./config.ts";
import { weightQueryTerms } from "./terms.ts";

export type CandidateLists = {
	readonly fts: ReadonlyArray<string>;
	readonly vector: ReadonlyArray<string>;
	readonly graph: ReadonlyArray<string>;
	readonly recent: ReadonlyArray<string>;
	readonly ftsChunks: ReadonlyArray<string>;
	readonly vectorChunks: ReadonlyArray<string>;
	readonly vectorValues: ReadonlyMap<string, ReadonlyArray<number>>;
};

const asSearchFilters = (
	query: RecallQuery | SearchQuery,
	plan: QueryPlan,
	limit: number,
): SearchFilters => ({
	sources: query.sources,
	kinds: query.kinds,
	types: query.types ?? [],
	since: query.since,
	from: query.from ?? plan.temporalFrom,
	to: query.to ?? plan.temporalTo,
	asOf: query.asOf ?? plan.asOf,
	includeDormant: "includeDormant" in query ? Boolean(query.includeDormant) : false,
	limit,
});

const vectorFilter = (
	query: RecallQuery | SearchQuery,
	plan: QueryPlan,
	kind?: string,
): Record<string, unknown> => {
	const filter: Record<string, unknown> = {};
	if (kind) {
		filter.kind = kind;
	} else if (query.kinds.length === 1) {
		filter.kind = query.kinds[0];
	} else if (query.kinds.length > 1) {
		filter.kind = { $in: [...query.kinds] };
	}
	if (query.types && query.types.length === 1) {
		filter.type = query.types[0];
	} else if (query.types && query.types.length > 1) {
		filter.type = { $in: [...query.types] };
	}
	if (query.sources.length === 1) {
		filter.sourceId = query.sources[0];
	} else if (query.sources.length > 1) {
		filter.sourceId = { $in: [...query.sources] };
	}
	const asOf = query.asOf ?? plan.asOf ?? Date.now();
	if (!(query.asOf ?? plan.asOf)) {
		filter.state = "active";
	}
	filter.validTo = { $gte: asOf };
	const from = query.from ?? plan.temporalFrom;
	const to = query.to ?? plan.temporalTo;
	if (from != null || to != null) {
		filter.eventAt = {
			...(from != null ? { $gte: from } : {}),
			...(to != null ? { $lte: to } : {}),
		};
	}
	return filter;
};

const parsePrefixed = (id: string, prefix: "m:" | "c:"): string | null =>
	id.startsWith(prefix) ? id.slice(prefix.length) : null;

export const collectCandidates = (input: {
	readonly query: RecallQuery | SearchQuery;
	readonly plan: QueryPlan;
	readonly namespace: string;
	readonly queryValues: ReadonlyArray<number> | undefined;
	readonly includeEvidence: boolean;
	readonly config?: RetrievalConfig;
}) =>
	Effect.gen(function* () {
		const config = input.config ?? defaultRetrievalConfig;
		const repo = yield* MemoryRepo;
		const index = yield* VectorIndex;
		const filters = asSearchFilters(input.query, input.plan, config.ftsLimit);
		const match =
			ftsMatchWeighted(weightQueryTerms(input.plan.terms)) ?? ftsMatchQuery(input.plan.text);

		const ftsMemories = match ? yield* repo.searchMemoryFts(match, filters) : ([] as RankedId[]);
		const vector =
			input.queryValues && input.queryValues.length > 0
				? yield* index
						.query({
							values: input.queryValues,
							namespace: input.namespace,
							topK: config.vectorTopK,
							filter: vectorFilter(input.query, input.plan),
							returnValues: true,
						})
						.pipe(Effect.catchTag("ProviderUnavailable", () => Effect.succeed([])))
				: [];

		const includeEvidence = input.includeEvidence;
		const ftsChunks =
			includeEvidence && match
				? yield* repo.searchChunkFts(match, { ...filters, limit: config.ftsLimit })
				: [];
		const vectorChunks =
			includeEvidence && input.queryValues && input.queryValues.length > 0
				? yield* index
						.query({
							values: input.queryValues,
							namespace: input.namespace,
							topK: 40,
							filter: {
								kind: "chunk",
								...(input.query.sources.length === 1
									? { sourceId: input.query.sources[0] }
									: input.query.sources.length > 1
										? { sourceId: { $in: [...input.query.sources] } }
										: {}),
							},
						})
						.pipe(Effect.catchTag("ProviderUnavailable", () => Effect.succeed([])))
				: [];

		const graph =
			input.plan.entities.length > 0 || input.plan.intent === "who"
				? yield* graphCandidateIds({
						names: input.plan.entities,
						namespace: input.namespace,
						filters,
						hops: 2,
					})
				: [];

		const recent =
			input.plan.intent === "history" && input.plan.temporalFrom == null
				? yield* repo.listRecentEpisodic(Date.now() - 30 * 86_400_000, 40)
				: [];

		const vectorValues = new Map<string, ReadonlyArray<number>>();
		const vectorIds: string[] = [];
		for (const hit of vector) {
			const id = parsePrefixed(hit.id, "m:");
			if (!id) {
				continue;
			}
			vectorIds.push(id);
			if (hit.values) {
				vectorValues.set(id, hit.values);
			}
		}

		return {
			fts: ftsMemories.map((row) => row.id),
			vector: vectorIds,
			graph: graph.map((row) => row.id),
			recent: recent.map((memory) => memory.id),
			ftsChunks: ftsChunks.map((row) => row.id),
			vectorChunks: vectorChunks.flatMap((hit) => {
				const id = parsePrefixed(hit.id, "c:");
				return id ? [id] : [];
			}),
			vectorValues,
		} satisfies CandidateLists;
	});

export { VALID_TO_SENTINEL };
