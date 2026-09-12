import { describe, expect, test } from "bun:test";
import { defaultLlmConfig, ProviderUnavailable, SchemaViolation } from "@yumeoi/domain";
import {
	FakeEmbeddings,
	inMemoryObjectStoreLayer,
	inMemoryVectorIndexLayer,
	memoryMemoryRepoLayer,
} from "@yumeoi/test-kit";
import { Effect, Layer } from "effect";
import { recoverExtractedMemory } from "./classify.ts";
import { Consolidator, consolidatorLayer } from "./consolidator.ts";
import { extractorLayer } from "./extractor.ts";
import { heuristicLlmLayer } from "./heuristic-llm.ts";
import { Llm } from "./llm.ts";
import { remember } from "./remember.ts";

const userId = "remember-pipeline-user";

const failingClassifyLlm = Layer.succeed(Llm, {
	config: defaultLlmConfig,
	drainUsage: () => Effect.succeed([]),
	structured: () =>
		Effect.fail(
			new ProviderUnavailable({
				provider: "openrouter",
				cause:
					"402 This request requires more credits, or fewer max_tokens. You requested up to 65536 tokens, but can only afford 28952.",
			}),
		),
});

const incompleteClassifyLlm = Layer.succeed(Llm, {
	config: defaultLlmConfig,
	drainUsage: () => Effect.succeed([]),
	structured: (({ schemaName, user }) => {
		if (schemaName === "extracted_memory") {
			return Effect.succeed({
				type: "semantic",
				kind: "preference",
				text: user,
				confidence: "0.91",
				importance: 0.7,
			});
		}
		if (schemaName === "consolidate_decision") {
			return Effect.succeed({
				action: "new",
				targetId: null,
				mergedText: null,
				reason: "distinct",
			});
		}
		return Effect.fail(new SchemaViolation({ message: `unexpected schema ${schemaName}` }));
	}) as Llm["Service"]["structured"],
});

const explodingConsolidator = Layer.succeed(Consolidator, {
	decide: () =>
		Effect.fail(
			new ProviderUnavailable({ provider: "openrouter", cause: "consolidate should not run" }),
		),
});

const layerFor = (llm: Layer.Layer<Llm>, consolidator?: Layer.Layer<Consolidator>) =>
	Layer.mergeAll(
		memoryMemoryRepoLayer(userId),
		FakeEmbeddings,
		llm,
		Layer.provide(extractorLayer, llm),
		consolidator ?? Layer.provide(consolidatorLayer, llm),
		inMemoryVectorIndexLayer(),
		inMemoryObjectStoreLayer(),
	);

describe("remember pipeline", () => {
	test("recovers classify JSON that omits arrays and uses numeric strings", () => {
		const recovered = recoverExtractedMemory(
			{
				type: "semantic",
				kind: "preference",
				confidence: "0.9",
				importance: "0.7",
			},
			"Luv likes Horizon as memory infrastructure.",
		);
		expect(recovered?.text).toContain("Horizon");
		expect(recovered?.entities).toEqual([]);
		expect(recovered?.relations).toEqual([]);
		expect(recovered?.confidence).toBe(0.9);
		expect(recovered?.eventAt).toBeNull();
	});

	test("does not invent type/kind when the model omits them", () => {
		expect(
			recoverExtractedMemory({ text: "Luv likes Horizon.", confidence: 0.9 }, "Luv likes Horizon."),
		).toBeNull();
	});

	test("verbatim remember succeeds when classify+embed layers are provided", async () => {
		const outcome = await Effect.runPromise(
			remember({
				userId,
				text: "Luv likes Horizon as memory infrastructure.",
				mode: "verbatim",
			}).pipe(Effect.provide(layerFor(heuristicLlmLayer))),
		);
		expect(outcome.items).toHaveLength(1);
		expect(outcome.items[0]?.action).toBe("created");
		expect(outcome.items[0]?.text).toContain("Horizon");
		expect(outcome.items[0]?.id).toMatch(/^m_/);
	});

	test("skips classify when the caller provides both valid type and kind", async () => {
		const outcome = await Effect.runPromise(
			remember({
				userId,
				items: [
					{
						text: "Luv likes Horizon as memory infrastructure.",
						type: "semantic",
						kind: "preference",
					},
				],
				mode: "verbatim",
			}).pipe(Effect.provide(layerFor(failingClassifyLlm, explodingConsolidator))),
		);
		expect(outcome.items[0]?.action).toBe("created");
		expect(outcome.items[0]?.kind).toBe("preference");
	});

	test("skips consolidate when there are no similar memories", async () => {
		const outcome = await Effect.runPromise(
			remember({
				userId,
				text: "Luv likes Horizon as memory infrastructure.",
				mode: "verbatim",
			}).pipe(Effect.provide(layerFor(incompleteClassifyLlm, explodingConsolidator))),
		);
		expect(outcome.items[0]?.action).toBe("created");
		expect(outcome.items[0]?.kind).toBe("preference");
	});

	test("surfaces ProviderUnavailable from classify instead of succeeding", async () => {
		const error = await Effect.runPromise(
			remember({
				userId,
				text: "Luv likes Horizon as memory infrastructure.",
				mode: "verbatim",
			}).pipe(Effect.provide(layerFor(failingClassifyLlm)), Effect.flip),
		);
		const tagged = error as ProviderUnavailable;
		expect(tagged._tag).toBe("ProviderUnavailable");
		expect(tagged.provider).toBe("openrouter");
		expect(String(tagged.cause)).toMatch(/65536/);
	});
});
