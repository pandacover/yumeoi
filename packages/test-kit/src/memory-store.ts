import type {
	Chunk,
	Document,
	EntityType,
	Memory,
	MemoryStats,
	Provenance,
	QueryPlan,
	Source,
} from "@yumeoi/domain";
import { fillMemory, NotFound } from "@yumeoi/domain";
import {
	type CommitBatch,
	MemoryRepo,
	newShortId,
	ObjectStore,
	type SearchFilters,
	VectorIndex,
} from "@yumeoi/memory";
import { Effect, Layer } from "effect";

const cosine = (a: ReadonlyArray<number>, b: ReadonlyArray<number>): number => {
	let dot = 0;
	let na = 0;
	let nb = 0;
	const n = Math.min(a.length, b.length);
	for (let i = 0; i < n; i++) {
		dot += (a[i] ?? 0) * (b[i] ?? 0);
		na += (a[i] ?? 0) ** 2;
		nb += (b[i] ?? 0) ** 2;
	}
	if (na === 0 || nb === 0) {
		return 0;
	}
	return dot / (Math.sqrt(na) * Math.sqrt(nb));
};

type StoredMemory = {
	id: string;
	kind: Memory["kind"];
	text: string;
	confidence: number;
	validFrom: string | null;
	validTo: string | null;
	supersedes: string | null;
	createdAt: number;
	type: Memory["type"];
	state: Memory["state"];
	importance: number;
	eventAt: number | null;
	observedAt: number | null;
	origin: Memory["origin"];
	clientRef: string | null;
	accessCount: number;
	lastAccessedAt: number | null;
	updatedAt: number | null;
	retention: number;
};

type Stored = {
	sources: Source[];
	documents: Document[];
	chunks: Chunk[];
	memories: StoredMemory[];
	links: Array<Provenance & { memoryId: string }>;
	updatedAt: Map<string, number>;
	edges: Array<{ src: string; dst: string; relation: string }>;
	entities: Array<{
		id: string;
		name: string;
		canonical: string;
		type: EntityType;
		mentionCount: number;
		description: string | null;
	}>;
	memoryEntities: Array<{ memoryId: string; entityId: string; role: string }>;
	history: Array<{
		id: string;
		memoryId: string;
		text: string;
		type: Memory["type"];
		kind: Memory["kind"];
		confidence: number;
		validFrom: string | null;
		validTo: string | null;
		state: Memory["state"];
		changedAt: number;
		reason: string;
	}>;
	queryCache: Map<string, { plan: QueryPlan; expiresAt: number }>;
	aliases: Map<string, string>;
	relations: Array<{
		id: string;
		srcEntity: string;
		dstEntity: string;
		predicate: string;
		memoryId: string;
		validFrom: string | null;
		validTo: string | null;
		confidence: number;
	}>;
	archive: StoredMemory[];
	feedback: Array<{ memoryId: string; clientId: string; signal: number }>;
	stats: MemoryStats;
};

const empty = (): Stored => ({
	sources: [],
	documents: [],
	chunks: [],
	memories: [],
	links: [],
	updatedAt: new Map(),
	edges: [],
	entities: [],
	memoryEntities: [],
	history: [],
	queryCache: new Map(),
	aliases: new Map(),
	relations: [],
	archive: [],
	feedback: [],
	stats: {
		lastSweepAt: null,
		vectorsDeleted: 0,
		active: 0,
		dormant: 0,
		archived: 0,
		forgotten: 0,
		semantic: 0,
		episodic: 0,
		procedural: 0,
		cursor: null,
	},
});

export const inMemoryObjectStoreLayer = () => {
	const objects = new Map<string, string>();
	return Layer.succeed(ObjectStore, {
		put: (key, body) =>
			Effect.sync(() => {
				objects.set(key, body);
			}),
		get: (key) => {
			const body = objects.get(key);
			return body !== undefined
				? Effect.succeed(body)
				: Effect.fail(new NotFound({ entity: "object", id: key }));
		},
	});
};

