import type { Memory, RecallQuery, RecallResult, SearchQuery } from "@yumeoi/domain";
import { Effect } from "effect";
import { Embeddings } from "./embeddings.ts";
import { MemoryRepo } from "./memory-repo.ts";
import { collectCandidates } from "./retrieval/candidates.ts";
import { defaultRetrievalConfig } from "./retrieval/config.ts";
import { fuseMemories, validAt, weightedRrf, whyFor } from "./retrieval/fuse.ts";
import { packRecall } from "./retrieval/pack.ts";
import { planQuery, planQueryFast } from "./retrieval/plan.ts";
import { crossEncode, llmRerank, mmrDiversify } from "./retrieval/rerank.ts";

const VECTOR_KIND_CHUNK = "chunk";
const memoryVectorId = (id: string) => `m:${id}`;
const chunkVectorId = (id: string) => `c:${id}`;
const parseVectorId = (id: string): { type: "memory" | "chunk"; id: string } | null => {
	if (id.startsWith("m:")) {
		return { type: "memory", id: id.slice(2) };
	}
	if (id.startsWith("c:")) {
		return { type: "chunk", id: id.slice(2) };
	}
	return null;
};

const defaultSearch = (query: Partial<SearchQuery> & { query: string }): SearchQuery => ({
	query: query.query,
	sources: query.sources ?? [],
	kinds: query.kinds ?? [],
	since: query.since ?? null,
	limit: query.limit ?? 20,
	...(query.types ? { types: query.types } : {}),
	...(query.from !== undefined ? { from: query.from } : {}),
	...(query.to !== undefined ? { to: query.to } : {}),
	...(query.asOf !== undefined ? { asOf: query.asOf } : {}),
	...(query.entities ? { entities: query.entities } : {}),
	...(query.includeDormant !== undefined ? { includeDormant: query.includeDormant } : {}),
	...(query.cursor !== undefined ? { cursor: query.cursor } : {}),
});

const defaultRecall = (query: Partial<RecallQuery> & { query: string }): RecallQuery => ({
	query: query.query,
	sources: query.sources ?? [],
	kinds: query.kinds ?? [],
	since: query.since ?? null,
	budgetTokens: query.budgetTokens ?? 1500,
	rerank: query.rerank ?? true,
	...(query.types ? { types: query.types } : {}),
	...(query.from !== undefined ? { from: query.from } : {}),
	...(query.to !== undefined ? { to: query.to } : {}),
	...(query.asOf !== undefined ? { asOf: query.asOf } : {}),
	...(query.entities ? { entities: query.entities } : {}),
	...(query.include ? { include: query.include } : {}),
	...(query.format ? { format: query.format } : {}),
	...(query.plan ? { plan: query.plan } : {}),
	...(query.rerankMode ? { rerankMode: query.rerankMode } : {}),
});

const embedQuery = (text: string) =>
	Effect.gen(function* () {
		const embeddings = yield* Embeddings;
		const vectors = yield* embeddings
			.embed([text])
			.pipe(
				Effect.catchTag("ProviderUnavailable", () =>
					Effect.succeed<ReadonlyArray<ReadonlyArray<number>>>([]),
				),
			);
		return vectors[0];
	});

const uniqueIds = (ids: ReadonlyArray<string>): string[] => [...new Set(ids)];

const collapseEdges = (
	ids: ReadonlyArray<string>,
	edges: ReadonlyArray<{ readonly src: string; readonly dst: string; readonly relation: string }>,
	scores: Map<string, number>,
): string[] => {
	const drop = new Set<string>();
	for (const edge of edges) {
		if (edge.relation === "supersedes") {
			if (ids.includes(edge.src) && ids.includes(edge.dst)) {
				drop.add(edge.dst);
			}
		}
		if (edge.relation === "same_episode" || edge.relation === "elaborates") {
			if (ids.includes(edge.src) && ids.includes(edge.dst)) {
				const srcScore = scores.get(edge.src) ?? 0;
				const dstScore = scores.get(edge.dst) ?? 0;
				drop.add(srcScore >= dstScore ? edge.dst : edge.src);
			}
		}
	}
	return ids.filter((id) => !drop.has(id));
};

export const searchMemories = (
	input: Partial<SearchQuery> & { query: string; namespace: string },
) =>
	Effect.gen(function* () {
		const query = defaultSearch(input);
		const plan = planQueryFast(query);
		const values = yield* embedQuery(query.query);
		const lists = yield* collectCandidates({
			query,
			plan,
			namespace: input.namespace,
			queryValues: values,
			includeEvidence: false,
		});
		const repo = yield* MemoryRepo;
		const ids = uniqueIds([...lists.fts, ...lists.vector, ...lists.graph, ...lists.recent]);
		const memories = yield* repo.listMemoriesByIds(ids);
		const scores = fuseMemories({
			lists,
			memories,
			plan,
			config: defaultRetrievalConfig,
		});
		const ranked = [...scores.entries()]
			.sort((a, b) => b[1] - a[1])
			.slice(0, query.limit)
			.map(([id]) => id);
		const byId = new Map(memories.map((memory) => [memory.id, memory]));
		const provenance = yield* repo.provenanceFor(ranked);
		const provenanceByMemory = new Map<string, Array<(typeof provenance)[number]>>();
		for (const row of provenance) {
			const list = provenanceByMemory.get(row.memoryId) ?? [];
			list.push(row);
			provenanceByMemory.set(row.memoryId, list);
		}
		return ranked.flatMap((id) => {
			const memory = byId.get(id);
			if (!memory || !validAt(memory, plan.asOf)) {
				return [];
			}
			return [
				{
					memory,
					score: scores.get(id) ?? 0,
					provenance: (provenanceByMemory.get(id) ?? []).map(({ memoryId: _id, ...rest }) => rest),
					why: whyFor(id, lists),
				},
			];
		});
	});

