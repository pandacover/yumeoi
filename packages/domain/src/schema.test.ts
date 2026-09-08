import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import {
	consolidateDecisionJsonSchema,
	extractedMemoriesJsonSchema,
	extractedMemoryJsonSchema,
	rerankResultJsonSchema,
} from "./json-schema.ts";
import {
	CHAT_MODEL_ID,
	DEFAULT_LLM_PROVIDER,
	defaultLlmConfig,
	FALLBACK_LLM_PROVIDER,
	parseResponseUsage,
} from "./llm.ts";
import {
	ConsolidateDecision,
	ExtractedMemories,
	ExtractedMemory,
	IngestRequest,
} from "./schema.ts";

describe("domain schemas", () => {
	test("chat is pinned to gpt-5.6-luna high", () => {
		expect(CHAT_MODEL_ID).toBe("gpt-5.6-luna");
		expect(defaultLlmConfig.chat).toEqual({ model: "gpt-5.6-luna", effort: "high" });
	});

	test("M1 pins extract/consolidate/rerank from the keyed eval", () => {
		expect(defaultLlmConfig.extract).toEqual({ model: "gpt-5.6-luna", effort: "high" });
		expect(defaultLlmConfig.consolidate).toEqual({ model: "gpt-5.6-luna", effort: "none" });
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

	test("OpenRouter is the default LLM provider with OpenAI as fallback", () => {
		expect(DEFAULT_LLM_PROVIDER).toBe("openrouter");
		expect(FALLBACK_LLM_PROVIDER).toBe("openai");
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
		expect(extractedMemoriesJsonSchema().required).toEqual(expect.arrayContaining(["memories"]));
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

	test("IngestRequest accepts optional sourceKind and metadata", () => {
		const decoded = Schema.decodeUnknownSync(IngestRequest)({
			externalId: "doc-1",
			title: "Notes",
			markdown: "hello",
			sourceId: "generic",
			sourceLabel: "Notes",
			url: null,
			sourceKind: "notion",
			metadata: { origin: "test" },
		});
		expect(decoded.metadata).toEqual({ origin: "test" });
		expect(decoded.sourceKind).toBe("notion");
	});
});
