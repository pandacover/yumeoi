import { describe, expect, test } from "bun:test";
import {
	inMemoryObjectStoreLayer,
	inMemoryVectorIndexLayer,
	memoryMemoryRepoLayer,
} from "@yumeoi/test-kit";
import { Effect, Layer } from "effect";
import { consolidatorLayer } from "./consolidator.ts";
import { extractorLayer } from "./extractor.ts";
import { hashEmbeddingsLayer } from "./hash-embeddings.ts";
import { heuristicLlmLayer } from "./heuristic-llm.ts";
import { changesSince, profileLines, promoteEpisodes, timelineAbout } from "./layers/promote.ts";
import { MemoryRepo } from "./memory-repo.ts";
import { recallContext } from "./recall.ts";
import { remember } from "./remember.ts";
import { identityRerankerLayer } from "./reranker.ts";

const userId = "p5-user";
const MS_DAY = 86_400_000;

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

describe("P5 temporal and layers", () => {
	test("asOf returns only the version valid at T", async () => {
		const t1 = Date.parse("2026-01-15T00:00:00.000Z");
		const t2 = Date.parse("2026-06-15T00:00:00.000Z");
		const mid = Date.parse("2026-03-01T00:00:00.000Z");
		const program = Effect.gen(function* () {
			const first = yield* remember({
				userId,
				items: [
					{
						text: "Notion polling is scheduled every 15 minutes.",
						type: "semantic",
						kind: "fact",
					},
				],
				mode: "verbatim",
				observedAt: t1,
				dedupe: false,
			});
			const oldId = first.items[0]?.id ?? "";
			yield* Effect.flatMap(MemoryRepo, (repo) =>
				repo.updateMemory(oldId, {
					validTo: new Date(t2).toISOString(),
					state: "superseded",
					observedAt: t1,
				}),
			);
			yield* remember({
				userId,
				items: [
					{
						text: "Notion polling is scheduled every 10 minutes.",
						type: "semantic",
						kind: "fact",
					},
				],
				mode: "verbatim",
				observedAt: t2,
				dedupe: false,
			});
			const atMarch = yield* recallContext({
				query: "Notion polling interval",
				namespace: userId,
				asOf: mid,
				rerank: false,
			});
			const atJuly = yield* recallContext({
				query: "Notion polling interval",
				namespace: userId,
				asOf: Date.parse("2026-07-01T00:00:00.000Z"),
				rerank: false,
			});
			const marchText = atMarch.memories.map((hit) => hit.memory.text).join(" ");
			const julyText = atJuly.memories.map((hit) => hit.memory.text).join(" ");
			expect(marchText).toContain("15 minutes");
			expect(marchText).not.toContain("10 minutes");
			expect(julyText).toContain("10 minutes");
			expect(julyText).not.toContain("15 minutes");
			return true;
		});
		expect(await Effect.runPromise(program.pipe(Effect.provide(layerFor())))).toBe(true);
	});

	test("timeline and changes_since surface history", async () => {
		const program = Effect.gen(function* () {
			const created = yield* remember({
				userId,
				items: [
					{
						text: "On 2026-08-12 Luv met Anna about Project Aurora.",
						type: "episodic",
						kind: "event",
					},
				],
				mode: "verbatim",
			});
			const id = created.items[0]?.id ?? "";
			yield* Effect.flatMap(MemoryRepo, (repo) =>
				repo.insertHistory({
					memoryId: id,
					text: created.items[0]?.text ?? "",
					type: "episodic",
					kind: "event",
					confidence: 0.9,
					validFrom: null,
					validTo: null,
					state: "active",
					reason: "correct",
				}),
			);
			const events = yield* timelineAbout({ userId, about: "Anna" });
			expect(events.some((memory) => memory.text.includes("Aurora"))).toBe(true);
			const changes = yield* changesSince(0);
			expect(changes.some((row) => row.memoryId === id)).toBe(true);
			return true;
		});
		expect(await Effect.runPromise(program.pipe(Effect.provide(layerFor())))).toBe(true);
	});

	test("promotion writes derived_from edges", async () => {
		const old = Date.now() - 20 * MS_DAY;
		const program = Effect.gen(function* () {
			for (const suffix of ["one", "two", "three"]) {
				yield* remember({
					userId,
					items: [
						{
							text: `On 2026-01-01 Luv met Anna about Aurora planning ${suffix}.`,
							type: "episodic",
							kind: "event",
							importance: 0.6,
						},
					],
					mode: "verbatim",
					origin: "extracted",
					observedAt: old,
					dedupe: false,
				});
			}
			const result = yield* promoteEpisodes(userId, Date.now());
			expect(result.created).toBeGreaterThan(0);
			const repo = yield* MemoryRepo;
			const edges = yield* repo.listEdges(result.ids);
			expect(edges.some((edge) => edge.relation === "derived_from")).toBe(true);
			return true;
		});
		expect(await Effect.runPromise(program.pipe(Effect.provide(layerFor())))).toBe(true);
	});

	test("profile is stable semantic memories only", async () => {
		const program = Effect.gen(function* () {
			yield* remember({
				userId,
				items: [
					{
						text: "Luv prefers Effect 4 for the yumeoi domain layer.",
						type: "semantic",
						kind: "preference",
					},
				],
				mode: "verbatim",
				origin: "agent",
			});
			yield* remember({
				userId,
				items: [
					{
						text: "On 2026-08-12 Luv met Anna about lunch plans.",
						type: "episodic",
						kind: "event",
					},
				],
				mode: "verbatim",
				origin: "chat",
			});
			const profile = yield* profileLines(userId);
			expect(profile.toLowerCase()).toContain("effect 4");
			expect(profile.toLowerCase()).not.toContain("lunch plans");
			return true;
		});
		expect(await Effect.runPromise(program.pipe(Effect.provide(layerFor())))).toBe(true);
	});
});
