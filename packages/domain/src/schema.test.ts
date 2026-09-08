import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import {
	consolidateDecisionJsonSchema,
	extractedMemoriesJsonSchema,
	extractedMemoryJsonSchema,
	rerankResultJsonSchema,
} from "./json-schema.ts";
import { CHAT_MODEL_ID, defaultLlmConfig } from "./llm.ts";
import { ConsolidateDecision, ExtractedMemories, ExtractedMemory } from "./schema.ts";

describe("domain schemas", () => {
	test("chat is pinned to gpt-5.6-luna high", () => {
		expect(CHAT_MODEL_ID).toBe("gpt-5.6-luna");
		expect(defaultLlmConfig.chat).toEqual({ model: "gpt-5.6-luna", effort: "high" });
		expect(defaultLlmConfig.extract.model).toBe(CHAT_MODEL_ID);
	});

	test("ExtractedMemory JSON Schema is an object with required fields", () => {
		const jsonSchema = extractedMemoryJsonSchema();
		expect(jsonSchema.type).toBe("object");
		expect(jsonSchema.additionalProperties).toBe(false);
		expect(jsonSchema.required).toEqual(
			expect.arrayContaining(["kind", "text", "confidence", "validFrom"]),
		);
	});

	test("ExtractedMemories / consolidate / rerank schemas are objects", () => {
		expect(extractedMemoriesJsonSchema().type).toBe("object");
		expect(consolidateDecisionJsonSchema().type).toBe("object");
		expect(rerankResultJsonSchema().type).toBe("object");
	});

	test("ExtractedMemory decodes a valid payload", () => {
		const decoded = Schema.decodeUnknownSync(ExtractedMemory)({
			kind: "fact",
			text: "Luv prefers Effect 4.",
			confidence: 0.9,
			validFrom: null,
		});
		expect(decoded.text).toContain("Effect 4");
	});

	test("ExtractedMemories and ConsolidateDecision decode", () => {
		const memories = Schema.decodeUnknownSync(ExtractedMemories)({
			memories: [
				{
					kind: "preference",
					text: "Luv prefers Effect 4.",
					confidence: 0.9,
					validFrom: null,
				},
			],
		});
		expect(memories.memories).toHaveLength(1);
		const decision = Schema.decodeUnknownSync(ConsolidateDecision)({
			action: "new",
			targetId: null,
		});
		expect(decision.action).toBe("new");
	});
});
