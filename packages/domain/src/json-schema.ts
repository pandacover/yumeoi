import { Schema } from "effect";
import { ExtractedMemory } from "./schema.ts";

export const toOpenAiJsonSchema = (schema: Schema.Top): Record<string, unknown> => {
	const document = Schema.toJsonSchemaDocument(schema);
	const jsonSchema: Record<string, unknown> = { ...document.schema };
	if (Object.keys(document.definitions).length > 0) {
		jsonSchema.$defs = document.definitions;
	}
	return jsonSchema;
};

export const extractedMemoryJsonSchema = () => toOpenAiJsonSchema(ExtractedMemory);