export const memoryMemoryRepoLayer = (userId = "test-user") => {
	const db = empty();
	const toMemory = (memory: StoredMemory) => strip(memory, db);
	return Layer.succeed(MemoryRepo, {
		getDocumentByExternalId: (sourceId, externalId) =>
			Effect.succeed(
				db.documents.find((doc) => doc.sourceId === sourceId && doc.externalId === externalId) ??
					null,
			),
		listChunkHashes: (documentId) =>
			Effect.succeed(
				db.chunks
					.filter((chunk) => chunk.documentId === documentId)
					.map((chunk) => ({ id: chunk.id, contentHash: chunk.contentHash })),
			),
		searchMemoryFts: (match, filters) =>
			Effect.succeed(
				filterMemories(db, match, filters)
					.slice(0, filters.limit)
					.map((memory, rank) => ({ id: memory.id, rank })),
			),
		searchChunkFts: (match, filters) =>
			Effect.succeed(
				db.chunks
					.filter((chunk) => needle(match, chunk.text))
					.filter((chunk) => {
						const doc = db.documents.find((item) => item.id === chunk.documentId);
						return !doc || filters.sources.length === 0 || filters.sources.includes(doc.sourceId);
					})
					.slice(0, filters.limit)
					.map((chunk, rank) => ({ id: chunk.id, rank })),
			),
		getMemory: (id) => {
			const memory =
				db.memories.find((item) => item.id === id) ?? db.archive.find((item) => item.id === id);
			return memory
				? Effect.succeed(toMemory(memory))
				: Effect.fail(new NotFound({ entity: "memory", id }));
		},
		getDocument: (id) => {
			const document = db.documents.find((item) => item.id === id);
			return document
				? Effect.succeed(document)
				: Effect.fail(new NotFound({ entity: "document", id }));
		},
		getChunk: (id) => {
			const chunk = db.chunks.find((item) => item.id === id);
			return chunk ? Effect.succeed(chunk) : Effect.fail(new NotFound({ entity: "chunk", id }));
		},
		listMemoriesByIds: (ids) =>
			Effect.succeed(
				ids.flatMap((id) => {
					const memory = db.memories.find((item) => item.id === id);
					return memory ? [toMemory(memory)] : [];
				}),
			),
		listChunksByIds: (ids) =>
			Effect.succeed(
				ids.flatMap((id) => {
					const chunk = db.chunks.find((item) => item.id === id);
					return chunk ? [chunk] : [];
				}),
			),
		provenanceFor: (memoryIds) =>
			Effect.succeed(db.links.filter((link) => memoryIds.includes(link.memoryId))),
		chunkMeta: (chunkIds) =>
			Effect.succeed(
				chunkIds.flatMap((chunkId) => {
					const chunk = db.chunks.find((item) => item.id === chunkId);
					const document = chunk
						? db.documents.find((item) => item.id === chunk.documentId)
						: undefined;
					if (!chunk || !document) {
						return [];
					}
					return [
						{
							chunkId,
							sourceId: document.sourceId,
							title: document.title,
							url: document.url,
							updatedAt: db.updatedAt.get(document.id) ?? 0,
						},
					];
				}),
			),
		memoryTimestamps: (memoryIds) =>
			Effect.succeed(
				db.memories
					.filter((memory) => memoryIds.includes(memory.id))
					.map((memory) => ({ id: memory.id, createdAt: memory.createdAt })),
			),
		listSources: () => Effect.succeed(db.sources.map((source) => ({ ...source, userId }))),
		upsertSource: (source) =>
			Effect.sync(() => {
				const index = db.sources.findIndex((item) => item.id === source.id);
				if (index >= 0) {
					db.sources[index] = source;
				} else {
					db.sources.push(source);
				}
			}),
		listMemories: (filters) =>
			Effect.succeed(
				filterMemories(db, "", filters)
					.sort((left, right) => right.createdAt - left.createdAt)
					.slice(0, filters.limit)
					.map(toMemory),
			),
		similarMemoryCandidates: (excludeIds, limit) =>
			Effect.succeed(
				db.memories
					.filter(
						(memory) =>
							memory.validTo === null &&
							memory.state === "active" &&
							!excludeIds.includes(memory.id),
					)
					.slice(0, limit)
					.map(toMemory),
			),
		listRecentMemories: (limit) =>
			Effect.succeed(
				[...db.memories]
					.filter((memory) => memory.validTo === null && memory.state === "active")
					.sort((left, right) => right.createdAt - left.createdAt)
					.slice(0, limit)
					.map(toMemory),
			),
		commit: (batch: CommitBatch) =>
			Effect.sync(() => {
				const now = Date.now();
				if (!db.sources.some((source) => source.id === batch.source.id)) {
					db.sources.push({
						id: batch.source.id,
						userId: batch.userId,
						kind: batch.source.kind,
						label: batch.source.label,
					});
				}
				db.documents = db.documents.filter((doc) => doc.id !== batch.document.id);
				db.documents.push({
					id: batch.document.id,
					sourceId: batch.document.sourceId,
					externalId: batch.document.externalId,
					contentHash: batch.document.contentHash,
					title: batch.document.title,
					markdown: batch.document.markdown,
					url: batch.document.url,
					r2Key: batch.document.r2Key,
				});
				db.updatedAt.set(batch.document.id, now);
				const keep = new Set(batch.chunks.map((chunk) => chunk.id));
				const dropped = db.chunks
					.filter((chunk) => chunk.documentId === batch.document.id && !keep.has(chunk.id))
					.map((chunk) => chunk.id);
				if (dropped.length > 0) {
					const droppedSet = new Set(dropped);
					const affected = [
						...new Set(
							db.links.filter((link) => droppedSet.has(link.chunkId)).map((link) => link.memoryId),
						),
					];
					db.links = db.links.filter((link) => !droppedSet.has(link.chunkId));
					const remaining = new Set(db.links.map((link) => link.memoryId));
					const superseded = new Set(
						batch.memories.flatMap((memory) => (memory.supersedes ? [memory.supersedes] : [])),
					);
					for (const id of affected) {
						if (remaining.has(id) || superseded.has(id)) {
							continue;
						}
						const memory = db.memories.find((item) => item.id === id);
						if (memory && memory.state === "active") {
							memory.state = "dormant";
							memory.updatedAt = now;
							db.history.push({
								id: newShortId("h"),
								memoryId: id,
								text: memory.text,
								type: memory.type,
								kind: memory.kind,
								confidence: memory.confidence,
								validFrom: memory.validFrom,
								validTo: memory.validTo,
								state: "dormant",
								changedAt: now,
								reason: "source_removed",
							});
						}
					}
				}
				db.chunks = db.chunks.filter(
					(chunk) => chunk.documentId !== batch.document.id || keep.has(chunk.id),
				);
				for (const chunk of batch.chunks) {
					db.chunks = db.chunks.filter((item) => item.id !== chunk.id);
					db.chunks.push({
						id: chunk.id,
						documentId: batch.document.id,
						text: chunk.text,
						contentHash: chunk.contentHash,
						byteStart: chunk.byteStart,
						byteEnd: chunk.byteEnd,
					});
				}
				for (const memory of batch.memories) {
					if (memory.supersedes) {
						const previous = db.memories.find((item) => item.id === memory.supersedes);
						if (previous) {
							previous.validTo = new Date(now).toISOString();
							previous.state = "superseded";
						}
					}
					db.memories.push({
						id: memory.id,
						kind: memory.kind,
						text: memory.text,
						confidence: memory.confidence,
						validFrom: memory.validFrom,
						validTo: memory.validTo,
						supersedes: memory.supersedes,
						createdAt: now,
						type:
							memory.type ??
							(memory.kind === "event" || memory.kind === "task"
								? "episodic"
								: memory.kind === "procedure" || memory.kind === "rule"
									? "procedural"
									: "semantic"),
						state: memory.state ?? "active",
						importance: memory.importance ?? memory.confidence,
						eventAt: memory.eventAt ?? null,
						observedAt: now,
						origin: memory.origin ?? "extracted",
						clientRef: memory.clientRef ?? null,
						accessCount: 0,
						lastAccessedAt: null,
						updatedAt: now,
						retention: 1,
					});
					for (const chunkId of memory.chunkIds) {
						db.links.push({
							memoryId: memory.id,
							sourceId: batch.source.id,
							documentId: batch.document.id,
							chunkId,
							title: batch.document.title,
							url: batch.document.url,
						});
					}
				}
				return {
					documentId: batch.document.id,
					sourceId: batch.source.id,
					contentHash: batch.document.contentHash,
					unchanged: false,
					chunkCount: batch.chunks.length,
					memoryCount: batch.memories.length,
					skippedChunks: 0,
				};
			}),
		insertMemory: (userId, input, options) =>
			Effect.sync(() => {
				const now = Date.now();
				const sourceId = input.sourceId ?? `agent:${userId}`;
				const documentId = input.documentId ?? `${sourceId}:notes`;
				const chunkId = input.chunkId ?? crypto.randomUUID();
				const memoryId = input.id ?? newShortId("m");
				const supersedes = options?.supersedes ?? null;
				if (supersedes) {
					const previous = db.memories.find((item) => item.id === supersedes);
					if (previous && previous.validTo === null) {
						previous.validTo = new Date(now).toISOString();
						previous.state = "superseded";
					}
				}
				if (!db.sources.some((source) => source.id === sourceId)) {
					db.sources.push({
						id: sourceId,
						userId,
						kind: "agent",
						label: "Agent writes",
					});
				}
				if (!db.documents.some((doc) => doc.id === documentId)) {
					db.documents.push({
						id: documentId,
						sourceId,
						externalId: "notes",
						contentHash: "agent",
						title: "Agent notes",
						markdown: input.text,
						url: null,
						r2Key: `${userId}/${sourceId}/notes.json`,
					});
				}
				if (!db.chunks.some((chunk) => chunk.id === chunkId)) {
					db.chunks.push({
						id: chunkId,
						documentId,
						text: input.text,
						contentHash: memoryId,
						byteStart: 0,
						byteEnd: input.text.length,
					});
				}
				const memory: StoredMemory = {
					id: memoryId,
					kind: input.kind,
					text: input.text,
					confidence: input.confidence,
					validFrom: input.validFrom ?? null,
					validTo: input.validTo ?? null,
					supersedes,
					createdAt: now,
					type:
						input.type ??
						(input.kind === "event" || input.kind === "task"
							? "episodic"
							: input.kind === "procedure" || input.kind === "rule"
								? "procedural"
								: "semantic"),
					state: input.state ?? (input.validTo ? "superseded" : "active"),
					importance: input.importance ?? input.confidence,
					eventAt: input.eventAt ?? null,
					observedAt: input.observedAt ?? now,
					origin: input.origin ?? "agent",
					clientRef: input.clientRef ?? null,
					accessCount: 0,
					lastAccessedAt: null,
					updatedAt: now,
					retention: 1,
				};
				db.memories.push(memory);
				const document = db.documents.find((item) => item.id === documentId);
				db.links.push({
					memoryId,
					sourceId,
					documentId,
					chunkId,
					title: document?.title ?? "Agent notes",
					url: document?.url ?? null,
				});
				return toMemory(memory);
			}),
		linkProvenance: (input) =>
			Effect.sync(() => {
				if (
					db.links.some(
						(link) => link.memoryId === input.memoryId && link.chunkId === input.chunkId,
					)
				) {
					return;
				}
				const document = db.documents.find((item) => item.id === input.documentId);
				db.links.push({
					memoryId: input.memoryId,
					sourceId: input.sourceId,
					documentId: input.documentId,
					chunkId: input.chunkId,
					title: document?.title ?? "",
					url: document?.url ?? null,
				});
			}),
		ensureLinkedProvenance: (input) =>
			Effect.sync(() => {
				const sourceId = input.sourceId;
				const documentId = input.documentId ?? `${sourceId}:notes`;
				const chunkId = input.chunkId ?? crypto.randomUUID();
				if (!db.sources.some((source) => source.id === sourceId)) {
					db.sources.push({
						id: sourceId,
						userId: input.userId,
						kind: "agent",
						label: "Agent writes",
					});
				}
				if (!db.documents.some((doc) => doc.id === documentId)) {
					db.documents.push({
						id: documentId,
						sourceId,
						externalId: "notes",
						contentHash: "agent",
						title: "Agent notes",
						markdown: input.text,
						url: null,
						r2Key: `${input.userId}/${sourceId}/notes.json`,
					});
				}
				if (!db.chunks.some((chunk) => chunk.id === chunkId)) {
					db.chunks.push({
						id: chunkId,
						documentId,
						text: input.text,
						contentHash: input.memoryId,
						byteStart: 0,
						byteEnd: input.text.length,
					});
				}
				if (db.links.some((link) => link.memoryId === input.memoryId && link.chunkId === chunkId)) {
					return;
				}
				const document = db.documents.find((item) => item.id === documentId);
				db.links.push({
					memoryId: input.memoryId,
					sourceId,
					documentId,
					chunkId,
					title: document?.title ?? "Agent notes",
					url: document?.url ?? null,
				});
			}),
		updateMemory: (id, patch) =>
			Effect.gen(function* () {
				const memory = db.memories.find((item) => item.id === id);
				if (!memory) {
					return yield* Effect.fail(new NotFound({ entity: "memory", id }));
				}
				if (patch.text !== undefined) {
					memory.text = patch.text;
				}
				if (patch.validTo !== undefined) {
					memory.validTo = patch.validTo;
				}
				if (patch.state !== undefined) {
					memory.state = patch.state;
				}
				if (patch.confidence !== undefined) {
					memory.confidence = patch.confidence;
				}
				if (patch.importance !== undefined) {
					memory.importance = patch.importance;
				}
				if (patch.kind !== undefined) {
					memory.kind = patch.kind;
				}
				if (patch.eventAt !== undefined) {
					memory.eventAt = patch.eventAt;
				}
				if (patch.observedAt !== undefined) {
					memory.observedAt = patch.observedAt;
				}
				if (patch.retention !== undefined) {
					memory.retention = patch.retention;
				}
				if (patch.origin !== undefined) {
					memory.origin = patch.origin;
				}
				memory.updatedAt = Date.now();
				return toMemory(memory);
			}),
		insertEdge: (src, dst, relation) =>
			Effect.sync(() => {
				if (
					!db.edges.some(
						(edge) => edge.src === src && edge.dst === dst && edge.relation === relation,
					)
				) {
					db.edges.push({ src, dst, relation });
				}
			}),
		insertHistory: (row) =>
			Effect.sync(() => {
				db.history.push({
					id: newShortId("h"),
					memoryId: row.memoryId,
					text: row.text,
					type: row.type,
					kind: row.kind,
					confidence: row.confidence,
					validFrom: row.validFrom,
					validTo: row.validTo,
					state: row.state,
					changedAt: row.changedAt ?? Date.now(),
					reason: row.reason,
				});
			}),
		getMemoryByClientRef: (clientRef) =>
			Effect.succeed(
				(() => {
					const memory = db.memories.find((item) => item.clientRef === clientRef);
					return memory ? toMemory(memory) : null;
				})(),
			),
		upsertEntity: (input) =>
			Effect.sync(() => {
				const existing = db.entities.find(
					(entity) => entity.canonical === input.canonical && entity.type === input.type,
				);
				if (existing) {
					existing.mentionCount += 1;
					return { id: existing.id, mentionCount: existing.mentionCount };
				}
				const id = newShortId("e");
				db.entities.push({
					id,
					name: input.name,
					canonical: input.canonical,
					type: input.type,
					mentionCount: 1,
					description: null,
				});
				return { id, mentionCount: 1 };
			}),
		linkMemoryEntity: (memoryId, entityId, role) =>
			Effect.sync(() => {
				db.memoryEntities.push({ memoryId, entityId, role });
			}),
		setEntityDescription: (id, description) =>
			Effect.sync(() => {
				const entity = db.entities.find((item) => item.id === id);
				if (entity) {
					entity.description = description;
				}
			}),
		listMemoriesPage: (options) =>
			Effect.succeed(
				db.memories
					.filter(
						(memory) =>
							!options.activeOnly || (memory.validTo === null && memory.state === "active"),
					)
					.filter((memory) => !options.afterId || memory.id > options.afterId)
					.sort((left, right) => left.id.localeCompare(right.id))
					.slice(0, options.limit)
					.map(toMemory),
			),
		listChunksPage: (options) =>
			Effect.succeed(
				db.chunks
					.filter((chunk) => !options.afterId || chunk.id > options.afterId)
					.sort((left, right) => left.id.localeCompare(right.id))
					.slice(0, options.limit)
					.map((chunk) => {
						const document = db.documents.find((item) => item.id === chunk.documentId);
						return { ...chunk, sourceId: document?.sourceId ?? "generic" };
					}),
			),
		listInactiveMemoryIds: () =>
			Effect.succeed(
				db.memories
					.filter((memory) => memory.validTo !== null || memory.state !== "active")
					.map((memory) => memory.id),
			),
		recordAccess: (ids, at) =>
			Effect.sync(() => {
				for (const memory of db.memories) {
					if (ids.includes(memory.id)) {
						memory.accessCount += 1;
						memory.lastAccessedAt = at;
						if (memory.state === "dormant") {
							memory.state = "active";
						}
					}
				}
			}),
		listByEntities: (entityIds, filters) =>
			Effect.succeed(
				(() => {
					const allowed = new Set(
						filterMemories(db, "", { ...filters, limit: 10_000 }).map((memory) => memory.id),
					);
					return [
						...new Set(
							db.memoryEntities
								.filter((link) => entityIds.includes(link.entityId) && allowed.has(link.memoryId))
								.map((link) => link.memoryId),
						),
					]
						.slice(0, filters.limit)
						.map((id, rank) => ({ id, rank }));
				})(),
			),
		listRecentEpisodic: (sinceEventAt, limit) =>
			Effect.succeed(
				db.memories
					.filter(
						(memory) =>
							memory.type === "episodic" &&
							memory.state === "active" &&
							(memory.eventAt ?? memory.observedAt ?? memory.createdAt) >= sinceEventAt,
					)
					.sort(
						(left, right) =>
							(right.eventAt ?? right.observedAt ?? right.createdAt) -
							(left.eventAt ?? left.observedAt ?? left.createdAt),
					)
					.slice(0, limit)
					.map(toMemory),
			),
		listEdges: (ids) =>
			Effect.succeed(db.edges.filter((edge) => ids.includes(edge.src) || ids.includes(edge.dst))),
		listHistory: (memoryId) =>
			Effect.succeed(db.history.filter((row) => row.memoryId === memoryId)),
		insertFeedback: (row) =>
			Effect.sync(() => {
				db.feedback.push({
					memoryId: row.memoryId,
					clientId: row.clientId,
					signal: row.signal,
				});
			}),
		getQueryPlan: (hash, now) =>
			Effect.sync(() => {
				const cached = db.queryCache.get(hash);
				if (!cached || cached.expiresAt < now) {
					return null;
				}
				return cached.plan;
			}),
		putQueryPlan: (hash, plan, expiresAt) =>
			Effect.sync(() => {
				db.queryCache.set(hash, { plan, expiresAt });
			}),
		findEntity: (canonical, type) =>
			Effect.succeed(
				db.entities.find(
					(entity) =>
						entity.canonical === canonical && (type === undefined || entity.type === type),
				) ?? null,
			),
		findEntityByAlias: (alias) =>
			Effect.succeed(
				(() => {
					const id = db.aliases.get(alias);
					return id ? (db.entities.find((entity) => entity.id === id) ?? null) : null;
				})(),
			),
		getEntity: (id) => Effect.succeed(db.entities.find((entity) => entity.id === id) ?? null),
		listEntities: () => Effect.succeed([...db.entities]),
		putAlias: (alias, entityId) =>
			Effect.sync(() => {
				db.aliases.set(alias, entityId);
			}),
		upsertRelation: (input) =>
			Effect.sync(() => {
				const open = db.relations.find(
					(row) =>
						row.srcEntity === input.srcEntity &&
						row.predicate === input.predicate &&
						row.validTo === null,
				);
				if (open && open.dstEntity !== input.dstEntity) {
					open.validTo = new Date(input.now).toISOString();
				}
				const existing = db.relations.find(
					(row) =>
						row.srcEntity === input.srcEntity &&
						row.dstEntity === input.dstEntity &&
						row.predicate === input.predicate &&
						row.validTo === null,
				);
				if (existing) {
					return { id: existing.id };
				}
				const id = newShortId("r");
				db.relations.push({
					id,
					srcEntity: input.srcEntity,
					dstEntity: input.dstEntity,
					predicate: input.predicate,
					memoryId: input.memoryId,
					validFrom: input.validFrom,
					validTo: null,
					confidence: input.confidence,
				});
				return { id };
			}),
		listRelations: (entityIds, asOf) =>
			Effect.succeed(
				db.relations.filter((row) => {
					if (!entityIds.includes(row.srcEntity) && !entityIds.includes(row.dstEntity)) {
						return false;
					}
					if (asOf != null && row.validTo && Date.parse(row.validTo) <= asOf) {
						return false;
					}
					return row.validTo === null || asOf != null;
				}),
			),
		listTimeline: (input) =>
			Effect.succeed(
				db.memories
					.filter((memory) => {
						const linked = db.memoryEntities.some(
							(link) => link.memoryId === memory.id && link.entityId === input.entityId,
						);
						const about = memory.text.toLowerCase().includes(input.about.toLowerCase());
						if (!linked && !about) {
							return false;
						}
						const at = memory.eventAt ?? memory.observedAt ?? memory.createdAt;
						if (input.from != null && at < input.from) {
							return false;
						}
						if (input.to != null && at > input.to) {
							return false;
						}
						return memory.type === "episodic" || linked;
					})
					.sort(
						(left, right) =>
							(left.eventAt ?? left.observedAt ?? left.createdAt) -
							(right.eventAt ?? right.observedAt ?? right.createdAt),
					)
					.slice(0, input.limit)
					.map(toMemory),
			),
		listChangesSince: (since) =>
			Effect.succeed(
				db.history
					.filter((row) => row.changedAt >= since)
					.map((row) => ({
						id: row.id,
						memoryId: row.memoryId,
						reason: row.reason,
						changedAt: row.changedAt,
					})),
			),
		listProfileMemories: (limit) =>
			Effect.succeed(
				db.memories
					.filter(
						(memory) =>
							memory.type === "semantic" &&
							memory.state === "active" &&
							(memory.origin === "agent" ||
								memory.origin === "user" ||
								memory.origin === "extracted"),
					)
					.sort((left, right) => right.importance - left.importance)
					.slice(0, limit)
					.map(toMemory),
			),
		splitEntity: (id, newName) =>
			Effect.sync(() => {
				const current = db.entities.find((entity) => entity.id === id);
				const nextId = newShortId("e");
				db.entities.push({
					id: nextId,
					name: newName,
					canonical: newName.toLowerCase(),
					type: (current?.type ?? "other") as EntityType,
					mentionCount: 1,
					description: null,
				});
				return { id: nextId };
			}),
		listEntityMemories: (entityId, limit) =>
			Effect.succeed(
				db.memoryEntities
					.filter((link) => link.entityId === entityId)
					.slice(0, limit)
					.flatMap((link) => {
						const memory = db.memories.find((item) => item.id === link.memoryId);
						return memory ? [toMemory(memory)] : [];
					}),
			),
		listFeedbackSums: (ids) =>
			Effect.succeed(
				ids.map((id) => ({
					id,
					sum: db.feedback
						.filter((row) => row.memoryId === id)
						.reduce((total, row) => total + row.signal, 0),
				})),
			),
		listDerivedParents: (ids) =>
			Effect.succeed(
				ids.filter((id) =>
					db.edges.some((edge) => edge.relation === "derived_from" && edge.dst === id),
				),
			),
		lastStateChange: (memoryId, state) =>
			Effect.succeed(
				db.history
					.filter((row) => row.memoryId === memoryId && row.state === state)
					.sort((left, right) => right.changedAt - left.changedAt)[0]?.changedAt ?? null,
			),
		archiveMemory: (id, now) =>
			Effect.sync(() => {
				const index = db.memories.findIndex((item) => item.id === id);
				const memory = index >= 0 ? db.memories[index] : undefined;
				if (!memory) {
					return;
				}
				db.memories.splice(index, 1);
				memory.state = "archived";
				memory.updatedAt = now;
				db.archive.push(memory);
			}),
		restoreMemory: (id, now) =>
			Effect.gen(function* () {
				const live = db.memories.find((item) => item.id === id);
				if (live) {
					live.state = "active";
					live.updatedAt = now;
					return toMemory(live);
				}
				const index = db.archive.findIndex((item) => item.id === id);
				const archived = index >= 0 ? db.archive[index] : undefined;
				if (!archived) {
					return yield* Effect.fail(new NotFound({ entity: "memory", id }));
				}
				db.archive.splice(index, 1);
				archived.state = "active";
				archived.updatedAt = now;
				db.memories.push(archived);
				return toMemory(archived);
			}),
		hardDeleteMemory: (id) =>
			Effect.sync(() => {
				db.memories = db.memories.filter((item) => item.id !== id);
				db.archive = db.archive.filter((item) => item.id !== id);
			}),
		listArchived: (limit) =>
			Effect.succeed(
				[...db.archive]
					.sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0))
					.slice(0, limit)
					.map(toMemory),
			),
		countActive: () =>
			Effect.succeed(db.memories.filter((memory) => memory.state === "active").length),
		listLowestRetentionActive: (limit) =>
			Effect.succeed(
				[...db.memories]
					.filter((memory) => memory.state === "active")
					.sort(
						(left, right) => left.retention - right.retention || left.createdAt - right.createdAt,
					)
					.slice(0, limit)
					.map(toMemory),
			),
		getStats: () =>
			Effect.sync(() => {
				const countState = (state: Memory["state"]) =>
					db.memories.filter((memory) => memory.state === state).length;
				const countType = (type: Memory["type"]) =>
					db.memories.filter((memory) => memory.type === type).length;
				return {
					...db.stats,
					active: countState("active"),
					dormant: countState("dormant"),
					archived: db.archive.length,
					forgotten: countState("forgotten"),
					semantic: countType("semantic"),
					episodic: countType("episodic"),
					procedural: countType("procedural"),
				};
			}),
		writeStats: (stats) =>
			Effect.sync(() => {
				db.stats = { ...stats };
			}),
		listDocuments: () =>
			Effect.succeed(db.documents.map((doc) => ({ id: doc.id, contentHash: doc.contentHash }))),
	});
};

