import { Schema } from "effect";
import {
	EntityType,
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

export const AGENT_INSTRUCTIONS = `yumeoi is a personal memory store. Prefer tools over guessing.

When to call which tool:
- recall: before answering anything about the user's notes, preferences, decisions, or past events. Default format is markdown with numbered citations. Use plan=fast unless the query needs synonym/entity expansion (then plan=full).
- search_memories: when you need a paged ranked list rather than a packed context block.
- remember: to store what the user just said, a decision, or a preference. Pass text (or items[]) and let the store classify, embed, and dedupe. Use clientRef on retries. mode=extract splits a paragraph into several memories; mode=verbatim stores the statement as given.
- update_memory: to correct text or validity on an existing id. The id stays stable.
- forget: to retire a memory the agent or user wrote. Extracted memories need confirm=true.
- feedback: signal=1 if a recalled line was useful, -1 if it was wrong. Cheap and preferred over rewriting.
- get_memory / get_document: after recall, when you need history, edges, entities, or the source document.
- get_entity: entity summary, relations, and recent memories. Pass name or id; hops≤2.
- timeline: chronological episodic memories about an entity or topic (from/to optional).
- changes_since: created/updated/superseded/forgotten ids since a timestamp, for local mirrors.

Cite memories with [n] from the packed block. Follow-up ids are in the footer (\`ids: m_…=[1]\`). Do not pick types, hashes, or embeddings — the server does that.`;

const optionalStringArray = Schema.optionalKey(Schema.Array(Schema.String));
const optionalKinds = Schema.optionalKey(Schema.Array(MemoryKind));
const optionalTypes = Schema.optionalKey(Schema.Array(MemoryType));
const optionalNumber = Schema.optionalKey(Schema.NullOr(Schema.Finite));

export const RecallToolInput = Schema.Struct({
	query: Schema.String,
	budgetTokens: Schema.optionalKey(Schema.Int),
	types: optionalTypes,
	kinds: optionalKinds,
	sources: optionalStringArray,
	from: optionalNumber,
	to: optionalNumber,
	asOf: optionalNumber,
	entities: optionalStringArray,
	include: Schema.optionalKey(Schema.Array(RecallInclude)),
	format: Schema.optionalKey(RecallFormat),
	plan: Schema.optionalKey(RecallPlanMode),
	rerankMode: Schema.optionalKey(RerankMode),
});
export type RecallToolInput = typeof RecallToolInput.Type;

export const RecallToolOutput = RecallResult;
export type RecallToolOutput = typeof RecallToolOutput.Type;

export const SearchMemoriesToolInput = Schema.Struct({
	query: Schema.String,
	types: optionalTypes,
	kinds: optionalKinds,
	sources: optionalStringArray,
	from: optionalNumber,
	to: optionalNumber,
	asOf: optionalNumber,
	entities: optionalStringArray,
	limit: Schema.optionalKey(Schema.Int),
	cursor: Schema.optionalKey(Schema.NullOr(Schema.String)),
	includeDormant: Schema.optionalKey(Schema.Boolean),
});
export type SearchMemoriesToolInput = typeof SearchMemoriesToolInput.Type;

export const RememberItemInput = Schema.Struct({
	text: Schema.String,
	type: Schema.optionalKey(MemoryType),
	kind: Schema.optionalKey(MemoryKind),
	importance: Schema.optionalKey(Schema.Finite),
	eventAt: Schema.optionalKey(Schema.NullOr(Schema.String)),
	validFrom: Schema.optionalKey(Schema.NullOr(Schema.String)),
	entities: Schema.optionalKey(
		Schema.Array(Schema.Struct({ name: Schema.String, type: EntityType })),
	),
	clientRef: Schema.optionalKey(Schema.String),
});
export type RememberItemInput = typeof RememberItemInput.Type;

export const RememberToolInput = Schema.Struct({
	text: Schema.optionalKey(Schema.String),
	items: Schema.optionalKey(Schema.Array(RememberItemInput)),
	dedupe: Schema.optionalKey(Schema.Boolean),
	mode: Schema.optionalKey(Schema.Literals(["extract", "verbatim"])),
});
export type RememberToolInput = typeof RememberToolInput.Type;

export const RememberToolOutput = Schema.Struct({
	items: Schema.Array(RememberOutcomeItem),
});
export type RememberToolOutput = typeof RememberToolOutput.Type;

export const UpdateMemoryToolInput = Schema.Struct({
	id: Schema.String,
	text: Schema.optionalKey(Schema.String),
	validTo: Schema.optionalKey(Schema.NullOr(Schema.String)),
	importance: Schema.optionalKey(Schema.Finite),
	kind: Schema.optionalKey(MemoryKind),
	eventAt: Schema.optionalKey(Schema.NullOr(Schema.String)),
});
export type UpdateMemoryToolInput = typeof UpdateMemoryToolInput.Type;

export const ForgetToolInput = Schema.Struct({
	id: Schema.optionalKey(Schema.String),
	query: Schema.optionalKey(Schema.String),
	confirm: Schema.optionalKey(Schema.Boolean),
	reason: Schema.optionalKey(Schema.String),
});
export type ForgetToolInput = typeof ForgetToolInput.Type;

export const ForgetToolOutput = Schema.Struct({
	ids: Schema.Array(Schema.String),
});
export type ForgetToolOutput = typeof ForgetToolOutput.Type;

export const FeedbackToolInput = Schema.Struct({
	id: Schema.String,
	signal: Schema.Literals([1, -1]),
	note: Schema.optionalKey(Schema.String),
});
export type FeedbackToolInput = typeof FeedbackToolInput.Type;

export const FeedbackToolOutput = Schema.Struct({
	ok: Schema.Boolean,
	id: Schema.String,
});
export type FeedbackToolOutput = typeof FeedbackToolOutput.Type;

export const GetMemoryToolInput = Schema.Struct({
	id: Schema.String,
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
	id: Schema.String,
});
export type GetDocumentToolInput = typeof GetDocumentToolInput.Type;

export const ListSourcesToolInput = Schema.Struct({});
export type ListSourcesToolInput = typeof ListSourcesToolInput.Type;

export const ListSourcesToolOutput = Schema.Array(Source);
export type ListSourcesToolOutput = typeof ListSourcesToolOutput.Type;

export const GetEntityToolInput = Schema.Struct({
	name: Schema.optionalKey(Schema.String),
	id: Schema.optionalKey(Schema.String),
	hops: Schema.optionalKey(Schema.Int),
});
export type GetEntityToolInput = typeof GetEntityToolInput.Type;

export const TimelineToolInput = Schema.Struct({
	about: Schema.String,
	from: optionalNumber,
	to: optionalNumber,
	limit: Schema.optionalKey(Schema.Int),
});
export type TimelineToolInput = typeof TimelineToolInput.Type;

export const ChangesSinceToolInput = Schema.Struct({
	since: Schema.Finite,
});
export type ChangesSinceToolInput = typeof ChangesSinceToolInput.Type;

export const ToolErrorOutput = ToolError;

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
	update_memory: { id: "m_0123456789ab", text: "Luv prefers Effect 4." },
	forget: { id: "m_0123456789ab", confirm: true, reason: "user asked" },
	feedback: { id: "m_0123456789ab", signal: 1 as const },
	get_memory: { id: "m_0123456789ab" },
	get_document: { id: "doc-1" },
	list_sources: {},
	get_entity: { name: "Luv", hops: 1 },
	timeline: { about: "Aurora", limit: 10 },
	changes_since: { since: 1_700_000_000_000 },
} as const;
