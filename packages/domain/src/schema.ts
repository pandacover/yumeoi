import { Schema } from "effect";

export const MemoryType = Schema.Literals(["semantic", "episodic", "procedural"]);
export type MemoryType = typeof MemoryType.Type;

export const MEMORY_TYPES = ["semantic", "episodic", "procedural"] as const;

export const MemoryKind = Schema.Literals([
	"fact",
	"preference",
	"decision",
	"task",
	"relationship",
	"event",
	"procedure",
	"rule",
]);
export type MemoryKind = typeof MemoryKind.Type;

export const MEMORY_KINDS = [
	"fact",
	"preference",
	"decision",
	"task",
	"relationship",
	"event",
	"procedure",
	"rule",
] as const;

export const MemoryState = Schema.Literals([
	"active",
	"superseded",
	"dormant",
	"archived",
	"forgotten",
]);
export type MemoryState = typeof MemoryState.Type;

export const MemoryOrigin = Schema.Literals(["extracted", "agent", "user", "derived", "chat"]);
export type MemoryOrigin = typeof MemoryOrigin.Type;

export const EntityType = Schema.Literals([
	"person",
	"org",
	"project",
	"place",
	"tool",
	"topic",
	"document",
	"other",
]);
export type EntityType = typeof EntityType.Type;

export const ExtractedEntity = Schema.Struct({
	name: Schema.String,
	type: EntityType,
});
export type ExtractedEntity = typeof ExtractedEntity.Type;

export const ExtractedRelation = Schema.Struct({
	subject: Schema.String,
	predicate: Schema.String,
	object: Schema.String,
});
export type ExtractedRelation = typeof ExtractedRelation.Type;

export const MemoryEntityRef = Schema.Struct({
	id: Schema.String,
	name: Schema.String,
	type: EntityType,
});
export type MemoryEntityRef = typeof MemoryEntityRef.Type;

/** Structured-output shape used by extract (all fields required for OpenAI strict mode). */
export const ExtractedMemory = Schema.Struct({
	type: MemoryType,
	kind: MemoryKind,
	text: Schema.String,
	confidence: Schema.Finite,
	importance: Schema.Finite,
	eventAt: Schema.NullOr(Schema.String),
	validFrom: Schema.NullOr(Schema.String),
	entities: Schema.Array(ExtractedEntity),
	relations: Schema.Array(ExtractedRelation),
});
export type ExtractedMemory = typeof ExtractedMemory.Type;

export const ExtractedMemories = Schema.Struct({
	memories: Schema.Array(ExtractedMemory),
});
export type ExtractedMemories = typeof ExtractedMemories.Type;

export const ConsolidateAction = Schema.Literals([
	"new",
	"duplicate",
	"supersedes",
	"merge",
	"contradicts",
]);
export type ConsolidateAction = typeof ConsolidateAction.Type;

export const ConsolidateDecision = Schema.Struct({
	action: ConsolidateAction,
	targetId: Schema.NullOr(Schema.String),
	mergedText: Schema.NullOr(Schema.String),
	reason: Schema.String,
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
	type: MemoryType,
	state: MemoryState,
	importance: Schema.Finite,
	eventAt: Schema.NullOr(Schema.Finite),
	observedAt: Schema.NullOr(Schema.Finite),
	updatedAt: Schema.NullOr(Schema.Finite),
	lastAccessedAt: Schema.NullOr(Schema.Finite),
	accessCount: Schema.Int,
	retention: Schema.Finite,
	origin: MemoryOrigin,
	clientRef: Schema.NullOr(Schema.String),
	entities: Schema.Array(MemoryEntityRef),
});
export type Memory = typeof Memory.Type;

export const defaultTypeForKind = (kind: MemoryKind): MemoryType => {
	if (kind === "event" || kind === "task") {
		return "episodic";
	}
	if (kind === "procedure" || kind === "rule") {
		return "procedural";
	}
	return "semantic";
};

export const fillMemory = (
	core: Pick<
		Memory,
		"id" | "kind" | "text" | "confidence" | "validFrom" | "validTo" | "supersedes"
	> &
		Partial<Memory>,
): Memory => ({
	id: core.id,
	kind: core.kind,
	text: core.text,
	confidence: core.confidence,
	validFrom: core.validFrom,
	validTo: core.validTo,
	supersedes: core.supersedes,
	type: core.type ?? defaultTypeForKind(core.kind),
	state: core.state ?? (core.validTo ? "superseded" : "active"),
	importance: core.importance ?? core.confidence,
	eventAt: core.eventAt ?? null,
	observedAt: core.observedAt ?? null,
	updatedAt: core.updatedAt ?? null,
	lastAccessedAt: core.lastAccessedAt ?? null,
	accessCount: core.accessCount ?? 0,
	retention: core.retention ?? 1,
	origin: core.origin ?? "extracted",
	clientRef: core.clientRef ?? null,
	entities: core.entities ?? [],
});

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

export const WhyFlag = Schema.Literals(["kw", "vec", "graph", "recent"]);
export type WhyFlag = typeof WhyFlag.Type;

export const MemoryHit = Schema.Struct({
	memory: Memory,
	score: Schema.Finite,
	provenance: Schema.Array(Provenance),
	why: Schema.optionalKey(Schema.Array(WhyFlag)),
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
	markdown: Schema.optionalKey(Schema.String),
});
export type RecallResult = typeof RecallResult.Type;

