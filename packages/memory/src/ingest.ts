import type { ExtractedMemory, IngestRequest, IngestResult } from "@yumeoi/domain";
import { Effect } from "effect";
import { chunkMarkdown } from "./chunker.ts";
import { Embeddings } from "./embeddings.ts";
import { Extractor } from "./extractor.ts";
import { sha256Hex } from "./hasher.ts";
import { type CommitBatch, MemoryRepo } from "./memory-repo.ts";
import { documentObjectKey, ObjectStore } from "./object-store.ts";
import { chunkVectorId, VECTOR_KIND_CHUNK } from "./recall.ts";
import { VectorIndex } from "./vector-index.ts";
import {
	commitMemoryFromWrite,
	type ExtractedWrite,
	finalizeIngestWrites,
	planExtractedWrite,
	plannedMemory,
} from "./write-extracted.ts";

export { overlapCandidates, similarExistingMemories } from "./write-extracted.ts";

const newId = () => crypto.randomUUID();

export const INGEST_STEPS = [
	"fetch",
	"normalize",
	"chunk",
	"embed",
	"extract",
	"consolidate",
	"commit",
] as const;
export type IngestStepName = (typeof INGEST_STEPS)[number];

export type IngestParams = {
	readonly userId: string;
	readonly request: IngestRequest;
};

export type PreparedChunk = {
	readonly id: string;
	readonly text: string;
	readonly contentHash: string;
	readonly byteStart: number;
	readonly byteEnd: number;
	readonly reused: boolean;
	readonly values: ReadonlyArray<number> | null;
};

export type IngestState = {
	readonly jobId: string;
	readonly userId: string;
	readonly request: IngestRequest;
	readonly sourceId: string;
	readonly sourceKind: NonNullable<IngestRequest["sourceKind"]>;
	readonly sourceLabel: string;
	readonly contentHash: string;
	readonly documentId: string;
	readonly r2Key: string;
	readonly unchanged: boolean;
	readonly existing: boolean;
	readonly previousHashes: ReadonlyArray<{ readonly id: string; readonly contentHash: string }>;
	readonly chunks: ReadonlyArray<PreparedChunk>;
	readonly extracted: ReadonlyArray<{
		readonly chunkId: string;
		readonly memories: ReadonlyArray<ExtractedMemory>;
	}>;
	readonly memories: CommitBatch["memories"];
	readonly writes: ReadonlyArray<ExtractedWrite>;
	readonly result?: IngestResult;
};

const sourceKindFor = (
	request: IngestRequest,
	sourceId: string,
): NonNullable<IngestRequest["sourceKind"]> => {
	if (request.sourceKind) {
		return request.sourceKind;
	}
	if (sourceId.startsWith("notion")) {
		return "notion";
	}
	if (sourceId.startsWith("agent")) {
		return "agent";
	}
	return "generic";
};

export const initialIngestState = (params: IngestParams): IngestState => {
	const sourceId = params.request.sourceId ?? "generic";
	const sourceLabel = params.request.sourceLabel ?? "Generic ingest";
	const sourceKind = sourceKindFor(params.request, sourceId);
	return {
		jobId: "",
		userId: params.userId,
		request: {
			...params.request,
			sourceId,
			sourceLabel,
			sourceKind,
		},
		sourceId,
		sourceKind,
		sourceLabel,
		contentHash: "",
		documentId: "",
		r2Key: "",
		unchanged: false,
		existing: false,
		previousHashes: [],
		chunks: [],
		extracted: [],
		memories: [],
		writes: [],
	};
};

