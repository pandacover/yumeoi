import type { McpGrantView } from "../auth/grants.ts";

export const INTEGRATION_IDS = ["notion"] as const;
export type IntegrationId = (typeof INTEGRATION_IDS)[number];

export const isIntegrationId = (value: string): value is IntegrationId =>
	INTEGRATION_IDS.includes(value as IntegrationId);

export const isFixtureSourceId = (id: string): boolean => id.includes(":fixture:");

export const AGENT_IDS = ["cursor", "claude", "http"] as const;
export type AgentId = (typeof AGENT_IDS)[number];

export const isAgentId = (value: string): value is AgentId => AGENT_IDS.includes(value as AgentId);

export const agentCatalog = [
	{
		id: "cursor" as const,
		name: "Cursor",
		detail: "MCP over OAuth",
	},
	{
		id: "claude" as const,
		name: "Claude Desktop",
		detail: "MCP over OAuth",
	},
	{
		id: "http" as const,
		name: "HTTP / scripts",
		detail: "Bearer API key",
	},
];

export const grantMatchesAgent = (id: Exclude<AgentId, "http">, grant: McpGrantView): boolean => {
	const hay = `${grant.clientName} ${grant.clientId} ${grant.redirectUri ?? ""}`.toLowerCase();
	if (id === "cursor") {
		return hay.includes("cursor") || hay.includes("localhost:8787");
	}
	return hay.includes("claude") || hay.includes("anthropic");
};
