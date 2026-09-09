import type {
	AddMemoryRequest,
	Chunk,
	Document,
	EntityType,
	ExtractedEntity,
	ExtractedRelation,
	IngestResult,
	Memory,
	MemoryEdgeRow,
	MemoryHistoryRow,
	MemoryKind,
	MemoryOrigin,
	MemoryState,
	MemoryType,
	NotFound,
	Provenance,
	QueryPlan,
	Source,
} from "@yumeoi/domain";
import { Context, type Effect } from "effect";

export type ChunkHash = {
	readonly id: string;
	readonly contentHash: string;
};

export type CommitMemory = {
	readonly id: string;
	readonly kind: MemoryKind;
	readonly text: string;
	readonly confidence: number;
	readonly validFrom: string | null;
	readonly validTo: string | null;
	readonly supersedes: string | null;
	readonly chunkIds: ReadonlyArray<string>;
	readonly type?: MemoryType;
	readonly state?: MemoryState;
	readonly importance?: number;
	readonly eventAt?: number | null;
	readonly origin?: MemoryOrigin;
	readonly clientRef?: string | null;
	readonly entities?: ReadonlyArray<ExtractedEntity>;
	readonly relations?: ReadonlyArray<ExtractedRelation>;
};

export type InsertMemoryInput = AddMemoryRequest & {
	readonly id?: string;
	readonly type?: MemoryType;
	readonly state?: MemoryState;
	readonly importance?: number;
	readonly eventAt?: number | null;
	readonly validFrom?: string | null;
	readonly validTo?: string | null;
	readonly origin?: MemoryOrigin;
	readonly documentId?: string;
	readonly chunkId?: string;
};

export type MemoryPatch = {
	readonly text?: string;
	readonly validTo?: string | null;
	readonly state?: MemoryState;
	readonly confidence?: number;
	readonly importance?: number;
	readonly kind?: MemoryKind;
	readonly eventAt?: number | null;
};

export type CommitBatch = {
	readonly userId: string;
	readonly source: {
		readonly id: string;
		readonly kind: "generic" | "agent" | "notion" | "gmail" | "obsidian";
		readonly label: string;
	};
	readonly document: {
		readonly id: string;
		readonly sourceId: string;
		readonly externalId: string;
		readonly contentHash: string;
		readonly title: string;
		readonly markdown: string;
		readonly url: string | null;
		readonly r2Key: string;
	};
	readonly chunks: ReadonlyArray<
		Omit<Chunk, "documentId"> & {
			readonly values: ReadonlyArray<number> | null;
		}
	>;
	readonly memories: ReadonlyArray<
		CommitMemory & {
			readonly values: ReadonlyArray<number> | null;
		}
	>;
	readonly replaceDocument: boolean;
};

export type SearchFilters = {
	readonly sources: ReadonlyArray<string>;
	readonly kinds: ReadonlyArray<MemoryKind>;
	readonly since: number | null;
	readonly limit: number;
	readonly types?: ReadonlyArray<MemoryType>;
	readonly from?: number | null;
	readonly to?: number | null;
	readonly asOf?: number | null;
	readonly includeDormant?: boolean;
};

export type RankedId = {
	readonly id: string;
	readonly rank: number;
	readonly bm25?: number;
};

