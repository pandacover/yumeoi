import { describe, expect, test } from "bun:test";
import { defaultLlmConfig } from "@yumeoi/domain";
import { Llm } from "@yumeoi/memory";
import { Effect } from "effect";
import { llmLayerFor } from "./agent-runtime.ts";

describe("llmLayerFor", () => {
	test("uses the heuristic layer when no providers are configured", async () => {
		const usage = await Effect.runPromise(
			Effect.gen(function* () {
				const llm = yield* Llm;
				expect(llm.config).toEqual(defaultLlmConfig);
				return yield* llm.drainUsage();
			}).pipe(Effect.provide(llmLayerFor({}))),
		);
		expect(usage).toEqual([]);
	});

	test("exposes drainUsage for an OpenRouter-first gateway layer", async () => {
		const usage = await Effect.runPromise(
			Effect.gen(function* () {
				const llm = yield* Llm;
				expect(llm.config.extract.model).toBe("gpt-5.6-luna");
				return yield* llm.drainUsage();
			}).pipe(
				Effect.provide(
					llmLayerFor({
						providers: [
							{
								provider: "openrouter",
								apiKey: "or-key",
								baseURL: "https://gateway.example/openrouter",
							},
							{ provider: "openai", apiKey: "oa-key", baseURL: "https://gateway.example/openai" },
						],
					}),
				),
			),
		);
		expect(usage).toEqual([]);
	});
});
