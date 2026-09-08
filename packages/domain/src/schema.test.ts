import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import { extractedMemoriesJsonSchema, extractedMemoryJsonSchema } from "./json-schema.ts";
import { CHAT_MODEL_ID, defaultLlmConfig, parseResponseUsage } from "./llm.ts";
import { ExtractedMemories, ExtractedMemory } from "./schema.ts";

describe("domain schemas", () => {
	test("chat is pinned to gpt-5.6-luna high", () => {
		expect(CHAT_MODEL_ID).toBe("gpt-5.6-luna");
		expect(defaultLlmConfig.chat).toEqual({ model: "gpt-5.6-luna", effort: "high" });
	});

	test("M1 pins extract/consolidate/rerank on Luna with cheaper efforts", () => {
		expect(defaultLlmConfig.extract).toEqual({ model: "gpt-5.6-luna", effort: "low" });
		expect(defaultLlmConfig.consolidate).toEqual({ model: "gpt-5.6-luna", effort: "low" });
		expect(defaultLlmConfig.rerank).toEqual({ model: "gpt-5.6-luna", effort: "none" });
	});

	test("parseResponseUsage reads input, output, and reasoning tokens", () => {
		const usage = parseResponseUsage(
			"extract",
			{ model: "gpt-5.6-luna", effort: "low" },
			{
				usage: {
					input_tokens: 120,
					output_tokens: 80,
					output_tokens_details: { reasoning_tokens: 40 },
					input_tokens_details: { cached_tokens: 16 },
				},
			},
		);
		expect(usage).toEqual({
			job: "extract",
			model: "gpt-5.6-luna",
			effort: "low",
			inputTokens: 120,
			outputTokens: 80,
			reasoningTokens: 40,
			cachedInputTokens: 16,
		});
	});

	test("ExtractedMemory JSON Schema is an object with required fields", () => {
		const jsonSchema = extractedMemoryJsonSchema();
		expect(jsonSchema.type).toBe("object");
		expect(jsonSchema.additionalProperties).toBe(false);
		expect(jsonSchema.required).toEqual(
			expect.arrayContaining(["kind", "text", "confidence", "validFrom"]),
		);
	});

	test("ExtractedMemories JSON Schema wraps an array", () => {
		const jsonSchema = extractedMemoriesJsonSchema();
		expect(jsonSchema.type).toBe("object");
		expect(jsonSchema.required).toEqual(expect.arrayContaining(["memories"]));
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

	test("ExtractedMemories decodes a list", () => {
		const decoded = Schema.decodeUnknownSync(ExtractedMemories)({
			memories: [
				{
					kind: "preference",
					text: "Luv prefers Effect 4.",
					confidence: 0.9,
					validFrom: null,
				},
			],
		});
		expect(decoded.memories.length).toBe(1);
	});
});
