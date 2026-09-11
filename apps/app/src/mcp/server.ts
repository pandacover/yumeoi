import { McpServer } from "@modelcontextprotocol/server";
import {
	AGENT_INSTRUCTIONS,
	MEMORY_KINDS,
	MEMORY_TYPES,
	type MemoryKind,
	type MemoryType,
	type RecallFormat,
	type RecallInclude,
	type RecallPlanMode,
	type RerankMode,
} from "@yumeoi/domain";
import { createMcpHandler, getMcpAuthContext } from "agents/mcp/server";
import { z } from "zod";

const kinds = z.enum(MEMORY_KINDS);
const types = z.enum(MEMORY_TYPES);
const include = z.enum(["memories", "evidence", "entities", "conflicts"]);
const format = z.enum(["markdown", "json"]);
const planMode = z.enum(["fast", "full"]);
const rerankMode = z.enum(["none", "cross", "llm"]);

const jsonText = (value: unknown) => ({
	content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
});

const textResult = (text: string) => ({
	content: [{ type: "text" as const, text }],
});

const toolError = (error: string, hint: string) => ({
	isError: true as const,
	content: [{ type: "text" as const, text: JSON.stringify({ error, hint }) }],
});

const authProps = () => {
	const auth = getMcpAuthContext();
	const props = auth?.props ?? {};
	if (typeof props.userId !== "string" || props.userId.length === 0) {
		throw new Error("unauthorized");
	}
	return {
		userId: props.userId,
		clientId: typeof props.clientId === "string" ? props.clientId : "unknown",
	};
};

const agentFor = (env: Env) => env.MemoryAgent.getByName(authProps().userId);

const asError = (caught: unknown) => {
	const message = caught instanceof Error ? caught.message : String(caught);
	if (/not found/i.test(message)) {
		return toolError("not_found", message);
	}
	if (/confirm=true|requires/i.test(message)) {
		return toolError("invalid_input", message);
	}
	return toolError("invalid_input", message);
};

const omitUndefined = <T extends Record<string, unknown>>(value: T) =>
	Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;

