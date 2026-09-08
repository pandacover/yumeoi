import type { ExtractedMemory, IngestRequest, Memory } from "@yumeoi/domain";
import { Effect } from "effect";
import { chunkMarkdown } from "./chunker.ts";
import { Consolidator } from "./consolidator.ts";
import { Embeddings } from "./embeddings.ts";
import { Extractor } from "./extractor.ts";
import { sha256Hex } from "./hasher.ts";
import { type CommitBatch, MemoryRepo } from "./memory-repo.ts";
import { documentObjectKey, ObjectStore } from "./object-store.ts";
import { chunkVectorId, memoryVectorId, VECTOR_KIND_CHUNK } from "./recall.ts";
import { VectorIndex } from "./vector-index.ts";

const newId = () => crypto.randomUUID();

export type IngestParams = {
	readonly userId: string;
	readonly request: IngestRequest;
};

const candidatesFor = (existing: ReadonlyArray<Memory>, text: string): ReadonlyArray<Memory> => {
	const needle = text.toLowerCase();
	return existing
		.filter((memory) => {
			const hay = memory.text.toLowerCase();
			return hay.includes(needle.slice(0, 24)) || needle.includes(hay.slice(0, 24));
		})
		.slice(0, 5);
};

export const ingestDocument = (params: IngestParams) =>
	Effect.gen(function* () {
		const repo = yield* MemoryRepo;
		const embeddings = yield* Embeddings;
		const extractor = yield* Extractor;
		const consolidator = yield* Consolidator;
		const index = yield* VectorIndex;
		const objects = yield* ObjectStore;

		const sourceId = params.request.sourceId ?? "generic";
		const sourceLabel = params.request.sourceLabel ?? "Generic ingest";
		const contentHash = yield* Effect.promise(() => sha256Hex(params.request.markdown));
		const existing = yield* repo.getDocumentByExternalId(sourceId, params.request.externalId);
		if (existing && existing.contentHash === contentHash) {
			return {
				documentId: existing.id,
				sourceId,
				contentHash,
				unchanged: true,
				chunkCount: 0,
				memoryCount: 0,
				skippedChunks: 0,
			};
		}

		const documentId = existing?.id ?? newId();
		const r2Key = documentObjectKey(
			params.userId,
			sourceId,
			params.request.externalId,
			contentHash,
		);
		yield* objects.put(
			r2Key,
			JSON.stringify({
				externalId: params.request.externalId,
				title: params.request.title,
				markdown: params.request.markdown,
				url: params.request.url,
			}),
		);

		const slices = chunkMarkdown(params.request.markdown);
		const previousHashes = existing ? yield* repo.listChunkHashes(existing.id) : [];
		const previousByHash = new Map(previousHashes.map((row) => [row.contentHash, row.id]));

		const preparedChunks: Array<CommitBatch["chunks"][number]> = [];
		let skippedChunks = 0;
		for (const slice of slices) {
			const chunkHash = yield* Effect.promise(() => sha256Hex(slice.text));
			const reused = previousByHash.get(chunkHash);
			const id = reused ?? newId();
			if (reused) {
				skippedChunks += 1;
			}
			preparedChunks.push({
				id,
				text: slice.text,
				contentHash: chunkHash,
				byteStart: slice.byteStart,
				byteEnd: slice.byteEnd,
				values: null,
			});
		}

		const textsToEmbed = [...preparedChunks.map((chunk) => chunk.text), params.request.title];
		const vectors = yield* embeddings.embed(textsToEmbed);
		const chunkVectors = vectors.slice(0, preparedChunks.length);
		const withValues = preparedChunks.map((chunk, i) => ({
			...chunk,
			values: chunkVectors[i] ?? null,
		}));

		const extracted: Array<{ chunkId: string; memories: ReadonlyArray<ExtractedMemory> }> = [];
		for (const chunk of withValues) {
			const reused = previousByHash.has(chunk.contentHash);
			if (reused) {
				continue;
			}
			const memories = yield* extractor.extract(chunk.text, params.request.title);
			extracted.push({ chunkId: chunk.id, memories });
		}

		const known: Memory[] = [...(yield* repo.similarMemoryCandidates([], 50))];
		const commitMemories: Array<CommitBatch["memories"][number]> = [];
		for (const group of extracted) {
			for (const memory of group.memories) {
				const similar = candidatesFor(known, memory.text);
				const decision = yield* consolidator.decide(memory.text, similar);
				if (decision.action === "duplicate") {
					continue;
				}
				const id = newId();
				const [values] = yield* embeddings.embed([memory.text]);
				const row = {
					id,
					kind: memory.kind,
					text: memory.text,
					confidence: memory.confidence,
					validFrom: memory.validFrom,
					validTo: null,
					supersedes: decision.action === "supersedes" ? decision.targetId : null,
					chunkIds: [group.chunkId],
					values: values ?? null,
				};
				commitMemories.push(row);
				known.push({
					id,
					kind: memory.kind,
					text: memory.text,
					confidence: memory.confidence,
					validFrom: memory.validFrom,
					validTo: null,
					supersedes: row.supersedes,
				});
			}
		}

		const batch: CommitBatch = {
			userId: params.userId,
			source: {
				id: sourceId,
				kind: "generic",
				label: sourceLabel,
			},
			document: {
				id: documentId,
				sourceId,
				externalId: params.request.externalId,
				contentHash,
				title: params.request.title,
				markdown: params.request.markdown,
				url: params.request.url,
				r2Key,
			},
			chunks: withValues,
			memories: commitMemories,
			replaceDocument: Boolean(existing),
		};

		const result = yield* repo.commit(batch);

		const ts = Date.now();
		const records = [
			...withValues.flatMap((chunk) =>
				chunk.values
					? [
							{
								id: chunkVectorId(chunk.id),
								values: chunk.values,
								namespace: params.userId,
								metadata: {
									sourceId,
									documentId,
									kind: VECTOR_KIND_CHUNK,
									ts,
								},
							},
						]
					: [],
			),
			...commitMemories.flatMap((memory) =>
				memory.values
					? [
							{
								id: memoryVectorId(memory.id),
								values: memory.values,
								namespace: params.userId,
								metadata: {
									sourceId,
									documentId,
									kind: memory.kind,
									ts,
								},
							},
						]
					: [],
			),
		];
		if (records.length > 0) {
			yield* index.upsert(records).pipe(Effect.catchTag("ProviderUnavailable", () => Effect.void));
		}

		return {
			...result,
			skippedChunks,
		};
	});
