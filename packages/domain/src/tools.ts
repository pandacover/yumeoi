import { Schema } from "effect";
import {
	EntityType,
	MEMORY_KINDS,
	MEMORY_TYPES,
	Memory,
	MemoryEdgeRow,
	MemoryHistoryRow,
	MemoryKind,
	MemoryType,
	Provenance,
	RecallFormat,
	RecallInclude,
	RecallPlanMode,
	RecallResult,
	RememberOutcomeItem,
	RerankMode,
	Source,
	ToolError,
} from "./schema.ts";

const kindsList = MEMORY_KINDS.join(", ");
const typesList = MEMORY_TYPES.join(", ");
const includeList = "memories, evidence, entities, conflicts";
const formatList = "markdown, json";
const planList = "fast, full";
const rerankList = "none, cross, llm";
const modeList = "extract, verbatim";

const epochMs =
	"Unix timestamp in milliseconds (e.g. Date.now() or 1700000000000). ISO-8601 strings are coerced to ms.";
const isoDatetime = "ISO-8601 datetime string (e.g. 2026-03-15T00:00:00.000Z), or null.";

/** Shared field copy used by Effect schemas, MCP zod `.describe()`, and tests. */
export const TOOL_FIELD_DESCRIPTIONS = {
	recall: {
		query:
			'Required. Natural-language question or topic to pack cited memory context for. Example: "What does Luv prefer for the domain layer?"',
		budgetTokens: "Optional. Token budget for the packed block. Default 1500.",
		types: `Optional. Restrict to memory types. Allowed: ${typesList}.`,
		kinds: `Optional. Restrict to memory kinds. Allowed: ${kindsList}.`,
		sources: "Optional. Restrict to connected source ids from list_sources.",
		from: `Optional. Inclusive start of event time. ${epochMs} Null = unbounded.`,
		to: `Optional. Inclusive end of event time. ${epochMs} Null = unbounded.`,
		asOf: `Optional. Belief time for bitemporal recall. ${epochMs} Null = now.`,
		entities: "Optional. Restrict to these entity names or ids.",
		include: `Optional. What to pack. Allowed: ${includeList}. Default ["memories"].`,
		format: `Optional. Output shape. Allowed: ${formatList}. Default markdown.`,
		plan: `Optional. Query planning. Allowed: ${planList}. Default fast; use full for synonym/entity expansion.`,
		rerankMode: `Optional. Reranker. Allowed: ${rerankList}. Default cross.`,
	},
	search_memories: {
		query: "Required. Natural-language search query for a ranked memory list.",
		types: `Optional. Restrict to memory types. Allowed: ${typesList}.`,
		kinds: `Optional. Restrict to memory kinds. Allowed: ${kindsList}.`,
		sources: "Optional. Restrict to connected source ids from list_sources.",
		from: `Optional. Inclusive start of event time. ${epochMs} Null = unbounded.`,
		to: `Optional. Inclusive end of event time. ${epochMs} Null = unbounded.`,
		asOf: `Optional. Belief time for bitemporal search. ${epochMs} Null = now.`,
		entities: "Optional. Restrict to these entity names or ids.",
		limit: "Optional. Page size. Default 20.",
		cursor: "Optional. Opaque pagination cursor from a previous search_memories page.",
		includeDormant: "Optional. Include dormant memories. Default false.",
	},
	remember: {
		text: 'Optional if items is set. A statement or paragraph to store. Required unless items[] is provided. Example: "Luv prefers oat milk."',
		items:
			"Optional if text is set. Up to 20 pre-split memories. Required unless text is provided. Each item needs text; type/kind are classified when omitted.",
		itemText: "Required per item. Memory text to store.",
		itemType: `Optional. Allowed: ${typesList}. Omit unless sure — invalid or mismatched values are dropped and the server classifies.`,
		itemKind: `Optional. Allowed: ${kindsList}. Omit unless sure — invalid or mismatched values are dropped and the server classifies.`,
		itemImportance:
			"Optional. Importance in 0–1. Numeric strings are accepted. Server fills if omitted.",
		itemEventAt: `Optional. When the event happened. ${isoDatetime}`,
		itemValidFrom: `Optional. Start of validity. ${isoDatetime}`,
		itemEntities:
			"Optional. Explicit entities for this item. Usually omit and let the server extract.",
		itemEntityName: "Entity display name.",
		itemEntityType: "Entity type (person, org, project, place, tool, topic, document, other).",
		itemClientRef:
			"Optional. Idempotency key so retries return the original memory instead of duplicating.",
		dedupe: "Optional. Deduplicate against existing memories. Default true.",
		mode: `Optional. Allowed: ${modeList}. extract splits a paragraph (default when only text is passed); verbatim stores the statement as given (default when items[] is passed).`,
	},
	update_memory: {
		id: "Required. Memory id from a recall footer (`ids: m_…=[1]`) or search_memories. The id stays stable.",
		text: "Optional. Replacement memory text.",
		validTo: `Optional. End of validity. ${isoDatetime}`,
		importance: "Optional. Importance in 0–1.",
		kind: `Optional. Allowed: ${kindsList}.`,
		eventAt: `Optional. When the event happened. ${isoDatetime}`,
	},
	forget: {
		id: "Optional if query is set. Memory id to soft-forget. Required unless query is provided.",
		query:
			"Optional if id is set. Search text to forget matching memories. Requires confirm=true. Required unless id is provided.",
		confirm:
			"Optional. Must be true to forget extracted memories, and required when forgetting by query. Agent/user/chat origin can omit confirm when forgetting by id.",
		reason: "Optional. Note recorded on memory history.",
	},
	feedback: {
		id: "Required. Memory id from a recall footer (`ids: m_…=[1]`).",
		signal:
			'Required. Integer 1 if the recalled line was useful, or -1 if it was wrong. Strings "1" and "-1" are accepted. Not 0 or a label like "useful".',
		note: "Optional. Correction text. On signal=-1, used to rewrite the memory (same id, re-embedded).",
		query:
			"Optional. The recall query that missed. On signal=-1, used to re-extract. Without note or query, -1 only adjusts importance.",
	},
	get_memory: {
		id: "Required. Memory id from a recall footer (`ids: m_…=[1]`) or search_memories.",
	},
	get_document: {
		id: "Required. Document id from get_memory provenance or a recall citation.",
	},
	get_entity: {
		name: "Optional if id is set. Entity display name. Required unless id is provided.",
		id: "Optional if name is set. Entity id. Required unless name is provided.",
		hops: "Optional. Relation hops to include, 0–2. Default 1.",
	},
	timeline: {
		about: "Required. Entity name or topic to list episodic memories for.",
		from: `Optional. Inclusive start of event time. ${epochMs} Null = unbounded.`,
		to: `Optional. Inclusive end of event time. ${epochMs} Null = unbounded.`,
		limit: "Optional. Max events to return.",
	},
	changes_since: {
		since: `Required. ${epochMs} Returns memory ids created, updated, superseded, or forgotten after this instant.`,
	},
	recall_context: {
		query: "Required. Natural-language question. Deprecated alias of recall; prefer recall.",
		sources: "Optional. Restrict to connected source ids from list_sources.",
		kinds: `Optional. Restrict to memory kinds. Allowed: ${kindsList}.`,
		since: `Optional. Inclusive start time. ${epochMs}`,
		budgetTokens: "Optional. Token budget for the packed block. Default 1500.",
	},
	add_memory: {
		text: "Required. Statement to store. Deprecated alias of remember; prefer remember with text or items[].",
		kind: `Optional. Allowed: ${kindsList}.`,
		confidence: "Optional. Maps to importance (0–1). Default 1.",
	},
} as const;

