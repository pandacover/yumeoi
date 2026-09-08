import { describe, expect, test } from "bun:test";
import { defaultLlmConfig, ExtractedMemory } from "@yumeoi/domain";
import { Llm } from "@yumeoi/memory";
import { FakeLlm } from "@yumeoi/test-kit";
import { Effect } from "effect";

describe("FakeLlm", () => {
	test("decodes structured output through the Llm layer", async () => {
		const memory = await Effect.runPromise(
			Effect.gen(function* () {
				const llm = yield* Llm;
				expect(llm.config.chat.model).toBe(defaultLlmConfig.chat.model);
				return yield* llm.structured({
					job: "extract",
					schema: ExtractedMemory,
					schemaName: "extracted_memory",
					jsonSchema: {},
					system: "test",
					user: "test",
				});
			}).pipe(Effect.provide(FakeLlm)),
		);
		expect(memory.kind).toBe("fact");
		expect(memory.text.length).toBeGreaterThan(0);
	});

	test("drainUsage is empty for the heuristic layer", async () => {
		const usage = await Effect.runPromise(
			Effect.gen(function* () {
				const llm = yield* Llm;
				return yield* llm.drainUsage();
			}).pipe(Effect.provide(FakeLlm)),
		);
		expect(usage).toEqual([]);
	});
});