const fetchIngest = (state: IngestState) =>
	Effect.gen(function* () {
		const repo = yield* MemoryRepo;
		const objects = yield* ObjectStore;
		const contentHash = yield* Effect.promise(() => sha256Hex(state.request.markdown));
		const existing = yield* repo.getDocumentByExternalId(state.sourceId, state.request.externalId);
		const documentId = existing?.id ?? newId();
		const r2Key = documentObjectKey(
			state.userId,
			state.sourceId,
			state.request.externalId,
			contentHash,
		);
		yield* objects.put(
			r2Key,
			JSON.stringify({
				externalId: state.request.externalId,
				title: state.request.title,
				markdown: state.request.markdown,
				url: state.request.url,
				...(state.request.metadata ? { metadata: state.request.metadata } : {}),
			}),
		);
		if (existing && existing.contentHash === contentHash) {
			return {
				...state,
				jobId: state.jobId || newId(),
				contentHash,
				documentId,
				r2Key,
				unchanged: true,
				existing: true,
				result: {
					documentId: existing.id,
					sourceId: state.sourceId,
					contentHash,
					unchanged: true,
					chunkCount: 0,
					memoryCount: 0,
					skippedChunks: 0,
				},
			} satisfies IngestState;
		}
		const previousHashes = existing ? yield* repo.listChunkHashes(existing.id) : [];
		return {
			...state,
			jobId: state.jobId || newId(),
			contentHash,
			documentId,
			r2Key,
			unchanged: false,
			existing: Boolean(existing),
			previousHashes,
		} satisfies IngestState;
	});

const normalizeIngest = (state: IngestState) =>
	Effect.succeed({
		...state,
		request: {
			...state.request,
			title: state.request.title.trim() || state.request.externalId,
			markdown: state.request.markdown,
		},
	} satisfies IngestState);

const chunkIngest = (state: IngestState) =>
	Effect.gen(function* () {
		const slices = chunkMarkdown(state.request.markdown);
		const previousByHash = new Map(state.previousHashes.map((row) => [row.contentHash, row.id]));
		const chunks: PreparedChunk[] = [];
		for (const slice of slices) {
			const chunkHash = yield* Effect.promise(() => sha256Hex(slice.text));
			const reused = previousByHash.get(chunkHash);
			chunks.push({
				id: reused ?? newId(),
				text: slice.text,
				contentHash: chunkHash,
				byteStart: slice.byteStart,
				byteEnd: slice.byteEnd,
				reused: Boolean(reused),
				values: null,
			});
		}
		return { ...state, chunks } satisfies IngestState;
	});

const embedIngest = (state: IngestState) =>
	Effect.gen(function* () {
		const embeddings = yield* Embeddings;
		const index = yield* VectorIndex;
		const fresh = state.chunks.filter((chunk) => !chunk.reused);
		if (fresh.length === 0) {
			return state;
		}
		const vectors = yield* embeddings.embed(fresh.map((chunk) => chunk.text));
		let freshIndex = 0;
		const chunks = state.chunks.map((chunk) => {
			if (chunk.reused) {
				return chunk;
			}
			const values = vectors[freshIndex] ?? null;
			freshIndex += 1;
			return { ...chunk, values };
		});
		const ts = Date.now();
		const records = chunks.flatMap((chunk) =>
			chunk.values
				? [
						{
							id: chunkVectorId(chunk.id),
							values: chunk.values,
							namespace: state.userId,
							metadata: {
								sourceId: state.sourceId,
								documentId: state.documentId,
								kind: VECTOR_KIND_CHUNK,
								ts,
							},
						},
					]
				: [],
		);
		if (records.length > 0) {
			yield* index.upsert(records).pipe(Effect.catchTag("ProviderUnavailable", () => Effect.void));
		}
		return { ...state, chunks } satisfies IngestState;
	});

const extractIngest = (state: IngestState) =>
	Effect.gen(function* () {
		const extractor = yield* Extractor;
		const extracted: Array<{ chunkId: string; memories: ReadonlyArray<ExtractedMemory> }> = [];
		for (const chunk of state.chunks) {
			if (chunk.reused) {
				continue;
			}
			const memories = yield* extractor.extract(chunk.text, state.request.title);
			extracted.push({ chunkId: chunk.id, memories });
		}
		return { ...state, extracted } satisfies IngestState;
	});