export const MCP_TOOL_DESCRIPTIONS = {
	recall:
		'Packed, cited memory context for a question. Prefer this before doing work. Default output is markdown. Example: {"query":"..."}',
	search_memories: "Flat ranked memory list with the same filters as recall. Use to page.",
	remember:
		'Store a statement or extract several memories from a paragraph. The server classifies, embeds, and dedupes. Omit kind/type. Example: {"text":"...","mode":"verbatim"}',
	update_memory:
		"Correct an existing memory in place. The id stays stable and history is recorded.",
	forget:
		'Soft-forget a memory. Agent/user/chat origin can be forgotten by id; extracted memories need confirm=true. Example: {"id":"m_…"}',
	feedback:
		'Mark a recalled memory as useful (1) or wrong (-1). On -1, note and/or query rewrites the memory. Example: {"id":"m_…","signal":1}',
	get_memory: "Full memory record: history, edges, entities, provenance.",
	get_document: "Fetch a normalized document (markdown) by id.",
	list_sources: "List connected sources and their labels.",
	get_entity: "Entity summary, relations, and recent memories. Pass name or id.",
	timeline: "Chronological episodic memories about an entity or topic.",
	changes_since: "Created, updated, superseded, or forgotten memory ids since a timestamp.",
	recall_context: "Deprecated alias of recall. Prefer recall.",
	add_memory: "Deprecated alias of remember. Prefer remember.",
} as const;

