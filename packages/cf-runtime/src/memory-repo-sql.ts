import type {
	AddMemoryRequest,
	Chunk,
	Document,
	IngestResult,
	Memory,
	Provenance,
	Source,
} from "@yumeoi/domain";
import { NotFound } from "@yumeoi/domain";
import { MemoryRepo, type SearchFilters } from "@yumeoi/memory";
import { Effect, Layer } from "effect";
import { SqlClient } from "effect/unstable/sql/SqlClient";

type MemoryRow = {
	id: string;
	kind: Memory["kind"];
	text: string;
	confidence: number;
	valid_from: string | null;
	valid_to: string | null;
	supersedes: string | null;
	created_at: number;
};

type DocumentRow = {
	id: string;
	source_id: string;
	external_id: string;
	content_hash: string;
	title: string;
	markdown: string;
	url: string | null;
	r2_key: string | null;
};

type ChunkRow = {
	id: string;
	document_id: string;
	text: string;
	content_hash: string;
	byte_start: number;
	byte_end: number;
};

const toMemory = (row: MemoryRow): Memory => ({
	id: row.id,
	kind: row.kind,
	text: row.text,
	confidence: row.confidence,
	validFrom: row.valid_from,
	validTo: row.valid_to,
	supersedes: row.supersedes,
});

const toDocument = (row: DocumentRow): Document => ({
	id: row.id,
	sourceId: row.source_id,
	externalId: row.external_id,
	contentHash: row.content_hash,
	title: row.title,
	markdown: row.markdown,
	url: row.url,
	r2Key: row.r2_key,
});

const toChunk = (row: ChunkRow): Chunk => ({
	id: row.id,
	documentId: row.document_id,
	text: row.text,
	contentHash: row.content_hash,
	byteStart: row.byte_start,
	byteEnd: row.byte_end,
});

const matchesMemoryFilters = (
	kind: Memory["kind"],
	createdAt: number,
	sourceIds: ReadonlyArray<string>,
	filters: SearchFilters,
): boolean => {
	if (filters.kinds.length > 0 && !filters.kinds.includes(kind)) {
		return false;
	}
	if (filters.since !== null && createdAt < filters.since) {
		return false;
	}
	if (filters.sources.length > 0 && !sourceIds.some((id) => filters.sources.includes(id))) {
		return false;
	}
	return true;
};