const strip = (memory: StoredMemory, store: Stored): Memory =>
	fillMemory({
		id: memory.id,
		kind: memory.kind,
		text: memory.text,
		confidence: memory.confidence,
		validFrom: memory.validFrom,
		validTo: memory.validTo,
		supersedes: memory.supersedes,
		type: memory.type,
		state: memory.state,
		importance: memory.importance,
		eventAt: memory.eventAt,
		observedAt: memory.observedAt,
		origin: memory.origin,
		clientRef: memory.clientRef,
		accessCount: memory.accessCount,
		lastAccessedAt: memory.lastAccessedAt,
		updatedAt: memory.updatedAt,
		retention: memory.retention,
		entities: store.memoryEntities.flatMap((link) => {
			if (link.memoryId !== memory.id) {
				return [];
			}
			const entity = store.entities.find((item) => item.id === link.entityId);
			return entity ? [{ id: entity.id, name: entity.name, type: entity.type }] : [];
		}),
	});

const needle = (match: string, text: string): boolean => {
	const tokens = match
		.replaceAll('"', "")
		.split(" OR ")
		.map((token) => token.trim().toLowerCase());
	const hay = text.toLowerCase();
	return tokens.some((token) => token.length > 0 && hay.includes(token));
};

const filterMemories = (db: Stored, match: string, filters: SearchFilters) =>
	db.memories.filter((memory) => {
		const asOf = filters.asOf ?? null;
		if (asOf != null) {
			const observed = memory.observedAt ?? memory.createdAt;
			if (observed > asOf) {
				return false;
			}
			if (memory.validTo) {
				const to = Date.parse(memory.validTo);
				if (Number.isFinite(to) && to <= asOf) {
					return false;
				}
			}
			if (memory.state === "forgotten" || memory.state === "archived") {
				return false;
			}
		} else {
			if (memory.validTo !== null) {
				return false;
			}
			if (filters.includeDormant) {
				if (memory.state !== "active" && memory.state !== "dormant") {
					return false;
				}
			} else if (memory.state !== "active") {
				return false;
			}
		}
		if (match.trim().length > 0 && !needle(match, memory.text)) {
			return false;
		}
		if (filters.kinds.length > 0 && !filters.kinds.includes(memory.kind)) {
			return false;
		}
		if (filters.types && filters.types.length > 0 && !filters.types.includes(memory.type)) {
			return false;
		}
		const eventTime = memory.eventAt ?? memory.observedAt ?? memory.createdAt;
		if (filters.since !== null && eventTime < filters.since) {
			return false;
		}
		if (filters.from != null && eventTime < filters.from) {
			return false;
		}
		if (filters.to != null && eventTime > filters.to) {
			return false;
		}
		if (filters.sources.length > 0) {
			const sources = db.links
				.filter((link) => link.memoryId === memory.id)
				.map((link) => link.sourceId);
			if (!sources.some((id) => filters.sources.includes(id))) {
				return false;
			}
		}
		return true;
	});

