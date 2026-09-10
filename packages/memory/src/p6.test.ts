import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fillMemory } from "@yumeoi/domain";
import {
	inMemoryObjectStoreLayer,
	inMemoryVectorIndexLayer,
	memoryMemoryRepoLayer,
} from "@yumeoi/test-kit";
import { Effect, Layer } from "effect";
import { mutableClockLayer } from "./clock.ts";
import { consolidatorLayer } from "./consolidator.ts";
import type { RecallSet } from "./eval.ts";
import { scoreRecall, summarizeRecall } from "./eval.ts";
import { extractorLayer } from "./extractor.ts";
import { formatMemoryLine } from "./format.ts";
import { hashEmbeddingsLayer } from "./hash-embeddings.ts";
import { heuristicLlmLayer } from "./heuristic-llm.ts";
import { ingestDocument } from "./ingest.ts";
import { forgetMemories } from "./lifecycle.ts";
import { MemoryRepo } from "./memory-repo.ts";
import { recallContext } from "./recall.ts";
import { remember } from "./remember.ts";
import { identityRerankerLayer } from "./reranker.ts";
import { FORGET_GRACE_MS, isSemanticStale, MS_DAY } from "./retention.ts";
import { restoreArchivedMemory, sweepStore } from "./sweep.ts";

const userId = "p6-user";

const layerFor = (box: { now: number }, deleted: string[] = []) =>
	Layer.mergeAll(
		memoryMemoryRepoLayer(userId),
		hashEmbeddingsLayer,
		heuristicLlmLayer,
		Layer.provide(extractorLayer, heuristicLlmLayer),
		Layer.provide(consolidatorLayer, heuristicLlmLayer),
		inMemoryVectorIndexLayer({ onDelete: (ids) => deleted.push(...ids) }),
		inMemoryObjectStoreLayer(),
		identityRerankerLayer,
		mutableClockLayer(box),
	);

const relevantQueries = [
	"What does Luv prefer for the domain layer?",
	"What editor preference does Luv have?",
	"What model does chat use?",
	"Who leads Project Aurora?",
];