export class MemoryRepo extends Context.Service<
	MemoryRepo,
	{
		readonly getDocumentByExternalId: (
			sourceId: string,
			externalId: string,
		) => Effect.Effect<Document | null, unknown>;
		readonly listChunkHashes: (
			documentId: string,
		) => Effect.Effect<ReadonlyArray<ChunkHash>, unknown>;
		readonly searchMemoryFts: (
			match: string,
			filters: SearchFilters,
		) => Effect.Effect<ReadonlyArray<RankedId>, unknown>;
		readonly searchChunkFts: (
			match: string,
			filters: SearchFilters,
		) => Effect.Effect<ReadonlyArray<RankedId>, unknown>;
		readonly getMemory: (id: string) => Effect.Effect<Memory, NotFound | unknown>;
		readonly getDocument: (id: string) => Effect.Effect<Document, NotFound | unknown>;
		readonly getChunk: (id: string) => Effect.Effect<Chunk, NotFound | unknown>;
		readonly listMemoriesByIds: (
			ids: ReadonlyArray<string>,
		) => Effect.Effect<ReadonlyArray<Memory>, unknown>;
		readonly listChunksByIds: (
			ids: ReadonlyArray<string>,
		) => Effect.Effect<ReadonlyArray<Chunk>, unknown>;
		readonly provenanceFor: (
			memoryIds: ReadonlyArray<string>,
		) => Effect.Effect<ReadonlyArray<Provenance & { readonly memoryId: string }>, unknown>;
		readonly chunkMeta: (chunkIds: ReadonlyArray<string>) => Effect.Effect<
			ReadonlyArray<{
				readonly chunkId: string;
				readonly sourceId: string;
				readonly title: string;
				readonly url: string | null;
				readonly updatedAt: number;
			}>,
			unknown
		>;
		readonly memoryTimestamps: (
			memoryIds: ReadonlyArray<string>,
		) => Effect.Effect<ReadonlyArray<{ readonly id: string; readonly createdAt: number }>, unknown>;
		readonly listSources: (userId: string) => Effect.Effect<ReadonlyArray<Source>, unknown>;
		readonly upsertSource: (source: Source) => Effect.Effect<void, unknown>;
		readonly listMemories: (
			filters: SearchFilters,
		) => Effect.Effect<ReadonlyArray<Memory>, unknown>;
		readonly similarMemoryCandidates: (
			excludeIds: ReadonlyArray<string>,
			limit: number,
		) => Effect.Effect<ReadonlyArray<Memory>, unknown>;
		readonly listRecentMemories: (limit: number) => Effect.Effect<ReadonlyArray<Memory>, unknown>;
		readonly commit: (batch: CommitBatch) => Effect.Effect<IngestResult, unknown>;
		readonly insertMemory: (
			userId: string,
			input: InsertMemoryInput,
			options?: { readonly supersedes?: string | null },
		) => Effect.Effect<Memory, unknown>;
		readonly updateMemory: (id: string, patch: MemoryPatch) => Effect.Effect<Memory, unknown>;
		readonly insertEdge: (
			src: string,
			dst: string,
			relation: string,
		) => Effect.Effect<void, unknown>;
		readonly insertHistory: (row: {
			readonly memoryId: string;
			readonly text: string;
			readonly type: MemoryType;
			readonly kind: MemoryKind;
			readonly confidence: number;
			readonly validFrom: string | null;
			readonly validTo: string | null;
			readonly state: MemoryState;
			readonly reason: string;
		}) => Effect.Effect<void, unknown>;
		readonly getMemoryByClientRef: (clientRef: string) => Effect.Effect<Memory | null, unknown>;
		readonly upsertEntity: (input: {
			readonly name: string;
			readonly canonical: string;
			readonly type: EntityType;
			readonly now: number;
		}) => Effect.Effect<{ readonly id: string }, unknown>;
		readonly linkMemoryEntity: (
			memoryId: string,
			entityId: string,
			role: string,
		) => Effect.Effect<void, unknown>;
		readonly listMemoriesPage: (options: {
			readonly afterId: string | null;
			readonly limit: number;
			readonly activeOnly: boolean;
		}) => Effect.Effect<ReadonlyArray<Memory>, unknown>;
		readonly listChunksPage: (options: {
			readonly afterId: string | null;
			readonly limit: number;
		}) => Effect.Effect<ReadonlyArray<Chunk & { readonly sourceId: string }>, unknown>;
		readonly listInactiveMemoryIds: () => Effect.Effect<ReadonlyArray<string>, unknown>;
		readonly recordAccess: (ids: ReadonlyArray<string>, at: number) => Effect.Effect<void, unknown>;
		readonly listByEntities: (
			entityIds: ReadonlyArray<string>,
			filters: SearchFilters,
		) => Effect.Effect<ReadonlyArray<RankedId>, unknown>;
		readonly listRecentEpisodic: (
			sinceEventAt: number,
			limit: number,
		) => Effect.Effect<ReadonlyArray<Memory>, unknown>;
		readonly listEdges: (
			ids: ReadonlyArray<string>,
		) => Effect.Effect<ReadonlyArray<MemoryEdgeRow>, unknown>;
		readonly listHistory: (
			memoryId: string,
		) => Effect.Effect<ReadonlyArray<MemoryHistoryRow>, unknown>;
		readonly insertFeedback: (row: {
			readonly memoryId: string;
			readonly clientId: string;
			readonly signal: 1 | -1;
			readonly note?: string;
		}) => Effect.Effect<void, unknown>;
		readonly getQueryPlan: (hash: string, now: number) => Effect.Effect<QueryPlan | null, unknown>;
		readonly putQueryPlan: (
			hash: string,
			plan: QueryPlan,
			expiresAt: number,
		) => Effect.Effect<void, unknown>;
	}
>()("@yumeoi/memory/MemoryRepo") {}
