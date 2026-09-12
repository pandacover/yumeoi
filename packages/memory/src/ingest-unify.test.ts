import { describe, expect, test } from "bun:test";
import {
	inMemoryObjectStoreLayer,
	inMemoryVectorIndexLayer,
	memoryMemoryRepoLayer,
} from "@yumeoi/test-kit";
import { Effect, Layer } from "effect";
import { Consolidator } from "./consolidator.ts";
import { extractorLayer } from "./extractor.ts";
import { hashEmbeddingsLayer } from "./hash-embeddings.ts";
import { heuristicLlmLayer } from "./heuristic-llm.ts";
import { ingestDocument } from "./ingest.ts";
import { MemoryRepo } from "./memory-repo.ts";
import { addMemory } from "./remember.ts";
import { identityRerankerLayer } from "./reranker.ts";

const scriptedConsolidator = (
	action: "duplicate" | "supersedes" | "merge" | "contradicts",
	mergedText: string | null = null,
) =>
	Layer.succeed(Consolidator, {
		decide: (_candidate, existing) =>
			Effect.succeed(
				existing[0]
					? { action, targetId: existing[0].id, mergedText, reason: action }
					: { action: "new", targetId: null, mergedText: null, reason: "new" },
			),
	});

const layerFor = (userId: string, consolidator: Layer.Layer<Consolidator>) =>
	Layer.mergeAll(
		memoryMemoryRepoLayer(userId),
		hashEmbeddingsLayer,
		heuristicLlmLayer,
		Layer.provide(extractorLayer, heuristicLlmLayer),
		consolidator,
		inMemoryVectorIndexLayer(),
		inMemoryObjectStoreLayer(),
		identityRerankerLayer,
	);

describe("ingest uses remember consolidation and graph writes", () => {
	test("ingest merge updates the existing memory instead of inserting a duplicate", async () => {
		const userId = "ingest-merge-user";
		const program = Effect.gen(function* () {
			const first = yield* addMemory(userId, {
				text: "Luv prefers Effect 4 for the yumeoi domain layer.",
				kind: "preference",
				confidence: 0.9,
			});
			yield* ingestDocument({
				userId,
				request: {
					externalId: "merge-doc",
					title: "Prefs",
					markdown:
						"Luv prefers Effect 4 for the yumeoi domain layer and keeps it out of React components.",
					sourceId: "generic",
					sourceLabel: "Notes",
					url: null,
				},
			});
			const stored = yield* Effect.flatMap(MemoryRepo, (repo) => repo.getMemory(first.id));
			expect(stored.text.toLowerCase()).toContain("react");
			const listed = yield* Effect.flatMap(MemoryRepo, (repo) =>
				repo.listMemories({ sources: [], kinds: [], since: null, limit: 20 }),
			);
			expect(listed.filter((memory) => memory.state === "active").length).toBe(1);
		});
		await Effect.runPromise(
			program.pipe(
				Effect.provide(
					layerFor(
						userId,
						scriptedConsolidator(
							"merge",
							"Luv prefers Effect 4 for the yumeoi domain layer and keeps it out of React components.",
						),
					),
				),
			),
		);
	});

	test("ingest contradicts keeps both memories and records an edge", async () => {
		const userId = "ingest-conflict-user";
		const program = Effect.gen(function* () {
			const first = yield* addMemory(userId, {
				text: "Luv prefers Effect 3 for the yumeoi domain layer.",
				kind: "preference",
				confidence: 0.9,
			});
			yield* ingestDocument({
				userId,
				request: {
					externalId: "conflict-doc",
					title: "Prefs",
					markdown: "Luv prefers Effect 4 for the yumeoi domain layer in every package.",
					sourceId: "generic",
					sourceLabel: "Notes",
					url: null,
				},
			});
			const repo = yield* MemoryRepo;
			const previous = yield* repo.getMemory(first.id);
			expect(previous.state).toBe("active");
			const listed = yield* repo.listMemories({ sources: [], kinds: [], since: null, limit: 20 });
			expect(listed.length).toBeGreaterThanOrEqual(2);
			const edges = yield* repo.listEdges(listed.map((memory) => memory.id));
			expect(edges.some((edge) => edge.relation === "contradicts")).toBe(true);
		});
		await Effect.runPromise(
			program.pipe(Effect.provide(layerFor(userId, scriptedConsolidator("contradicts")))),
		);
	});

	test("ingest writes graph entities from extracted mentions", async () => {
		const userId = "ingest-graph-user";
		const program = Effect.gen(function* () {
			yield* ingestDocument({
				userId,
				request: {
					externalId: "graph-doc",
					title: "People",
					markdown: "Luv prefers Effect 4 for the yumeoi domain layer.",
					sourceId: "generic",
					sourceLabel: "Notes",
					url: null,
				},
			});
			const repo = yield* MemoryRepo;
			const luv = yield* repo.findEntity("luv", "person");
			expect(luv).not.toBeNull();
			expect(luv?.name).toBe("Luv");
			const memories = yield* repo.listMemories({ sources: [], kinds: [], since: null, limit: 10 });
			expect(
				memories.some((memory) => memory.entities.some((entity) => entity.name === "Luv")),
			).toBe(true);
		});
		await Effect.runPromise(
			program.pipe(
				Effect.provide(
					layerFor(
						userId,
						Layer.succeed(Consolidator, {
							decide: () =>
								Effect.succeed({
									action: "new",
									targetId: null,
									mergedText: null,
									reason: "new",
								}),
						}),
					),
				),
			),
		);
	});
});
