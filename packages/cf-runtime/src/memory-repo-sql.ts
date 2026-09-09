import type { Chunk, Document, IngestResult, Memory, Source } from "@yumeoi/domain";
import { fillMemory, NotFound } from "@yumeoi/domain";
import { MemoryRepo, newShortId } from "@yumeoi/memory";
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
	type?: Memory["type"] | null;
	state?: Memory["state"] | null;
	importance?: number | null;
	event_at?: number | null;
	observed_at?: number | null;
	updated_at?: number | null;
	last_accessed_at?: number | null;
	access_count?: number | null;
	retention?: number | null;
	origin?: Memory["origin"] | null;
	client_ref?: string | null;
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

const toMemory = (row: MemoryRow): Memory =>
	fillMemory({
		id: row.id,
		kind: row.kind,
		text: row.text,
		confidence: row.confidence,
		validFrom: row.valid_from,
		validTo: row.valid_to,
		supersedes: row.supersedes,
		type: row.type ?? undefined,
		state: row.state ?? undefined,
		importance: row.importance ?? undefined,
		eventAt: row.event_at ?? null,
		observedAt: row.observed_at ?? row.created_at,
		updatedAt: row.updated_at ?? row.created_at,
		lastAccessedAt: row.last_accessed_at ?? null,
		accessCount: row.access_count ?? 0,
		retention: row.retention ?? 1,
		origin: row.origin ?? "extracted",
		clientRef: row.client_ref ?? null,
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
					const clauses = [
						sql`memories_fts MATCH ${match}`,
						sql`memories.valid_to IS NULL`,
						sql`memories.state = ${"active"}`,
					];
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
					const clauses = [sql`valid_to IS NULL`, sql`state = ${"active"}`];
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
					SELECT * FROM memories
					WHERE valid_to IS NULL AND state = ${"active"}
					ORDER BY created_at DESC LIMIT ${limit}
				`.pipe(Effect.map((rows) => rows.map(toMemory))),
			listRecentMemories: (limit) =>
				sql<MemoryRow>`
					SELECT * FROM memories
					WHERE valid_to IS NULL AND state = ${"active"}
					ORDER BY created_at DESC LIMIT ${limit}
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
								yield* sql`UPDATE memories SET valid_to = ${new Date(now).toISOString()}, state = ${"superseded"} WHERE id = ${memory.supersedes}`;
							}
							const memoryType =
								memory.type ??
								(memory.kind === "event" || memory.kind === "task"
									? "episodic"
									: memory.kind === "procedure" || memory.kind === "rule"
										? "procedural"
										: "semantic");
							const memoryState = memory.state ?? "active";
							const importance = memory.importance ?? memory.confidence;
							yield* sql`
								INSERT INTO memories (
									id, kind, text, confidence, valid_from, valid_to, supersedes, created_at,
									type, state, importance, event_at, observed_at, updated_at, origin, client_ref
								)
								VALUES (
									${memory.id}, ${memory.kind}, ${memory.text}, ${memory.confidence},
									${memory.validFrom}, ${memory.validTo}, ${memory.supersedes}, ${now},
									${memoryType}, ${memoryState}, ${importance}, ${memory.eventAt ?? null},
									${now}, ${now}, ${memory.origin ?? "extracted"}, ${memory.clientRef ?? null}
								)
							`;
							if (memory.supersedes) {
								yield* sql`
									INSERT OR IGNORE INTO memory_edges (src, dst, relation, created_at)
									VALUES (${memory.id}, ${memory.supersedes}, ${"supersedes"}, ${now})
								`;
							}
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
			insertMemory: (userId, input, options) =>
				Effect.gen(function* () {
					const now = Date.now();
					const sourceId = input.sourceId ?? `agent:${userId}`;
					const documentId = input.documentId ?? `${sourceId}:notes`;
					const chunkId = input.chunkId ?? crypto.randomUUID();
					const memoryId = input.id ?? newShortId("m");
					const supersedes = options?.supersedes ?? null;
					const memoryType =
						input.type ??
						(input.kind === "event" || input.kind === "task"
							? "episodic"
							: input.kind === "procedure" || input.kind === "rule"
								? "procedural"
								: "semantic");
					const memoryState = input.state ?? (input.validTo ? "superseded" : "active");
					if (supersedes) {
						yield* sql`UPDATE memories SET valid_to = ${new Date(now).toISOString()}, state = ${"superseded"} WHERE id = ${supersedes}`;
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
						ON CONFLICT(id) DO NOTHING
					`;
					yield* sql`
						INSERT INTO memories (
							id, kind, text, confidence, valid_from, valid_to, supersedes, created_at,
							type, state, importance, event_at, observed_at, updated_at, origin, client_ref
						)
						VALUES (
							${memoryId}, ${input.kind}, ${input.text}, ${input.confidence},
							${input.validFrom ?? null}, ${input.validTo ?? null}, ${supersedes}, ${now},
							${memoryType}, ${memoryState}, ${input.importance ?? input.confidence},
							${input.eventAt ?? null}, ${now}, ${now}, ${input.origin ?? "agent"},
							${input.clientRef ?? null}
						)
					`;
					yield* sql`
						INSERT INTO memory_sources (memory_id, source_id, document_id, chunk_id)
						VALUES (${memoryId}, ${sourceId}, ${documentId}, ${chunkId})
					`;
					if (supersedes) {
						yield* sql`
							INSERT OR IGNORE INTO memory_edges (src, dst, relation, created_at)
							VALUES (${memoryId}, ${supersedes}, ${"supersedes"}, ${now})
						`;
					}
					const rows = yield* sql<MemoryRow>`SELECT * FROM memories WHERE id = ${memoryId} LIMIT 1`;
					const row = rows[0];
					return row
						? toMemory(row)
						: fillMemory({
								id: memoryId,
								kind: input.kind,
								text: input.text,
								confidence: input.confidence,
								validFrom: input.validFrom ?? null,
								validTo: input.validTo ?? null,
								supersedes,
								type: memoryType,
								state: memoryState,
								origin: input.origin ?? "agent",
								clientRef: input.clientRef ?? null,
							});
				}),
			updateMemory: (id, patch) =>
				Effect.gen(function* () {
					const now = Date.now();
					if (patch.text !== undefined) {
						yield* sql`UPDATE memories SET text = ${patch.text}, updated_at = ${now} WHERE id = ${id}`;
					}
					if (patch.validTo !== undefined) {
						yield* sql`UPDATE memories SET valid_to = ${patch.validTo}, updated_at = ${now} WHERE id = ${id}`;
					}
					if (patch.state !== undefined) {
						yield* sql`UPDATE memories SET state = ${patch.state}, updated_at = ${now} WHERE id = ${id}`;
					}
					if (patch.confidence !== undefined) {
						yield* sql`UPDATE memories SET confidence = ${patch.confidence}, updated_at = ${now} WHERE id = ${id}`;
					}
					if (patch.importance !== undefined) {
						yield* sql`UPDATE memories SET importance = ${patch.importance}, updated_at = ${now} WHERE id = ${id}`;
					}
					const rows = yield* sql<MemoryRow>`SELECT * FROM memories WHERE id = ${id} LIMIT 1`;
					const row = rows[0];
					if (!row) {
						return yield* Effect.fail(new NotFound({ entity: "memory", id }));
					}
					return toMemory(row);
				}),
			insertEdge: (src, dst, relation) =>
				sql`
					INSERT OR IGNORE INTO memory_edges (src, dst, relation, created_at)
					VALUES (${src}, ${dst}, ${relation}, ${Date.now()})
				`.pipe(Effect.asVoid),
			insertHistory: (row) =>
				sql`
					INSERT INTO memory_history (
						id, memory_id, text, type, kind, confidence, valid_from, valid_to, state, changed_at, reason
					) VALUES (
						${crypto.randomUUID()}, ${row.memoryId}, ${row.text}, ${row.type}, ${row.kind},
						${row.confidence}, ${row.validFrom}, ${row.validTo}, ${row.state}, ${Date.now()}, ${row.reason}
					)
				`.pipe(Effect.asVoid),
			getMemoryByClientRef: (clientRef) =>
				Effect.gen(function* () {
					const rows = yield* sql<MemoryRow>`
						SELECT * FROM memories WHERE client_ref = ${clientRef} LIMIT 1
					`;
					const row = rows[0];
					return row ? toMemory(row) : null;
				}),
			upsertEntity: (input) =>
				Effect.gen(function* () {
					const existing = yield* sql<{ id: string }>`
						SELECT id FROM entities WHERE canonical = ${input.canonical} AND type = ${input.type} LIMIT 1
					`;
					const found = existing[0];
					if (found) {
						yield* sql`
							UPDATE entities SET last_seen = ${input.now}, mention_count = mention_count + 1
							WHERE id = ${found.id}
						`;
						return { id: found.id };
					}
					const id = newShortId("e");
					yield* sql`
						INSERT INTO entities (id, name, canonical, type, description, first_seen, last_seen, mention_count, state)
						VALUES (${id}, ${input.name}, ${input.canonical}, ${input.type}, ${null}, ${input.now}, ${input.now}, ${1}, ${"active"})
					`;
					return { id };
				}),
			linkMemoryEntity: (memoryId, entityId, role) =>
				sql`
					INSERT OR IGNORE INTO memory_entities (memory_id, entity_id, role)
					VALUES (${memoryId}, ${entityId}, ${role})
				`.pipe(Effect.asVoid),
			listMemoriesPage: (options) =>
				Effect.gen(function* () {
					const clauses = options.activeOnly
						? [sql`valid_to IS NULL`, sql`state = ${"active"}`]
						: [];
					if (options.afterId) {
						clauses.push(sql`id > ${options.afterId}`);
					}
					const rows =
						clauses.length > 0
							? yield* sql<MemoryRow>`
								SELECT * FROM memories WHERE ${sql.and(clauses)}
								ORDER BY id LIMIT ${options.limit}
							`
							: yield* sql<MemoryRow>`
								SELECT * FROM memories ORDER BY id LIMIT ${options.limit}
							`;
					return rows.map(toMemory);
				}),
			listChunksPage: (options) =>
				Effect.gen(function* () {
					const rows = options.afterId
						? yield* sql<ChunkRow & { source_id: string }>`
							SELECT chunks.*, documents.source_id FROM chunks
							JOIN documents ON documents.id = chunks.document_id
							WHERE chunks.id > ${options.afterId}
							ORDER BY chunks.id LIMIT ${options.limit}
						`
						: yield* sql<ChunkRow & { source_id: string }>`
							SELECT chunks.*, documents.source_id FROM chunks
							JOIN documents ON documents.id = chunks.document_id
							ORDER BY chunks.id LIMIT ${options.limit}
						`;
					return rows.map((row) => ({ ...toChunk(row), sourceId: row.source_id }));
				}),
			listInactiveMemoryIds: () =>
				sql<{ id: string }>`
					SELECT id FROM memories WHERE valid_to IS NOT NULL OR state != ${"active"}
				`.pipe(Effect.map((rows) => rows.map((row) => row.id))),
		});
	}),
);
