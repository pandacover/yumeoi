import { describe, expect, test } from "bun:test";
import {
	FakeEmbeddings,
	inMemoryObjectStoreLayer,
	inMemoryVectorIndexLayer,
	memoryMemoryRepoLayer,
} from "@yumeoi/test-kit";
import { Effect, Layer } from "effect";
import { addMemory } from "./add-memory.ts";
import { Consolidator, consolidatorLayer } from "./consolidator.ts";
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL, Embeddings } from "./embeddings.ts";
import { extractorLayer } from "./extractor.ts";
import { heuristicLlmLayer } from "./heuristic-llm.ts";
import { ingestDocument } from "./ingest.ts";
import { MemoryRepo } from "./memory-repo.ts";
import { memoryVectorId, recallContext, searchMemories } from "./recall.ts";
import { identityRerankerLayer } from "./reranker.ts";
import { VectorIndex } from "./vector-index.ts";

const userId = "p0-user";

const base = Layer.mergeAll(
	memoryMemoryRepoLayer(userId),
	FakeEmbeddings,
	heuristicLlmLayer,
	Layer.provide(extractorLayer, heuristicLlmLayer),
	Layer.provide(consolidatorLayer, heuristicLlmLayer),
	inMemoryVectorIndexLayer(),
	inMemoryObjectStoreLayer(),
	identityRerankerLayer,
);

const countingEmbeddings = (counts: { calls: number }) =>
	Layer.succeed(Embeddings, {
		model: EMBEDDING_MODEL,
		dimensions: EMBEDDING_DIMENSIONS,
		embed: (texts) =>
			Effect.sync(() => {
				counts.calls += 1;
				return texts.map((text, index) =>
					Array.from(
						{ length: EMBEDDING_DIMENSIONS },
						(_, i) => ((text.charCodeAt(i % Math.max(text.length, 1)) + index + i) % 100) / 100,
					),
				);
			}),
	});

const scriptedConsolidator = (action: "duplicate" | "supersedes") =>
	Layer.succeed(Consolidator, {
		decide: (_candidate, existing) =>
			Effect.succeed(
				existing[0]
					? { action, targetId: existing[0].id, mergedText: null, reason: action }
					: { action: "new", targetId: null, mergedText: null, reason: "new" },
			),
	});

