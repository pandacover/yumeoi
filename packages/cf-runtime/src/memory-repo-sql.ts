import type { Chunk, Document, IngestResult, Memory, Source } from "@yumeoi/domain";
import { fillMemory, NotFound } from "@yumeoi/domain";
import { MemoryRepo, newShortId } from "@yumeoi/memory";
import { Effect, Layer } from "effect";
import { SqlClient } from "effect/unstable/sql/SqlClient";
import type { Fragment } from "effect/unstable/sql/Statement";

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
		...(row.type ? { type: row.type } : {}),
		...(row.state ? { state: row.state } : {}),
		...(row.importance != null ? { importance: row.importance } : {}),
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

		const hydrateMemories = (memories: ReadonlyArray<Memory>) =>
			Effect.gen(function* () {
				if (memories.length === 0) {
					return memories;
				}
				const rows = yield* sql<{
					memory_id: string;
					entity_id: string;
					name: string;
					type: import("@yumeoi/domain").EntityType;
				}>`
					SELECT memory_entities.memory_id, entities.id AS entity_id, entities.name, entities.type
					FROM memory_entities
					JOIN entities ON entities.id = memory_entities.entity_id
					WHERE ${sql.in(
						"memory_entities.memory_id",
						memories.map((memory) => memory.id),
					)}
				`;
				const byMemory = new Map<string, Memory["entities"][number][]>();
				for (const row of rows) {
					const list = byMemory.get(row.memory_id) ?? [];
					list.push({ id: row.entity_id, name: row.name, type: row.type });
					byMemory.set(row.memory_id, list);
				}
				return memories.map((memory) => ({
					...memory,
					entities: byMemory.get(memory.id) ?? [],
				}));
			});

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
					const clauses: Array<Fragment> = [sql`memories_fts MATCH ${match}`];
					const asOf = filters.asOf ?? null;
					if (asOf != null) {
						clauses.push(sql`memories.observed_at <= ${asOf}`);
						clauses.push(
							sql`(memories.valid_to IS NULL OR memories.valid_to > ${new Date(asOf).toISOString()})`,
						);
					} else {
						clauses.push(sql`memories.valid_to IS NULL`);
						if (filters.includeDormant) {
							clauses.push(sql`(memories.state = ${"active"} OR memories.state = ${"dormant"})`);
						} else {
							clauses.push(sql`memories.state = ${"active"}`);
						}
					}
					if (filters.kinds.length > 0) {
						clauses.push(sql.in("memories.kind", [...filters.kinds]));
					}
					if (filters.types && filters.types.length > 0) {
						clauses.push(sql.in("memories.type", [...filters.types]));
					}
					if (filters.since !== null) {
						clauses.push(
							sql`COALESCE(memories.event_at, memories.observed_at, memories.created_at) >= ${filters.since}`,
						);
					}
					if (filters.from != null) {
						clauses.push(
							sql`COALESCE(memories.event_at, memories.observed_at, memories.created_at) >= ${filters.from}`,
						);
					}
					if (filters.to != null) {
						clauses.push(
							sql`COALESCE(memories.event_at, memories.observed_at, memories.created_at) <= ${filters.to}`,
						);
					}
					if (filters.sources.length > 0) {
						clauses.push(sql`EXISTS (
							SELECT 1 FROM memory_sources
							WHERE memory_sources.memory_id = memories.id
							AND ${sql.in("memory_sources.source_id", [...filters.sources])}
						)`);
					}
					const rows = yield* sql<{ id: string; bm25: number }>`
						SELECT memories.id, bm25(memories_fts) AS bm25
						FROM memories_fts
						JOIN memories ON memories.rowid = memories_fts.rowid
						WHERE ${sql.and(clauses)}
						ORDER BY bm25(memories_fts)
						LIMIT ${filters.limit}
					`;
					return rows.map((row, rank) => ({ id: row.id, rank, bm25: row.bm25 }));
				}),
			searchChunkFts: (match, filters) =>
				Effect.gen(function* () {
					const clauses: Array<Fragment> = [sql`chunks_fts MATCH ${match}`];
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
					const live = rows[0];
					if (live) {
						const [hydrated] = yield* hydrateMemories([toMemory(live)]);
						return hydrated ?? toMemory(live);
					}
					const archived = yield* sql<MemoryRow>`
						SELECT * FROM memories_archive WHERE id = ${id} LIMIT 1
					`;
					const row = archived[0];
					if (!row) {
						return yield* Effect.fail(new NotFound({ entity: "memory", id }));
					}
					const [hydrated] = yield* hydrateMemories([toMemory(row)]);
					return hydrated ?? toMemory(row);
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
					return yield* hydrateMemories(
						ids.flatMap((id) => {
							const memory = byId.get(id);
							return memory ? [memory] : [];
						}),
					);
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
					const clauses: Array<Fragment> = [sql`valid_to IS NULL`, sql`state = ${"active"}`];
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
					return yield* hydrateMemories(rows.map(toMemory));
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
						let orphanIds: string[] = [];
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
								orphanIds = affected.map((row) => row.memory_id).filter((id) => !linked.has(id));
								orphanCount = orphanIds.length;
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
									orphanIds = affected.map((row) => row.memory_id).filter((id) => !linked.has(id));
									orphanCount = orphanIds.length;
								}
							}
						}
						if (orphanCount > 0) {
							yield* Effect.log(
								`ingest orphaned ${orphanCount} memories on document ${batch.document.id}`,
							);
							const superseded = new Set(
								batch.memories.flatMap((memory) => (memory.supersedes ? [memory.supersedes] : [])),
							);
							for (const id of orphanIds) {
								if (superseded.has(id)) {
									continue;
								}
								yield* sql`
									UPDATE memories SET state = ${"dormant"}, updated_at = ${now}
									WHERE id = ${id} AND state = ${"active"}
								`;
								const rows = yield* sql<MemoryRow>`SELECT * FROM memories WHERE id = ${id} LIMIT 1`;
								const row = rows[0];
								if (row) {
									yield* sql`
										INSERT INTO memory_history (
											id, memory_id, text, type, kind, confidence, valid_from, valid_to, state, changed_at, reason
										) VALUES (
											${crypto.randomUUID()}, ${id}, ${row.text}, ${row.type ?? "semantic"}, ${row.kind},
											${row.confidence}, ${row.valid_from}, ${row.valid_to}, ${"dormant"}, ${now}, ${"source_removed"}
										)
									`;
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
							${input.eventAt ?? null}, ${input.observedAt ?? now}, ${now}, ${input.origin ?? "agent"},
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
					if (patch.kind !== undefined) {
						yield* sql`UPDATE memories SET kind = ${patch.kind}, updated_at = ${now} WHERE id = ${id}`;
					}
					if (patch.eventAt !== undefined) {
						yield* sql`UPDATE memories SET event_at = ${patch.eventAt}, updated_at = ${now} WHERE id = ${id}`;
					}
					if (patch.observedAt !== undefined) {
						yield* sql`UPDATE memories SET observed_at = ${patch.observedAt}, updated_at = ${now} WHERE id = ${id}`;
					}
					if (patch.retention !== undefined) {
						yield* sql`UPDATE memories SET retention = ${patch.retention}, updated_at = ${now} WHERE id = ${id}`;
					}
					if (patch.origin !== undefined) {
						yield* sql`UPDATE memories SET origin = ${patch.origin}, updated_at = ${now} WHERE id = ${id}`;
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
			linkProvenance: (input) =>
				sql`
					INSERT OR IGNORE INTO memory_sources (memory_id, source_id, document_id, chunk_id)
					VALUES (${input.memoryId}, ${input.sourceId}, ${input.documentId}, ${input.chunkId})
				`.pipe(Effect.asVoid),
			ensureLinkedProvenance: (input) =>
				Effect.gen(function* () {
					const now = Date.now();
					const sourceId = input.sourceId;
					const documentId = input.documentId ?? `${sourceId}:notes`;
					const chunkId = input.chunkId ?? crypto.randomUUID();
					yield* sql`
						INSERT INTO sources (id, kind, label, created_at)
						VALUES (${sourceId}, ${"agent"}, ${"Agent writes"}, ${now})
						ON CONFLICT(id) DO NOTHING
					`;
					yield* sql`
						INSERT INTO documents (id, source_id, external_id, content_hash, title, markdown, url, r2_key, created_at, updated_at)
						VALUES (${documentId}, ${sourceId}, ${"notes"}, ${"agent"}, ${"Agent notes"}, ${input.text}, ${null}, ${`${input.userId}/${sourceId}/notes.json`}, ${now}, ${now})
						ON CONFLICT(id) DO NOTHING
					`;
					yield* sql`
						INSERT INTO chunks (id, document_id, text, content_hash, byte_start, byte_end)
						VALUES (${chunkId}, ${documentId}, ${input.text}, ${input.memoryId}, ${0}, ${input.text.length})
						ON CONFLICT(id) DO NOTHING
					`;
					yield* sql`
						INSERT OR IGNORE INTO memory_sources (memory_id, source_id, document_id, chunk_id)
						VALUES (${input.memoryId}, ${sourceId}, ${documentId}, ${chunkId})
					`;
				}),
			insertHistory: (row) =>
				sql`
					INSERT INTO memory_history (
						id, memory_id, text, type, kind, confidence, valid_from, valid_to, state, changed_at, reason
					) VALUES (
						${crypto.randomUUID()}, ${row.memoryId}, ${row.text}, ${row.type}, ${row.kind},
						${row.confidence}, ${row.validFrom}, ${row.validTo}, ${row.state}, ${row.changedAt ?? Date.now()}, ${row.reason}
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
						const counts = yield* sql<{ mention_count: number }>`
							SELECT mention_count FROM entities WHERE id = ${found.id} LIMIT 1
						`;
						return { id: found.id, mentionCount: counts[0]?.mention_count ?? 1 };
					}
					const id = newShortId("e");
					yield* sql`
						INSERT INTO entities (id, name, canonical, type, description, first_seen, last_seen, mention_count, state)
						VALUES (${id}, ${input.name}, ${input.canonical}, ${input.type}, ${null}, ${input.now}, ${input.now}, ${1}, ${"active"})
					`;
					return { id, mentionCount: 1 };
				}),
			linkMemoryEntity: (memoryId, entityId, role) =>
				sql`
					INSERT OR IGNORE INTO memory_entities (memory_id, entity_id, role)
					VALUES (${memoryId}, ${entityId}, ${role})
				`.pipe(Effect.asVoid),
			setEntityDescription: (id, description) =>
				sql`UPDATE entities SET description = ${description} WHERE id = ${id}`.pipe(Effect.asVoid),
			listMemoriesPage: (options) =>
				Effect.gen(function* () {
					const clauses: Array<Fragment> = options.activeOnly
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
			recordAccess: (ids, at) =>
				Effect.gen(function* () {
					if (ids.length === 0) {
						return;
					}
					yield* sql`
						UPDATE memories
						SET access_count = access_count + 1,
							last_accessed_at = ${at},
							state = CASE WHEN state = ${"dormant"} THEN ${"active"} ELSE state END
						WHERE ${sql.in("id", [...ids])}
					`;
				}),
			listByEntities: (entityIds, filters) =>
				Effect.gen(function* () {
					if (entityIds.length === 0) {
						return [];
					}
					const clauses: Array<Fragment> = [sql.in("memory_entities.entity_id", [...entityIds])];
					if (filters.asOf != null) {
						clauses.push(sql`memories.observed_at <= ${filters.asOf}`);
						clauses.push(
							sql`(memories.valid_to IS NULL OR memories.valid_to > ${new Date(filters.asOf).toISOString()})`,
						);
					} else {
						clauses.push(sql`memories.state = ${"active"}`);
					}
					if (filters.kinds.length > 0) {
						clauses.push(sql.in("memories.kind", [...filters.kinds]));
					}
					if (filters.types && filters.types.length > 0) {
						clauses.push(sql.in("memories.type", [...filters.types]));
					}
					if (filters.sources.length > 0) {
						clauses.push(sql`EXISTS (
							SELECT 1 FROM memory_sources
							WHERE memory_sources.memory_id = memories.id
							AND ${sql.in("memory_sources.source_id", [...filters.sources])}
						)`);
					}
					const rows = yield* sql<{ id: string }>`
						SELECT DISTINCT memories.id
						FROM memories
						JOIN memory_entities ON memory_entities.memory_id = memories.id
						WHERE ${sql.and(clauses)}
						LIMIT ${filters.limit}
					`;
					return rows.map((row, rank) => ({ id: row.id, rank }));
				}),
			listRecentEpisodic: (sinceEventAt, limit) =>
				Effect.gen(function* () {
					const rows = yield* sql<MemoryRow>`
						SELECT * FROM memories
						WHERE type = ${"episodic"}
						AND state = ${"active"}
						AND COALESCE(event_at, observed_at, created_at) >= ${sinceEventAt}
						ORDER BY COALESCE(event_at, observed_at, created_at) DESC
						LIMIT ${limit}
					`;
					return yield* hydrateMemories(rows.map(toMemory));
				}),
			listEdges: (ids) =>
				Effect.gen(function* () {
					if (ids.length === 0) {
						return [];
					}
					const rows = yield* sql<{ src: string; dst: string; relation: string }>`
						SELECT src, dst, relation FROM memory_edges
						WHERE ${sql.in("src", [...ids])} OR ${sql.in("dst", [...ids])}
					`;
					return rows;
				}),
			listHistory: (memoryId) =>
				sql<{
					id: string;
					memory_id: string;
					text: string;
					type: Memory["type"];
					kind: Memory["kind"];
					confidence: number;
					valid_from: string | null;
					valid_to: string | null;
					state: Memory["state"];
					changed_at: number;
					reason: string;
				}>`
					SELECT * FROM memory_history WHERE memory_id = ${memoryId} ORDER BY changed_at
				`.pipe(
					Effect.map((rows) =>
						rows.map((row) => ({
							id: row.id,
							memoryId: row.memory_id,
							text: row.text,
							type: row.type,
							kind: row.kind,
							confidence: row.confidence,
							validFrom: row.valid_from,
							validTo: row.valid_to,
							state: row.state,
							changedAt: row.changed_at,
							reason: row.reason,
						})),
					),
				),
			insertFeedback: (row) =>
				sql`
					INSERT INTO memory_feedback (id, memory_id, client_id, signal, note, created_at)
					VALUES (${crypto.randomUUID()}, ${row.memoryId}, ${row.clientId}, ${row.signal}, ${row.note ?? null}, ${Date.now()})
				`.pipe(Effect.asVoid),
			getQueryPlan: (hash, now) =>
				Effect.gen(function* () {
					const rows = yield* sql<{ plan: string; expires_at: number }>`
						SELECT plan, expires_at FROM query_cache WHERE hash = ${hash} LIMIT 1
					`;
					const row = rows[0];
					if (!row || row.expires_at < now) {
						return null;
					}
					try {
						return JSON.parse(row.plan) as import("@yumeoi/domain").QueryPlan;
					} catch {
						return null;
					}
				}),
			putQueryPlan: (hash, plan, expiresAt) =>
				sql`
					INSERT OR REPLACE INTO query_cache (hash, plan, expires_at)
					VALUES (${hash}, ${JSON.stringify(plan)}, ${expiresAt})
				`.pipe(Effect.asVoid),
			findEntity: (canonical, type) =>
				Effect.gen(function* () {
					const rows = type
						? yield* sql<{
								id: string;
								name: string;
								canonical: string;
								type: import("@yumeoi/domain").EntityType;
								description: string | null;
								mention_count: number;
							}>`
								SELECT id, name, canonical, type, description, mention_count
								FROM entities WHERE canonical = ${canonical} AND type = ${type} LIMIT 1
							`
						: yield* sql<{
								id: string;
								name: string;
								canonical: string;
								type: import("@yumeoi/domain").EntityType;
								description: string | null;
								mention_count: number;
							}>`
								SELECT id, name, canonical, type, description, mention_count
								FROM entities WHERE canonical = ${canonical} LIMIT 1
							`;
					const row = rows[0];
					return row
						? {
								id: row.id,
								name: row.name,
								canonical: row.canonical,
								type: row.type,
								description: row.description,
								mentionCount: row.mention_count,
							}
						: null;
				}),
			findEntityByAlias: (alias) =>
				Effect.gen(function* () {
					const rows = yield* sql<{ entity_id: string }>`
						SELECT entity_id FROM entity_aliases WHERE alias = ${alias} LIMIT 1
					`;
					const id = rows[0]?.entity_id;
					if (!id) {
						return null;
					}
					const entities = yield* sql<{
						id: string;
						name: string;
						canonical: string;
						type: import("@yumeoi/domain").EntityType;
						description: string | null;
						mention_count: number;
					}>`
						SELECT id, name, canonical, type, description, mention_count
						FROM entities WHERE id = ${id} LIMIT 1
					`;
					const row = entities[0];
					return row
						? {
								id: row.id,
								name: row.name,
								canonical: row.canonical,
								type: row.type,
								description: row.description,
								mentionCount: row.mention_count,
							}
						: null;
				}),
			getEntity: (id) =>
				Effect.gen(function* () {
					const rows = yield* sql<{
						id: string;
						name: string;
						canonical: string;
						type: import("@yumeoi/domain").EntityType;
						description: string | null;
						mention_count: number;
					}>`
						SELECT id, name, canonical, type, description, mention_count
						FROM entities WHERE id = ${id} LIMIT 1
					`;
					const row = rows[0];
					return row
						? {
								id: row.id,
								name: row.name,
								canonical: row.canonical,
								type: row.type,
								description: row.description,
								mentionCount: row.mention_count,
							}
						: null;
				}),
			listEntities: () =>
				sql<{
					id: string;
					name: string;
					canonical: string;
					type: import("@yumeoi/domain").EntityType;
					description: string | null;
					mention_count: number;
				}>`
					SELECT id, name, canonical, type, description, mention_count FROM entities
					WHERE state = ${"active"} ORDER BY mention_count DESC LIMIT 100
				`.pipe(
					Effect.map((rows) =>
						rows.map((row) => ({
							id: row.id,
							name: row.name,
							canonical: row.canonical,
							type: row.type,
							description: row.description,
							mentionCount: row.mention_count,
						})),
					),
				),
			putAlias: (alias, entityId) =>
				sql`
					INSERT OR REPLACE INTO entity_aliases (alias, entity_id) VALUES (${alias}, ${entityId})
				`.pipe(Effect.asVoid),
			upsertRelation: (input) =>
				Effect.gen(function* () {
					const open = yield* sql<{ id: string; dst_entity: string }>`
						SELECT id, dst_entity FROM relations
						WHERE src_entity = ${input.srcEntity} AND predicate = ${input.predicate}
						AND valid_to IS NULL LIMIT 1
					`;
					const current = open[0];
					if (current && current.dst_entity !== input.dstEntity) {
						yield* sql`
							UPDATE relations SET valid_to = ${new Date(input.now).toISOString()} WHERE id = ${current.id}
						`;
					}
					const existing = yield* sql<{ id: string }>`
						SELECT id FROM relations
						WHERE src_entity = ${input.srcEntity} AND dst_entity = ${input.dstEntity}
						AND predicate = ${input.predicate} AND valid_to IS NULL LIMIT 1
					`;
					if (existing[0]) {
						return { id: existing[0].id };
					}
					const id = newShortId("r");
					yield* sql`
						INSERT INTO relations (id, src_entity, dst_entity, predicate, memory_id, valid_from, valid_to, confidence, created_at)
						VALUES (${id}, ${input.srcEntity}, ${input.dstEntity}, ${input.predicate}, ${input.memoryId}, ${input.validFrom}, ${null}, ${input.confidence}, ${input.now})
					`;
					return { id };
				}),
			listRelations: (entityIds, asOf) =>
				Effect.gen(function* () {
					if (entityIds.length === 0) {
						return [];
					}
					const rows = yield* sql<{
						id: string;
						src_entity: string;
						dst_entity: string;
						predicate: string;
						memory_id: string;
						valid_from: string | null;
						valid_to: string | null;
					}>`
						SELECT id, src_entity, dst_entity, predicate, memory_id, valid_from, valid_to
						FROM relations
						WHERE (${sql.in("src_entity", [...entityIds])} OR ${sql.in("dst_entity", [...entityIds])})
					`;
					return rows
						.filter((row) => {
							const from = row.valid_from ? Date.parse(row.valid_from) : null;
							const to = row.valid_to ? Date.parse(row.valid_to) : null;
							if (asOf != null) {
								if (from != null && Number.isFinite(from) && from > asOf) {
									return false;
								}
								if (to != null && Number.isFinite(to) && to <= asOf) {
									return false;
								}
								return true;
							}
							return row.valid_to == null;
						})
						.map((row) => ({
							id: row.id,
							srcEntity: row.src_entity,
							dstEntity: row.dst_entity,
							predicate: row.predicate,
							memoryId: row.memory_id,
							validFrom: row.valid_from,
							validTo: row.valid_to,
						}));
				}),
			listTimeline: (input) =>
				Effect.gen(function* () {
					const rows = yield* sql<MemoryRow>`
						SELECT DISTINCT memories.* FROM memories
						LEFT JOIN memory_entities ON memory_entities.memory_id = memories.id
						WHERE (memory_entities.entity_id = ${input.entityId} OR memories.text LIKE ${`%${input.about}%`})
						AND memories.type = ${"episodic"}
						ORDER BY COALESCE(memories.event_at, memories.observed_at, memories.created_at) ASC
						LIMIT ${input.limit}
					`;
					return (yield* hydrateMemories(rows.map(toMemory))).filter((memory) => {
						const at = memory.eventAt ?? memory.observedAt ?? 0;
						if (input.from != null && at < input.from) {
							return false;
						}
						if (input.to != null && at > input.to) {
							return false;
						}
						return true;
					});
				}),
			listChangesSince: (since) =>
				sql<{
					id: string;
					memory_id: string;
					reason: string;
					changed_at: number;
				}>`
					SELECT id, memory_id, reason, changed_at FROM memory_history
					WHERE changed_at >= ${since} ORDER BY changed_at ASC LIMIT 200
				`.pipe(
					Effect.map((rows) =>
						rows.map((row) => ({
							id: row.id,
							memoryId: row.memory_id,
							reason: row.reason,
							changedAt: row.changed_at,
						})),
					),
				),
			listProfileMemories: (limit) =>
				Effect.gen(function* () {
					const rows = yield* sql<MemoryRow>`
						SELECT * FROM memories
						WHERE type = ${"semantic"} AND state = ${"active"}
						AND origin IN (${"agent"}, ${"user"}, ${"extracted"})
						ORDER BY (importance * COALESCE(retention, 1)) DESC
						LIMIT ${limit}
					`;
					return yield* hydrateMemories(rows.map(toMemory));
				}),
			splitEntity: (id, newName) =>
				Effect.gen(function* () {
					const current = yield* sql<{ type: import("@yumeoi/domain").EntityType }>`
						SELECT type FROM entities WHERE id = ${id} LIMIT 1
					`;
					const nextId = newShortId("e");
					const now = Date.now();
					yield* sql`
						INSERT INTO entities (id, name, canonical, type, description, first_seen, last_seen, mention_count, state)
						VALUES (${nextId}, ${newName}, ${newName.toLowerCase()}, ${current[0]?.type ?? "other"}, ${null}, ${now}, ${now}, ${1}, ${"active"})
					`;
					return { id: nextId };
				}),
			listEntityMemories: (entityId, limit) =>
				Effect.gen(function* () {
					const rows = yield* sql<MemoryRow>`
						SELECT memories.* FROM memories
						JOIN memory_entities ON memory_entities.memory_id = memories.id
						WHERE memory_entities.entity_id = ${entityId}
						ORDER BY memories.created_at DESC LIMIT ${limit}
					`;
					return yield* hydrateMemories(rows.map(toMemory));
				}),
			listFeedbackSums: (ids) =>
				Effect.gen(function* () {
					if (ids.length === 0) {
						return [];
					}
					const rows = yield* sql<{ memory_id: string; sum: number }>`
						SELECT memory_id, COALESCE(SUM(signal), 0) AS sum
						FROM memory_feedback
						WHERE ${sql.in("memory_id", [...ids])}
						GROUP BY memory_id
					`;
					return rows.map((row) => ({ id: row.memory_id, sum: row.sum }));
				}),
			listDerivedParents: (ids) =>
				Effect.gen(function* () {
					if (ids.length === 0) {
						return [];
					}
					const rows = yield* sql<{ dst: string }>`
						SELECT DISTINCT dst FROM memory_edges
						WHERE relation = ${"derived_from"} AND ${sql.in("dst", [...ids])}
					`;
					return rows.map((row) => row.dst);
				}),
			lastStateChange: (memoryId, state) =>
				Effect.gen(function* () {
					const rows = yield* sql<{ changed_at: number }>`
						SELECT changed_at FROM memory_history
						WHERE memory_id = ${memoryId} AND state = ${state}
						ORDER BY changed_at DESC LIMIT 1
					`;
					return rows[0]?.changed_at ?? null;
				}),
			archiveMemory: (id, now) =>
				Effect.gen(function* () {
					yield* sql`
						INSERT OR REPLACE INTO memories_archive
						SELECT * FROM memories WHERE id = ${id}
					`;
					yield* sql`UPDATE memories_archive SET state = ${"archived"}, updated_at = ${now} WHERE id = ${id}`;
					yield* sql`DELETE FROM memories WHERE id = ${id}`;
				}),
			restoreMemory: (id, now) =>
				Effect.gen(function* () {
					const live = yield* sql<MemoryRow>`SELECT * FROM memories WHERE id = ${id} LIMIT 1`;
					if (live[0]) {
						yield* sql`
							UPDATE memories SET state = ${"active"}, updated_at = ${now} WHERE id = ${id}
						`;
						return toMemory({ ...live[0], state: "active" });
					}
					const archived = yield* sql<MemoryRow>`
						SELECT * FROM memories_archive WHERE id = ${id} LIMIT 1
					`;
					if (!archived[0]) {
						return yield* Effect.fail(new NotFound({ entity: "memory", id }));
					}
					yield* sql`
						INSERT OR REPLACE INTO memories
						SELECT * FROM memories_archive WHERE id = ${id}
					`;
					yield* sql`
						UPDATE memories SET state = ${"active"}, updated_at = ${now} WHERE id = ${id}
					`;
					yield* sql`DELETE FROM memories_archive WHERE id = ${id}`;
					const rows = yield* sql<MemoryRow>`SELECT * FROM memories WHERE id = ${id} LIMIT 1`;
					const row = rows[0];
					if (!row) {
						return yield* Effect.fail(new NotFound({ entity: "memory", id }));
					}
					return toMemory(row);
				}),
			hardDeleteMemory: (id) =>
				Effect.gen(function* () {
					yield* sql`DELETE FROM memories WHERE id = ${id}`;
					yield* sql`DELETE FROM memories_archive WHERE id = ${id}`;
				}),
			listArchived: (limit) =>
				Effect.gen(function* () {
					const rows = yield* sql<MemoryRow>`
						SELECT * FROM memories_archive ORDER BY updated_at DESC LIMIT ${limit}
					`;
					return rows.map(toMemory);
				}),
			countActive: () =>
				sql<{ n: number }>`SELECT COUNT(*) AS n FROM memories WHERE state = ${"active"}`.pipe(
					Effect.map((rows) => rows[0]?.n ?? 0),
				),
			listLowestRetentionActive: (limit) =>
				Effect.gen(function* () {
					const rows = yield* sql<MemoryRow>`
						SELECT * FROM memories
						WHERE state = ${"active"}
						ORDER BY retention ASC, created_at ASC
						LIMIT ${limit}
					`;
					return rows.map(toMemory);
				}),
			getStats: () =>
				Effect.gen(function* () {
					const stored = yield* sql<{
						last_sweep_at: number | null;
						vectors_deleted: number;
						cursor: string | null;
					}>`SELECT last_sweep_at, vectors_deleted, cursor FROM memory_stats WHERE id = 1 LIMIT 1`;
					const byState = yield* sql<{ state: string; n: number }>`
						SELECT state, COUNT(*) AS n FROM memories GROUP BY state
					`;
					const byType = yield* sql<{ type: string; n: number }>`
						SELECT type, COUNT(*) AS n FROM memories GROUP BY type
					`;
					const archived = yield* sql<{ n: number }>`
						SELECT COUNT(*) AS n FROM memories_archive
					`;
					const count = (
						rows: ReadonlyArray<{ state?: string; type?: string; n: number }>,
						key: string,
					) => rows.find((row) => row.state === key || row.type === key)?.n ?? 0;
					const snapshot = stored[0];
					return {
						lastSweepAt: snapshot?.last_sweep_at ?? null,
						vectorsDeleted: snapshot?.vectors_deleted ?? 0,
						active: count(byState, "active"),
						dormant: count(byState, "dormant"),
						archived: archived[0]?.n ?? 0,
						forgotten: count(byState, "forgotten"),
						semantic: count(byType, "semantic"),
						episodic: count(byType, "episodic"),
						procedural: count(byType, "procedural"),
						cursor: snapshot?.cursor ?? null,
					};
				}),
			writeStats: (stats) =>
				sql`
					INSERT INTO memory_stats (
						id, last_sweep_at, vectors_deleted, active_count, dormant_count, archived_count,
						forgotten_count, semantic_count, episodic_count, procedural_count, cursor
					) VALUES (
						1, ${stats.lastSweepAt}, ${stats.vectorsDeleted}, ${stats.active}, ${stats.dormant},
						${stats.archived}, ${stats.forgotten}, ${stats.semantic}, ${stats.episodic},
						${stats.procedural}, ${stats.cursor}
					)
					ON CONFLICT(id) DO UPDATE SET
						last_sweep_at = excluded.last_sweep_at,
						vectors_deleted = excluded.vectors_deleted,
						active_count = excluded.active_count,
						dormant_count = excluded.dormant_count,
						archived_count = excluded.archived_count,
						forgotten_count = excluded.forgotten_count,
						semantic_count = excluded.semantic_count,
						episodic_count = excluded.episodic_count,
						procedural_count = excluded.procedural_count,
						cursor = excluded.cursor
				`.pipe(Effect.asVoid),
			listDocuments: () =>
				sql<{ id: string; content_hash: string }>`
					SELECT id, content_hash FROM documents ORDER BY id
				`.pipe(
					Effect.map((rows) => rows.map((row) => ({ id: row.id, contentHash: row.content_hash }))),
				),
		});
	}),
);
