import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
	inMemoryObjectStoreLayer,
	inMemoryVectorIndexLayer,
	memoryMemoryRepoLayer,
} from "@yumeoi/test-kit";
import { Effect, Layer } from "effect";
import { consolidatorLayer } from "./consolidator.ts";
import type { RecallSet } from "./eval.ts";
import { evaluateRecall } from "./eval-run.ts";
import { extractorLayer } from "./extractor.ts";
import { hashEmbeddingsLayer } from "./hash-embeddings.ts";
import { heuristicLlmLayer } from "./heuristic-llm.ts";
import { identityRerankerLayer } from "./reranker.ts";

const set = JSON.parse(
	readFileSync(new URL("../../../docs/eval/recall-set.json", import.meta.url), "utf8"),
) as RecallSet;

const layer = Layer.mergeAll(
	memoryMemoryRepoLayer("recall-ci"),
	hashEmbeddingsLayer,
	heuristicLlmLayer,
	Layer.provide(extractorLayer, heuristicLlmLayer),
	Layer.provide(consolidatorLayer, heuristicLlmLayer),
	inMemoryVectorIndexLayer(),
	inMemoryObjectStoreLayer(),
	identityRerankerLayer,
);

describe("recall eval set", () => {
	test("has ~40 dated docs and ~80 queries with matcher labels", () => {
		expect(set.documents.length).toBe(40);
		expect(set.queries.length).toBe(80);
		expect(set.documents.every((doc) => typeof doc.date === "string")).toBe(true);
		expect(set.queries.every((query) => query.expected.length > 0)).toBe(true);
		expect(set.queries.some((query) => query.asOf)).toBe(true);
		expect(set.queries.some((query) => query.graph)).toBe(true);
	});

	test("deterministic ingest+recall has a non-zero Recall@10", async () => {
		const result = await Effect.runPromise(
			evaluateRecall(set, { userId: "recall-ci" }).pipe(Effect.provide(layer)),
		);
		expect(result.scores.length).toBe(set.queries.length);
		expect(result.summary.recallAt10).toBeGreaterThan(0.2);
		expect(result.summary.ndcgAt10).toBeGreaterThan(0.15);
	}, 30_000);
});
