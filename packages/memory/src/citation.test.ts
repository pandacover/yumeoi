import { describe, expect, test } from "bun:test";
import {
	inMemoryObjectStoreLayer,
	inMemoryVectorIndexLayer,
	memoryMemoryRepoLayer,
} from "@yumeoi/test-kit";
import { Effect, Layer } from "effect";
import { Consolidator } from "./consolidator.ts";
import { extractorLayer } from "./extractor.ts";
import { hashEmbeddingsLayer } from "./hash-embeddings.ts";
import { heuristicLlmLayer } from "./heuristic-llm.ts";
import { ingestDocument } from "./ingest.ts";
import { MemoryRepo } from "./memory-repo.ts";
import { mergeCitationOrigin } from "./provenance.ts";
import { recallContext } from "./recall.ts";
import { remember } from "./remember.ts";
import { identityRerankerLayer } from "./reranker.ts";

const userId = "citation-user";

const scriptedMerge = (mergedText: string) =>
	Layer.succeed(Consolidator, {
		decide: (_candidate, existing) =>
			Effect.succeed(
				existing[0]
					? {
							action: "merge" as const,
							targetId: existing[0].id,
							mergedText,
							reason: "merge",
						}
					: { action: "new" as const, targetId: null, mergedText: null, reason: "new" },
			),
	});

const layerFor = (consolidator: Layer.Layer<Consolidator>) =>
	Layer.mergeAll(
		memoryMemoryRepoLayer(userId),
		hashEmbeddingsLayer,
		heuristicLlmLayer,
		Layer.provide(extractorLayer, heuristicLlmLayer),
		consolidator,
		inMemoryVectorIndexLayer(),
		inMemoryObjectStoreLayer(),
		identityRerankerLayer,
	);

describe("recall citation origin", () => {
	test("mergeCitationOrigin prefers non-extracted authorship when text changes", () => {
		expect(mergeCitationOrigin("extracted", "agent", true)).toBe("agent");
		expect(mergeCitationOrigin("agent", "extracted", true)).toBe("agent");
		expect(mergeCitationOrigin("extracted", "extracted", true)).toBe("extracted");
		expect(mergeCitationOrigin("extracted", "agent", false)).toBe("extracted");
	});

	test("agent remember after similar Notion extract does not cite the page as src", async () => {
		const agentText = "Luv drinks oat milk lattes at the office every morning.";
		const program = Effect.gen(function* () {
			yield* ingestDocument({
				userId,
				request: {
					externalId: "coffee-wiki",
					title: "Coffee wiki",
					markdown: "Luv drinks black coffee at home every morning.",
					sourceId: "notion:ws",
					sourceKind: "notion",
					sourceLabel: "Notion",
					url: "https://notion.so/coffee-wiki",
				},
			});
			const outcome = yield* remember({
				userId,
				text: agentText,
				mode: "verbatim",
				sourceId: "agent:claude",
				origin: "agent",
			});
			expect(outcome.items[0]?.action).toBe("merged");
			const stored = yield* Effect.flatMap(MemoryRepo, (repo) =>
				repo.getMemory(outcome.items[0]?.id ?? ""),
			);
			expect(stored.origin).toBe("agent");
			expect(stored.text).toContain("oat milk");
			const recalled = yield* recallContext({
				query: "What does Luv drink in the morning?",
				namespace: userId,
				rerank: false,
			});
			const markdown = recalled.markdown ?? "";
			expect(markdown).toContain("oat milk");
			expect(markdown).toContain("agent");
			expect(markdown).not.toMatch(/extracted·src "Coffee wiki"/);
			expect(markdown).not.toMatch(/agent·src "Coffee wiki"/);
			expect(markdown).not.toMatch(/, src "Coffee wiki"/);
			const hit = recalled.memories[0];
			expect(hit?.memory.origin).toBe("agent");
			expect(hit?.provenance.some((row) => row.title === "Coffee wiki")).toBe(true);
			expect(hit?.provenance.some((row) => row.sourceId.startsWith("agent:"))).toBe(true);
			return true;
		});
		expect(
			await Effect.runPromise(program.pipe(Effect.provide(layerFor(scriptedMerge(agentText))))),
		).toBe(true);
	});
});
