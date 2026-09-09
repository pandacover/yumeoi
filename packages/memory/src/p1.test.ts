import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
	inMemoryObjectStoreLayer,
	inMemoryVectorIndexLayer,
	memoryMemoryRepoLayer,
} from "@yumeoi/test-kit";
import { Effect, Layer } from "effect";
import { classifyStatement } from "./classify.ts";
import { Consolidator, consolidatorLayer } from "./consolidator.ts";
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL, Embeddings } from "./embeddings.ts";
import { scoreClassification, summarizeClassification, type TypesSet } from "./eval.ts";
import { evaluateClassification } from "./eval-run.ts";
import { extractorLayer } from "./extractor.ts";
import { heuristicClassify, heuristicLlmLayer } from "./heuristic-llm.ts";
import { newShortId } from "./ids.ts";
import { MemoryRepo } from "./memory-repo.ts";
import { memoryVectorId } from "./recall.ts";
import { reindexStore } from "./reindex.ts";
import { addMemory, maySupersede, remember } from "./remember.ts";
import { VectorIndex } from "./vector-index.ts";

const userId = "p1-user";

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

const layerFor = (consolidator: Layer.Layer<Consolidator>) =>
	Layer.mergeAll(
		memoryMemoryRepoLayer(userId),
		countingEmbeddings({ calls: 0 }),
		heuristicLlmLayer,
		Layer.provide(extractorLayer, heuristicLlmLayer),
		consolidator,
		inMemoryVectorIndexLayer(),
		inMemoryObjectStoreLayer(),
	);

const typesSet = JSON.parse(
	readFileSync(new URL("../../../docs/eval/types-set.json", import.meta.url), "utf8"),
) as TypesSet;