export function createYumeoiMcpServer(env: Env) {
	const server = new McpServer({
		name: "horizon",
		version: "0.2.0",
		instructions: AGENT_INSTRUCTIONS,
	} as never);

	server.registerTool(
		"recall",
		{
			description:
				"Packed, cited memory context for a question. Prefer this before doing work. Default output is markdown.",
			annotations: { readOnlyHint: true },
			inputSchema: {
				query: z.string(),
				budgetTokens: z.number().optional(),
				types: z.array(types).optional(),
				kinds: z.array(kinds).optional(),
				sources: z.array(z.string()).optional(),
				from: z.number().nullable().optional(),
				to: z.number().nullable().optional(),
				asOf: z.number().nullable().optional(),
				entities: z.array(z.string()).optional(),
				include: z.array(include).optional(),
				format: format.optional(),
				plan: planMode.optional(),
				rerankMode: rerankMode.optional(),
			},
		},
		async (input) => {
			try {
				const result = await agentFor(env).recall({
					query: input.query,
					sources: input.sources ?? [],
					kinds: (input.kinds ?? []) as MemoryKind[],
					types: (input.types ?? []) as MemoryType[],
					since: input.from ?? null,
					from: input.from ?? null,
					to: input.to ?? null,
					asOf: input.asOf ?? null,
					entities: input.entities ?? [],
					include: (input.include ?? ["memories"]) as RecallInclude[],
					format: (input.format ?? "markdown") as RecallFormat,
					plan: (input.plan ?? "fast") as RecallPlanMode,
					budgetTokens: input.budgetTokens ?? 1500,
					rerank: (input.rerankMode ?? "cross") !== "none",
					rerankMode: (input.rerankMode ?? "cross") as RerankMode,
				});
				if ((input.format ?? "markdown") === "json") {
					return jsonText(result);
				}
				return textResult(result.markdown ?? "");
			} catch (caught) {
				return asError(caught);
			}
		},
	);

	server.registerTool(
		"search_memories",
		{
			description: "Flat ranked memory list with the same filters as recall. Use to page.",
			annotations: { readOnlyHint: true },
			inputSchema: {
				query: z.string(),
				types: z.array(types).optional(),
				kinds: z.array(kinds).optional(),
				sources: z.array(z.string()).optional(),
				from: z.number().nullable().optional(),
				to: z.number().nullable().optional(),
				asOf: z.number().nullable().optional(),
				entities: z.array(z.string()).optional(),
				limit: z.number().optional(),
				includeDormant: z.boolean().optional(),
			},
		},
		async (input) => {
			try {
				const hits = await agentFor(env).search({
					query: input.query,
					sources: input.sources ?? [],
					kinds: (input.kinds ?? []) as MemoryKind[],
					types: (input.types ?? []) as MemoryType[],
					since: input.from ?? null,
					from: input.from ?? null,
					to: input.to ?? null,
					asOf: input.asOf ?? null,
					entities: input.entities ?? [],
					limit: input.limit ?? 20,
					includeDormant: input.includeDormant ?? false,
				});
				const lines = hits.map(
					(hit, index) =>
						`[${index + 1}] (${hit.memory.type}·${hit.memory.kind}) ${hit.memory.text} — ${hit.memory.id}`,
				);
				return textResult(
					`${lines.join("\n")}\nids: ${hits.map((hit, i) => `${hit.memory.id}=[${i + 1}]`).join(", ")}`,
				);
			} catch (caught) {
				return asError(caught);
			}
		},
	);

	server.registerTool(
		"remember",
		{
			description:
				"Store a statement or extract several memories from a paragraph. The server classifies, embeds, and dedupes. Pass clientRef to make retries idempotent.",
			annotations: { idempotentHint: true },
			inputSchema: {
				text: z.string().optional(),
				items: z
					.array(
						z.object({
							text: z.string(),
							type: types.optional(),
							kind: kinds.optional(),
							importance: z.number().optional(),
							eventAt: z.string().nullable().optional(),
							validFrom: z.string().nullable().optional(),
							clientRef: z.string().optional(),
						}),
					)
					.optional(),
				dedupe: z.boolean().optional(),
				mode: z.enum(["extract", "verbatim"]).optional(),
			},
		},
		async (input) => {
			try {
				const { clientId } = authProps();
				return jsonText(
					await agentFor(env).remember(
						omitUndefined({
							text: input.text,
							items: input.items,
							dedupe: input.dedupe ?? true,
							mode: input.mode ?? (input.items ? "verbatim" : "extract"),
							sourceId: `agent:${clientId}`,
						}) as never,
					),
				);
			} catch (caught) {
				return asError(caught);
			}
		},
	);

	server.registerTool(
		"update_memory",
		{
			description:
				"Correct an existing memory in place. The id stays stable and history is recorded.",
			inputSchema: {
				id: z.string(),
				text: z.string().optional(),
				validTo: z.string().nullable().optional(),
				importance: z.number().optional(),
				kind: kinds.optional(),
				eventAt: z.string().nullable().optional(),
			},
		},
		async (input) => {
			try {
				return jsonText(await agentFor(env).updateMemory(omitUndefined(input) as never));
			} catch (caught) {
				return asError(caught);
			}
		},
	);

	server.registerTool(
		"forget",
		{
			description:
				"Soft-forget a memory. Agent/user/chat origin can be forgotten by id; extracted memories need confirm=true.",
			annotations: { destructiveHint: true },
			inputSchema: {
				id: z.string().optional(),
				query: z.string().optional(),
				confirm: z.boolean().optional(),
				reason: z.string().optional(),
			},
		},
		async (input) => {
			try {
				return jsonText(await agentFor(env).forget(omitUndefined(input) as never));
			} catch (caught) {
				return asError(caught);
			}
		},
	);

	server.registerTool(
		"feedback",
		{
			description: "Mark a recalled memory as useful (1) or wrong (-1).",
			annotations: { idempotentHint: true },
			inputSchema: {
				id: z.string(),
				signal: z.union([z.literal(1), z.literal(-1)]),
				note: z.string().optional(),
			},
		},
		async (input) => {
			try {
				const { clientId } = authProps();
				return jsonText(
					await agentFor(env).feedback(omitUndefined({ ...input, clientId }) as never),
				);
			} catch (caught) {
				return asError(caught);
			}
		},
	);

	server.registerTool(
		"get_memory",
		{
			description: "Full memory record: history, edges, entities, provenance.",
			annotations: { readOnlyHint: true },
			inputSchema: { id: z.string() },
		},
		async ({ id }) => {
			try {
				return jsonText(await agentFor(env).getMemoryDetail(id));
			} catch (caught) {
				return asError(caught);
			}
		},
	);

	server.registerTool(
		"get_document",
		{
			description: "Fetch a normalized document (markdown) by id.",
			annotations: { readOnlyHint: true },
			inputSchema: { id: z.string() },
		},
		async ({ id }) => {
			try {
				return jsonText(await agentFor(env).getDocument(id));
			} catch (caught) {
				return asError(caught);
			}
		},
	);

	server.registerTool(
		"list_sources",
		{
			description: "List connected sources and their labels.",
			annotations: { readOnlyHint: true },
			inputSchema: {},
		},
		async () => jsonText(await agentFor(env).listSources()),
	);

	server.registerTool(
		"get_entity",
		{
			description: "Entity summary, relations, and recent memories. Pass name or id.",
			annotations: { readOnlyHint: true },
			inputSchema: {
				name: z.string().optional(),
				id: z.string().optional(),
				hops: z.number().optional(),
			},
		},
		async (input) => {
			try {
				const view = await agentFor(env).getEntity(omitUndefined(input));
				if (!view) {
					return toolError("not_found", "entity was not found");
				}
				return jsonText(view);
			} catch (caught) {
				return asError(caught);
			}
		},
	);

	server.registerTool(
		"timeline",
		{
			description: "Chronological episodic memories about an entity or topic.",
			annotations: { readOnlyHint: true },
			inputSchema: {
				about: z.string(),
				from: z.number().nullable().optional(),
				to: z.number().nullable().optional(),
				limit: z.number().optional(),
			},
		},
		async (input) => {
			try {
				return jsonText(await agentFor(env).timeline(omitUndefined(input) as never));
			} catch (caught) {
				return asError(caught);
			}
		},
	);

	server.registerTool(
		"changes_since",
		{
			description: "Created, updated, superseded, or forgotten memory ids since a timestamp.",
			annotations: { readOnlyHint: true },
			inputSchema: { since: z.number() },
		},
		async ({ since }) => {
			try {
				return jsonText(await agentFor(env).changesSince(since));
			} catch (caught) {
				return asError(caught);
			}
		},
	);

	server.registerTool(
		"recall_context",
		{
			description: "Deprecated alias of recall. Prefer recall.",
			annotations: { readOnlyHint: true },
			inputSchema: {
				query: z.string(),
				sources: z.array(z.string()).optional(),
				kinds: z.array(kinds).optional(),
				since: z.number().optional(),
				budgetTokens: z.number().optional(),
			},
		},
		async ({ query, sources, kinds: kindFilter, since, budgetTokens }) => {
			const result = await agentFor(env).recall({
				query,
				sources: sources ?? [],
				kinds: (kindFilter ?? []) as MemoryKind[],
				since: since ?? null,
				budgetTokens: budgetTokens ?? 1500,
				rerank: true,
				format: "markdown",
			});
			return textResult(result.markdown ?? "");
		},
	);

	server.registerTool(
		"add_memory",
		{
			description: "Deprecated alias of remember. Prefer remember.",
			inputSchema: {
				text: z.string(),
				kind: kinds.optional(),
				confidence: z.number().optional(),
			},
		},
		async ({ text, kind, confidence }) => {
			const { clientId } = authProps();
			return jsonText(
				await agentFor(env).remember({
					text,
					items: [
						{
							text,
							kind: kind ?? "fact",
							importance: confidence ?? 1,
						},
					],
					mode: "verbatim",
					sourceId: `agent:${clientId}`,
				}),
			);
		},
	);

	const stubResource = (name: string, uri: string, title: string, body: () => Promise<unknown>) =>
		server.registerResource(
			name,
			uri,
			{ title, description: title, mimeType: "text/markdown" },
			async (resourceUri) => ({
				contents: [
					{
						uri: resourceUri.href,
						mimeType: "text/markdown",
						text: String(await body()),
					},
				],
			}),
		);

	stubResource(
		"profile",
		"memory://profile",
		"Stable semantic memories about the user",
		async () => {
			const text = await agentFor(env).profile();
			return text || "(no profile memories yet)";
		},
	);
	stubResource("procedures", "memory://procedures", "Procedural memories", async () => {
		const hits = await agentFor(env).search({
			query: "how to procedure rule",
			types: ["procedural"],
			limit: 25,
		});
		return hits.map((hit) => `- ${hit.memory.text}`).join("\n") || "(no procedures yet)";
	});
	stubResource("entities", "memory://entities", "Known entities", async () => {
		const text = await agentFor(env).entityIndex();
		return text || "(no entities yet)";
	});

	server.registerResource(
		"sources",
		"memory://sources",
		{
			title: "Sources",
			description: "Connected sources for this user",
			mimeType: "application/json",
		},
		async (uri) => ({
			contents: [
				{
					uri: uri.href,
					mimeType: "application/json",
					text: JSON.stringify(await agentFor(env).listSources(), null, 2),
				},
			],
		}),
	);

	server.registerResource(
		"recent",
		"memory://recent",
		{
			title: "Recent memories",
			description: "Last 20 memories for this user",
			mimeType: "application/json",
		},
		async (uri) => ({
			contents: [
				{
					uri: uri.href,
					mimeType: "application/json",
					text: JSON.stringify(await agentFor(env).listRecentMemories(20), null, 2),
				},
			],
		}),
	);

	server.registerPrompt(
		"context-for-task",
		{
			title: "Context for a task",
			description: "Recall memories relevant to a task description",
			argsSchema: { task: z.string() },
		},
		({ task }) => ({
			messages: [
				{
					role: "user" as const,
					content: {
						type: "text" as const,
						text: `Use the recall tool with query: ${task}. Then do the task using only cited memories.`,
					},
				},
			],
		}),
	);

	return server;
}

export const mcpApiHandler = {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		return createMcpHandler(() => createYumeoiMcpServer(env), {
			route: "/mcp",
		})(request, env, ctx);
	},
} satisfies ExportedHandler<Env>;
