import { Effect } from "effect";
import { Embeddings } from "./embeddings.ts";
import { MemoryRepo } from "./memory-repo.ts";
import { chunkVectorId, memoryVectorId } from "./recall.ts";
import { VALID_TO_SENTINEL, VectorIndex } from "./vector-index.ts";

const PAGE = 500;

export type ReindexResult = {
	readonly memories: number;
	readonly chunks: number;
	readonly deleted: number;
};

export const reindexStore = (userId: string) =>
	Effect.gen(function* () {
		const repo = yield* MemoryRepo;
		const embeddings = yield* Embeddings;
		const index = yield* VectorIndex;
		let after: string | null = null;
		let memories = 0;
		let chunks = 0;
		for (;;) {
			const page = yield* repo.listMemoriesPage({ afterId: after, limit: PAGE, activeOnly: true });
			if (page.length === 0) {
				break;
			}
			const vectors = yield* embeddings
				.embed(page.map((memory) => memory.text))
				.pipe(
					Effect.catchTag("ProviderUnavailable", () =>
						Effect.succeed<ReadonlyArray<ReadonlyArray<number>>>([]),
					),
				);
			const records = page.flatMap((memory, i) => {
				const values = vectors[i];
				if (!values) {
					return [];
				}
				const ts = memory.observedAt ?? Date.now();
				return [
					{
						id: memoryVectorId(memory.id),
						values,
						namespace: userId,
						metadata: {
							sourceId: memory.origin === "agent" ? `agent:${userId}` : "generic",
							kind: memory.kind,
							type: memory.type,
							state: memory.state,
							ts,
							eventAt: memory.eventAt ?? ts,
							validTo: memory.validTo
								? Date.parse(memory.validTo) || VALID_TO_SENTINEL
								: VALID_TO_SENTINEL,
						},
					},
				];
			});
			if (records.length > 0) {
				yield* index
					.upsert(records)
					.pipe(Effect.catchTag("ProviderUnavailable", () => Effect.void));
			}
			memories += page.length;
			after = page[page.length - 1]?.id ?? null;
			if (page.length < PAGE) {
				break;
			}
		}
		after = null;
		for (;;) {
			const page = yield* repo.listChunksPage({ afterId: after, limit: PAGE });
			if (page.length === 0) {
				break;
			}
			const vectors = yield* embeddings
				.embed(page.map((chunk) => chunk.text))
				.pipe(
					Effect.catchTag("ProviderUnavailable", () =>
						Effect.succeed<ReadonlyArray<ReadonlyArray<number>>>([]),
					),
				);
			const records = page.flatMap((chunk, i) => {
				const values = vectors[i];
				return values
					? [
							{
								id: chunkVectorId(chunk.id),
								values,
								namespace: userId,
								metadata: {
									sourceId: chunk.sourceId,
									documentId: chunk.documentId,
									kind: "chunk",
									ts: Date.now(),
								},
							},
						]
					: [];
			});
			if (records.length > 0) {
				yield* index
					.upsert(records)
					.pipe(Effect.catchTag("ProviderUnavailable", () => Effect.void));
			}
			chunks += page.length;
			after = page[page.length - 1]?.id ?? null;
			if (page.length < PAGE) {
				break;
			}
		}
		const inactive = yield* repo.listInactiveMemoryIds();
		const toDelete = inactive.map((id) => memoryVectorId(id));
		if (toDelete.length > 0) {
			yield* index
				.deleteByIds(toDelete)
				.pipe(Effect.catchTag("ProviderUnavailable", () => Effect.void));
		}
		return { memories, chunks, deleted: toDelete.length } satisfies ReindexResult;
	});
