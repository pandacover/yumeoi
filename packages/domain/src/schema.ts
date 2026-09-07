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

/** Structured-output shape used by extract (all fields required for OpenAI strict mode). */
export const ExtractedMemory = Schema.Struct({
	kind: MemoryKind,
	text: Schema.String,
	confidence: Schema.Finite,
	validFrom: Schema.NullOr(Schema.String),
});
export type ExtractedMemory = typeof ExtractedMemory.Type;

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

export const Document = Schema.Struct({
	id: Schema.String,
	sourceId: Schema.String,
	externalId: Schema.String,
	contentHash: Schema.String,
	title: Schema.String,
	markdown: Schema.String,
	url: Schema.NullOr(Schema.String),
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

export const RecallResult = Schema.Struct({
	memories: Schema.Array(Memory),
	chunks: Schema.Array(Chunk),
});
export type RecallResult = typeof RecallResult.Type;
