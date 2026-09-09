import {
	ExtractedMemory,
	extractedMemoryJsonSchema,
	type ProviderUnavailable,
	type RateLimited,
	type SchemaViolation,
} from "@yumeoi/domain";
import { Effect } from "effect";
import { Llm } from "./llm.ts";
import { coerceTypeKind } from "./types.ts";

export const CLASSIFY_SYSTEM = `Classify one statement as a memory.

Types: semantic (timeless fact/preference/relationship/standing decision), episodic (a specific occurrence; set eventAt), procedural (how-to or rule).
Return one extracted_memory object. entities and relations may be empty.`;

export const classifyStatement = (
	text: string,
): Effect.Effect<ExtractedMemory, ProviderUnavailable | RateLimited | SchemaViolation> =>
	Effect.gen(function* () {
		const llm = yield* Llm;
		const extracted = yield* llm.structured({
			job: "classify",
			schema: ExtractedMemory,
			schemaName: "extracted_memory",
			jsonSchema: extractedMemoryJsonSchema(),
			system: CLASSIFY_SYSTEM,
			user: text,
		});
		const coerced = coerceTypeKind(extracted.type, extracted.kind);
		return { ...extracted, ...coerced, text: extracted.text || text };
	});
