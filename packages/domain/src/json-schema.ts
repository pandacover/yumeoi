import { Schema } from "effect";
import {
	ConsolidateDecision,
	ExtractedMemories,
	ExtractedMemory,
	QueryPlan,
	RerankResult,
} from "./schema.ts";

const isRecord = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === "object" && !Array.isArray(value);

const strictify = (node: unknown): unknown => {
	if (Array.isArray(node)) {
		return node.map(strictify);
	}
	if (!isRecord(node)) {
		return node;
	}
	const next: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(node)) {
		next[key] = strictify(value);
	}
	if (next.type === "object" && isRecord(next.properties)) {
		next.additionalProperties = false;
		next.required = Object.keys(next.properties);
	}
	return next;
};

export const toOpenAiJsonSchema = (schema: Schema.Top): Record<string, unknown> => {
	const document = Schema.toJsonSchemaDocument(schema);
	const jsonSchema: Record<string, unknown> = { ...document.schema };
	if (Object.keys(document.definitions).length > 0) {
		jsonSchema.$defs = document.definitions;
	}
	return strictify(jsonSchema) as Record<string, unknown>;
};

export const extractedMemoryJsonSchema = () => toOpenAiJsonSchema(ExtractedMemory);
export const extractedMemoriesJsonSchema = () => toOpenAiJsonSchema(ExtractedMemories);
export const consolidateDecisionJsonSchema = () => toOpenAiJsonSchema(ConsolidateDecision);
export const rerankResultJsonSchema = () => toOpenAiJsonSchema(RerankResult);
export const queryPlanJsonSchema = () => toOpenAiJsonSchema(QueryPlan);

const everyObjectStrict = (node: unknown): boolean => {
	if (Array.isArray(node)) {
		return node.every(everyObjectStrict);
	}
	if (!isRecord(node)) {
		return true;
	}
	if (node.type === "object" && isRecord(node.properties)) {
		if (node.additionalProperties !== false) {
			return false;
		}
		const keys = Object.keys(node.properties);
		const required = Array.isArray(node.required) ? node.required : [];
		if (keys.some((key) => !required.includes(key))) {
			return false;
		}
	}
	return Object.values(node).every(everyObjectStrict);
};

export const isStrictOpenAiObjectSchema = (schema: Record<string, unknown>): boolean =>
	everyObjectStrict(schema);
