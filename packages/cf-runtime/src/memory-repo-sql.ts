import type {
	AddMemoryRequest,
	Chunk,
	Document,
	IngestResult,
	Memory,
	Source,
} from "@yumeoi/domain";
import { NotFound } from "@yumeoi/domain";
import { MemoryRepo } from "@yumeoi/memory";
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
					const clauses = [sql`memories_fts MATCH ${match}`, sql`memories.valid_to IS NULL`];
					if (filters.kinds.length > 0) {
						clauses.push(sql.in("memories.kind", [...filters.kinds]));
					}
					if (filters.since !== null) {
						clauses.push(sql`memories.created_at >= ${filters.since}`);
					}
					if (filters.sources.length > 0) {
						clauses.push(sql`EXISTS (
							SELECT 1 FROM memory_sources
							WHERE memory_sources.memory_id = memories.id
							AND ${sql.in("memory_sources.source_id", [...filters.sources])}
						)`);
					}
					const rows = yield* sql<{ id: string }>`
						SELECT memories.id
						FROM memories_fts
						JOIN memories ON memories.rowid = memories_fts.rowid
						WHERE ${sql.and(clauses)}
						ORDER BY rank
						LIMIT ${filters.limit}
					`;
					return rows.map((row, rank) => ({ id: row.id, rank }));
				}),
			searchChunkFts: (match, filters) =>
				Effect.gen(function* () {
					const clauses = [sql`chunks_fts MATCH ${match}`];
					if (filters.sources.length > 0) {
						clauses.push(sql.in("documents.source_id", [...filters.sources]));
					}
					const rows = yield* sql<{ id: string }>`
						SELECT chunks.id
						FROM chunks_fts
						JOIN chunks ON chunks.rowid = chunks_fts.rowid
						JOIN documents ON documents.id = chunks.document_id
						WHERE ${sql.and(clauses)}
						ORDER BY rank
						LIMIT ${filters.limit}
					`;
					return rows.map((row, rank) => ({ id: row.id, rank }));
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
					const found = yield* sql<MemoryRow>`
						SELECT * FROM memories WHERE ${sql.in("id", [...ids])}
					`;
					const byId = new Map(found.map((row) => [row.id, toMemory(row)]));
					return ids.flatMap((id) => {
						const memory = byId.get(id);
						return memory ? [memory] : [];
					});
				}),
			listChunksByIds: (ids) =>
				Effect.gen(function* () {
					if (ids.length === 0) {
						return [];
					}
					const found = yield* sql<ChunkRow>`
						SELECT * FROM chunks WHERE ${sql.in("id", [...ids])}
					`;
					const byId = new Map(found.map((row) => [row.id, toChunk(row)]));
					return ids.flatMap((id) => {
						const chunk = byId.get(id);
						return chunk ? [chunk] : [];
					});
				}),
			provenanceFor: (memoryIds) =>
				Effect.gen(function* () {
					if (memoryIds.length === 0) {
						return [];
					}
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
						WHERE ${sql.in("memory_sources.memory_id", [...memoryIds])}
					`;
					return found.map((row) => ({
						memoryId: row.memory_id,
						sourceId: row.source_id,
						documentId: row.document_id,
						chunkId: row.chunk_id,
						title: row.title,
						url: row.url,
					}));
				}),
			chunkMeta: (chunkIds) =>
				Effect.gen(function* () {
					if (chunkIds.length === 0) {
						return [];
					}
					const found = yield* sql<{
						id: string;
						source_id: string;
						title: string;
						url: string | null;
						updated_at: number;
					}>`
						SELECT chunks.id, documents.source_id, documents.title, documents.url, documents.updated_at
						FROM chunks JOIN documents ON documents.id = chunks.document_id
						WHERE ${sql.in("chunks.id", [...chunkIds])}
					`;
					const byId = new Map(
						found.map((row) => [
							row.id,
							{
								chunkId: row.id,
								sourceId: row.source_id,
								title: row.title,
								url: row.url,
								updatedAt: row.updated_at,
							},
						]),
					);
					return chunkIds.flatMap((id) => {
						const meta = byId.get(id);
						return meta ? [meta] : [];
					});
				}),
			memoryTimestamps: (memoryIds) =>
				Effect.gen(function* () {
					if (memoryIds.length === 0) {
						return [];
					}
					const found = yield* sql<{ id: string; created_at: number }>`
						SELECT id, created_at FROM memories WHERE ${sql.in("id", [...memoryIds])}
					`;
					const byId = new Map(found.map((row) => [row.id, row.created_at]));
					return memoryIds.flatMap((id) => {
						const createdAt = byId.get(id);
						return createdAt !== undefined ? [{ id, createdAt }] : [];
					});
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
			upsertSource: (source) =>
				sql`
					INSERT INTO sources (id, kind, label, created_at)
					VALUES (${source.id}, ${source.kind}, ${source.label}, ${Date.now()})
					ON CONFLICT(id) DO UPDATE SET label = excluded.label, kind = excluded.kind
				`.pipe(Effect.asVoid),
			listMemories: (filters) =>
				Effect.gen(function* () {
					const clauses = [sql`valid_to IS NULL`];
					if (filters.kinds.length > 0) {
						clauses.push(sql.in("kind", [...filters.kinds]));
					}
					if (filters.since !== null) {
						clauses.push(sql`created_at >= ${filters.since}`);
					}
					if (filters.sources.length > 0) {
						clauses.push(sql`EXISTS (
							SELECT 1 FROM memory_sources
							WHERE memory_sources.memory_id = memories.id
							AND ${sql.in("memory_sources.source_id", [...filters.sources])}
						)`);
					}
					const rows = yield* sql<MemoryRow>`
						SELECT * FROM memories
						WHERE ${sql.and(clauses)}
						ORDER BY created_at DESC
						LIMIT ${filters.limit}
					`;
					return rows.map(toMemory);
				}),
			similarMemoryCandidates: (_excludeIds, limit) =>
				sql<MemoryRow>`
					SELECT * FROM memories WHERE valid_to IS NULL ORDER BY created_at DESC LIMIT ${limit}
				`.pipe(Effect.map((rows) => rows.map(toMemory))),
			listRecentMemories: (limit) =>
				sql<MemoryRow>`
					SELECT * FROM memories WHERE valid_to IS NULL ORDER BY created_at DESC LIMIT ${limit}
				`.pipe(Effect.map((rows) => rows.map(toMemory))),
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
						let orphanCount = 0;
						if (keepChunkIds.length === 0) {
							const affected = yield* sql<{ memory_id: string }>`
								SELECT DISTINCT memory_id FROM memory_sources
								WHERE document_id = ${batch.document.id}
							`;
							yield* sql`DELETE FROM memory_sources WHERE document_id = ${batch.document.id}`;
							yield* sql`DELETE FROM chunks WHERE document_id = ${batch.document.id}`;
							if (affected.length > 0) {
								const remaining = yield* sql<{ memory_id: string }>`
									SELECT DISTINCT memory_id FROM memory_sources
									WHERE ${sql.in(
										"memory_id",
										affected.map((row) => row.memory_id),
									)}
								`;
								const linked = new Set(remaining.map((row) => row.memory_id));
								orphanCount = affected.filter((row) => !linked.has(row.memory_id)).length;
							}
						} else {
							const existingChunks = yield* sql<{ id: string }>`
								SELECT id FROM chunks WHERE document_id = ${batch.document.id}
							`;
							const dropped = existingChunks
								.map((chunk) => chunk.id)
								.filter((id) => !keepChunkIds.includes(id));
							if (dropped.length > 0) {
								const affected = yield* sql<{ memory_id: string }>`
									SELECT DISTINCT memory_id FROM memory_sources
									WHERE ${sql.in("chunk_id", dropped)}
								`;
								yield* sql`DELETE FROM memory_sources WHERE ${sql.in("chunk_id", dropped)}`;
								yield* sql`DELETE FROM chunks WHERE ${sql.in("id", dropped)}`;
								if (affected.length > 0) {
									const remaining = yield* sql<{ memory_id: string }>`
										SELECT DISTINCT memory_id FROM memory_sources
										WHERE ${sql.in(
											"memory_id",
											affected.map((row) => row.memory_id),
										)}
									`;
									const linked = new Set(remaining.map((row) => row.memory_id));
									orphanCount = affected.filter((row) => !linked.has(row.memory_id)).length;
								}
							}
						}
						if (orphanCount > 0) {
							yield* Effect.log(
								`ingest orphaned ${orphanCount} memories on document ${batch.document.id}`,
							);
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
			addMemory: (userId, input: AddMemoryRequest, options) =>
				Effect.gen(function* () {
					const now = Date.now();
					const sourceId = input.sourceId ?? `agent:${userId}`;
					const documentId = `${sourceId}:notes`;
					const chunkId = crypto.randomUUID();
					const memoryId = crypto.randomUUID();
					const supersedes = options?.supersedes ?? null;
					if (supersedes) {
						yield* sql`UPDATE memories SET valid_to = ${new Date(now).toISOString()} WHERE id = ${supersedes}`;
					}
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
						VALUES (${memoryId}, ${input.kind}, ${input.text}, ${input.confidence}, ${null}, ${null}, ${supersedes}, ${now})
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
						supersedes,
					};
				}),
		});
	}),
);