describe("P1 memory model", () => {
	test("remember merge updates the target text and keeps its id", async () => {
		const program = Effect.gen(function* () {
			const first = yield* addMemory(userId, {
				text: "Luv prefers Effect 4 for the yumeoi domain layer.",
				kind: "preference",
				confidence: 0.9,
			});
			const outcome = yield* remember({
				userId,
				items: [
					{
						text: "Luv prefers Effect 4 for the yumeoi domain layer and keeps it out of React.",
						type: "semantic",
						kind: "preference",
						confidence: 0.9,
					},
				],
			});
			const merged = outcome.items[0];
			expect(merged?.action).toBe("merged");
			expect(merged?.id).toBe(first.id);
			const stored = yield* Effect.flatMap(MemoryRepo, (repo) => repo.getMemory(first.id));
			expect(stored.text).toContain("React");
			expect(stored.type).toBe("semantic");
			expect(stored.state).toBe("active");
		});
		await Effect.runPromise(
			program.pipe(
				Effect.provide(
					layerFor(
						scriptedConsolidator(
							"merge",
							"Luv prefers Effect 4 for the yumeoi domain layer and keeps it out of React.",
						),
					),
				),
			),
		);
	});

	test("remember contradicts keeps both memories and records an edge", async () => {
		const program = Effect.gen(function* () {
			const first = yield* addMemory(userId, {
				text: "Luv prefers Effect 3 for the yumeoi domain layer.",
				kind: "preference",
				confidence: 0.9,
			});
			const outcome = yield* remember({
				userId,
				items: [
					{
						text: "Luv prefers Effect 4 for the yumeoi domain layer.",
						type: "semantic",
						kind: "preference",
						confidence: 0.9,
					},
				],
			});
			const conflict = outcome.items[0];
			expect(conflict?.action).toBe("conflict");
			expect(conflict?.id).not.toBe(first.id);
			expect(conflict?.affected).toContain(first.id);
			const previous = yield* Effect.flatMap(MemoryRepo, (repo) => repo.getMemory(first.id));
			expect(previous.state).toBe("active");
			expect(previous.validTo).toBeNull();
		});
		await Effect.runPromise(
			program.pipe(Effect.provide(layerFor(scriptedConsolidator("contradicts")))),
		);
	});

	test("temporal guard stores an older candidate as superseded", async () => {
		expect(
			maySupersede(
				{ observedAt: 2_000, eventAt: 1_000 },
				{
					id: "m_oldtarget000",
					kind: "event",
					text: "newer",
					confidence: 0.9,
					validFrom: null,
					validTo: null,
					supersedes: null,
					type: "episodic",
					state: "active",
					importance: 0.9,
					eventAt: 1_500,
					observedAt: 1_500,
					updatedAt: 1_500,
					lastAccessedAt: null,
					accessCount: 0,
					retention: 1,
					origin: "extracted",
					clientRef: null,
					entities: [],
				},
				null,
			),
		).toBe(false);

		const program = Effect.gen(function* () {
			const first = yield* remember({
				userId,
				items: [
					{
						text: "On 2026-09-03 Luv and Anna agreed to ship M4 before Gmail.",
						type: "episodic",
						kind: "decision",
						eventAt: "2026-09-03T00:00:00.000Z",
						confidence: 0.9,
					},
				],
				dedupe: false,
			});
			const newer = first.items[0];
			expect(newer?.id).toMatch(/^m_[0-9a-hjkmnp-tv-z]{12}$/);
			const older = yield* remember({
				userId,
				items: [
					{
						text: "On 2026-08-01 Luv and Anna agreed to ship M4 before Gmail.",
						type: "episodic",
						kind: "decision",
						eventAt: "2026-08-01T00:00:00.000Z",
						confidence: 0.9,
					},
				],
			});
			const created = older.items[0];
			expect(created?.action).toBe("created");
			const stored = yield* Effect.flatMap(MemoryRepo, (repo) => repo.getMemory(created?.id ?? ""));
			expect(stored.state).toBe("superseded");
			expect(stored.validTo).not.toBeNull();
			const target = yield* Effect.flatMap(MemoryRepo, (repo) => repo.getMemory(newer?.id ?? ""));
			expect(target.state).toBe("active");
		});
		await Effect.runPromise(
			program.pipe(Effect.provide(layerFor(scriptedConsolidator("supersedes")))),
		);
	});

	test("clientRef retries return the original memory as duplicate", async () => {
		const program = Effect.gen(function* () {
			const first = yield* remember({
				userId,
				items: [
					{
						text: "Luv prefers oat milk in coffee rather than dairy milk.",
						type: "semantic",
						kind: "preference",
						clientRef: "note-oat-1",
						confidence: 0.9,
					},
				],
			});
			const again = yield* remember({
				userId,
				items: [
					{
						text: "Luv prefers oat milk in coffee rather than dairy milk.",
						type: "semantic",
						kind: "preference",
						clientRef: "note-oat-1",
						confidence: 0.9,
					},
				],
			});
			expect(first.items[0]?.action).toBe("created");
			expect(again.items[0]?.action).toBe("duplicate");
			expect(again.items[0]?.id).toBe(first.items[0]?.id);
		});
		await Effect.runPromise(
			program.pipe(Effect.provide(layerFor(scriptedConsolidator("duplicate")))),
		);
	});

	test("classify maps a preference to semantic", async () => {
		const extracted = await Effect.runPromise(
			classifyStatement("Luv prefers Effect 4 for the yumeoi domain layer.").pipe(
				Effect.provide(heuristicLlmLayer),
			),
		);
		expect(extracted.type).toBe("semantic");
		expect(extracted.kind).toBe("preference");
		expect(extracted.entities).toEqual([{ name: "Luv", type: "person" }]);
	});

	test("reindex upserts active vectors and deletes inactive ones", async () => {
		const program = Effect.gen(function* () {
			const active = yield* addMemory(userId, {
				text: "Luv prefers Effect 4 for the yumeoi domain layer.",
				kind: "preference",
				confidence: 0.9,
			});
			const dropped = yield* addMemory(userId, {
				text: "A one-off note about Lisbon flight deals starting at four hundred dollars.",
				kind: "fact",
				confidence: 0.4,
			});
			yield* Effect.flatMap(MemoryRepo, (repo) =>
				repo.updateMemory(dropped.id, {
					state: "forgotten",
					validTo: new Date().toISOString(),
				}),
			);
			const result = yield* reindexStore(userId);
			expect(result.memories).toBeGreaterThan(0);
			expect(result.deleted).toBeGreaterThan(0);
			const index = yield* VectorIndex;
			const embeddings = yield* Embeddings;
			const [values] = yield* embeddings.embed([
				"Luv prefers Effect 4 for the yumeoi domain layer.",
			]);
			const hits = yield* index.query({
				values: values ?? [],
				namespace: userId,
				topK: 10,
			});
			expect(hits.some((hit) => hit.id === memoryVectorId(active.id))).toBe(true);
			expect(hits.some((hit) => hit.id === memoryVectorId(dropped.id))).toBe(false);
		});
		await Effect.runPromise(
			program.pipe(
				Effect.provide(
					Layer.mergeAll(
						memoryMemoryRepoLayer(`${userId}-reindex`),
						countingEmbeddings({ calls: 0 }),
						heuristicLlmLayer,
						Layer.provide(extractorLayer, heuristicLlmLayer),
						Layer.provide(consolidatorLayer, heuristicLlmLayer),
						inMemoryVectorIndexLayer(),
						inMemoryObjectStoreLayer(),
					),
				),
			),
		);
	});

	test("new memories use short ids", async () => {
		const program = Effect.gen(function* () {
			const memory = yield* addMemory(userId, {
				text: "yumeoi stores per-user memories inside a Durable Object.",
				kind: "fact",
				confidence: 0.8,
			});
			expect(memory.id).toMatch(/^m_[0-9a-hjkmnp-tv-z]{12}$/);
			expect(memory.type).toBe("semantic");
			expect(memory.state).toBe("active");
			expect(newShortId("e")).toMatch(/^e_[0-9a-hjkmnp-tv-z]{12}$/);
		});
		await Effect.runPromise(
			program.pipe(
				Effect.provide(
					Layer.mergeAll(
						memoryMemoryRepoLayer(`${userId}-ids`),
						countingEmbeddings({ calls: 0 }),
						heuristicLlmLayer,
						Layer.provide(extractorLayer, heuristicLlmLayer),
						Layer.provide(consolidatorLayer, heuristicLlmLayer),
						inMemoryVectorIndexLayer(),
						inMemoryObjectStoreLayer(),
					),
				),
			),
		);
	});
});