describe("P6 decay and lifecycle", () => {
	test("stale semantic memories render a last-confirmed warning", () => {
		const memory = fillMemory({
			id: "m_stale0000001",
			kind: "fact",
			text: "Luv prefers Effect 4 for the domain layer.",
			confidence: 0.9,
			validFrom: null,
			validTo: null,
			supersedes: null,
			type: "semantic",
			observedAt: 0,
		});
		expect(isSemanticStale(memory, 2 * 365 * MS_DAY)).toBe(true);
		const line = formatMemoryLine(1, {
			memory,
			score: 1,
			provenance: [],
			stale: true,
		});
		expect(line).toContain("⚠ last confirmed");
	});

	test("orphans are marked dormant with source_removed history", async () => {
		const box = { now: Date.now() };
		const program = Effect.gen(function* () {
			yield* ingestDocument({
				userId,
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
			const workflow = before.find((memory) => memory.text.toLowerCase().includes("workflow"));
			expect(workflow).toBeTruthy();
			yield* ingestDocument({
				userId,
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
			const leftover = yield* repo.getMemory(workflow?.id ?? "");
			expect(leftover.state).toBe("dormant");
			const history = yield* repo.listHistory(leftover.id);
			expect(history.some((row) => row.reason === "source_removed")).toBe(true);
			return true;
		});
		expect(await Effect.runPromise(program.pipe(Effect.provide(layerFor(box))))).toBe(true);
	});

	test("exact duplicates are merged and budget dormants the lowest retention", async () => {
		const box = { now: Date.now() };
		const program = Effect.gen(function* () {
			for (let i = 0; i < 2; i++) {
				yield* remember({
					userId,
					items: [
						{
							text: "Always cite memories with numbered marks when answering.",
							type: "procedural",
							kind: "rule",
							importance: 0.4,
						},
					],
					mode: "verbatim",
					dedupe: false,
					origin: "extracted",
				});
			}
			yield* remember({
				userId,
				items: [
					{
						text: "Incidental newsletter about a coffee shop opening nearby.",
						type: "episodic",
						kind: "event",
						importance: 0.05,
					},
				],
				mode: "verbatim",
				dedupe: false,
				origin: "extracted",
			});
			const merged = yield* sweepStore({ userId, now: box.now, skipPromote: true });
			expect(merged.merged.length).toBeGreaterThan(0);
			const budget = yield* sweepStore({
				userId,
				now: box.now,
				skipPromote: true,
				maxActive: 1,
			});
			expect(budget.budgeted.length).toBeGreaterThan(0);
			const stats = yield* Effect.flatMap(MemoryRepo, (repo) => repo.getStats());
			expect(stats.active).toBeLessThanOrEqual(1);
			return true;
		});
		expect(await Effect.runPromise(program.pipe(Effect.provide(layerFor(box))))).toBe(true);
	});

	test("forget waits 30 days then hard-deletes; restore returns archived rows", async () => {
		const box = { now: Date.now() };
		const deleted: string[] = [];
		const program = Effect.gen(function* () {
			const created = yield* remember({
				userId,
				items: [
					{
						text: "Luv asked to forget this scratch note about lunch.",
						type: "semantic",
						kind: "fact",
						importance: 0.2,
					},
				],
				mode: "verbatim",
				origin: "agent",
			});
			const id = created.items[0]?.id ?? "";
			yield* forgetMemories({ id, userId, confirm: true });
			const forgotten = yield* Effect.flatMap(MemoryRepo, (repo) => repo.getMemory(id));
			expect(forgotten.state).toBe("forgotten");
			yield* sweepStore({
				userId,
				now: box.now + FORGET_GRACE_MS + MS_DAY,
				skipPromote: true,
			});
			const gone = yield* Effect.flatMap(MemoryRepo, (repo) =>
				repo.getMemory(id).pipe(
					Effect.map(() => false),
					Effect.orElseSucceed(() => true),
				),
			);
			expect(gone).toBe(true);

			const noisy = yield* remember({
				userId,
				items: [
					{
						text: "On 2026-01-01 Luv mentioned a throwaway hallway chat about snacks.",
						type: "episodic",
						kind: "event",
						importance: 0.05,
					},
				],
				mode: "verbatim",
				origin: "extracted",
				observedAt: box.now,
			});
			const noisyId = noisy.items[0]?.id ?? "";
			const repo = yield* MemoryRepo;
			yield* repo.updateMemory(noisyId, { state: "dormant", retention: 0.05 });
			yield* repo.insertHistory({
				memoryId: noisyId,
				text: noisy.items[0]?.text ?? "",
				type: "episodic",
				kind: "event",
				confidence: 0.5,
				validFrom: null,
				validTo: null,
				state: "dormant",
				reason: "decay",
				changedAt: box.now,
			});
			yield* sweepStore({
				userId,
				now: box.now + 90 * MS_DAY,
				skipPromote: true,
			});
			const archived = yield* repo.getMemory(noisyId);
			expect(archived.state).toBe("archived");
			const restored = yield* restoreArchivedMemory(noisyId, userId);
			expect(restored.state).toBe("active");
			const docs = yield* repo.listDocuments();
			expect(docs.length).toBeGreaterThan(0);
			return true;
		});
		expect(await Effect.runPromise(program.pipe(Effect.provide(layerFor(box, deleted))))).toBe(
			true,
		);
		expect(deleted.some((id) => id.startsWith("m:"))).toBe(true);
	});

	test("180-day decay simulation shrinks the active set without losing relevant recall or documents", async () => {
		const set = JSON.parse(
			readFileSync(new URL("../../../docs/eval/recall-set.json", import.meta.url), "utf8"),
		) as RecallSet;
		const t0 = Date.now();
		const box = { now: t0 };
		const deleted: string[] = [];
		const program = Effect.gen(function* () {
			for (const document of set.documents) {
				yield* ingestDocument({
					userId,
					request: {
						externalId: document.id,
						title: document.title,
						markdown: document.markdown,
						sourceId: document.sourceId ?? "notes",
						sourceLabel: document.sourceLabel ?? "Notes",
						url: null,
					},
				});
			}
			for (let i = 0; i < 40; i++) {
				yield* remember({
					userId,
					items: [
						{
							text: `On 2026-01-01 newsletter ${i} mentioned a cafe opening on side street ${i}.`,
							type: "episodic",
							kind: "event",
							importance: 0.05,
						},
					],
					mode: "verbatim",
					origin: "extracted",
					observedAt: t0,
					dedupe: false,
				});
			}
			const repo = yield* MemoryRepo;
			const docsBefore = yield* repo.listDocuments();
			const activeBefore = yield* repo.countActive();
			const scoreRelevant = Effect.gen(function* () {
				const scores = [];
				for (const query of relevantQueries) {
					const result = yield* recallContext({
						query,
						namespace: userId,
						rerank: false,
					});
					const packed = result.memories.map((hit) => ({
						text: hit.memory.text,
						kind: hit.memory.kind,
					}));
					const expected = set.queries.find((item) => item.query === query)?.expected ?? [
						{ contains: query.split(" ").slice(-1)[0] ?? "Effect" },
					];
					scores.push(scoreRecall({ id: query, query, expected }, packed));
				}
				return summarizeRecall(scores).recallAt10;
			});
			const recallBefore = yield* scoreRelevant;
			for (let day = 0; day < 180; day++) {
				box.now = t0 + day * MS_DAY;
				if (day % 7 === 0) {
					for (const query of relevantQueries) {
						yield* recallContext({ query, namespace: userId, rerank: false });
					}
				}
				yield* sweepStore({
					userId,
					now: box.now,
					skipPromote: true,
					log: false,
				});
			}
			const activeAfter = yield* repo.countActive();
			const recallAfter = yield* scoreRelevant;
			const docsAfter = yield* repo.listDocuments();
			const archived = yield* repo.listArchived(200);
			expect(activeAfter).toBeLessThanOrEqual(activeBefore * 0.7);
			expect(recallBefore - recallAfter).toBeLessThanOrEqual(0.02);
			expect(docsAfter).toEqual(docsBefore);
			for (const memory of archived) {
				expect(deleted).toContain(`m:${memory.id}`);
			}
			const stats = yield* repo.getStats();
			expect(stats.lastSweepAt).toBe(box.now);
			expect(stats.archived).toBeGreaterThan(0);
			return true;
		});
		expect(await Effect.runPromise(program.pipe(Effect.provide(layerFor(box, deleted))))).toBe(
			true,
		);
	}, 60_000);
});
