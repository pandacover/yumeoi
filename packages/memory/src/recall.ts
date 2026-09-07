import {
	type RecallQuery,
	type RecallResult,
	RerankResult,
	rerankResultJsonSchema,
	type SearchQuery,
} from "@yumeoi/domain";
import { Effect } from "effect";
import { Embeddings } from "./embeddings.ts";
import { Llm } from "./llm.ts";
import { MemoryRepo } from "./memory-repo.ts";
import { estimateTokens, ftsMatchQuery, recencyBoost, rrfScore } from "./rrf.ts";
import { VectorIndex } from "./vector-index.ts";

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
});

const defaultRecall = (query: Partial<RecallQuery> & { query: string }): RecallQuery => ({
	query: query.query,
	sources: query.sources ?? [],
	kinds: query.kinds ?? [],
	since: query.since ?? null,
	budgetTokens: query.budgetTokens ?? 2000,
	rerank: query.rerank ?? true,
});

const vectorFilter = (filters: SearchQuery | RecallQuery, kind?: string) => {
	const filter: Record<string, unknown> = {};
	if (kind) {
		filter.kind = kind;
	} else if (filters.kinds.length === 1) {
		filter.kind = filters.kinds[0];
	} else if (filters.kinds.length > 1) {
		filter.kind = { $in: [...filters.kinds] };
	}
	if (filters.sources.length === 1) {
		filter.sourceId = filters.sources[0];
	} else if (filters.sources.length > 1) {
		filter.sourceId = { $in: [...filters.sources] };
	}
	if (filters.since !== null) {
		filter.ts = { $gte: filters.since };
	}
	return Object.keys(filter).length > 0 ? filter : undefined;
};

export const searchMemories = (
	input: Partial<SearchQuery> & { query: string; namespace: string },
) =>
	Effect.gen(function* () {
		const query = defaultSearch(input);
		const repo = yield* MemoryRepo;
		const embeddings = yield* Embeddings;
		const index = yield* VectorIndex;

		const match = ftsMatchQuery(query.query);
		const fts = match
			? yield* repo.searchMemoryFts(match, {
					sources: query.sources,
					kinds: query.kinds,
					since: query.since,
					limit: query.limit,
				})
			: [];

		const [values] = yield* embeddings.embed([query.query]);
		const memoryFilter = vectorFilter(query);
		const vector = values
			? memoryFilter
				? yield* index.query({
						values,
						namespace: input.namespace,
						topK: Math.min(40, Math.max(query.limit, 10)),
						filter: memoryFilter,
					})
				: yield* index.query({
						values,
						namespace: input.namespace,
						topK: Math.min(40, Math.max(query.limit, 10)),
					})
			: [];

		const memoryVectorIds = vector
			.map((hit) => parseVectorId(hit.id))
			.filter((parsed): parsed is { type: "memory"; id: string } => parsed?.type === "memory")
			.map((parsed) => parsed.id);

		const fused = rrfScore([fts.map((row) => row.id), memoryVectorIds]);
		const timestamps = yield* repo.memoryTimestamps([...fused.keys()]);
		const tsById = new Map(timestamps.map((row) => [row.id, row.createdAt]));
		const ranked = [...fused.entries()]
			.map(([id, score]) => ({
				id,
				score: recencyBoost(score, tsById.get(id) ?? 0),
			}))
			.sort((a, b) => b.score - a.score)
			.slice(0, query.limit);

		const memories = yield* repo.listMemoriesByIds(ranked.map((row) => row.id));
		const provenance = yield* repo.provenanceFor(ranked.map((row) => row.id));
		const byId = new Map(memories.map((memory) => [memory.id, memory]));
		const provenanceByMemory = new Map<string, Array<(typeof provenance)[number]>>();
		for (const row of provenance) {
			const list = provenanceByMemory.get(row.memoryId) ?? [];
			list.push(row);
			provenanceByMemory.set(row.memoryId, list);
		}

		return ranked.flatMap((row) => {
			const memory = byId.get(row.id);
			if (!memory) {
				return [];
			}
			return [
				{
					memory,
					score: row.score,
					provenance: (provenanceByMemory.get(memory.id) ?? []).map(
						({ memoryId: _memoryId, ...rest }) => rest,
					),
				},
			];
		});
	});