describe("types eval set", () => {
	test("has ~80 balanced labeled statements", () => {
		expect(typesSet.statements.length).toBe(80);
		const counts = { semantic: 0, episodic: 0, procedural: 0 };
		for (const item of typesSet.statements) {
			counts[item.type] += 1;
		}
		expect(counts.semantic).toBeGreaterThanOrEqual(24);
		expect(counts.episodic).toBeGreaterThanOrEqual(24);
		expect(counts.procedural).toBeGreaterThanOrEqual(24);
	});

	test("scoreClassification and the heuristic floor", async () => {
		expect(scoreClassification({ id: "x", text: "t", type: "semantic" }, "semantic").correct).toBe(
			true,
		);
		expect(scoreClassification({ id: "x", text: "t", type: "semantic" }, "episodic").correct).toBe(
			false,
		);
		const heuristicScores = typesSet.statements.map((item) =>
			scoreClassification(item, heuristicClassify(item.text).type),
		);
		const heuristic = summarizeClassification(heuristicScores);
		expect(heuristic.accuracy).toBeGreaterThan(0.5);

		const result = await Effect.runPromise(
			evaluateClassification(typesSet.statements).pipe(Effect.provide(heuristicLlmLayer)),
		);
		expect(result.summary.cases).toBe(80);
		expect(result.summary.accuracy).toBeGreaterThan(0.5);
		expect(result.usage.inputTokens).toBe(0);
	});
});