/** Numbered citation shown inline in chat answers. */
export const ChatCitation = Schema.Struct({
	index: Schema.Int,
	memoryId: Schema.NullOr(Schema.String),
	documentId: Schema.NullOr(Schema.String),
	title: Schema.String,
	url: Schema.NullOr(Schema.String),
	text: Schema.String,
	kind: Schema.NullOr(Schema.String),
});
export type ChatCitation = typeof ChatCitation.Type;

export const SearchQuery = Schema.Struct({
	query: Schema.String,
	sources: Schema.Array(Schema.String),
	kinds: Schema.Array(MemoryKind),
	since: Schema.NullOr(Schema.Finite),
	limit: Schema.Int,
	types: Schema.optionalKey(Schema.Array(MemoryType)),
	from: Schema.optionalKey(Schema.NullOr(Schema.Finite)),
	to: Schema.optionalKey(Schema.NullOr(Schema.Finite)),
	asOf: Schema.optionalKey(Schema.NullOr(Schema.Finite)),
	entities: Schema.optionalKey(Schema.Array(Schema.String)),
	includeDormant: Schema.optionalKey(Schema.Boolean),
	cursor: Schema.optionalKey(Schema.NullOr(Schema.String)),
});
export type SearchQuery = typeof SearchQuery.Type;

export const RecallInclude = Schema.Literals(["memories", "evidence", "entities", "conflicts"]);
export type RecallInclude = typeof RecallInclude.Type;

export const RecallFormat = Schema.Literals(["markdown", "json"]);
export type RecallFormat = typeof RecallFormat.Type;

export const RecallPlanMode = Schema.Literals(["fast", "full"]);
export type RecallPlanMode = typeof RecallPlanMode.Type;

export const RerankMode = Schema.Literals(["none", "cross", "llm"]);
export type RerankMode = typeof RerankMode.Type;

export const QueryIntent = Schema.Literals(["lookup", "howto", "history", "who", "open"]);
export type QueryIntent = typeof QueryIntent.Type;

export const QueryPlan = Schema.Struct({
	text: Schema.String,
	terms: Schema.Array(Schema.String),
	temporalFrom: Schema.NullOr(Schema.Finite),
	temporalTo: Schema.NullOr(Schema.Finite),
	asOf: Schema.NullOr(Schema.Finite),
	typeWeights: Schema.Struct({
		semantic: Schema.Finite,
		episodic: Schema.Finite,
		procedural: Schema.Finite,
	}),
	entities: Schema.Array(Schema.String),
	intent: QueryIntent,
});
export type QueryPlan = typeof QueryPlan.Type;

export const RecallQuery = Schema.Struct({
	query: Schema.String,
	sources: Schema.Array(Schema.String),
	kinds: Schema.Array(MemoryKind),
	since: Schema.NullOr(Schema.Finite),
	budgetTokens: Schema.Int,
	rerank: Schema.Boolean,
	types: Schema.optionalKey(Schema.Array(MemoryType)),
	from: Schema.optionalKey(Schema.NullOr(Schema.Finite)),
	to: Schema.optionalKey(Schema.NullOr(Schema.Finite)),
	asOf: Schema.optionalKey(Schema.NullOr(Schema.Finite)),
	entities: Schema.optionalKey(Schema.Array(Schema.String)),
	include: Schema.optionalKey(Schema.Array(RecallInclude)),
	format: Schema.optionalKey(RecallFormat),
	plan: Schema.optionalKey(RecallPlanMode),
	rerankMode: Schema.optionalKey(RerankMode),
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
	type: Schema.optionalKey(MemoryType),
	clientRef: Schema.optionalKey(Schema.String),
});
export type AddMemoryRequest = typeof AddMemoryRequest.Type;

export const RememberAction = Schema.Literals([
	"created",
	"merged",
	"duplicate",
	"superseded",
	"conflict",
]);
export type RememberAction = typeof RememberAction.Type;

export const RememberOutcomeItem = Schema.Struct({
	action: RememberAction,
	id: Schema.String,
	text: Schema.String,
	type: MemoryType,
	kind: MemoryKind,
	affected: Schema.Array(Schema.String),
	idempotent: Schema.optionalKey(Schema.Boolean),
});
export type RememberOutcomeItem = typeof RememberOutcomeItem.Type;

export const ToolErrorCode = Schema.Literals([
	"not_found",
	"invalid_input",
	"scope_required",
	"rate_limited",
	"conflict",
]);
export type ToolErrorCode = typeof ToolErrorCode.Type;

export const ToolError = Schema.Struct({
	error: ToolErrorCode,
	hint: Schema.String,
});
export type ToolError = typeof ToolError.Type;

export const MemoryHistoryRow = Schema.Struct({
	id: Schema.String,
	memoryId: Schema.String,
	text: Schema.String,
	type: MemoryType,
	kind: MemoryKind,
	confidence: Schema.Finite,
	validFrom: Schema.NullOr(Schema.String),
	validTo: Schema.NullOr(Schema.String),
	state: MemoryState,
	changedAt: Schema.Finite,
	reason: Schema.String,
});
export type MemoryHistoryRow = typeof MemoryHistoryRow.Type;

export const MemoryEdgeRow = Schema.Struct({
	src: Schema.String,
	dst: Schema.String,
	relation: Schema.String,
});
export type MemoryEdgeRow = typeof MemoryEdgeRow.Type;
