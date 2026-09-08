export const MCP_SCOPES = ["memories:read", "memories:write"] as const;

export type McpScope = (typeof MCP_SCOPES)[number];

export const isMcpScope = (value: string): value is McpScope =>
	(MCP_SCOPES as readonly string[]).includes(value);

export const grantedScopes = (requested: readonly string[]): McpScope[] => {
	const allowed = requested.filter(isMcpScope);
	return allowed.length > 0 ? allowed : [...MCP_SCOPES];
};
