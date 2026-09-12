import { McpServer } from "@modelcontextprotocol/server";
import {
	AGENT_INSTRUCTIONS,
	type MemoryKind,
	type MemoryType,
	type RecallFormat,
	type RecallInclude,
	type RecallPlanMode,
	type RerankMode,
} from "@yumeoi/domain";
import { createMcpHandler, getMcpAuthContext } from "agents/mcp/server";
import { z } from "zod";
import { jsonText, runTool, textResult, toolError } from "./errors.ts";
import {
	addMemoryAliasInputSchema,
	advertiseInput,
	changesSinceInputSchema,
	feedbackInputSchema,
	forgetInputSchema,
	getDocumentInputSchema,
	getEntityInputSchema,
	getMemoryInputSchema,
	listSourcesInputSchema,
	recallContextAliasInputSchema,
	recallInputSchema,
	rememberInputSchema,
	searchMemoriesInputSchema,
	timelineInputSchema,
	updateMemoryInputSchema,
} from "./schemas.ts";

const authProps = () => {
	const auth = getMcpAuthContext();
	const props = auth?.props ?? {};
	if (typeof props.userId !== "string" || props.userId.length === 0) {
		throw new Error("unauthorized: MCP session has no user");
	}
	return {
		userId: props.userId,
		clientId: typeof props.clientId === "string" ? props.clientId : "unknown",
	};
};

