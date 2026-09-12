import { MEMORY_KINDS, MEMORY_TYPES, TOOL_FIELD_DESCRIPTIONS } from "@yumeoi/domain";
import { z } from "zod";

const F = TOOL_FIELD_DESCRIPTIONS;
const kinds = z.enum(MEMORY_KINDS);
const types = z.enum(MEMORY_TYPES);
const include = z.enum(["memories", "evidence", "entities", "conflicts"]);
const format = z.enum(["markdown", "json"]);
const planMode = z.enum(["fast", "full"]);
const rerankMode = z.enum(["none", "cross", "llm"]);

const epochMs = (description: string) => z.number().nullable().optional().describe(description);
const isoDatetime = (description: string) => z.string().nullable().optional().describe(description);

export const recallInputSchema = z.object({
	query: z.string().describe(F.recall.query),
	budgetTokens: z.number().optional().describe(F.recall.budgetTokens),
	types: z.array(types).optional().describe(F.recall.types),
	kinds: z.array(kinds).optional().describe(F.recall.kinds),
	sources: z.array(z.string()).optional().describe(F.recall.sources),
	from: epochMs(F.recall.from),
	to: epochMs(F.recall.to),
	asOf: epochMs(F.recall.asOf),
	entities: z.array(z.string()).optional().describe(F.recall.entities),
	include: z.array(include).optional().describe(F.recall.include),
	format: format.optional().describe(F.recall.format),
	plan: planMode.optional().describe(F.recall.plan),
	rerankMode: rerankMode.optional().describe(F.recall.rerankMode),
});

export const searchMemoriesInputSchema = z.object({
	query: z.string().describe(F.search_memories.query),
	types: z.array(types).optional().describe(F.search_memories.types),
	kinds: z.array(kinds).optional().describe(F.search_memories.kinds),
	sources: z.array(z.string()).optional().describe(F.search_memories.sources),
	from: epochMs(F.search_memories.from),
	to: epochMs(F.search_memories.to),
	asOf: epochMs(F.search_memories.asOf),
	entities: z.array(z.string()).optional().describe(F.search_memories.entities),
	limit: z.number().optional().describe(F.search_memories.limit),
	includeDormant: z.boolean().optional().describe(F.search_memories.includeDormant),
});

export const rememberItemSchema = z.object({
	text: z.string().describe(F.remember.itemText),
	type: types.optional().describe(F.remember.itemType),
	kind: kinds.optional().describe(F.remember.itemKind),
	importance: z.number().optional().describe(F.remember.itemImportance),
	eventAt: isoDatetime(F.remember.itemEventAt),
	validFrom: isoDatetime(F.remember.itemValidFrom),
	clientRef: z.string().optional().describe(F.remember.itemClientRef),
});

export const rememberInputSchema = z
	.object({
		text: z.string().optional().describe(F.remember.text),
		items: z.array(rememberItemSchema).max(20).optional().describe(F.remember.items),
		dedupe: z.boolean().optional().describe(F.remember.dedupe),
		mode: z.enum(["extract", "verbatim"]).optional().describe(F.remember.mode),
	})
	.superRefine((value, ctx) => {
		if (!value.text && !value.items?.length) {
			ctx.addIssue({
				code: "custom",
				message: "remember needs text or items[]",
				path: ["text"],
			});
		}
	});

export const updateMemoryInputSchema = z.object({
	id: z.string().describe(F.update_memory.id),
	text: z.string().optional().describe(F.update_memory.text),
	validTo: isoDatetime(F.update_memory.validTo),
	importance: z.number().optional().describe(F.update_memory.importance),
	kind: kinds.optional().describe(F.update_memory.kind),
	eventAt: isoDatetime(F.update_memory.eventAt),
});

export const forgetInputSchema = z
	.object({
		id: z.string().optional().describe(F.forget.id),
		query: z.string().optional().describe(F.forget.query),
		confirm: z.boolean().optional().describe(F.forget.confirm),
		reason: z.string().optional().describe(F.forget.reason),
	})
	.superRefine((value, ctx) => {
		if (!value.id && !value.query) {
			ctx.addIssue({
				code: "custom",
				message: "forget needs id or query",
				path: ["id"],
			});
		}
		if (value.query && !value.id && value.confirm !== true) {
			ctx.addIssue({
				code: "custom",
				message: "forgetting by query requires confirm=true",
				path: ["confirm"],
			});
		}
	});

