import { describe, expect, test } from "bun:test";
import { ProviderUnavailable } from "@yumeoi/domain";
import {
	consolidatorLayer,
	extractorLayer,
	ingestDocument,
	recallContext,
	searchMemories,
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
	inMemoryObjectStoreLayer,
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
			inMemoryObjectStoreLayer,
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
});
