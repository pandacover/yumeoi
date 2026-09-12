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
import { recallContext, searchMemories } from "./recall.ts";
import { remember } from "./remember.ts";
import { lexicalRerankerLayer, Reranker, unavailableRerankerLayer } from "./reranker.ts";
import { tokenizeQuery } from "./retrieval/plan.ts";
import { isMultiConceptQuery, lexicalRerankScores } from "./retrieval/terms.ts";

const userId = "horizon-recall-user";
const query = "Horizon memory product, continual learning, user's work context";

const horizonNotes = [
	"Horizon is a memory product for continual learning over the user's work context.",
	"The Horizon agent stores work-context memories so it can keep learning from what the user is doing.",
];

const articleNotes = [
	"Episodic Memory is a long-term memory (LTM) store described in cognitive science.",
	"MNEME proposes an episodic memory architecture for language agents.",
	"Long-term memory (LTM) stores episodic traces from past events in a notebook.",
	"Extracted notes on Episodic Memory: encoding, storage, and retrieval stages.",
	"A survey of episodic memory models compares Hippocampus-inspired LTM designs.",
	"MNEME and related LTM papers treat memory as a generic agent database.",
	"Wikipedia-style notes: episodic memory differs from semantic memory.",
	"Article extract: complementary learning systems and episodic memory replay.",
];

const financeNotes = [
	"Current salary is ₹160k per month after the last review.",
	"Investment portfolio value is ₹85k across index funds.",
	"S&P 500 closed at 1396.87 in that archived market snapshot.",
];

const layerFor = (reranker: Layer.Layer<Reranker>) =>
	Layer.mergeAll(
		memoryMemoryRepoLayer(userId),
		hashEmbeddingsLayer,
		heuristicLlmLayer,
		Layer.provide(extractorLayer, heuristicLlmLayer),
		Layer.provide(consolidatorLayer, heuristicLlmLayer),
		inMemoryVectorIndexLayer(),
		inMemoryObjectStoreLayer(),
		reranker,
	);

const seedCorpus = () =>
	Effect.gen(function* () {
		for (const text of [...articleNotes, ...financeNotes, ...horizonNotes]) {
			yield* remember({
				userId,
				items: [
					{
						text,
						type: "semantic",
						kind: "fact",
						confidence: text.includes("₹") || text.includes("S&P") ? 0.99 : 0.92,
						importance: text.includes("₹") || text.includes("S&P") ? 0.95 : 0.7,
					},
				],
				mode: "verbatim",
				origin: "extracted",
				dedupe: false,
			});
		}
	});

const isHorizon = (text: string): boolean => /\bhorizon\b/i.test(text);
const isArticleNoise = (text: string): boolean =>
	/\b(mneme|episodic memory|\bltm\b)\b/i.test(text) && !isHorizon(text);
const isFinance = (text: string): boolean => /160k|85k|1396/.test(text);

describe("Horizon recall quality", () => {
	test("the user query is multi-concept and not generic-token-only", () => {
		const terms = tokenizeQuery(query);
		expect(isMultiConceptQuery(terms)).toBe(true);
		expect(terms.some((term) => term.toLowerCase() === "horizon")).toBe(true);
		expect(terms.some((term) => term.toLowerCase().includes("continual"))).toBe(true);
	});

	test("packed recall prefers Horizon work context over encyclopedia memory notes and finance", async () => {
		const program = Effect.gen(function* () {
			yield* seedCorpus();
			const recalled = yield* recallContext({
				query,
				namespace: userId,
				budgetTokens: 1500,
				format: "json",
			});
			const packed = recalled.memories.map((hit) => hit.memory.text);
			expect(packed.some(isHorizon)).toBe(true);
			expect(packed.some(isFinance)).toBe(false);
			const firstHorizon = packed.findIndex(isHorizon);
			const firstArticle = packed.findIndex(isArticleNoise);
			expect(firstHorizon).toBe(0);
			expect(firstArticle === -1 || firstHorizon < firstArticle).toBe(true);
			expect(packed.filter(isArticleNoise)).toHaveLength(0);

			const searched = yield* searchMemories({
				query,
				namespace: userId,
				limit: 10,
			});
			expect(isHorizon(searched[0]?.memory.text ?? "")).toBe(true);
			expect(searched.slice(0, 3).some((hit) => isFinance(hit.memory.text))).toBe(false);
			return true;
		});
		expect(
			await Effect.runPromise(program.pipe(Effect.provide(layerFor(lexicalRerankerLayer)))),
		).toBe(true);
	});

	test("default cross rerank runs and lexical fallback demotes kw-only noise when the encoder is down", async () => {
		const calls = { n: 0 };
		const counting = Layer.succeed(Reranker, {
			score: (text, documents) =>
				Effect.sync(() => {
					calls.n += 1;
					return lexicalRerankScores(tokenizeQuery(text), documents);
				}),
		});
		const counted = await Effect.runPromise(
			Effect.gen(function* () {
				yield* seedCorpus();
				return yield* recallContext({
					query,
					namespace: userId,
					format: "json",
				});
			}).pipe(Effect.provide(layerFor(counting))),
		);
		expect(calls.n).toBeGreaterThan(0);
		expect(counted.memories.some((hit) => isHorizon(hit.memory.text))).toBe(true);

		const fallback = await Effect.runPromise(
			Effect.gen(function* () {
				yield* seedCorpus();
				const unavailable = yield* recallContext({
					query,
					namespace: userId,
					format: "json",
				});
				return unavailable.memories.map((hit) => hit.memory.text);
			}).pipe(Effect.provide(layerFor(unavailableRerankerLayer))),
		);
		expect(fallback.some(isHorizon)).toBe(true);
		expect(fallback.some(isFinance)).toBe(false);
	});

	test("lexical overlap scores Horizon above MNEME article notes", () => {
		const scored = lexicalRerankScores(tokenizeQuery(query), [
			{ id: "article", text: articleNotes[0] ?? "" },
			{ id: "horizon", text: horizonNotes[0] ?? "" },
			{ id: "salary", text: financeNotes[0] ?? "" },
		]);
		const byId = new Map(scored.map((row) => [row.id, row.score]));
		expect(byId.get("horizon") ?? 0).toBeGreaterThan(byId.get("article") ?? 0);
		expect(byId.get("horizon") ?? 0).toBeGreaterThan(byId.get("salary") ?? 0);
	});
});