export const inMemoryVectorIndexLayer = (options?: {
	readonly onDelete?: (ids: ReadonlyArray<string>) => void;
}) => {
	const records: Array<{
		id: string;
		values: ReadonlyArray<number>;
		namespace: string;
		metadata: Record<string, unknown>;
	}> = [];
	return Layer.succeed(VectorIndex, {
		upsert: (incoming) =>
			Effect.sync(() => {
				for (const record of incoming) {
					const index = records.findIndex((item) => item.id === record.id);
					const next = {
						id: record.id,
						values: record.values,
						namespace: record.namespace,
						metadata: record.metadata,
					};
					if (index >= 0) {
						records[index] = next;
					} else {
						records.push(next);
					}
				}
			}),
		query: ({ values, namespace, topK, filter, returnValues }) =>
			Effect.sync(() =>
				records
					.filter((record) => record.namespace === namespace)
					.filter((record) => matchesFilter(record.metadata, filter))
					.map((record) => ({
						id: record.id,
						score: cosine(values, record.values),
						metadata: record.metadata,
						...(returnValues ? { values: record.values } : {}),
					}))
					.sort((a, b) => b.score - a.score)
					.slice(0, topK),
			),
		deleteByIds: (ids) =>
			Effect.sync(() => {
				options?.onDelete?.(ids);
				const remove = new Set(ids);
				for (let i = records.length - 1; i >= 0; i--) {
					if (remove.has(records[i]?.id ?? "")) {
						records.splice(i, 1);
					}
				}
			}),
	});
};

const matchesFilter = (
	metadata: Record<string, unknown>,
	filter?: Record<string, unknown>,
): boolean => {
	if (!filter) {
		return true;
	}
	for (const [key, raw] of Object.entries(filter)) {
		const value = metadata[key];
		if (raw && typeof raw === "object") {
			const rec = raw as Record<string, unknown>;
			if ("$in" in rec) {
				const list = rec.$in as unknown[];
				if (!list.includes(value)) {
					return false;
				}
				continue;
			}
			if ("$gte" in rec || "$lte" in rec) {
				if (typeof value !== "number") {
					return false;
				}
				if (typeof rec.$gte === "number" && value < rec.$gte) {
					return false;
				}
				if (typeof rec.$lte === "number" && value > rec.$lte) {
					return false;
				}
				continue;
			}
		}
		if (value !== raw) {
			return false;
		}
	}
	return true;
};