export const sqlMemoryRepoLayer = Layer.effect(
	MemoryRepo,
	Effect.gen(function* () {
		const sql = yield* SqlClient;

		return MemoryRepo.of({
			getDocumentByExternalId: (sourceId, externalId) =>
				Effect.gen(function* () {
					const rows = yield* sql<DocumentRow>`
						SELECT id, source_id, external_id, content_hash, title, markdown, url, r2_key
						FROM documents
						WHERE source_id = ${sourceId} AND external_id = ${externalId}
						LIMIT 1
					`;
					const row = rows[0];
					return row ? toDocument(row) : null;
				}),
			listChunkHashes: (documentId) =>
				sql<{ id: string; content_hash: string }>`
					SELECT id, content_hash FROM chunks WHERE document_id = ${documentId}
				`.pipe(
					Effect.map((rows) => rows.map((row) => ({ id: row.id, contentHash: row.content_hash }))),
				),
			searchMemoryFts: (match, filters) =>
				Effect.gen(function* () {
					const rows = yield* sql<{
						id: string;
						kind: Memory["kind"];
						created_at: number;
						source_id: string | null;
					}>`
						SELECT memories.id, memories.kind, memories.created_at, memory_sources.source_id
						FROM memories_fts
						JOIN memories ON memories.rowid = memories_fts.rowid
						LEFT JOIN memory_sources ON memory_sources.memory_id = memories.id
						WHERE memories_fts MATCH ${match}
						LIMIT 80
					`;
					const grouped = new Map<
						string,
						{ kind: Memory["kind"]; createdAt: number; sources: string[] }
					>();
					for (const row of rows) {
						const current = grouped.get(row.id) ?? {
							kind: row.kind,
							createdAt: row.created_at,
							sources: [],
						};
						if (row.source_id) {
							current.sources.push(row.source_id);
						}
						grouped.set(row.id, current);
					}
					return [...grouped.entries()]
						.filter(([, value]) =>
							matchesMemoryFilters(value.kind, value.createdAt, value.sources, filters),
						)
						.slice(0, filters.limit)
						.map(([id], rank) => ({ id, rank }));
				}),
			searchChunkFts: (match, filters) =>
				Effect.gen(function* () {
					const rows = yield* sql<{ id: string; source_id: string }>`
						SELECT chunks.id, documents.source_id
						FROM chunks_fts
						JOIN chunks ON chunks.rowid = chunks_fts.rowid
						JOIN documents ON documents.id = chunks.document_id
						WHERE chunks_fts MATCH ${match}
						LIMIT 80
					`;
					return rows
						.filter(
							(row) => filters.sources.length === 0 || filters.sources.includes(row.source_id),
						)
						.slice(0, filters.limit)
						.map((row, rank) => ({ id: row.id, rank }));
				}),
			getMemory: (id) =>
				Effect.gen(function* () {
					const rows = yield* sql<MemoryRow>`SELECT * FROM memories WHERE id = ${id} LIMIT 1`;
					const row = rows[0];
					if (!row) {
						return yield* Effect.fail(new NotFound({ entity: "memory", id }));
					}
					return toMemory(row);
				}),
			getDocument: (id) =>
				Effect.gen(function* () {
					const rows = yield* sql<DocumentRow>`
						SELECT id, source_id, external_id, content_hash, title, markdown, url, r2_key
						FROM documents WHERE id = ${id} LIMIT 1
					`;
					const row = rows[0];
					if (!row) {
						return yield* Effect.fail(new NotFound({ entity: "document", id }));
					}
					return toDocument(row);
				}),
			getChunk: (id) =>
				Effect.gen(function* () {
					const rows = yield* sql<ChunkRow>`SELECT * FROM chunks WHERE id = ${id} LIMIT 1`;
					const row = rows[0];
					if (!row) {
						return yield* Effect.fail(new NotFound({ entity: "chunk", id }));
					}
					return toChunk(row);
				}),
			listMemoriesByIds: (ids) =>
				Effect.gen(function* () {
					if (ids.length === 0) {
						return [];
					}
					const rows: Memory[] = [];
					for (const id of ids) {
						const found = yield* sql<MemoryRow>`SELECT * FROM memories WHERE id = ${id} LIMIT 1`;
						if (found[0]) {
							rows.push(toMemory(found[0]));
						}
					}
					return rows;
				}),
			listChunksByIds: (ids) =>
				Effect.gen(function* () {
					if (ids.length === 0) {
						return [];
					}
					const rows: Chunk[] = [];
					for (const id of ids) {
						const found = yield* sql<ChunkRow>`SELECT * FROM chunks WHERE id = ${id} LIMIT 1`;
						if (found[0]) {
							rows.push(toChunk(found[0]));
						}
					}
					return rows;
				}),
			provenanceFor: (memoryIds) =>
				Effect.gen(function* () {
					const rows: Array<Provenance & { memoryId: string }> = [];
					for (const memoryId of memoryIds) {
						const found = yield* sql<{
							memory_id: string;
							source_id: string;
							document_id: string;
							chunk_id: string;
							title: string;
							url: string | null;
						}>`
							SELECT memory_sources.memory_id, memory_sources.source_id, memory_sources.document_id,
								memory_sources.chunk_id, documents.title, documents.url
							FROM memory_sources
							JOIN documents ON documents.id = memory_sources.document_id
							WHERE memory_sources.memory_id = ${memoryId}
						`;
						for (const row of found) {
							rows.push({
								memoryId: row.memory_id,
								sourceId: row.source_id,
								documentId: row.document_id,
								chunkId: row.chunk_id,
								title: row.title,
								url: row.url,
							});
						}
					}
					return rows;
				}),
			chunkMeta: (chunkIds) =>
				Effect.gen(function* () {
					const rows: Array<{
						chunkId: string;
						sourceId: string;
						title: string;
						url: string | null;
						updatedAt: number;
					}> = [];
					for (const chunkId of chunkIds) {
						const found = yield* sql<{
							id: string;
							source_id: string;
							title: string;
							url: string | null;
							updated_at: number;
						}>`
							SELECT chunks.id, documents.source_id, documents.title, documents.url, documents.updated_at
							FROM chunks JOIN documents ON documents.id = chunks.document_id
							WHERE chunks.id = ${chunkId}
						`;
						if (found[0]) {
							rows.push({
								chunkId: found[0].id,
								sourceId: found[0].source_id,
								title: found[0].title,
								url: found[0].url,
								updatedAt: found[0].updated_at,
							});
						}
					}
					return rows;
				}),
			memoryTimestamps: (memoryIds) =>
				Effect.gen(function* () {
					const rows: Array<{ id: string; createdAt: number }> = [];
					for (const id of memoryIds) {
						const found = yield* sql<{ id: string; created_at: number }>`
							SELECT id, created_at FROM memories WHERE id = ${id}
						`;
						if (found[0]) {
							rows.push({ id: found[0].id, createdAt: found[0].created_at });
						}
					}
					return rows;
				}),
			listSources: (userId) =>
				sql<{
					id: string;
					kind: Source["kind"];
					label: string;
				}>`SELECT id, kind, label FROM sources`.pipe(
					Effect.map((rows) =>
						rows.map((row) => ({
							id: row.id,
							userId,
							kind: row.kind,
							label: row.label,
						})),
					),
				),
			similarMemoryCandidates: (_excludeIds, limit) =>
				sql<MemoryRow>`SELECT * FROM memories ORDER BY created_at DESC LIMIT ${limit}`.pipe(
					Effect.map((rows) => rows.map(toMemory)),
				),
			listRecentMemories: (limit) =>
				sql<MemoryRow>`SELECT * FROM memories ORDER BY created_at DESC LIMIT ${limit}`.pipe(
					Effect.map((rows) => rows.map(toMemory)),
				),
			commit: (batch) =>
				sql.withTransaction(
					Effect.gen(function* () {
						const now = Date.now();
						yield* sql`
							INSERT INTO sources (id, kind, label, created_at)
							VALUES (${batch.source.id}, ${batch.source.kind}, ${batch.source.label}, ${now})
							ON CONFLICT(id) DO UPDATE SET label = excluded.label
						`;
						yield* sql`
							INSERT INTO documents (id, source_id, external_id, content_hash, title, markdown, url, r2_key, created_at, updated_at)
							VALUES (
								${batch.document.id}, ${batch.document.sourceId}, ${batch.document.externalId},
								${batch.document.contentHash}, ${batch.document.title}, ${batch.document.markdown},
								${batch.document.url}, ${batch.document.r2Key}, ${now}, ${now}
							)
							ON CONFLICT(id) DO UPDATE SET
								content_hash = excluded.content_hash,
								title = excluded.title,
								markdown = excluded.markdown,
								url = excluded.url,
								r2_key = excluded.r2_key,
								updated_at = excluded.updated_at
						`;
						const keepChunkIds = batch.chunks.map((chunk) => chunk.id);
						if (keepChunkIds.length === 0) {
							yield* sql`DELETE FROM chunks WHERE document_id = ${batch.document.id}`;
						} else {
							for (const chunk of yield* sql<{ id: string }>`
								SELECT id FROM chunks WHERE document_id = ${batch.document.id}
							`) {
								if (!keepChunkIds.includes(chunk.id)) {
									yield* sql`DELETE FROM memory_sources WHERE chunk_id = ${chunk.id}`;
									yield* sql`DELETE FROM chunks WHERE id = ${chunk.id}`;
								}
							}
						}
						for (const chunk of batch.chunks) {
							yield* sql`
								INSERT INTO chunks (id, document_id, text, content_hash, byte_start, byte_end)
								VALUES (${chunk.id}, ${batch.document.id}, ${chunk.text}, ${chunk.contentHash}, ${chunk.byteStart}, ${chunk.byteEnd})
								ON CONFLICT(id) DO UPDATE SET
									text = excluded.text,
									content_hash = excluded.content_hash,
									byte_start = excluded.byte_start,
									byte_end = excluded.byte_end
							`;
						}
						for (const memory of batch.memories) {
							if (memory.supersedes) {
								yield* sql`UPDATE memories SET valid_to = ${new Date(now).toISOString()} WHERE id = ${memory.supersedes}`;
							}
							yield* sql`
								INSERT INTO memories (id, kind, text, confidence, valid_from, valid_to, supersedes, created_at)
								VALUES (
									${memory.id}, ${memory.kind}, ${memory.text}, ${memory.confidence},
									${memory.validFrom}, ${memory.validTo}, ${memory.supersedes}, ${now}
								)
							`;
							for (const chunkId of memory.chunkIds) {
								yield* sql`
									INSERT OR IGNORE INTO memory_sources (memory_id, source_id, document_id, chunk_id)
									VALUES (${memory.id}, ${batch.source.id}, ${batch.document.id}, ${chunkId})
								`;
							}
						}
						const result: IngestResult = {
							documentId: batch.document.id,
							sourceId: batch.source.id,
							contentHash: batch.document.contentHash,
							unchanged: false,
							chunkCount: batch.chunks.length,
							memoryCount: batch.memories.length,
							skippedChunks: 0,
						};
						return result;
					}),
				),
			addMemory: (userId, input: AddMemoryRequest) =>
				Effect.gen(function* () {
					const now = Date.now();
					const sourceId = input.sourceId ?? `agent:${userId}`;
					const documentId = `${sourceId}:notes`;
					const chunkId = crypto.randomUUID();
					const memoryId = crypto.randomUUID();
					yield* sql`
						INSERT INTO sources (id, kind, label, created_at)
						VALUES (${sourceId}, ${"agent"}, ${"Agent writes"}, ${now})
						ON CONFLICT(id) DO NOTHING
					`;
					yield* sql`
						INSERT INTO documents (id, source_id, external_id, content_hash, title, markdown, url, r2_key, created_at, updated_at)
						VALUES (${documentId}, ${sourceId}, ${"notes"}, ${"agent"}, ${"Agent notes"}, ${input.text}, ${null}, ${`${userId}/${sourceId}/notes.json`}, ${now}, ${now})
						ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at
					`;
					yield* sql`
						INSERT INTO chunks (id, document_id, text, content_hash, byte_start, byte_end)
						VALUES (${chunkId}, ${documentId}, ${input.text}, ${memoryId}, ${0}, ${input.text.length})
					`;
					yield* sql`
						INSERT INTO memories (id, kind, text, confidence, valid_from, valid_to, supersedes, created_at)
						VALUES (${memoryId}, ${input.kind}, ${input.text}, ${input.confidence}, ${null}, ${null}, ${null}, ${now})
					`;
					yield* sql`
						INSERT INTO memory_sources (memory_id, source_id, document_id, chunk_id)
						VALUES (${memoryId}, ${sourceId}, ${documentId}, ${chunkId})
					`;
					return {
						id: memoryId,
						kind: input.kind,
						text: input.text,
						confidence: input.confidence,
						validFrom: null,
						validTo: null,
						supersedes: null,
					};
				}),
		});
	}),
);
