import { McpServer } from "@modelcontextprotocol/server";
import { MEMORY_KINDS, type MemoryKind } from "@yumeoi/domain";
import { createMcpHandler, getMcpAuthContext } from "agents/mcp/server";
import { z } from "zod";
import { authenticateRequest, unauthorized } from "../auth/api-key.ts";

const kinds = z.enum(MEMORY_KINDS);

const jsonText = (value: unknown) => ({
	content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
});

const agentFor = (env: Env) => {
	const auth = getMcpAuthContext();
	const userId = typeof auth?.props.userId === "string" ? auth.props.userId : "default";
	return env.MemoryAgent.getByName(userId);
};

export function createYumeoiMcpServer(env: Env) {
	const server = new McpServer({
		name: "yumeoi",
		version: "0.1.0",
	});

	server.registerTool(
		"ping",
		{
			description: "Health check for the yumeoi MCP server.",
			inputSchema: {
				note: z.string().optional(),
			},
		},
		async ({ note }) => ({
			content: [
				{
					type: "text" as const,
					text: note ? `pong: ${note}` : "pong",
				},
			],
		}),
	);

	server.registerTool(
		"search_memories",
		{
			description:
				"Hybrid search over extracted memories. Filter by source, kind, and time. Returns memories with provenance and scores.",
			inputSchema: {
				query: z.string(),
				sources: z.array(z.string()).optional(),
				kinds: z.array(kinds).optional(),
				since: z.number().optional(),
				limit: z.number().optional(),
			},
		},
		async ({ query, sources, kinds: kindFilter, since, limit }) => {
			const hits = await agentFor(env).search({
				query,
				sources: sources ?? [],
				kinds: (kindFilter ?? []) as MemoryKind[],
				since: since ?? null,
				limit: limit ?? 20,
			});
			return jsonText(hits);
		},
	);

	server.registerTool(
		"recall_context",
		{
			description:
				"Return a compact context block of deduped memories plus supporting chunks, sized to a token budget. Call this before doing work.",
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
				budgetTokens: budgetTokens ?? 2000,
				rerank: true,
			});
			return jsonText(result);
		},
	);

	server.registerTool(
		"get_memory",
		{
			description: "Fetch one memory by id.",
			inputSchema: { id: z.string() },
		},
		async ({ id }) => jsonText(await agentFor(env).getMemory(id)),
	);

	server.registerTool(
		"get_document",
		{
			description: "Fetch a normalized document (markdown) by id.",
			inputSchema: { id: z.string() },
		},
		async ({ id }) => jsonText(await agentFor(env).getDocument(id)),
	);

	server.registerTool(
		"add_memory",
		{
			description: "Write a memory back into the store (tagged as an agent source).",
			inputSchema: {
				text: z.string(),
				kind: kinds.optional(),
				confidence: z.number().optional(),
			},
		},
		async ({ text, kind, confidence }) =>
			jsonText(
				await agentFor(env).addMemory({
					text,
					kind: kind ?? "fact",
					confidence: confidence ?? 1,
				}),
			),
	);

	server.registerTool(
		"list_sources",
		{
			description: "List connected sources and their labels.",
			inputSchema: {},
		},
		async () => jsonText(await agentFor(env).listSources()),
	);

	return server;
}

export async function handleMcp(
	request: Request,
	env: Env,
	ctx: ExecutionContext,
): Promise<Response> {
	const auth = await authenticateRequest(request, env);
	if (!auth) {
		return unauthorized();
	}
	const handler = createMcpHandler(() => createYumeoiMcpServer(env), {
		route: "/mcp",
		authContext: { props: { userId: auth.userId } },
	});
	return handler(request, env, ctx);
}