export const recallContext = (input: Partial<RecallQuery> & { query: string; namespace: string }) =>
	Effect.gen(function* () {
		const query = defaultRecall(input);
		const repo = yield* MemoryRepo;
		const plan = yield* planQuery(query);
		const values = yield* embedQuery(query.query);
		const include = new Set(query.include ?? ["memories"]);
		const includeEvidence = include.has("evidence");
		const lists = yield* collectCandidates({
			query,
			plan,
			namespace: input.namespace,
			queryValues: values,
			includeEvidence,
		});
		const memoryIds = uniqueIds([...lists.fts, ...lists.vector, ...lists.graph, ...lists.recent]);
		const memories = yield* repo.listMemoriesByIds(memoryIds);
		let scores = fuseMemories({
			lists,
			memories,
			plan,
			config: defaultRetrievalConfig,
		});
		const texts = new Map(memories.map((memory) => [memory.id, memory.text]));
		const rankedIds = [...scores.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
		const mode = query.rerankMode ?? (query.rerank ? defaultRetrievalConfig.defaultRerank : "none");
		if (mode === "cross" && rankedIds.length > 1) {
			scores = yield* crossEncode(query.query, rankedIds, texts, scores, defaultRetrievalConfig);
		} else if (mode === "llm" && rankedIds.length > 1) {
			const order = yield* llmRerank(query.query, rankedIds, texts);
			const next = new Map(scores);
			order.forEach((id, index) => {
				next.set(id, (scores.get(id) ?? 0) * (1 + (order.length - index) / order.length));
			});
			scores = next;
		}
		const afterRerank = [...scores.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
		const diversified = mmrDiversify(
			afterRerank,
			scores,
			lists.vectorValues,
			defaultRetrievalConfig.mmrLambda,
			40,
		);
		const edges = yield* repo.listEdges(diversified);
		const kept = collapseEdges(diversified, edges, scores);
		const keptMemories = memories.filter((memory) => kept.includes(memory.id));
		const chunkIds = uniqueIds([...lists.ftsChunks, ...lists.vectorChunks]);
		const chunkScores = weightedRrf(
			[
				{ ids: lists.ftsChunks, weight: 1 },
				{ ids: lists.vectorChunks, weight: 1 },
			],
			defaultRetrievalConfig.rrfK,
		);
		const chunks = includeEvidence ? yield* repo.listChunksByIds(chunkIds) : [];
		const chunkMeta = includeEvidence ? yield* repo.chunkMeta(chunkIds) : [];
		const provenance = yield* repo.provenanceFor(kept);
		const why = new Map(kept.map((id) => [id, whyFor(id, lists)] as const));
		const format = query.format ?? "markdown";
		const entityIds = [
			...new Set(keptMemories.flatMap((memory) => memory.entities.map((entity) => entity.id))),
		];
		const graphRels = entityIds.length > 0 ? yield* repo.listRelations(entityIds, plan.asOf) : [];
		const nameById = new Map(
			keptMemories.flatMap((memory) =>
				memory.entities.map((entity) => [entity.id, entity.name] as const),
			),
		);
		for (const rel of graphRels) {
			if (!nameById.has(rel.srcEntity)) {
				const entity = yield* repo.getEntity(rel.srcEntity);
				if (entity) {
					nameById.set(entity.id, entity.name);
				}
			}
			if (!nameById.has(rel.dstEntity)) {
				const entity = yield* repo.getEntity(rel.dstEntity);
				if (entity) {
					nameById.set(entity.id, entity.name);
				}
			}
		}
		const relations = graphRels.flatMap((rel) => {
			const src = nameById.get(rel.srcEntity);
			const dst = nameById.get(rel.dstEntity);
			if (!src || !dst) {
				return [];
			}
			return [
				{
					src,
					predicate: rel.predicate,
					dst,
					memoryId: rel.memoryId,
					since: rel.validFrom,
				},
			];
		});
		const result: RecallResult = packRecall({
			memories: keptMemories,
			scores,
			why,
			provenance,
			chunks,
			chunkScores,
			chunkMeta,
			budgetTokens: query.budgetTokens,
			includeEvidence,
			conflicts: edges.filter((edge) => edge.relation === "contradicts"),
			format,
			relations,
		});
		const packedIds = result.memories.map((hit) => hit.memory.id);
		if (packedIds.length > 0) {
			yield* repo.recordAccess(packedIds, Date.now());
		}
		return result;
	});

export { chunkVectorId, memoryVectorId, parseVectorId, VECTOR_KIND_CHUNK };
export type { Memory };