export const AGENT_INSTRUCTIONS = `horizon is a personal memory store. Prefer tools over guessing.

When to call which tool:
- recall: before answering anything about the user's notes, preferences, decisions, or past events. Default format is markdown with numbered citations. Use plan=fast unless the query needs synonym/entity expansion (then plan=full).
- search_memories: when you need a paged ranked list rather than a packed context block.
- remember: to store what the user just said, a decision, or a preference. Pass only {"text":"...","mode":"verbatim"} and omit kind/type — the server classifies, embeds, and dedupes. Use clientRef on retries. mode=extract splits a paragraph into several memories; mode=verbatim stores the statement as given.
- update_memory: to correct text or validity on an existing id. The id stays stable.
- forget: to retire a memory the agent or user wrote. Extracted memories need confirm=true.
- feedback: signal=1 if a recalled line was useful, -1 if it was wrong. Strings "1"/"-1" are accepted. On -1, pass note (the correction) and/or query (the recall that missed) so the store can rewrite or re-extract the memory text, re-embed it, and keep the same id. Without note or source chunks, -1 only adjusts importance.
- get_memory / get_document: after recall, when you need history, edges, entities, or the source document.
- get_entity: entity summary, relations, and recent memories. Pass name or id; hops≤2.
- timeline: chronological episodic memories about an entity or topic (from/to optional).
- changes_since: created/updated/superseded/forgotten ids since a timestamp, for local mirrors.

Cite memories with [n] from the packed block. Follow-up ids are in the footer (\`ids: m_…=[1]\`). Do not pick types, hashes, or embeddings — the server does that.

Timestamps: from, to, asOf, since, and recall_context.since are millisecond Unix epochs. ISO-8601 strings are accepted and coerced to ms. remember/update eventAt, validFrom, and validTo are ISO-8601 strings.

On invalid_input with retry_with: call the same tool once with that JSON object exactly. If the same error repeats, stop. Do not invent new fields.
On unavailable, rate_limited, or schema_violation: do not retry the same payload. The hint names the missing provider, quota, or server-side classify failure — fix that dependency instead.
On unauthorized: reconnect OAuth. Do not retry.

Payload examples:
- recall: {"query":"What does Luv prefer for the domain layer?","format":"markdown","plan":"fast"}
- remember: {"text":"Luv prefers Effect 4 for the yumeoi domain layer.","mode":"verbatim"} or {"items":[{"text":"Luv prefers Effect 4.","clientRef":"note-1"}]}
- feedback: {"id":"m_0123456789ab","signal":1} or {"id":"m_0123456789ab","signal":-1,"note":"Luv prefers Effect 4.","query":"What does Luv prefer?"}
- forget: {"id":"m_0123456789ab"} for agent/user/chat origin; add "confirm":true for extracted memories. Query form: {"query":"oat milk","confirm":true}.`;