export const feedbackInputSchema = z.object({
	id: z.string().describe(F.feedback.id),
	signal: z.union([z.literal(1), z.literal(-1)]).describe(F.feedback.signal),
	note: z.string().optional().describe(F.feedback.note),
	query: z.string().optional().describe(F.feedback.query),
});

export const getMemoryInputSchema = z.object({
	id: z.string().describe(F.get_memory.id),
});

export const getDocumentInputSchema = z.object({
	id: z.string().describe(F.get_document.id),
});

export const listSourcesInputSchema = z.object({});

export const getEntityInputSchema = z
	.object({
		name: z.string().optional().describe(F.get_entity.name),
		id: z.string().optional().describe(F.get_entity.id),
		hops: z.number().int().min(0).max(2).optional().describe(F.get_entity.hops),
	})
	.superRefine((value, ctx) => {
		if (!value.name && !value.id) {
			ctx.addIssue({
				code: "custom",
				message: "get_entity needs name or id",
				path: ["name"],
			});
		}
	});

export const timelineInputSchema = z.object({
	about: z.string().describe(F.timeline.about),
	from: epochMs(F.timeline.from),
	to: epochMs(F.timeline.to),
	limit: z.number().optional().describe(F.timeline.limit),
});

export const changesSinceInputSchema = z.object({
	since: z.number().describe(F.changes_since.since),
});

export const recallContextAliasInputSchema = z.object({
	query: z.string().describe(F.recall_context.query),
	sources: z.array(z.string()).optional().describe(F.recall_context.sources),
	kinds: z.array(kinds).optional().describe(F.recall_context.kinds),
	since: z.number().optional().describe(F.recall_context.since),
	budgetTokens: z.number().optional().describe(F.recall_context.budgetTokens),
});

export const addMemoryAliasInputSchema = z.object({
	text: z.string().describe(F.add_memory.text),
	kind: kinds.optional().describe(F.add_memory.kind),
	confidence: z.number().optional().describe(F.add_memory.confidence),
});

export const HORIZON_MCP_INPUT_SCHEMAS = {
	recall: recallInputSchema,
	search_memories: searchMemoriesInputSchema,
	remember: rememberInputSchema,
	update_memory: updateMemoryInputSchema,
	forget: forgetInputSchema,
	feedback: feedbackInputSchema,
	get_memory: getMemoryInputSchema,
	get_document: getDocumentInputSchema,
	list_sources: listSourcesInputSchema,
	get_entity: getEntityInputSchema,
	timeline: timelineInputSchema,
	changes_since: changesSinceInputSchema,
	recall_context: recallContextAliasInputSchema,
	add_memory: addMemoryAliasInputSchema,
} as const;

type JsonSchemaConverter = {
	readonly input: (options?: unknown) => Record<string, unknown>;
	readonly output: (options?: unknown) => Record<string, unknown>;
};

/**
 * Advertise the described JSON Schema on tools/list, but always accept the raw
 * arguments so the handler can return `{ error, hint }` instead of an opaque
 * SDK InvalidParams string when the payload is wrong.
 */
export const advertiseInput = <S extends z.ZodType>(schema: S) => {
	const standard = (schema as { "~standard"?: { jsonSchema?: JsonSchemaConverter } })["~standard"];
	const jsonSchema: JsonSchemaConverter = standard?.jsonSchema ?? {
		input: () => z.toJSONSchema(schema) as Record<string, unknown>,
		output: () => z.toJSONSchema(schema) as Record<string, unknown>,
	};
	return {
		"~standard": {
			version: 1 as const,
			vendor: "horizon",
			jsonSchema,
			validate: (value: unknown) => ({ value }),
		},
	};
};

export const mcpInputJsonSchema = (schema: z.ZodType): Record<string, unknown> =>
	z.toJSONSchema(schema) as Record<string, unknown>;
