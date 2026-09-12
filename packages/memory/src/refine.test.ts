import { describe, expect, test } from "bun:test";
import {
	inMemoryObjectStoreLayer,
	inMemoryVectorIndexLayer,
	memoryMemoryRepoLayer,
} from "@yumeoi/test-kit";
import { Effect, Layer } from "effect";
import { consolidatorLayer } from "./consolidator.ts";
import { Embeddings } from "./embeddings.ts";
import { extractorLayer } from "./extractor.ts";
import { hashEmbeddingsLayer } from "./hash-embeddings.ts";
import { heuristicLlmLayer } from "./heuristic-llm.ts";
import { ingestDocument } from "./ingest.ts";
import { recordFeedback, updateMemoryRecord } from "./lifecycle.ts";
import { MemoryRepo } from "./memory-repo.ts";
import { memoryVectorId } from "./recall.ts";
import { remember } from "./remember.ts";
import { identityRerankerLayer } from "./reranker.ts";
import { VectorIndex } from "./vector-index.ts";

const userId = "refine-user";

const layerFor = () =>
	Layer.mergeAll(
		memoryMemoryRepoLayer(userId),
		hashEmbeddingsLayer,
		heuristicLlmLayer,
		Layer.provide(extractorLayer, heuristicLlmLayer),
		Layer.provide(consolidatorLayer, heuristicLlmLayer),
		inMemoryVectorIndexLayer(),
		inMemoryObjectStoreLayer(),
		identityRerankerLayer,
	);

describe("feedback refines memory content", () => {
	test("negative feedback with a note rewrites, re-embeds, and keeps the id", async () => {
		const program = Effect.gen(function* () {
			const created = yield* remember({
				userId,
				text: "Luv likes black coffee in the office kitchen.",
				mode: "verbatim",
			});
			const id = created.items[0]?.id ?? "";
			const result = yield* recordFeedback({
				id,
				signal: -1,
				note: "Luv prefers oat milk in coffee.",
				query: "What milk does Luv take in coffee?",
				clientId: userId,
				namespace: userId,
			});
			expect(result.ok).toBe(true);
			expect(result.action).toBe("rewritten");
			expect(result.text?.toLowerCase()).toContain("oat milk");
			const repo = yield* MemoryRepo;
			const stored = yield* repo.getMemory(id);
			expect(stored.text.toLowerCase()).toContain("oat milk");
			expect(stored.text.toLowerCase()).not.toContain("black coffee");
			const history = yield* repo.listHistory(id);
			expect(history.some((row) => row.reason === "refine")).toBe(true);
			const embeddings = yield* Embeddings;
			const [values] = yield* embeddings.embed([stored.text]);
			const index = yield* VectorIndex;
			const hits = yield* index.query({
				values: values ?? [],
				namespace: userId,
				topK: 5,
			});
			expect(hits[0]?.id).toBe(memoryVectorId(id));
			return true;
		});
		expect(await Effect.runPromise(program.pipe(Effect.provide(layerFor())))).toBe(true);
	});

	test("recall-miss feedback re-extracts from the source chunk", async () => {
		const program = Effect.gen(function* () {
			yield* ingestDocument({
				userId,
				request: {
					externalId: "prefs-doc",
					title: "Prefs",
					markdown: "Luv prefers Effect 4 for the yumeoi domain layer.",
					sourceId: "generic",
					sourceLabel: "Notes",
					url: null,
				},
			});
			const repo = yield* MemoryRepo;
			const listed = yield* repo.listMemories({ sources: [], kinds: [], since: null, limit: 20 });
			const memory = listed.find((item) => item.text.toLowerCase().includes("effect 4"));
			expect(memory).toBeTruthy();
			const id = memory?.id ?? "";
			yield* updateMemoryRecord({
				id,
				text: "Luv prefers React for the yumeoi domain layer.",
				namespace: userId,
			});
			const result = yield* recordFeedback({
				id,
				signal: -1,
				query: "What does Luv prefer for the domain layer?",
				clientId: userId,
				namespace: userId,
			});
			expect(result.action).toBe("reextracted");
			const stored = yield* repo.getMemory(id);
			expect(stored.text.toLowerCase()).toContain("effect 4");
			expect(stored.text.toLowerCase()).not.toContain("react");
			return true;
		});
		expect(await Effect.runPromise(program.pipe(Effect.provide(layerFor())))).toBe(true);
	});

	test("positive feedback only scores", async () => {
		const program = Effect.gen(function* () {
			const created = yield* remember({
				userId,
				text: "Luv prefers Effect 4 for the yumeoi domain layer.",
				mode: "verbatim",
			});
			const id = created.items[0]?.id ?? "";
			const before = yield* Effect.flatMap(MemoryRepo, (repo) => repo.getMemory(id));
			const result = yield* recordFeedback({
				id,
				signal: 1,
				clientId: userId,
				namespace: userId,
			});
			expect(result.action).toBe("scored");
			expect(result.text).toBeUndefined();
			const after = yield* Effect.flatMap(MemoryRepo, (repo) => repo.getMemory(id));
			expect(after.text).toBe(before.text);
			expect(after.importance).toBeGreaterThan(before.importance);
			return true;
		});
		expect(await Effect.runPromise(program.pipe(Effect.provide(layerFor())))).toBe(true);
	});
});
