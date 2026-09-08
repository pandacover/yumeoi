import { describe, expect, test } from "bun:test";
import { ProviderUnavailable } from "@yumeoi/domain";
import {
	consolidatorLayer,
	EMBEDDING_DIMENSIONS,
	EMBEDDING_MODEL,
	Embeddings,
	extractorLayer,
	ingestDocument,
	loadDocument,
	MemoryRepo,
	ObjectStore,
	recallContext,
	searchMemories,
	similarExistingMemories,
	VectorIndex,
} from "@yumeoi/memory";
import {
	FakeEmbeddings,
	FakeLlm,
	inMemoryObjectStoreLayer,
	inMemoryVectorIndexLayer,
	memoryMemoryRepoLayer,
} from "@yumeoi/test-kit";
import { Effect, Layer } from "effect";

const unavailableVectorIndexLayer = Layer.succeed(VectorIndex, {
	upsert: () => Effect.fail(new ProviderUnavailable({ provider: "vectorize" })),
	query: () => Effect.fail(new ProviderUnavailable({ provider: "vectorize" })),
});

const layer = Layer.mergeAll(
	memoryMemoryRepoLayer("test-user"),
	FakeEmbeddings,
	FakeLlm,
	Layer.provide(extractorLayer, FakeLlm),
	Layer.provide(consolidatorLayer, FakeLlm),
	inMemoryVectorIndexLayer(),
	inMemoryObjectStoreLayer(),
);

