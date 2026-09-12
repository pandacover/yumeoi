import {
	type ExtractedMemory,
	extractedMemoryJsonSchema,
	MEMORY_KINDS,
	MEMORY_TYPES,
	type MemoryKind,
	type MemoryType,
	type ProviderUnavailable,
	type RateLimited,
	SchemaViolation,
} from "@yumeoi/domain";
import { Effect, Schema } from "effect";
import { Llm } from "./llm.ts";
import { coerceTypeKind } from "./types.ts";

export const CLASSIFY_SYSTEM = `Classify one statement as a memory.

Types: semantic (timeless fact/preference/relationship/standing decision), episodic (a specific occurrence; set eventAt), procedural (how-to or rule).
Return one extracted_memory object. entities and relations may be empty.`;

const TYPE_SET = new Set<string>(MEMORY_TYPES);
const KIND_SET = new Set<string>(MEMORY_KINDS);
const ENTITY_TYPES = new Set([
	"person",
	"org",
	"project",
	"place",
	"tool",
	"topic",
	"document",
	"other",
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === "object" && !Array.isArray(value);

const asFinite = (value: unknown, fallback: number): number => {
	if (typeof value === "number" && Number.isFinite(value)) {
		return value;
	}
	if (typeof value === "string" && value.trim() !== "") {
		const numeric = Number(value);
		if (Number.isFinite(numeric)) {
			return numeric;
		}
	}
	return fallback;
};

const asNullString = (value: unknown): string | null => {
	if (value === null || value === undefined) {
		return null;
	}
	if (typeof value === "string") {
		const trimmed = value.trim();
		return trimmed.length > 0 ? trimmed : null;
	}
	return null;
};

/** Recover LLM classify JSON that is missing optional arrays/nulls or uses numeric strings. */
export const recoverExtractedMemory = (
	parsed: unknown,
	fallbackText: string,
): ExtractedMemory | null => {
	if (!isRecord(parsed)) {
		return null;
	}
	if (!TYPE_SET.has(String(parsed.type)) || !KIND_SET.has(String(parsed.kind))) {
		return null;
	}
	const type = parsed.type as MemoryType;
	const kind = parsed.kind as MemoryKind;
	const text =
		typeof parsed.text === "string" && parsed.text.trim().length > 0 ? parsed.text : fallbackText;
	const entities = Array.isArray(parsed.entities)
		? parsed.entities.flatMap((item) => {
				if (!isRecord(item) || typeof item.name !== "string" || item.name.trim() === "") {
					return [];
				}
				const entityType = ENTITY_TYPES.has(String(item.type)) ? String(item.type) : "other";
				return [
					{ name: item.name, type: entityType as ExtractedMemory["entities"][number]["type"] },
				];
			})
		: [];
	const relations = Array.isArray(parsed.relations)
		? parsed.relations.flatMap((item) => {
				if (
					!isRecord(item) ||
					typeof item.subject !== "string" ||
					typeof item.predicate !== "string" ||
					typeof item.object !== "string"
				) {
					return [];
				}
				return [
					{
						subject: item.subject,
						predicate: item.predicate,
						object: item.object,
					},
				];
			})
		: [];
	const coerced = coerceTypeKind(type, kind);
	return {
		type: coerced.type,
		kind: coerced.kind,
		text,
		confidence: asFinite(parsed.confidence, 0.8),
		importance: asFinite(parsed.importance, 0.8),
		eventAt: asNullString(parsed.eventAt),
		validFrom: asNullString(parsed.validFrom),
		entities,
		relations,
	};
};

export const classifyStatement = (
	text: string,
): Effect.Effect<ExtractedMemory, ProviderUnavailable | RateLimited | SchemaViolation, Llm> =>
	Effect.gen(function* () {
		const llm = yield* Llm;
		const parsed = yield* llm.structured({
			job: "classify",
			schema: Schema.Unknown,
			schemaName: "extracted_memory",
			jsonSchema: extractedMemoryJsonSchema(),
			system: CLASSIFY_SYSTEM,
			user: text,
		});
		const recovered = recoverExtractedMemory(parsed, text);
		if (!recovered) {
			return yield* Effect.fail(
				new SchemaViolation({
					message: "structured output failed schema decode",
					issues: parsed,
				}),
			);
		}
		return { ...recovered, text: recovered.text || text };
	});
