import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";

export function createYumeoiMcpServer() {
	const server = new McpServer({
		name: "yumeoi",
		version: "0.0.0",
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

	return server;
}

export const mcpHandler = createMcpHandler(createYumeoiMcpServer, {
	route: "/mcp",
});