describe("ingest and recall", () => {
	test("ingests markdown and recalls a preference", async () => {
		const program = Effect.gen(function* () {
			const ingest = yield* ingestDocument({
				userId: "test-user",
				request: {
					externalId: "doc-1",
					title: "Preferences",
					markdown:
						"Luv prefers Effect 4 for the yumeoi domain layer. Luv decided to run ingest on Cloudflare Workflows. Luv needs to ship M1 this week.",
					sourceId: "generic",
					sourceLabel: "Notes",
					url: null,
				},
			});
			expect(ingest.unchanged).toBe(false);
			expect(ingest.chunkCount).toBeGreaterThan(0);
			expect(ingest.memoryCount).toBeGreaterThan(0);

			const hits = yield* searchMemories({
				query: "Effect 4",
				namespace: "test-user",
				sources: [],
				kinds: [],
				since: null,
				limit: 10,
			});
			expect(hits.some((hit) => hit.memory.text.toLowerCase().includes("effect"))).toBe(true);

			const recalled = yield* recallContext({
				query: "What does Luv prefer?",
				namespace: "test-user",
				sources: [],
				kinds: [],
				since: null,
				budgetTokens: 800,
				rerank: false,
			});
			expect(recalled.memories.length).toBeGreaterThan(0);
			return ingest;
		});

		await Effect.runPromise(program.pipe(Effect.provide(layer)));
	});

	test("skips unchanged content hashes", async () => {
		const program = Effect.gen(function* () {
			const request = {
				externalId: "doc-2",
				title: "Same",
				markdown: "Luv prefers dark mode in the editor at all times.",
				sourceId: "generic",
				sourceLabel: "Notes",
				url: null,
			};
			const first = yield* ingestDocument({ userId: "test-user", request });
			const second = yield* ingestDocument({ userId: "test-user", request });
			expect(first.unchanged).toBe(false);
			expect(second.unchanged).toBe(true);
			expect(second.documentId).toBe(first.documentId);
		});

		await Effect.runPromise(program.pipe(Effect.provide(layer)));
	});

	test("falls back to keyword search when Vectorize is down", async () => {
		const fallback = Layer.mergeAll(
			memoryMemoryRepoLayer("fts-user"),
			FakeEmbeddings,
			FakeLlm,
			Layer.provide(extractorLayer, FakeLlm),
			Layer.provide(consolidatorLayer, FakeLlm),
			unavailableVectorIndexLayer,
			inMemoryObjectStoreLayer(),
		);
		const program = Effect.gen(function* () {
			yield* ingestDocument({
				userId: "fts-user",
				request: {
					externalId: "fts-doc",
					title: "FTS",
					markdown: "yumeoi stores memories in Durable Object SQLite with FTS5.",
					sourceId: "generic",
					sourceLabel: "Notes",
					url: null,
				},
			});
			const hits = yield* searchMemories({
				query: "FTS5",
				namespace: "fts-user",
				sources: [],
				kinds: [],
				since: null,
				limit: 10,
			});
			expect(hits.some((hit) => hit.memory.text.includes("FTS5"))).toBe(true);
		});
		await Effect.runPromise(program.pipe(Effect.provide(fallback)));
	});

	test("consolidation candidates use vector search when the index is available", async () => {
		const program = Effect.gen(function* () {
			yield* ingestDocument({
				userId: "test-user",
				request: {
					externalId: "vec-doc",
					title: "Preferences",
					markdown: "Luv prefers Effect 4 for the yumeoi domain layer.",
					sourceId: "generic",
					sourceLabel: "Notes",
					url: null,
				},
			});
			const embeddings = yield* Embeddings;
			const [values] = yield* embeddings.embed(["Luv prefers Effect 4 for domain work"]);
			const similar = yield* similarExistingMemories({
				userId: "test-user",
				text: "Luv prefers Effect 4 for domain work",
				values: values ?? [],
				inBatch: [],
				inBatchValues: new Map(),
			});
			expect(similar.some((memory) => memory.text.toLowerCase().includes("effect"))).toBe(true);
		});
		await Effect.runPromise(program.pipe(Effect.provide(layer)));
	});

	test("falls back to substring overlap when Vectorize is unavailable", async () => {
		const fallback = Layer.mergeAll(
			memoryMemoryRepoLayer("overlap-user"),
			FakeEmbeddings,
			FakeLlm,
			Layer.provide(extractorLayer, FakeLlm),
			Layer.provide(consolidatorLayer, FakeLlm),
			unavailableVectorIndexLayer,
			inMemoryObjectStoreLayer(),
		);
		const program = Effect.gen(function* () {
			yield* ingestDocument({
				userId: "overlap-user",
				request: {
					externalId: "overlap-doc",
					title: "Preferences",
					markdown: "Luv prefers Effect 4 for the yumeoi domain layer.",
					sourceId: "generic",
					sourceLabel: "Notes",
					url: null,
				},
			});
			const similar = yield* similarExistingMemories({
				userId: "overlap-user",
				text: "Luv prefers Effect 4 for the domain layer",
				values: Array.from({ length: 8 }, () => 0),
				inBatch: [],
				inBatchValues: new Map(),
			});
			expect(similar.some((memory) => memory.text.toLowerCase().includes("effect"))).toBe(true);
		});
		await Effect.runPromise(program.pipe(Effect.provide(fallback)));
	});

	test("skips embedding reused chunks on a partial rewrite", async () => {
		const counts = { texts: 0 };
		const countingEmbeddings = Layer.succeed(Embeddings, {
			model: EMBEDDING_MODEL,
			dimensions: EMBEDDING_DIMENSIONS,
			embed: (texts) =>
				Effect.sync(() => {
					counts.texts += texts.length;
					return texts.map((text, index) =>
						Array.from(
							{ length: EMBEDDING_DIMENSIONS },
							(_, i) => ((text.charCodeAt(i % Math.max(text.length, 1)) + index + i) % 100) / 100,
						),
					);
				}),
		});
		const counting = Layer.mergeAll(
			memoryMemoryRepoLayer("skip-user"),
			countingEmbeddings,
			FakeLlm,
			Layer.provide(extractorLayer, FakeLlm),
			Layer.provide(consolidatorLayer, FakeLlm),
			inMemoryVectorIndexLayer(),
			inMemoryObjectStoreLayer(),
		);
		const firstMarkdown = [
			"# Prefs",
			"Luv prefers Effect 4 for the yumeoi domain layer and uses it everywhere.",
			"",
			"# Work",
			"Luv decided to run ingest on Cloudflare Workflows for durability.",
		].join("\n");
		const secondMarkdown = [
			"# Prefs",
			"Luv prefers Effect 4 for the yumeoi domain layer and uses it everywhere.",
			"",
			"# Work",
			"Luv decided to ship M1 with OpenRouter as the default LLM provider.",
		].join("\n");
		const program = Effect.gen(function* () {
			const first = yield* ingestDocument({
				userId: "skip-user",
				request: {
					externalId: "skip-doc",
					title: "Skip",
					markdown: firstMarkdown,
					sourceId: "generic",
					sourceLabel: "Notes",
					url: null,
				},
			});
			const afterFirst = counts.texts;
			const second = yield* ingestDocument({
				userId: "skip-user",
				request: {
					externalId: "skip-doc",
					title: "Skip",
					markdown: secondMarkdown,
					sourceId: "generic",
					sourceLabel: "Notes",
					url: null,
				},
			});
			expect(first.unchanged).toBe(false);
			expect(second.unchanged).toBe(false);
			expect(second.skippedChunks).toBeGreaterThan(0);
			expect(counts.texts - afterFirst).toBeLessThan(afterFirst);
		});
		await Effect.runPromise(program.pipe(Effect.provide(counting)));
	});

	test("hydrates get_document markdown from the object store", async () => {
		const objects = inMemoryObjectStoreLayer();
		const layerWithStore = Layer.mergeAll(
			memoryMemoryRepoLayer("r2-user"),
			FakeEmbeddings,
			FakeLlm,
			Layer.provide(extractorLayer, FakeLlm),
			Layer.provide(consolidatorLayer, FakeLlm),
			inMemoryVectorIndexLayer(),
			objects,
		);
		const program = Effect.gen(function* () {
			const ingest = yield* ingestDocument({
				userId: "r2-user",
				request: {
					externalId: "r2-doc",
					title: "R2",
					markdown: "Luv prefers Effect 4 for the yumeoi domain layer.",
					sourceId: "generic",
					sourceLabel: "Notes",
					url: null,
					metadata: { origin: "test" },
				},
			});
			const repo = yield* MemoryRepo;
			const stored = yield* repo.getDocument(ingest.documentId);
			expect(stored.r2Key).toBeTruthy();
			const objectStore = yield* ObjectStore;
			yield* objectStore.put(
				stored.r2Key ?? "",
				JSON.stringify({
					title: "From R2",
					markdown: "hydrated-from-r2",
					url: "https://example.test/r2",
				}),
			);
			const loaded = yield* loadDocument(ingest.documentId);
			expect(loaded.markdown).toBe("hydrated-from-r2");
			expect(loaded.title).toBe("From R2");
		});
		await Effect.runPromise(program.pipe(Effect.provide(layerWithStore)));
	});
});
