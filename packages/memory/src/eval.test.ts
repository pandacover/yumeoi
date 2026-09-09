import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Effect, Layer } from "effect";
import {
	type EvalSet,
	scoreConsolidate,
	scoreExtraction,
	scoreRecall,
	scoreRerank,
	summarizeExtraction,
	summarizeScores,
} from "./eval.ts";
import { evaluateExtraction } from "./eval-run.ts";
import { extractorLayer } from "./extractor.ts";
import { heuristicExtract, heuristicLlmLayer } from "./heuristic-llm.ts";

const set = JSON.parse(
	readFileSync(new URL("../../../docs/eval/m1-set.json", import.meta.url), "utf8"),
) as EvalSet;

describe("m1 eval set", () => {
	test("has 20-50 labeled docs covering every kind", () => {
		expect(set.documents.length).toBeGreaterThanOrEqual(20);
		expect(set.documents.length).toBeLessThanOrEqual(50);
		const kinds = new Set(set.documents.flatMap((doc) => doc.expected.map((item) => item.kind)));
		for (const kind of ["fact", "preference", "decision", "task", "relationship", "event"]) {
			expect(kinds.has(kind as (typeof set.documents)[number]["expected"][number]["kind"])).toBe(
				true,
			);
		}
	});

	test("has labeled consolidate and rerank cases", () => {
		expect(set.consolidate.length).toBeGreaterThanOrEqual(10);
		expect(set.rerank.length).toBeGreaterThanOrEqual(6);
		const actions = new Set(set.consolidate.map((item) => item.expected.action));
		expect(actions.has("new")).toBe(true);
		expect(actions.has("duplicate")).toBe(true);
		expect(actions.has("supersedes")).toBe(true);
	});
});

describe("extraction scoring", () => {
	test("scores a perfect extract", () => {
		const doc = set.documents[0];
		if (!doc) {
			throw new Error("missing doc");
		}
		const score = scoreExtraction(doc, [
			{
				kind: "preference",
				text: "Luv prefers Effect 4 for the domain layer.",
				confidence: 0.9,
				validFrom: null,
			},
			{
				kind: "fact",
				text: "The team keeps Effect out of React components.",
				confidence: 0.8,
				validFrom: null,
			},
		]);
		expect(score.precision).toBe(1);
		expect(score.recall).toBe(1);
		expect(score.f1).toBe(1);
	});

	test("penalizes extra unmatched memories", () => {
		const doc = set.documents[5];
		if (!doc) {
			throw new Error("missing doc");
		}
		const score = scoreExtraction(doc, [
			{
				kind: "preference",
				text: "Luv prefers dark mode in the editor.",
				confidence: 0.9,
				validFrom: null,
			},
			{ kind: "fact", text: "The sky is green on Tuesdays.", confidence: 0.2, validFrom: null },
		]);
		expect(score.recall).toBe(1);
		expect(score.precision).toBe(0.5);
	});

	test("heuristic extractor scores against the labeled set", () => {
		const scores = set.documents.map((doc) =>
			scoreExtraction(doc, heuristicExtract(`${doc.title}\n\n${doc.markdown}`)),
		);
		const summary = summarizeScores(scores);
		expect(summary.documents).toBe(set.documents.length);
		expect(summary.recall).toBeGreaterThan(0.3);
		expect(summary.precision).toBeGreaterThan(0.2);
	});

	test("evaluateExtraction records zero tokens for the heuristic layer", async () => {
		const layer = Layer.mergeAll(
			heuristicLlmLayer,
			Layer.provide(extractorLayer, heuristicLlmLayer),
		);
		const result = await Effect.runPromise(
			evaluateExtraction(set.documents.slice(0, 2)).pipe(Effect.provide(layer)),
		);
		expect(result.documents.length).toBe(2);
		expect(result.usage.inputTokens).toBe(0);
		expect(result.usage.outputTokens).toBe(0);
		expect(result.usage.reasoningTokens).toBe(0);
	});

	test("averages across the labeled set for a naive extractor", () => {
		const scores = set.documents.map((doc) =>
			scoreExtraction(doc, [
				{
					kind: doc.expected[0]?.kind ?? "fact",
					text: `${doc.markdown}`,
					confidence: 0.5,
					validFrom: null,
				},
			]),
		);
		const summary = summarizeExtraction(scores);
		expect(summary.documents).toBe(set.documents.length);
		expect(summary.recall).toBeGreaterThan(0);
	});
});

describe("consolidate scoring", () => {
	test("requires matching action and target", () => {
		const item = set.consolidate[0];
		if (!item) {
			throw new Error("missing case");
		}
		expect(scoreConsolidate(item, { action: "duplicate", targetId: "m1" }).correct).toBe(true);
		expect(scoreConsolidate(item, { action: "new", targetId: null }).correct).toBe(false);
	});
});

describe("rerank scoring", () => {
	test("gives ndcg 1 when gold is first and permutation is complete", () => {
		const item = set.rerank[0];
		if (!item) {
			throw new Error("missing case");
		}
		const score = scoreRerank(item, ["a", "b", "c", "d"]);
		expect(score.top1).toBe(true);
		expect(score.complete).toBe(true);
		expect(score.ndcg).toBe(1);
	});

	test("drops ndcg when gold is last", () => {
		const item = set.rerank[0];
		if (!item) {
			throw new Error("missing case");
		}
		const score = scoreRerank(item, ["b", "c", "d", "a"]);
		expect(score.top1).toBe(false);
		expect(score.ndcg).toBeLessThan(1);
	});
});

describe("recall scoring", () => {
	test("recall@k, mrr, and ndcg follow packed order", () => {
		const score = scoreRecall(
			{
				id: "q",
				query: "Effect",
				expected: [{ contains: "Effect 4", kind: "preference" }],
			},
			[
				{ text: "Anna leads Project Aurora.", kind: "relationship" },
				{ text: "Luv prefers Effect 4 for the yumeoi domain layer.", kind: "preference" },
			],
			{ tokens: 40, latencyMs: 12 },
		);
		expect(score.recallAt5).toBe(1);
		expect(score.recallAt10).toBe(1);
		expect(score.mrr).toBe(0.5);
		expect(score.ndcgAt10).toBeLessThan(1);
		expect(score.ndcgAt10).toBeGreaterThan(0.5);
		expect(score.contextPrecision).toBe(0.5);
		expect(score.tokens).toBe(40);
	});

	test("misses score zero", () => {
		const score = scoreRecall({ id: "q", query: "missing", expected: [{ contains: "Effect 4" }] }, [
			{ text: "Lisbon flight deals start at four hundred dollars.", kind: "fact" },
		]);
		expect(score.recallAt10).toBe(0);
		expect(score.mrr).toBe(0);
		expect(score.ndcgAt10).toBe(0);
		expect(score.contextPrecision).toBe(0);
	});
});