const field = <S extends Schema.Top>(schema: S, description: string) =>
	schema.annotate({ description }).annotateKey({ description });

export const RecallToolInput = Schema.Struct({
	query: field(Schema.String, TOOL_FIELD_DESCRIPTIONS.recall.query),
	budgetTokens: Schema.optionalKey(field(Schema.Int, TOOL_FIELD_DESCRIPTIONS.recall.budgetTokens)),
	types: Schema.optionalKey(field(Schema.Array(MemoryType), TOOL_FIELD_DESCRIPTIONS.recall.types)),
	kinds: Schema.optionalKey(field(Schema.Array(MemoryKind), TOOL_FIELD_DESCRIPTIONS.recall.kinds)),
	sources: Schema.optionalKey(
		field(Schema.Array(Schema.String), TOOL_FIELD_DESCRIPTIONS.recall.sources),
	),
	from: Schema.optionalKey(
		field(Schema.NullOr(Schema.Finite), TOOL_FIELD_DESCRIPTIONS.recall.from),
	),
	to: Schema.optionalKey(field(Schema.NullOr(Schema.Finite), TOOL_FIELD_DESCRIPTIONS.recall.to)),
	asOf: Schema.optionalKey(
		field(Schema.NullOr(Schema.Finite), TOOL_FIELD_DESCRIPTIONS.recall.asOf),
	),
	entities: Schema.optionalKey(
		field(Schema.Array(Schema.String), TOOL_FIELD_DESCRIPTIONS.recall.entities),
	),
	include: Schema.optionalKey(
		field(Schema.Array(RecallInclude), TOOL_FIELD_DESCRIPTIONS.recall.include),
	),
	format: Schema.optionalKey(field(RecallFormat, TOOL_FIELD_DESCRIPTIONS.recall.format)),
	plan: Schema.optionalKey(field(RecallPlanMode, TOOL_FIELD_DESCRIPTIONS.recall.plan)),
	rerankMode: Schema.optionalKey(field(RerankMode, TOOL_FIELD_DESCRIPTIONS.recall.rerankMode)),
});
export type RecallToolInput = typeof RecallToolInput.Type;

export const RecallToolOutput = RecallResult;
export type RecallToolOutput = typeof RecallToolOutput.Type;

export const SearchMemoriesToolInput = Schema.Struct({
	query: field(Schema.String, TOOL_FIELD_DESCRIPTIONS.search_memories.query),
	types: Schema.optionalKey(
		field(Schema.Array(MemoryType), TOOL_FIELD_DESCRIPTIONS.search_memories.types),
	),
	kinds: Schema.optionalKey(
		field(Schema.Array(MemoryKind), TOOL_FIELD_DESCRIPTIONS.search_memories.kinds),
	),
	sources: Schema.optionalKey(
		field(Schema.Array(Schema.String), TOOL_FIELD_DESCRIPTIONS.search_memories.sources),
	),
	from: Schema.optionalKey(
		field(Schema.NullOr(Schema.Finite), TOOL_FIELD_DESCRIPTIONS.search_memories.from),
	),
	to: Schema.optionalKey(
		field(Schema.NullOr(Schema.Finite), TOOL_FIELD_DESCRIPTIONS.search_memories.to),
	),
	asOf: Schema.optionalKey(
		field(Schema.NullOr(Schema.Finite), TOOL_FIELD_DESCRIPTIONS.search_memories.asOf),
	),
	entities: Schema.optionalKey(
		field(Schema.Array(Schema.String), TOOL_FIELD_DESCRIPTIONS.search_memories.entities),
	),
	limit: Schema.optionalKey(field(Schema.Int, TOOL_FIELD_DESCRIPTIONS.search_memories.limit)),
	cursor: Schema.optionalKey(
		field(Schema.NullOr(Schema.String), TOOL_FIELD_DESCRIPTIONS.search_memories.cursor),
	),
	includeDormant: Schema.optionalKey(
		field(Schema.Boolean, TOOL_FIELD_DESCRIPTIONS.search_memories.includeDormant),
	),
});
export type SearchMemoriesToolInput = typeof SearchMemoriesToolInput.Type;