const consolidateIngest = (state: IngestState) =>
	Effect.gen(function* () {
		const known: ReturnType<typeof plannedMemory>[] = [];
		const knownValues = new Map<string, ReadonlyArray<number>>();
		const writes: ExtractedWrite[] = [];
		const commitMemories: CommitBatch["memories"][number][] = [];
		for (const group of state.extracted) {
			for (const memory of group.memories) {
				const write = yield* planExtractedWrite(memory, {
					userId: state.userId,
					sourceId: state.sourceId,
					origin: "extracted",
					documentDate: null,
					dedupe: true,
					documentId: state.documentId,
					chunkId: group.chunkId,
					inBatch: known.filter((item): item is NonNullable<typeof item> => item !== null),
					inBatchValues: knownValues,
				});
				writes.push(write);
				if (write.tag === "merge") {
					const existing = commitMemories.find((row) => row.id === write.target.id);
					if (existing) {
						const index = commitMemories.indexOf(existing);
						commitMemories[index] = {
							...existing,
							text: write.mergedText,
							importance: write.importance,
							chunkIds: [...new Set([...existing.chunkIds, group.chunkId])],
						};
					}
				}
				const commitRow = commitMemoryFromWrite(write, group.chunkId);
				if (commitRow) {
					commitMemories.push({
						...commitRow,
						values:
							write.tag === "insert" || write.tag === "conflict" ? (write.values ?? null) : null,
					});
				}
				const planned = plannedMemory(write);
				if (planned) {
					known.push(planned);
					if (write.tag !== "duplicate" && write.values) {
						knownValues.set(planned.id, write.values);
					}
				}
			}
		}
		return { ...state, memories: commitMemories, writes } satisfies IngestState;
	});

const commitIngest = (state: IngestState) =>
	Effect.gen(function* () {
		const repo = yield* MemoryRepo;
		const skippedChunks = state.chunks.filter((chunk) => chunk.reused).length;
		const batch: CommitBatch = {
			userId: state.userId,
			source: {
				id: state.sourceId,
				kind: state.sourceKind,
				label: state.sourceLabel,
			},
			document: {
				id: state.documentId,
				sourceId: state.sourceId,
				externalId: state.request.externalId,
				contentHash: state.contentHash,
				title: state.request.title,
				markdown: state.request.markdown,
				url: state.request.url,
				r2Key: state.r2Key,
			},
			chunks: state.chunks.map((chunk) => ({
				id: chunk.id,
				text: chunk.text,
				contentHash: chunk.contentHash,
				byteStart: chunk.byteStart,
				byteEnd: chunk.byteEnd,
				values: chunk.values,
			})),
			memories: state.memories,
			replaceDocument: state.existing,
		};
		const result = yield* repo.commit(batch);
		const insertedIds = new Set(state.memories.map((memory) => memory.id));
		yield* finalizeIngestWrites(state.userId, state.writes ?? [], insertedIds);
		const memoryCount =
			state.writes.filter((write) => write.tag !== "duplicate").length > 0
				? result.memoryCount +
					state.writes
						.filter((write) => write.tag === "merge")
						.filter((write) => {
							return !insertedIds.has(write.target.id);
						}).length
				: result.memoryCount;
		return {
			...state,
			result: { ...result, skippedChunks, memoryCount },
		} satisfies IngestState;
	});

export const runIngestStep = (name: IngestStepName, state: IngestState) => {
	switch (name) {
		case "fetch":
			return fetchIngest(state);
		case "normalize":
			return normalizeIngest(state);
		case "chunk":
			return chunkIngest(state);
		case "embed":
			return embedIngest(state);
		case "extract":
			return extractIngest(state);
		case "consolidate":
			return consolidateIngest(state);
		case "commit":
			return commitIngest(state);
	}
};

export const ingestDocument = (params: IngestParams) =>
	Effect.gen(function* () {
		let state = yield* runIngestStep("fetch", initialIngestState(params));
		if (state.unchanged && state.result) {
			return state.result;
		}
		for (const name of [
			"normalize",
			"chunk",
			"embed",
			"extract",
			"consolidate",
			"commit",
		] as const) {
			state = yield* runIngestStep(name, state);
		}
		if (!state.result) {
			return {
				documentId: state.documentId,
				sourceId: state.sourceId,
				contentHash: state.contentHash,
				unchanged: false,
				chunkCount: state.chunks.length,
				memoryCount: state.memories.length,
				skippedChunks: state.chunks.filter((chunk) => chunk.reused).length,
			};
		}
		return state.result;
	});
