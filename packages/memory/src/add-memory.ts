import type { AddMemoryRequest, Memory } from "@yumeoi/domain";
import { Effect } from "effect";
import { Consolidator } from "./consolidator.ts";
import { Embeddings } from "./embeddings.ts";
import { overlapCandidates, similarExistingMemories } from "./ingest.ts";
import { MemoryRepo } from "./memory-repo.ts";
import { memoryVectorId } from "./recall.ts";
import { VectorIndex } from "./vector-index.ts";

export const addMemory = (userId: string, input: AddMemoryRequest) =>
	Effect.gen(function* () {
		const repo = yield* MemoryRepo;
		const embeddings = yield* Embeddings;
		const index = yield* VectorIndex;
		const consolidator = yield* Consolidator;
		const sourceId = input.sourceId ?? `agent:${userId}`;
		const request = { ...input, sourceId };

		const vectors = yield* embeddings
			.embed([request.text])
			.pipe(
				Effect.catchTag("ProviderUnavailable", () =>
					Effect.succeed<ReadonlyArray<ReadonlyArray<number>>>([]),
				),
			);
		const values = vectors[0];
		const similar = values
			? yield* similarExistingMemories({
					userId,
					text: request.text,
					values,
					inBatch: [],
					inBatchValues: new Map(),
				})
			: overlapCandidates(yield* repo.similarMemoryCandidates([], 50), request.text);

		const decision = yield* consolidator.decide(request.text, similar);
		if (decision.action === "duplicate" && decision.targetId) {
			return yield* repo.getMemory(decision.targetId);
		}

		const supersedes = decision.action === "supersedes" ? decision.targetId : null;
		const memory: Memory = yield* repo.addMemory(userId, request, { supersedes });

		if (values) {
			yield* index
				.upsert([
					{
						id: memoryVectorId(memory.id),
						values,
						namespace: userId,
						metadata: {
							sourceId,
							documentId: `${sourceId}:notes`,
							kind: memory.kind,
							ts: Date.now(),
						},
					},
				])
				.pipe(Effect.catchTag("ProviderUnavailable", () => Effect.void));
		}

		return memory;
	});