export const RememberItemInput = Schema.Struct({
	text: field(Schema.String, TOOL_FIELD_DESCRIPTIONS.remember.itemText),
	type: Schema.optionalKey(field(MemoryType, TOOL_FIELD_DESCRIPTIONS.remember.itemType)),
	kind: Schema.optionalKey(field(MemoryKind, TOOL_FIELD_DESCRIPTIONS.remember.itemKind)),
	importance: Schema.optionalKey(
		field(Schema.Finite, TOOL_FIELD_DESCRIPTIONS.remember.itemImportance),
	),
	eventAt: Schema.optionalKey(
		field(Schema.NullOr(Schema.String), TOOL_FIELD_DESCRIPTIONS.remember.itemEventAt),
	),
	validFrom: Schema.optionalKey(
		field(Schema.NullOr(Schema.String), TOOL_FIELD_DESCRIPTIONS.remember.itemValidFrom),
	),
	entities: Schema.optionalKey(
		field(
			Schema.Array(
				Schema.Struct({
					name: field(Schema.String, TOOL_FIELD_DESCRIPTIONS.remember.itemEntityName),
					type: field(EntityType, TOOL_FIELD_DESCRIPTIONS.remember.itemEntityType),
				}),
			),
			TOOL_FIELD_DESCRIPTIONS.remember.itemEntities,
		),
	),
	clientRef: Schema.optionalKey(
		field(Schema.String, TOOL_FIELD_DESCRIPTIONS.remember.itemClientRef),
	),
});
export type RememberItemInput = typeof RememberItemInput.Type;

export const RememberToolInput = Schema.Struct({
	text: Schema.optionalKey(field(Schema.String, TOOL_FIELD_DESCRIPTIONS.remember.text)),
	items: Schema.optionalKey(
		field(Schema.Array(RememberItemInput), TOOL_FIELD_DESCRIPTIONS.remember.items),
	),
	dedupe: Schema.optionalKey(field(Schema.Boolean, TOOL_FIELD_DESCRIPTIONS.remember.dedupe)),
	mode: Schema.optionalKey(
		field(Schema.Literals(["extract", "verbatim"]), TOOL_FIELD_DESCRIPTIONS.remember.mode),
	),
});
export type RememberToolInput = typeof RememberToolInput.Type;

export const RememberToolOutput = Schema.Struct({
	items: Schema.Array(RememberOutcomeItem),
});
export type RememberToolOutput = typeof RememberToolOutput.Type;

export const UpdateMemoryToolInput = Schema.Struct({
	id: field(Schema.String, TOOL_FIELD_DESCRIPTIONS.update_memory.id),
	text: Schema.optionalKey(field(Schema.String, TOOL_FIELD_DESCRIPTIONS.update_memory.text)),
	validTo: Schema.optionalKey(
		field(Schema.NullOr(Schema.String), TOOL_FIELD_DESCRIPTIONS.update_memory.validTo),
	),
	importance: Schema.optionalKey(
		field(Schema.Finite, TOOL_FIELD_DESCRIPTIONS.update_memory.importance),
	),
	kind: Schema.optionalKey(field(MemoryKind, TOOL_FIELD_DESCRIPTIONS.update_memory.kind)),
	eventAt: Schema.optionalKey(
		field(Schema.NullOr(Schema.String), TOOL_FIELD_DESCRIPTIONS.update_memory.eventAt),
	),
});
export type UpdateMemoryToolInput = typeof UpdateMemoryToolInput.Type;

