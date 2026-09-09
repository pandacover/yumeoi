import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
	inMemoryObjectStoreLayer,
	inMemoryVectorIndexLayer,
	memoryMemoryRepoLayer,
} from "@yumeoi/test-kit";
import { Effect, Layer } from "effect";
import { consolidatorLayer } from "./consolidator.ts";
import type { EntitiesSet } from "./eval.ts";
import { evaluateResolution } from "./eval-run.ts";
import { extractorLayer } from "./extractor.ts";
import { formatRelationLine } from "./format.ts";
import { canonicalName } from "./graph/names.ts";
import { resolveEntity } from "./graph/resolve.ts";
import { hashEmbeddingsLayer } from "./hash-embeddings.ts";
import { heuristicLlmLayer } from "./heuristic-llm.ts";
import { MemoryRepo } from "./memory-repo.ts";
import { recallContext } from "./recall.ts";
import { remember } from "./remember.ts";
import { identityRerankerLayer } from "./reranker.ts";

const userId = "p4-user";

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

const entitiesSet = JSON.parse(
	readFileSync(new URL("../../../docs/eval/entities-set.json", import.meta.url), "utf8"),
) as EntitiesSet;

describe("P4 graph RAG", () => {
	test("canonical names strip honorifics and articles", () => {
		expect(canonicalName("Mr Luv")).toBe("luv");
		expect(canonicalName("The Aurora")).toBe("aurora");
		expect(canonicalName("Dr Anna")).toBe("anna");
	});

	test("persons are never merged on embedding similarity alone", async () => {
		const program = Effect.gen(function* () {
			const left = yield* resolveEntity({
				mention: { name: "Anna", type: "person" },
				namespace: userId,
				now: Date.now(),
			});
			const right = yield* resolveEntity({
				mention: { name: "Annabelle", type: "person" },
				namespace: userId,
				now: Date.now(),
			});
			return left.id !== right.id;
		});
		expect(await Effect.runPromise(program.pipe(Effect.provide(layerFor())))).toBe(true);
	});

	test("relation supersession closes the previous destination", async () => {
		const program = Effect.gen(function* () {
			yield* remember({
				userId,
				items: [
					{
						text: "Anna leads Project Aurora for the Hamburg launch this year.",
						type: "semantic",
						kind: "relationship",
					},
				],
				mode: "verbatim",
				dedupe: false,
			});
			yield* remember({
				userId,
				items: [
					{
						text: "Anna leads Project Yumeoi after the Hamburg launch ended.",
						type: "semantic",
						kind: "relationship",
					},
				],
				mode: "verbatim",
				dedupe: false,
			});
			const repo = yield* MemoryRepo;
			const anna = yield* repo.findEntity(canonicalName("Anna"), "person");
			expect(anna).not.toBeNull();
			const rels = yield* repo.listRelations([anna?.id ?? ""]);
			const leads = rels.filter((row) => row.predicate === "leads" && row.validTo === null);
			expect(leads.length).toBe(1);
			const yumeoi = yield* repo.findEntity("project yumeoi", "project");
			expect(yumeoi).not.toBeNull();
			expect(leads[0]?.dstEntity).toBe(yumeoi?.id);
			return true;
		});
		expect(await Effect.runPromise(program.pipe(Effect.provide(layerFor())))).toBe(true);
	});

	test("graph expansion surfaces a 2-hop neighbour memory", async () => {
		const program = Effect.gen(function* () {
			yield* remember({
				userId,
				text: "Anna leads Project Aurora for the Hamburg launch.",
				mode: "verbatim",
			});
			yield* remember({
				userId,
				text: "On 2026-08-12 Luv met Anna about the project Anna leads.",
				mode: "verbatim",
			});
			const result = yield* recallContext({
				query: "who did Luv meet about the project Anna leads?",
				namespace: userId,
				rerank: false,
				format: "markdown",
				include: ["memories", "entities"],
			});
			const blob = `${result.markdown ?? ""}\n${result.memories.map((hit) => hit.memory.text).join("\n")}`;
			expect(blob.toLowerCase()).toContain("anna");
			expect(result.memories.some((hit) => (hit.why ?? []).includes("graph"))).toBe(true);
			return true;
		});
		expect(await Effect.runPromise(program.pipe(Effect.provide(layerFor())))).toBe(true);
	});

	test("packed relation lines cite the evidence memory", () => {
		const line = formatRelationLine(
			5,
			{ src: "Anna", predicate: "leads", dst: "Aurora", since: "2026-08-01" },
			1,
		);
		expect(line).toContain("Anna —leads→ Aurora");
		expect(line).toContain("[1]");
	});

	test("entity resolution precision is at least 0.9", async () => {
		const result = await Effect.runPromise(
			evaluateResolution(entitiesSet).pipe(Effect.provide(layerFor())),
		);
		expect(entitiesSet.pairs.length).toBeGreaterThanOrEqual(60);
		expect(result.summary.precision).toBeGreaterThanOrEqual(0.9);
		expect(result.summary.falsePositives).toBe(0);
	});
});
