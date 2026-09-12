import { describe, expect, test } from "bun:test";
import { fillMemory } from "@yumeoi/domain";
import { defaultRetrievalConfig } from "./retrieval/config.ts";
import { fuseMemories, validAt, weightedRrf } from "./retrieval/fuse.ts";
import { packRecall } from "./retrieval/pack.ts";
import { freshness, planQueryFast } from "./retrieval/plan.ts";
import { blendRerank, mmrDiversify } from "./retrieval/rerank.ts";

describe("P3 retrieval helpers", () => {
	test("weighted RRF prefers the higher-weighted list", () => {
		const scores = weightedRrf(
			[
				{ ids: ["a", "b"], weight: 1 },
				{ ids: ["b", "a"], weight: 2 },
			],
			60,
		);
		expect(scores.get("b") ?? 0).toBeGreaterThan(scores.get("a") ?? 0);
	});

	test("asOf validity hides future observations and expired rows", () => {
		const memory = fillMemory({
			id: "m1",
			kind: "fact",
			text: "old",
			confidence: 1,
			validFrom: null,
			validTo: "2026-06-01T00:00:00.000Z",
			supersedes: null,
			observedAt: Date.parse("2026-01-01"),
			state: "superseded",
		});
		expect(validAt(memory, Date.parse("2026-03-01"))).toBe(true);
		expect(validAt(memory, Date.parse("2026-07-01"))).toBe(false);
		expect(validAt({ ...memory, validTo: null, state: "active" }, null)).toBe(true);
	});

	test("procedural freshness does not decay", () => {
		expect(freshness("procedural", 365 * 86_400_000, defaultRetrievalConfig.halfLifeDays)).toBe(1);
		expect(freshness("episodic", 30 * 86_400_000, defaultRetrievalConfig.halfLifeDays)).toBeCloseTo(
			0.5,
			5,
		);
	});

	test("MMR keeps the top item first", () => {
		const scores = new Map([
			["a", 1],
			["b", 0.9],
		]);
		const selected = mmrDiversify(["a", "b"], scores, new Map(), 0.7, 2);
		expect(selected[0]).toBe("a");
	});

	test("feedback-aware fuse boosts useful memories and demotes misses", () => {
		const lists = {
			fts: ["good", "bad"],
			vector: ["good", "bad"],
			graph: [],
			recent: [],
			ftsChunks: [],
			vectorChunks: [],
			vectorValues: new Map<string, ReadonlyArray<number>>(),
		};
		const memories = [
			fillMemory({
				id: "good",
				kind: "fact",
				text: "Luv prefers Effect 4.",
				confidence: 1,
				validFrom: null,
				validTo: null,
				supersedes: null,
				importance: 0.5,
			}),
			fillMemory({
				id: "bad",
				kind: "fact",
				text: "Luv prefers React.",
				confidence: 1,
				validFrom: null,
				validTo: null,
				supersedes: null,
				importance: 0.5,
			}),
		];
		const plan = planQueryFast({ query: "What does Luv prefer?" });
		const baseline = fuseMemories({
			lists,
			memories,
			plan,
			config: defaultRetrievalConfig,
		});
		const ranked = fuseMemories({
			lists,
			memories,
			plan,
			config: defaultRetrievalConfig,
			feedbackById: new Map([
				["good", 4],
				["bad", -2],
			]),
		});
		expect(ranked.get("good") ?? 0).toBeGreaterThan(baseline.get("good") ?? 0);
		expect(ranked.get("bad") ?? 0).toBeLessThan(baseline.get("bad") ?? 0);
	});

	test("rerank blend moves the cross-encoder winner up", () => {
		const fused = new Map([
			["a", 1],
			["b", 0.2],
		]);
		const blended = blendRerank(
			fused,
			[
				{ id: "b", score: 1 },
				{ id: "a", score: 0.1 },
			],
			{
				rerank: 0.6,
				fused: 0.4,
			},
		);
		expect(blended.get("b") ?? 0).toBeGreaterThan(blended.get("a") ?? 0);
	});

	test("fuse ranks Horizon product memories above generic memory articles", () => {
		const lists = {
			fts: ["article", "horizon", "salary"],
			vector: ["salary", "article", "horizon"],
			graph: [],
			recent: [],
			ftsChunks: [],
			vectorChunks: [],
			vectorValues: new Map<string, ReadonlyArray<number>>(),
		};
		const memories = [
			fillMemory({
				id: "article",
				kind: "fact",
				text: "Episodic Memory is a long-term memory (LTM) system in the MNEME paper.",
				confidence: 0.95,
				validFrom: null,
				validTo: null,
				supersedes: null,
				importance: 0.8,
			}),
			fillMemory({
				id: "horizon",
				kind: "fact",
				text: "Horizon is a memory product for continual learning over the user's work context.",
				confidence: 0.9,
				validFrom: null,
				validTo: null,
				supersedes: null,
				importance: 0.7,
			}),
			fillMemory({
				id: "salary",
				kind: "fact",
				text: "Current salary is ₹160k with investments of ₹85k. S&P 500 closed at 1396.87.",
				confidence: 0.99,
				validFrom: null,
				validTo: null,
				supersedes: null,
				importance: 0.95,
			}),
		];
		const plan = planQueryFast({
			query: "Horizon memory product, continual learning, user's work context",
		});
		const scores = fuseMemories({
			lists,
			memories,
			plan,
			config: defaultRetrievalConfig,
		});
		expect(scores.get("horizon") ?? 0).toBeGreaterThan(scores.get("article") ?? 0);
		expect(scores.get("horizon") ?? 0).toBeGreaterThan(scores.get("salary") ?? 0);
	});

	test("packRecall drops weak keyword hits instead of filling the budget", () => {
		const horizon = fillMemory({
			id: "horizon",
			kind: "fact",
			text: "Horizon is a continual-learning memory product for work context.",
			confidence: 0.9,
			validFrom: null,
			validTo: null,
			supersedes: null,
		});
		const article = fillMemory({
			id: "article",
			kind: "fact",
			text: "Episodic Memory / MNEME / LTM notes from a Notion article.",
			confidence: 0.95,
			validFrom: null,
			validTo: null,
			supersedes: null,
		});
		const salary = fillMemory({
			id: "salary",
			kind: "fact",
			text: "Current salary is ₹160k.",
			confidence: 0.99,
			validFrom: null,
			validTo: null,
			supersedes: null,
		});
		const packed = packRecall({
			memories: [article, salary, horizon],
			scores: new Map([
				["horizon", 0.04],
				["article", 0.006],
				["salary", 0.002],
			]),
			why: new Map([
				["horizon", ["kw", "vec"]],
				["article", ["kw"]],
				["salary", ["vec"]],
			]),
			provenance: [],
			chunks: [],
			chunkScores: new Map(),
			chunkMeta: [],
			budgetTokens: 1500,
			includeEvidence: false,
			conflicts: [],
			format: "json",
			scoreFloorRatio: defaultRetrievalConfig.scoreFloorRatio,
			minPackScore: defaultRetrievalConfig.minPackScore,
		});
		expect(packed.memories.map((hit) => hit.memory.id)).toEqual(["horizon"]);
	});
});