export const ForgetToolInput = Schema.Struct({
	id: Schema.optionalKey(field(Schema.String, TOOL_FIELD_DESCRIPTIONS.forget.id)),
	query: Schema.optionalKey(field(Schema.String, TOOL_FIELD_DESCRIPTIONS.forget.query)),
	confirm: Schema.optionalKey(field(Schema.Boolean, TOOL_FIELD_DESCRIPTIONS.forget.confirm)),
	reason: Schema.optionalKey(field(Schema.String, TOOL_FIELD_DESCRIPTIONS.forget.reason)),
});
export type ForgetToolInput = typeof ForgetToolInput.Type;

export const ForgetToolOutput = Schema.Struct({
	ids: Schema.Array(Schema.String),
});
export type ForgetToolOutput = typeof ForgetToolOutput.Type;

export const FeedbackToolInput = Schema.Struct({
	id: field(Schema.String, TOOL_FIELD_DESCRIPTIONS.feedback.id),
	signal: field(Schema.Literals([1, -1]), TOOL_FIELD_DESCRIPTIONS.feedback.signal),
	note: Schema.optionalKey(field(Schema.String, TOOL_FIELD_DESCRIPTIONS.feedback.note)),
	query: Schema.optionalKey(field(Schema.String, TOOL_FIELD_DESCRIPTIONS.feedback.query)),
});
export type FeedbackToolInput = typeof FeedbackToolInput.Type;

export const FeedbackToolOutput = Schema.Struct({
	ok: Schema.Boolean,
	id: Schema.String,
	action: Schema.optionalKey(Schema.Literals(["scored", "rewritten", "reextracted"])),
	text: Schema.optionalKey(Schema.String),
});
export type FeedbackToolOutput = typeof FeedbackToolOutput.Type;

export const GetMemoryToolInput = Schema.Struct({
	id: field(Schema.String, TOOL_FIELD_DESCRIPTIONS.get_memory.id),
});
export type GetMemoryToolInput = typeof GetMemoryToolInput.Type;

export const GetMemoryToolOutput = Schema.Struct({
	memory: Memory,
	history: Schema.Array(MemoryHistoryRow),
	edges: Schema.Array(MemoryEdgeRow),
	entities: Schema.Array(
		Schema.Struct({ id: Schema.String, name: Schema.String, type: EntityType }),
	),
	provenance: Schema.Array(Provenance),
});
export type GetMemoryToolOutput = typeof GetMemoryToolOutput.Type;

export const GetDocumentToolInput = Schema.Struct({
	id: field(Schema.String, TOOL_FIELD_DESCRIPTIONS.get_document.id),
});
export type GetDocumentToolInput = typeof GetDocumentToolInput.Type;

export const ListSourcesToolInput = Schema.Struct({});
export type ListSourcesToolInput = typeof ListSourcesToolInput.Type;

export const ListSourcesToolOutput = Schema.Array(Source);
export type ListSourcesToolOutput = typeof ListSourcesToolOutput.Type;

export const GetEntityToolInput = Schema.Struct({
	name: Schema.optionalKey(field(Schema.String, TOOL_FIELD_DESCRIPTIONS.get_entity.name)),
	id: Schema.optionalKey(field(Schema.String, TOOL_FIELD_DESCRIPTIONS.get_entity.id)),
	hops: Schema.optionalKey(field(Schema.Int, TOOL_FIELD_DESCRIPTIONS.get_entity.hops)),
});
export type GetEntityToolInput = typeof GetEntityToolInput.Type;

export const TimelineToolInput = Schema.Struct({
	about: field(Schema.String, TOOL_FIELD_DESCRIPTIONS.timeline.about),
	from: Schema.optionalKey(
		field(Schema.NullOr(Schema.Finite), TOOL_FIELD_DESCRIPTIONS.timeline.from),
	),
	to: Schema.optionalKey(field(Schema.NullOr(Schema.Finite), TOOL_FIELD_DESCRIPTIONS.timeline.to)),
	limit: Schema.optionalKey(field(Schema.Int, TOOL_FIELD_DESCRIPTIONS.timeline.limit)),
});
export type TimelineToolInput = typeof TimelineToolInput.Type;

