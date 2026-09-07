import type {
	AddMemoryRequest,
	Chunk,
	Document,
	IngestResult,
	Memory,
	MemoryKind,
	NotFound,
	Provenance,
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
};

export type RankedId = {
	readonly id: string;
	readonly rank: number;
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
		readonly similarMemoryCandidates: (
			excludeIds: ReadonlyArray<string>,
			limit: number,
		) => Effect.Effect<ReadonlyArray<Memory>, unknown>;
		readonly commit: (batch: CommitBatch) => Effect.Effect<IngestResult, unknown>;
		readonly addMemory: (userId: string, input: AddMemoryRequest) => Effect.Effect<Memory, unknown>;
	}
>()("@yumeoi/memory/MemoryRepo") {}
