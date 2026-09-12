import { describe, expect, it } from "vitest";
import type { McpGrantView } from "../src/auth/grants.ts";
import {
	AGENT_IDS,
	agentIsConnected,
	bearerMcpSnippet,
	classifyMcpGrant,
	cursorMcpInstallUrl,
	displayMcpUrl,
	grantDisplayName,
	grantMatchesAgent,
	grantRowDetail,
	isAgentId,
	mcpSnippetForClient,
	remoteMcpSnippet,
	stdioMcpRemoteSnippet,
} from "../src/content/catalog.ts";

const grant = (partial: Partial<McpGrantView>): McpGrantView => ({
	id: "g1",
	userId: "u1",
	clientId: "client-id",
	clientName: "client",
	scopes: ["memories:read", "memories:write"],
	redirectUri: null,
	createdAt: 1,
	...partial,
});

describe("agent catalog", () => {
	it("includes known MCP profiles, an other-MCP bucket, and HTTP keys", () => {
		expect(AGENT_IDS).toEqual(["cursor", "claude", "mcp", "http"]);
		expect(isAgentId("mcp")).toBe(true);
		expect(isAgentId("windsurf")).toBe(false);
	});
});

describe("classifyMcpGrant", () => {
	it("matches Cursor by client name", () => {
		expect(classifyMcpGrant(grant({ clientName: "Cursor" }))).toBe("cursor");
	});

	it("matches Cursor by the localhost:8787 loopback used for OAuth", () => {
		expect(
			classifyMcpGrant(
				grant({
					clientName: "MCP Client",
					redirectUri: "http://localhost:8787/callback",
				}),
			),
		).toBe("cursor");
	});

	it("matches Claude Desktop by brand markers", () => {
		expect(classifyMcpGrant(grant({ clientName: "Claude" }))).toBe("claude");
		expect(classifyMcpGrant(grant({ clientId: "anthropic-app" }))).toBe("claude");
	});

	it("keeps legacy Claude Desktop mcp-remote grants on the Claude profile", () => {
		expect(classifyMcpGrant(grant({ clientName: "mcp-remote" }))).toBe("claude");
		expect(classifyMcpGrant(grant({ clientName: "MCP CLI" }))).toBe("claude");
	});

	it("buckets unknown MCP hosts separately", () => {
		expect(classifyMcpGrant(grant({ clientName: "Windsurf", clientId: "ws-1" }))).toBe("mcp");
		expect(classifyMcpGrant(grant({ clientName: "Continue" }))).toBe("mcp");
		expect(
			classifyMcpGrant(
				grant({
					clientName: "codex",
					redirectUri: "http://127.0.0.1:1455/auth/callback",
				}),
			),
		).toBe("mcp");
	});

	it("prefers Cursor when both a Cursor marker and mcp-remote appear", () => {
		expect(
			classifyMcpGrant(
				grant({
					clientName: "mcp-remote",
					redirectUri: "http://localhost:8787/callback",
				}),
			),
		).toBe("cursor");
	});
});

describe("grantMatchesAgent", () => {
	it("is mutually exclusive across MCP profiles", () => {
		const samples = [
			grant({ clientName: "Cursor" }),
			grant({ clientName: "Claude Desktop" }),
			grant({ clientName: "Windsurf", clientId: "ws-9" }),
		];
		for (const sample of samples) {
			const hits = (["cursor", "claude", "mcp"] as const).filter((id) =>
				grantMatchesAgent(id, sample),
			);
			expect(hits).toHaveLength(1);
			expect(hits[0]).toBe(classifyMcpGrant(sample));
		}
	});
});

describe("agentIsConnected", () => {
	it("uses grants for MCP clients and key count for HTTP", () => {
		const grants = [grant({ clientName: "Cursor" }), grant({ clientName: "Continue" })];
		expect(agentIsConnected("cursor", grants, 0)).toBe(true);
		expect(agentIsConnected("claude", grants, 0)).toBe(false);
		expect(agentIsConnected("mcp", grants, 0)).toBe(true);
		expect(agentIsConnected("http", grants, 0)).toBe(false);
		expect(agentIsConnected("http", grants, 2)).toBe(true);
	});
});

describe("grant labeling", () => {
	it("labels unknown MCP grants with profile and client id", () => {
		const unknown = grant({
			clientName: "Windsurf",
			clientId: "ws-1",
			scopes: ["memories:read"],
		});
		expect(grantDisplayName(unknown)).toBe("Windsurf");
		expect(grantRowDetail(unknown, "12 Sep 2026, 10:00")).toBe(
			"Other MCP client · ws-1 · memories:read · 12 Sep 2026, 10:00",
		);
	});

	it("does not prefix known Cursor or Claude grants with the other-MCP label", () => {
		const cursor = grant({ clientName: "Cursor", scopes: ["memories:read"] });
		expect(grantRowDetail(cursor, "12 Sep 2026, 10:00")).toBe("memories:read · 12 Sep 2026, 10:00");
	});
});

describe("MCP snippets", () => {
	it("uses a remote URL config for Cursor and generic MCP hosts", () => {
		const url = "https://example.com/mcp";
		expect(mcpSnippetForClient("cursor", url)).toBe(remoteMcpSnippet(url));
		expect(mcpSnippetForClient("mcp", url)).toBe(remoteMcpSnippet(url));
		expect(remoteMcpSnippet(url)).toContain(`"url": "${url}"`);
		expect(remoteMcpSnippet(url)).not.toContain("mcp-remote");
	});

	it("uses mcp-remote stdio config for Claude Desktop", () => {
		const url = "https://example.com/mcp";
		expect(mcpSnippetForClient("claude", url)).toBe(stdioMcpRemoteSnippet(url));
		expect(stdioMcpRemoteSnippet(url)).toContain("mcp-remote");
	});

	it("keeps API keys on a Bearer header snippet", () => {
		expect(bearerMcpSnippet("https://example.com/mcp", "ym_secret")).toContain(
			'"Authorization": "Bearer ym_secret"',
		);
	});

	it("builds a Cursor install deeplink from the shared URL config", () => {
		const url = "https://example.com/mcp";
		const href = cursorMcpInstallUrl(url);
		expect(href.startsWith("cursor://anysphere.cursor-deeplink/mcp/install?")).toBe(true);
		const parsed = new URL(href);
		expect(parsed.searchParams.get("name")).toBe("horizon");
		expect(JSON.parse(atob(parsed.searchParams.get("config") ?? ""))).toEqual({ url });
	});

	it("falls back to a placeholder origin when window is unavailable", () => {
		expect(displayMcpUrl("", "/mcp")).toBe("https://<your-horizon>/mcp");
		expect(displayMcpUrl("https://horizon.example", "/mcp")).toBe("https://horizon.example/mcp");
	});
});