export const recallContext = (input: Partial<RecallQuery> & { query: string; namespace: string }) =>
	Effect.gen(function* () {
		const query = defaultRecall(input);
		const repo = yield* MemoryRepo;
		const embeddings = yield* Embeddings;
		const index = yield* VectorIndex;
		const llm = yield* Llm;

		const searchQuery = {
			query: query.query,
			sources: query.sources,
			kinds: query.kinds,
			since: query.since,
			limit: 40,
			namespace: input.namespace,
		};
		let memories = yield* searchMemories(searchQuery);

		const match = ftsMatchQuery(query.query);
		const ftsChunks = match
			? yield* repo.searchChunkFts(match, {
					sources: query.sources,
					kinds: query.kinds,
					since: query.since,
					limit: 40,
				})
			: [];
		const [values] = yield* embeddings.embed([query.query]);
		const vectorChunks = values
			? yield* index.query({
					values,
					namespace: input.namespace,
					topK: 40,
					filter: { ...vectorFilter(query), kind: VECTOR_KIND_CHUNK },
				})
			: [];
		const chunkVectorIds = vectorChunks
			.map((hit) => parseVectorId(hit.id))
			.filter((parsed): parsed is { type: "chunk"; id: string } => parsed?.type === "chunk")
			.map((parsed) => parsed.id);
		const fusedChunks = rrfScore([ftsChunks.map((row) => row.id), chunkVectorIds]);
		const chunkMeta = yield* repo.chunkMeta([...fusedChunks.keys()]);
		const metaById = new Map(chunkMeta.map((row) => [row.chunkId, row]));
		const chunkIds = [...fusedChunks.entries()]
			.map(([id, score]) => ({
				id,
				score: recencyBoost(score, metaById.get(id)?.updatedAt ?? 0),
			}))
			.sort((a, b) => b.score - a.score)
			.slice(0, 20);
		const chunks = yield* repo.listChunksByIds(chunkIds.map((row) => row.id));
		const chunkById = new Map(chunks.map((chunk) => [chunk.id, chunk]));

		if (query.rerank && memories.length > 1) {
			const ranked = yield* llm.structured({
				job: "rerank",
				schema: RerankResult,
				schemaName: "rerank_result",
				jsonSchema: rerankResultJsonSchema(),
				system: "Reorder memory ids by relevance to the query. Return every id exactly once.",
				user: `Query: ${query.query}\n\n${memories
					.map((hit) => `${hit.memory.id}: ${hit.memory.text}`)
					.join("\n")}`,
			});
			const order = new Map(ranked.ids.map((id, index) => [id, index]));
			memories = [...memories].sort(
				(a, b) => (order.get(a.memory.id) ?? 999) - (order.get(b.memory.id) ?? 999),
			);
		}

		const packedMemories = [];
		let used = 0;
		for (const hit of memories) {
			const cost = estimateTokens(hit.memory.text);
			if (used + cost > query.budgetTokens) {
				break;
			}
			packedMemories.push(hit);
			used += cost;
		}

		const seenDocuments = new Set(
			packedMemories.flatMap((hit) => hit.provenance.map((row) => row.documentId)),
		);
		const packedChunks = [];
		for (const ranked of chunkIds) {
			const chunk = chunkById.get(ranked.id);
			const meta = metaById.get(ranked.id);
			if (!chunk || !meta) {
				continue;
			}
			if (seenDocuments.has(chunk.documentId) && packedChunks.length > 0) {
				continue;
			}
			const cost = estimateTokens(chunk.text);
			if (used + cost > query.budgetTokens) {
				break;
			}
			packedChunks.push({
				chunk,
				score: ranked.score,
				title: meta.title,
				url: meta.url,
				sourceId: meta.sourceId,
			});
			seenDocuments.add(chunk.documentId);
			used += cost;
		}

		const result: RecallResult = {
			memories: packedMemories,
			chunks: packedChunks,
		};
		return result;
	});

export { chunkVectorId, memoryVectorId, VECTOR_KIND_CHUNK };
