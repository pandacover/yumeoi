import { Schema } from "effect";

export const MemoryKind = Schema.Literals([
	"fact",
	"preference",
	"decision",
	"task",
	"relationship",
	"event",
]);
export type MemoryKind = typeof MemoryKind.Type;

export const MEMORY_KINDS = [
	"fact",
	"preference",
	"decision",
	"task",
	"relationship",
	"event",
] as const;

/** Structured-output shape used by extract (all fields required for OpenAI strict mode). */
export const ExtractedMemory = Schema.Struct({
	kind: MemoryKind,
	text: Schema.String,
	confidence: Schema.Finite,
	validFrom: Schema.NullOr(Schema.String),
});
export type ExtractedMemory = typeof ExtractedMemory.Type;

export const ExtractedMemories = Schema.Struct({
	memories: Schema.Array(ExtractedMemory),
});
export type ExtractedMemories = typeof ExtractedMemories.Type;

export const ConsolidateAction = Schema.Literals(["new", "duplicate", "supersedes"]);
export type ConsolidateAction = typeof ConsolidateAction.Type;

export const ConsolidateDecision = Schema.Struct({
	action: ConsolidateAction,
	targetId: Schema.NullOr(Schema.String),
});
export type ConsolidateDecision = typeof ConsolidateDecision.Type;

export const RerankResult = Schema.Struct({
	ids: Schema.Array(Schema.String),
});
export type RerankResult = typeof RerankResult.Type;

export const Memory = Schema.Struct({
	id: Schema.String,
	kind: MemoryKind,
	text: Schema.String,
	confidence: Schema.Finite,
	validFrom: Schema.NullOr(Schema.String),
	validTo: Schema.NullOr(Schema.String),
	supersedes: Schema.NullOr(Schema.String),
});
export type Memory = typeof Memory.Type;

export const SourceKind = Schema.Literals(["notion", "gmail", "obsidian", "generic", "agent"]);
export type SourceKind = typeof SourceKind.Type;

export const Source = Schema.Struct({
	id: Schema.String,
	userId: Schema.String,
	kind: SourceKind,
	label: Schema.String,
});
export type Source = typeof Source.Type;

export const SourceStatus = Schema.Literals([
	"idle",
	"polling",
	"syncing",
	"error",
	"disconnected",
]);
export type SourceStatus = typeof SourceStatus.Type;

export const SOURCE_STATUSES = ["idle", "polling", "syncing", "error", "disconnected"] as const;

/** Live source row shown in the UI and streamed via MemoryAgent state. */
export const SourceView = Schema.Struct({
	id: Schema.String,
	userId: Schema.String,
	kind: SourceKind,
	label: Schema.String,
	status: SourceStatus,
	lastSyncedAt: Schema.NullOr(Schema.Finite),
	lastError: Schema.NullOr(Schema.String),
	documentsSeen: Schema.Int,
	documentsIngested: Schema.Int,
});
export type SourceView = typeof SourceView.Type;

export const Document = Schema.Struct({
	id: Schema.String,
	sourceId: Schema.String,
	externalId: Schema.String,
	contentHash: Schema.String,
	title: Schema.String,
	markdown: Schema.String,
	url: Schema.NullOr(Schema.String),
	r2Key: Schema.optionalKey(Schema.NullOr(Schema.String)),
});
export type Document = typeof Document.Type;

export const Chunk = Schema.Struct({
	id: Schema.String,
	documentId: Schema.String,
	text: Schema.String,
	contentHash: Schema.String,
	byteStart: Schema.Int,
	byteEnd: Schema.Int,
});
export type Chunk = typeof Chunk.Type;

export const Provenance = Schema.Struct({
	sourceId: Schema.String,
	documentId: Schema.String,
	chunkId: Schema.String,
	title: Schema.String,
	url: Schema.NullOr(Schema.String),
});
export type Provenance = typeof Provenance.Type;

export const MemoryHit = Schema.Struct({
	memory: Memory,
	score: Schema.Finite,
	provenance: Schema.Array(Provenance),
});
export type MemoryHit = typeof MemoryHit.Type;

export const ChunkHit = Schema.Struct({
	chunk: Chunk,
	score: Schema.Finite,
	title: Schema.String,
	url: Schema.NullOr(Schema.String),
	sourceId: Schema.String,
});
export type ChunkHit = typeof ChunkHit.Type;

export const RecallResult = Schema.Struct({
	memories: Schema.Array(MemoryHit),
	chunks: Schema.Array(ChunkHit),
});
export type RecallResult = typeof RecallResult.Type;

export const SearchQuery = Schema.Struct({
	query: Schema.String,
	sources: Schema.Array(Schema.String),
	kinds: Schema.Array(MemoryKind),
	since: Schema.NullOr(Schema.Finite),
	limit: Schema.Int,
});
export type SearchQuery = typeof SearchQuery.Type;

export const RecallQuery = Schema.Struct({
	query: Schema.String,
	sources: Schema.Array(Schema.String),
	kinds: Schema.Array(MemoryKind),
	since: Schema.NullOr(Schema.Finite),
	budgetTokens: Schema.Int,
	rerank: Schema.Boolean,
});
export type RecallQuery = typeof RecallQuery.Type;

export const IngestRequest = Schema.Struct({
	externalId: Schema.String,
	title: Schema.String,
	markdown: Schema.String,
	sourceId: Schema.NullOr(Schema.String),
	sourceLabel: Schema.NullOr(Schema.String),
	url: Schema.NullOr(Schema.String),
	sourceKind: Schema.optionalKey(SourceKind),
	metadata: Schema.optionalKey(
		Schema.Record(
			Schema.String,
			Schema.Union([
				Schema.String,
				Schema.Number,
				Schema.Boolean,
				Schema.Null,
				Schema.Array(Schema.Union([Schema.String, Schema.Number, Schema.Boolean, Schema.Null])),
			]),
		),
	),
});
export type IngestRequest = typeof IngestRequest.Type;

export const IngestResult = Schema.Struct({
	documentId: Schema.String,
	sourceId: Schema.String,
	contentHash: Schema.String,
	unchanged: Schema.Boolean,
	chunkCount: Schema.Int,
	memoryCount: Schema.Int,
	skippedChunks: Schema.Int,
});
export type IngestResult = typeof IngestResult.Type;

export const AddMemoryRequest = Schema.Struct({
	text: Schema.String,
	kind: MemoryKind,
	confidence: Schema.Finite,
	sourceId: Schema.optionalKey(Schema.String),
});
export type AddMemoryRequest = typeof AddMemoryRequest.Type;
