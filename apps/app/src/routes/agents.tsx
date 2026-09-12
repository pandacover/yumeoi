import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { getAgentsContext } from "../api/agent-rpc.ts";
import { requireAuth } from "../auth/page-user.ts";
import { CatalogList, CatalogRow } from "../components/catalog-row.tsx";
import { McpSetup } from "../components/mcp-setup.tsx";
import { Page, PageHeader } from "../components/page.tsx";
import { Button } from "../components/ui/button.tsx";
import { Separator } from "../components/ui/separator.tsx";
import {
	agentIsConnected,
	apiKeyCatalog,
	displayMcpUrl,
	mcpClientCatalog,
	remoteMcpSnippet,
} from "../content/catalog.ts";

export const Route = createFileRoute("/agents")({
	beforeLoad: () => requireAuth(),
	loader: () => getAgentsContext(),
	component: AgentsPage,
});

function AgentsPage() {
	const { grants, keys, mcpPath, scopes } = Route.useLoaderData();
	const [origin, setOrigin] = useState("");
	useEffect(() => {
		setOrigin(window.location.origin);
	}, []);
	const mcpUrl = displayMcpUrl(origin, mcpPath);
	const snippet = useMemo(() => remoteMcpSnippet(mcpUrl), [mcpUrl]);

	return (
		<Page>
			<PageHeader
				title="Agents"
				description="Connect clients to the same memory store. MCP hosts share one URL and OAuth path. HTTP uses a Bearer API key."
			/>
			<section className="flex flex-col gap-4">
				<div className="flex flex-col gap-2">
					<h2 className="font-heading text-base font-medium">MCP</h2>
					<p className="text-sm text-muted-foreground">
						Cursor, Claude Desktop, and any other MCP host (Windsurf, Codex, Continue, or custom)
						use this Horizon MCP server. Do not put an API key in MCP config.
					</p>
				</div>
				<McpSetup
					help={
						<p className="text-sm text-muted-foreground">
							Add the URL below, then allow access in the browser. Connected state is per client
							when Horizon can recognize the OAuth grant.
						</p>
					}
					mcpUrl={mcpUrl}
					scopes={scopes}
					snippet={snippet}
				/>
				<CatalogList>
					{mcpClientCatalog.map((agent) => {
						const connected = agentIsConnected(agent.id, grants, keys.length);
						return (
							<CatalogRow
								key={agent.id}
								title={agent.name}
								detail={connected ? `${agent.detail} · Connected` : agent.detail}
								action={
									<Button
										nativeButton={false}
										render={<Link params={{ id: agent.id }} to="/agents/$id" />}
										size="sm"
										variant={connected ? "outline" : "default"}
									>
										{connected ? "Manage" : "Connect"}
									</Button>
								}
							/>
						);
					})}
				</CatalogList>
			</section>
			<Separator />
			<section className="flex flex-col gap-4">
				<div className="flex flex-col gap-2">
					<h2 className="font-heading text-base font-medium">API keys</h2>
					<p className="text-sm text-muted-foreground">
						For curl, scripts, and headless clients that send <code>Authorization: Bearer</code>.
						Different auth, same store.
					</p>
				</div>
				<CatalogList>
					{apiKeyCatalog.map((agent) => {
						const connected = agentIsConnected(agent.id, grants, keys.length);
						return (
							<CatalogRow
								key={agent.id}
								title={agent.name}
								detail={
									connected
										? `${agent.detail} · ${keys.length} key${keys.length === 1 ? "" : "s"}`
										: agent.detail
								}
								action={
									<Button
										nativeButton={false}
										render={<Link params={{ id: agent.id }} to="/agents/$id" />}
										size="sm"
										variant={connected ? "outline" : "default"}
									>
										{connected ? "Manage" : "Connect"}
									</Button>
								}
							/>
						);
					})}
				</CatalogList>
			</section>
		</Page>
	);
}
