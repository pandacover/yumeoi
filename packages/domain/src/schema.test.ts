import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import { extractedMemoryJsonSchema } from "./json-schema.ts";
import { CHAT_MODEL_ID, defaultLlmConfig } from "./llm.ts";
import { ExtractedMemory } from "./schema.ts";

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

	test("ExtractedMemory decodes a valid payload", () => {
		const decoded = Schema.decodeUnknownSync(ExtractedMemory)({
			kind: "fact",
			text: "Luv prefers Effect 4.",
			confidence: 0.9,
			validFrom: null,
		});
		expect(decoded.text).toContain("Effect 4");
	});
});
