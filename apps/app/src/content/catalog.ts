import type { McpGrantView } from "../auth/grants.ts";

export const INTEGRATION_IDS = ["notion"] as const;
export type IntegrationId = (typeof INTEGRATION_IDS)[number];

export const isIntegrationId = (value: string): value is IntegrationId =>
	INTEGRATION_IDS.includes(value as IntegrationId);

export const isFixtureSourceId = (id: string): boolean => id.includes(":fixture:");

export const MCP_CLIENT_IDS = ["cursor", "claude", "mcp"] as const;
export type McpClientId = (typeof MCP_CLIENT_IDS)[number];

export const AGENT_IDS = [...MCP_CLIENT_IDS, "http"] as const;
export type AgentId = (typeof AGENT_IDS)[number];

export const isMcpClientId = (value: string): value is McpClientId =>
	MCP_CLIENT_IDS.includes(value as McpClientId);

export const isAgentId = (value: string): value is AgentId => AGENT_IDS.includes(value as AgentId);

export type ConnectionMethod = "mcp" | "api-key";

export type AgentCatalogItem = {
	readonly id: AgentId;
	readonly name: string;
	readonly method: ConnectionMethod;
	readonly detail: string;
	readonly summary: string;
};

export const agentCatalog: readonly AgentCatalogItem[] = [
	{
		id: "cursor",
		name: "Cursor",
		method: "mcp",
		detail: "MCP over OAuth",
		summary:
			"Same Horizon MCP URL. Optional install deeplink; OAuth returns to Cursor on this machine.",
	},
	{
		id: "claude",
		name: "Claude Desktop",
		method: "mcp",
		detail: "MCP over OAuth",
		summary:
			"Same Horizon MCP URL. Add a custom connector, or wrap with mcp-remote if the host needs stdio.",
	},
	{
		id: "mcp",
		name: "Any MCP client",
		method: "mcp",
		detail: "Windsurf, Codex, Continue, custom",
		summary: "Same Horizon MCP URL and OAuth. Copy the generic config for any MCP host.",
	},
	{
		id: "http",
		name: "HTTP / scripts",
		method: "api-key",
		detail: "Bearer API key",
		summary: "Mint a ym_ key for curl, scripts, or headless clients that cannot do browser OAuth.",
	},
];

export const mcpClientCatalog = agentCatalog.filter(
	(item): item is AgentCatalogItem & { id: McpClientId; method: "mcp" } => item.method === "mcp",
);

export const apiKeyCatalog = agentCatalog.filter((item) => item.method === "api-key");

export const agentById = (id: AgentId): AgentCatalogItem => {
	const item = agentCatalog.find((entry) => entry.id === id);
	if (!item) {
		throw new Error(`Unknown agent id: ${id}`);
	}
	return item;
};

const CURSOR_MARKERS = ["cursor", "localhost:8787"] as const;
const CLAUDE_BRAND_MARKERS = ["claude", "anthropic"] as const;
/** Claude Desktop historically registered as mcp-remote / MCP CLI. */
const CLAUDE_STDIO_MARKERS = ["mcp-remote", "mcp cli"] as const;

const grantHaystack = (grant: McpGrantView): string =>
	`${grant.clientName} ${grant.clientId} ${grant.redirectUri ?? ""}`.toLowerCase();

const haystackHas = (hay: string, markers: readonly string[]): boolean =>
	markers.some((marker) => hay.includes(marker));

export type McpGrantProfile = McpClientId;

export const classifyMcpGrant = (grant: McpGrantView): McpGrantProfile => {
	const hay = grantHaystack(grant);
	if (haystackHas(hay, CURSOR_MARKERS)) {
		return "cursor";
	}
	if (haystackHas(hay, CLAUDE_BRAND_MARKERS) || haystackHas(hay, CLAUDE_STDIO_MARKERS)) {
		return "claude";
	}
	return "mcp";
};

export const grantMatchesAgent = (id: McpClientId, grant: McpGrantView): boolean =>
	classifyMcpGrant(grant) === id;

export const agentIsConnected = (
	id: AgentId,
	grants: readonly McpGrantView[],
	keyCount: number,
): boolean => {
	if (id === "http") {
		return keyCount > 0;
	}
	return grants.some((grant) => grantMatchesAgent(id, grant));
};

export const mcpGrantProfileLabel = (profile: McpGrantProfile): string => {
	switch (profile) {
		case "cursor":
			return "Cursor";
		case "claude":
			return "Claude Desktop";
		case "mcp":
			return "Other MCP client";
	}
};

export const grantDisplayName = (grant: McpGrantView): string => {
	const name = grant.clientName.trim();
	if (name.length > 0) {
		return name;
	}
	return mcpGrantProfileLabel(classifyMcpGrant(grant));
};

export const grantRowDetail = (grant: McpGrantView, formattedTime: string): string => {
	const profile = classifyMcpGrant(grant);
	return [
		profile === "mcp" ? mcpGrantProfileLabel(profile) : null,
		profile === "mcp" ? grant.clientId : null,
		grant.scopes.join(", "),
		formattedTime,
	]
		.filter((part): part is string => Boolean(part))
		.join(" · ");
};

export const displayMcpUrl = (origin: string, mcpPath: string): string =>
	origin ? `${origin}${mcpPath}` : `https://<your-horizon>${mcpPath}`;

const prettyJson = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

export const remoteMcpSnippet = (mcpUrl: string): string =>
	prettyJson({
		mcpServers: {
			horizon: {
				url: mcpUrl,
			},
		},
	});

export const stdioMcpRemoteSnippet = (mcpUrl: string): string =>
	prettyJson({
		mcpServers: {
			horizon: {
				command: "npx",
				args: ["mcp-remote", mcpUrl],
			},
		},
	});

export const bearerMcpSnippet = (mcpUrl: string, token = "ym_…"): string =>
	prettyJson({
		mcpServers: {
			horizon: {
				url: mcpUrl,
				headers: {
					Authorization: `Bearer ${token}`,
				},
			},
		},
	});

export const mcpSnippetForClient = (id: McpClientId, mcpUrl: string): string =>
	id === "claude" ? stdioMcpRemoteSnippet(mcpUrl) : remoteMcpSnippet(mcpUrl);

export const cursorMcpInstallUrl = (mcpUrl: string, name = "horizon"): string => {
	const config = btoa(JSON.stringify({ url: mcpUrl }));
	return `cursor://anysphere.cursor-deeplink/mcp/install?name=${encodeURIComponent(name)}&config=${encodeURIComponent(config)}`;
};