describe("P0 retrieval defects", () => {
	test("search and recall skip superseded memories", async () => {
		const program = Effect.gen(function* () {
			const first = yield* addMemory(userId, {
				text: "Luv prefers Effect 3 for the yumeoi domain layer.",
				kind: "preference",
				confidence: 0.9,
			});
			const second = yield* addMemory(userId, {
				text: "Luv prefers Effect 4 for the yumeoi domain layer.",
				kind: "preference",
				confidence: 0.9,
			});
			expect(second.id).not.toBe(first.id);
			expect(second.supersedes).toBe(first.id);
			const previous = yield* Effect.flatMap(MemoryRepo, (repo) => repo.getMemory(first.id));
			expect(previous.validTo).not.toBeNull();

			const hits = yield* searchMemories({
				query: "Effect",
				namespace: userId,
				limit: 20,
			});
			expect(hits.some((hit) => hit.memory.id === first.id)).toBe(false);
			expect(hits.some((hit) => hit.memory.id === second.id)).toBe(true);

			const recalled = yield* recallContext({
				query: "Effect",
				namespace: userId,
				rerank: false,
			});
			expect(recalled.memories.some((hit) => hit.memory.id === first.id)).toBe(false);
			expect(recalled.memories.some((hit) => hit.memory.id === second.id)).toBe(true);
		});

		await Effect.runPromise(
			program.pipe(
				Effect.provide(
					Layer.mergeAll(
						memoryMemoryRepoLayer(userId),
						countingEmbeddings({ calls: 0 }),
						heuristicLlmLayer,
						Layer.provide(extractorLayer, heuristicLlmLayer),
						scriptedConsolidator("supersedes"),
						inMemoryVectorIndexLayer(),
						inMemoryObjectStoreLayer(),
						identityRerankerLayer,
					),
				),
			),
		);
	});

	test("addMemory embeds, upserts m: vectors, and returns the duplicate", async () => {
		const program = Effect.gen(function* () {
			const first = yield* addMemory(userId, {
				text: "Luv prefers oat milk in coffee at all times.",
				kind: "preference",
				confidence: 0.9,
			});
			const index = yield* VectorIndex;
			const embeddings = yield* Embeddings;
			const [values] = yield* embeddings.embed(["Luv prefers oat milk in coffee at all times."]);
			const vectorHits = yield* index.query({
				values: values ?? [],
				namespace: userId,
				topK: 5,
			});
			expect(vectorHits.some((hit) => hit.id === memoryVectorId(first.id))).toBe(true);

			const duplicate = yield* addMemory(userId, {
				text: "Luv prefers oat milk in coffee at all times.",
				kind: "preference",
				confidence: 0.9,
			});
			expect(duplicate.id).toBe(first.id);
		});

		await Effect.runPromise(
			program.pipe(
				Effect.provide(
					Layer.mergeAll(
						memoryMemoryRepoLayer(userId),
						countingEmbeddings({ calls: 0 }),
						heuristicLlmLayer,
						Layer.provide(extractorLayer, heuristicLlmLayer),
						scriptedConsolidator("duplicate"),
						inMemoryVectorIndexLayer(),
						inMemoryObjectStoreLayer(),
						identityRerankerLayer,
					),
				),
			),
		);
	});

	test("recallContext embeds the query once", async () => {
		const counts = { calls: 0 };
		const layer = Layer.mergeAll(
			memoryMemoryRepoLayer("embed-once"),
			countingEmbeddings(counts),
			heuristicLlmLayer,
			Layer.provide(extractorLayer, heuristicLlmLayer),
			Layer.provide(consolidatorLayer, heuristicLlmLayer),
			inMemoryVectorIndexLayer(),
			inMemoryObjectStoreLayer(),
			identityRerankerLayer,
		);
		const program = Effect.gen(function* () {
			yield* ingestDocument({
				userId: "embed-once",
				request: {
					externalId: "embed-doc",
					title: "Preferences",
					markdown: "Luv prefers Effect 4 for the yumeoi domain layer.",
					sourceId: "generic",
					sourceLabel: "Notes",
					url: null,
				},
			});
			counts.calls = 0;
			yield* recallContext({
				query: "What does Luv prefer?",
				namespace: "embed-once",
				rerank: false,
			});
			expect(counts.calls).toBe(1);
		});
		await Effect.runPromise(program.pipe(Effect.provide(layer)));
	});

	test("re-ingest that drops a chunk leaves memories without provenance", async () => {
		const program = Effect.gen(function* () {
			yield* ingestDocument({
				userId: userId,
				request: {
					externalId: "orphan-doc",
					title: "Two sections",
					markdown: [
						"# Prefs",
						"Luv prefers Effect 4 for the yumeoi domain layer and uses it everywhere.",
						"",
						"# Work",
						"Luv decided to run ingest on Cloudflare Workflows for durability.",
					].join("\n"),
					sourceId: "generic",
					sourceLabel: "Notes",
					url: null,
				},
			});
			const repo = yield* MemoryRepo;
			const before = yield* repo.listRecentMemories(20);
			expect(before.length).toBeGreaterThan(1);
			const workflow = before.find((memory) => memory.text.toLowerCase().includes("workflow"));
			expect(workflow).toBeTruthy();
			if (!workflow) {
				return;
			}
			const linkedBefore = yield* repo.provenanceFor([workflow.id]);
			expect(linkedBefore.length).toBeGreaterThan(0);

			yield* ingestDocument({
				userId: userId,
				request: {
					externalId: "orphan-doc",
					title: "Two sections",
					markdown: [
						"# Prefs",
						"Luv prefers Effect 4 for the yumeoi domain layer and uses it everywhere.",
					].join("\n"),
					sourceId: "generic",
					sourceLabel: "Notes",
					url: null,
				},
			});
			const stillThere = yield* repo.getMemory(workflow.id);
			expect(stillThere.id).toBe(workflow?.id);
			const linkedAfter = yield* repo.provenanceFor([workflow?.id ?? ""]);
			expect(linkedAfter).toEqual([]);
		});

		await Effect.runPromise(program.pipe(Effect.provide(base)));
	});
});
