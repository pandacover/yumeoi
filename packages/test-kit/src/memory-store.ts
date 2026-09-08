import type { Chunk, Document, Memory, Provenance, Source } from "@yumeoi/domain";
import { NotFound } from "@yumeoi/domain";
import {
	type CommitBatch,
	MemoryRepo,
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
};

type Stored = {
	sources: Source[];
	documents: Document[];
	chunks: Chunk[];
	memories: StoredMemory[];
	links: Array<Provenance & { memoryId: string }>;
	updatedAt: Map<string, number>;
};

const empty = (): Stored => ({
	sources: [],
	documents: [],
	chunks: [],
	memories: [],
	links: [],
	updatedAt: new Map(),
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
				filterMemories(db, match, filters).map((memory, rank) => ({ id: memory.id, rank })),
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
			const memory = db.memories.find((item) => item.id === id);
			return memory
				? Effect.succeed(strip(memory))
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
					return memory ? [strip(memory)] : [];
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
		similarMemoryCandidates: (_exclude, limit) =>
			Effect.succeed(db.memories.slice(0, limit).map(strip)),
		listRecentMemories: (limit) =>
			Effect.succeed(
				[...db.memories]
					.sort((left, right) => right.createdAt - left.createdAt)
					.slice(0, limit)
					.map(strip),
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
		addMemory: (userId, input) =>
			Effect.sync(() => {
				const sourceId = input.sourceId ?? `agent:${userId}`;
				if (!db.sources.some((source) => source.id === sourceId)) {
					db.sources.push({
						id: sourceId,
						userId,
						kind: "agent",
						label: "Agent writes",
					});
				}
				const memory = {
					id: crypto.randomUUID(),
					kind: input.kind,
					text: input.text,
					confidence: input.confidence,
					validFrom: null,
					validTo: null,
					supersedes: null,
					createdAt: Date.now(),
				};
				db.memories.push(memory);
				return strip(memory);
			}),
	});
};

const strip = (memory: StoredMemory): Memory => ({
	id: memory.id,
	kind: memory.kind,
	text: memory.text,
	confidence: memory.confidence,
	validFrom: memory.validFrom,
	validTo: memory.validTo,
	supersedes: memory.supersedes,
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
		if (!needle(match, memory.text)) {
			return false;
		}
		if (filters.kinds.length > 0 && !filters.kinds.includes(memory.kind)) {
			return false;
		}
		if (filters.since !== null && memory.createdAt < filters.since) {
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

export const inMemoryVectorIndexLayer = () => {
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
		query: ({ values, namespace, topK, filter }) =>
			Effect.sync(() =>
				records
					.filter((record) => record.namespace === namespace)
					.filter((record) => matchesFilter(record.metadata, filter))
					.map((record) => ({
						id: record.id,
						score: cosine(values, record.values),
						metadata: record.metadata,
					}))
					.sort((a, b) => b.score - a.score)
					.slice(0, topK),
			),
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
		if (raw && typeof raw === "object" && "$in" in (raw as object)) {
			const list = (raw as { $in: unknown[] }).$in;
			if (!list.includes(value)) {
				return false;
			}
		} else if (raw && typeof raw === "object" && "$gte" in (raw as object)) {
			if (typeof value !== "number" || value < (raw as { $gte: number }).$gte) {
				return false;
			}
		} else if (value !== raw) {
			return false;
		}
	}
	return true;
};