export const ChangesSinceToolInput = Schema.Struct({
	since: field(Schema.Finite, TOOL_FIELD_DESCRIPTIONS.changes_since.since),
});
export type ChangesSinceToolInput = typeof ChangesSinceToolInput.Type;

export const RecallContextAliasInput = Schema.Struct({
	query: field(Schema.String, TOOL_FIELD_DESCRIPTIONS.recall_context.query),
	sources: Schema.optionalKey(
		field(Schema.Array(Schema.String), TOOL_FIELD_DESCRIPTIONS.recall_context.sources),
	),
	kinds: Schema.optionalKey(
		field(Schema.Array(MemoryKind), TOOL_FIELD_DESCRIPTIONS.recall_context.kinds),
	),
	since: Schema.optionalKey(field(Schema.Finite, TOOL_FIELD_DESCRIPTIONS.recall_context.since)),
	budgetTokens: Schema.optionalKey(
		field(Schema.Int, TOOL_FIELD_DESCRIPTIONS.recall_context.budgetTokens),
	),
});
export type RecallContextAliasInput = typeof RecallContextAliasInput.Type;

export const AddMemoryAliasInput = Schema.Struct({
	text: field(Schema.String, TOOL_FIELD_DESCRIPTIONS.add_memory.text),
	kind: Schema.optionalKey(field(MemoryKind, TOOL_FIELD_DESCRIPTIONS.add_memory.kind)),
	confidence: Schema.optionalKey(
		field(Schema.Finite, TOOL_FIELD_DESCRIPTIONS.add_memory.confidence),
	),
});
export type AddMemoryAliasInput = typeof AddMemoryAliasInput.Type;

export const ToolErrorOutput = ToolError;

export const toolInputJsonSchema = (schema: Schema.Top): Record<string, unknown> => {
	const document = Schema.toJsonSchemaDocument(schema);
	const jsonSchema: Record<string, unknown> = { ...document.schema };
	if (Object.keys(document.definitions).length > 0) {
		jsonSchema.$defs = document.definitions;
	}
	return jsonSchema;
};

/** Example MCP payloads used to keep zod and Effect schemas in lockstep. */
export const TOOL_SCHEMA_EXAMPLES = {
	recall: {
		query: "What does Luv prefer for the domain layer?",
		budgetTokens: 1500,
		format: "markdown",
		plan: "fast",
	},
	search_memories: { query: "Effect 4", limit: 10, includeDormant: false },
	remember: {
		text: "Luv prefers Effect 4 for the yumeoi domain layer.",
		mode: "verbatim",
		dedupe: true,
	},
	remember_items: {
		items: [
			{
				text: "Luv prefers Effect 4.",
				clientRef: "note-1",
			},
		],
		mode: "verbatim" as const,
	},
	update_memory: { id: "m_0123456789ab", text: "Luv prefers Effect 4." },
	forget: { id: "m_0123456789ab", confirm: true, reason: "user asked" },
	feedback: { id: "m_0123456789ab", signal: 1 as const, query: "What does Luv prefer?" },
	feedback_correct: {
		id: "m_0123456789ab",
		signal: -1 as const,
		note: "Luv prefers Effect 4.",
		query: "What does Luv prefer?",
	},
	get_memory: { id: "m_0123456789ab" },
	get_document: { id: "doc-1" },
	list_sources: {},
	get_entity: { name: "Luv", hops: 1 },
	timeline: { about: "Aurora", limit: 10 },
	changes_since: { since: 1_700_000_000_000 },
	recall_context: {
		query: "What does Luv prefer for the domain layer?",
		budgetTokens: 1500,
	},
	add_memory: { text: "Luv prefers Effect 4.", kind: "preference" as const, confidence: 1 },
} as const;