const agentFor = (env: Env) => env.MemoryAgent.getByName(authProps().userId);

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
			inputSchema: advertiseInput(recallInputSchema),
		},
		async (input) =>
			runTool(recallInputSchema, input, async (parsed) => {
				const result = await agentFor(env).recall({
					query: parsed.query,
					sources: parsed.sources ?? [],
					kinds: (parsed.kinds ?? []) as MemoryKind[],
					types: (parsed.types ?? []) as MemoryType[],
					since: parsed.from ?? null,
					from: parsed.from ?? null,
					to: parsed.to ?? null,
					asOf: parsed.asOf ?? null,
					entities: parsed.entities ?? [],
					include: (parsed.include ?? ["memories"]) as RecallInclude[],
					format: (parsed.format ?? "markdown") as RecallFormat,
					plan: (parsed.plan ?? "fast") as RecallPlanMode,
					budgetTokens: parsed.budgetTokens ?? 1500,
					rerank: (parsed.rerankMode ?? "cross") !== "none",
					rerankMode: (parsed.rerankMode ?? "cross") as RerankMode,
				});
				if ((parsed.format ?? "markdown") === "json") {
					return jsonText(result);
				}
				return textResult(result.markdown ?? "");
			}),
	);

	server.registerTool(
		"search_memories",
		{
			description: "Flat ranked memory list with the same filters as recall. Use to page.",
			annotations: { readOnlyHint: true },
			inputSchema: advertiseInput(searchMemoriesInputSchema),
		},
		async (input) =>
			runTool(searchMemoriesInputSchema, input, async (parsed) => {
				const hits = await agentFor(env).search({
					query: parsed.query,
					sources: parsed.sources ?? [],
					kinds: (parsed.kinds ?? []) as MemoryKind[],
					types: (parsed.types ?? []) as MemoryType[],
					since: parsed.from ?? null,
					from: parsed.from ?? null,
					to: parsed.to ?? null,
					asOf: parsed.asOf ?? null,
					entities: parsed.entities ?? [],
					limit: parsed.limit ?? 20,
					includeDormant: parsed.includeDormant ?? false,
				});
				const lines = hits.map(
					(hit, index) =>
						`[${index + 1}] (${hit.memory.type}·${hit.memory.kind}) ${hit.memory.text} — ${hit.memory.id}`,
				);
				return textResult(
					`${lines.join("\n")}\nids: ${hits.map((hit, i) => `${hit.memory.id}=[${i + 1}]`).join(", ")}`,
				);
			}),
	);

	server.registerTool(
		"remember",
		{
			description:
				"Store a statement or extract several memories from a paragraph. The server classifies, embeds, and dedupes. Pass clientRef on items to make retries idempotent.",
			annotations: { idempotentHint: true },
			inputSchema: advertiseInput(rememberInputSchema),
		},
		async (input) =>
			runTool(rememberInputSchema, input, async (parsed) => {
				const { clientId } = authProps();
				return jsonText(
					await agentFor(env).remember(
						omitUndefined({
							text: parsed.text,
							items: parsed.items,
							dedupe: parsed.dedupe ?? true,
							mode: parsed.mode ?? (parsed.items ? "verbatim" : "extract"),
							sourceId: `agent:${clientId}`,
						}) as never,
					),
				);
			}),
	);

	server.registerTool(
		"update_memory",
		{
			description:
				"Correct an existing memory in place. The id stays stable and history is recorded.",
			inputSchema: advertiseInput(updateMemoryInputSchema),
		},
		async (input) =>
			runTool(updateMemoryInputSchema, input, async (parsed) =>
				jsonText(await agentFor(env).updateMemory(omitUndefined(parsed) as never)),
			),
	);

	server.registerTool(
		"forget",
		{
			description:
				"Soft-forget a memory. Agent/user/chat origin can be forgotten by id; extracted memories need confirm=true.",
			annotations: { destructiveHint: true },
			inputSchema: advertiseInput(forgetInputSchema),
		},
		async (input) =>
			runTool(forgetInputSchema, input, async (parsed) =>
				jsonText(await agentFor(env).forget(omitUndefined(parsed) as never)),
			),
	);

	server.registerTool(
		"feedback",
		{
			description:
				"Mark a recalled memory as useful (1) or wrong (-1). On -1, note and/or query rewrites or re-extracts the memory text (same id, re-embedded); otherwise only importance changes.",
			annotations: { idempotentHint: true },
			inputSchema: advertiseInput(feedbackInputSchema),
		},
		async (input) =>
			runTool(feedbackInputSchema, input, async (parsed) => {
				const { clientId } = authProps();
				return jsonText(
					await agentFor(env).feedback(omitUndefined({ ...parsed, clientId }) as never),
				);
			}),
	);

	server.registerTool(
		"get_memory",
		{
			description: "Full memory record: history, edges, entities, provenance.",
			annotations: { readOnlyHint: true },
			inputSchema: advertiseInput(getMemoryInputSchema),
		},
		async (input) =>
			runTool(getMemoryInputSchema, input, async ({ id }) =>
				jsonText(await agentFor(env).getMemoryDetail(id)),
			),
	);

	server.registerTool(
		"get_document",
		{
			description: "Fetch a normalized document (markdown) by id.",
			annotations: { readOnlyHint: true },
			inputSchema: advertiseInput(getDocumentInputSchema),
		},
		async (input) =>
			runTool(getDocumentInputSchema, input, async ({ id }) =>
				jsonText(await agentFor(env).getDocument(id)),
			),
	);

	server.registerTool(
		"list_sources",
		{
			description: "List connected sources and their labels.",
			annotations: { readOnlyHint: true },
			inputSchema: advertiseInput(listSourcesInputSchema),
		},
		async (input) =>
			runTool(listSourcesInputSchema, input, async () =>
				jsonText(await agentFor(env).listSources()),
			),
	);

	server.registerTool(
		"get_entity",
		{
			description: "Entity summary, relations, and recent memories. Pass name or id.",
			annotations: { readOnlyHint: true },
			inputSchema: advertiseInput(getEntityInputSchema),
		},
		async (input) =>
			runTool(getEntityInputSchema, input, async (parsed) => {
				const view = await agentFor(env).getEntity(omitUndefined(parsed));
				if (!view) {
					return toolError(
						"not_found",
						"entity was not found. Pass a name or id from recall entities, get_memory, or memory://entities.",
					);
				}
				return jsonText(view);
			}),
	);

	server.registerTool(
		"timeline",
		{
			description: "Chronological episodic memories about an entity or topic.",
			annotations: { readOnlyHint: true },
			inputSchema: advertiseInput(timelineInputSchema),
		},
		async (input) =>
			runTool(timelineInputSchema, input, async (parsed) =>
				jsonText(await agentFor(env).timeline(omitUndefined(parsed) as never)),
			),
	);

	server.registerTool(
		"changes_since",
		{
			description: "Created, updated, superseded, or forgotten memory ids since a timestamp.",
			annotations: { readOnlyHint: true },
			inputSchema: advertiseInput(changesSinceInputSchema),
		},
		async (input) =>
			runTool(changesSinceInputSchema, input, async ({ since }) =>
				jsonText(await agentFor(env).changesSince(since)),
			),
	);

	server.registerTool(
		"recall_context",
		{
			description: "Deprecated alias of recall. Prefer recall.",
			annotations: { readOnlyHint: true },
			inputSchema: advertiseInput(recallContextAliasInputSchema),
		},
		async (input) =>
			runTool(recallContextAliasInputSchema, input, async (parsed) => {
				const result = await agentFor(env).recall({
					query: parsed.query,
					sources: parsed.sources ?? [],
					kinds: (parsed.kinds ?? []) as MemoryKind[],
					since: parsed.since ?? null,
					budgetTokens: parsed.budgetTokens ?? 1500,
					rerank: true,
					format: "markdown",
				});
				return textResult(result.markdown ?? "");
			}),
	);

	server.registerTool(
		"add_memory",
		{
			description: "Deprecated alias of remember. Prefer remember.",
			inputSchema: advertiseInput(addMemoryAliasInputSchema),
		},
		async (input) =>
			runTool(addMemoryAliasInputSchema, input, async (parsed) => {
				const { clientId } = authProps();
				return jsonText(
					await agentFor(env).remember({
						text: parsed.text,
						items: [
							{
								text: parsed.text,
								kind: parsed.kind ?? "fact",
								importance: parsed.confidence ?? 1,
							},
						],
						mode: "verbatim",
						sourceId: `agent:${clientId}`,
					}),
				);
			}),
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
			argsSchema: {
				task: z
					.string()
					.describe("Task or question to recall memory context for before doing the work."),
			},
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
