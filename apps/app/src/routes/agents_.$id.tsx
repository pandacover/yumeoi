import { createFileRoute, notFound } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
	formatTimestamp,
	getAgentsContext,
	mintKey,
	revokeGrant,
	revokeKey,
} from "../api/agent-rpc.ts";
import { requireAuth } from "../auth/page-user.ts";
import { CatalogList, CatalogRow } from "../components/catalog-row.tsx";
import { copyText, McpSetup } from "../components/mcp-setup.tsx";
import { Page, PageCrumb, PageHeader } from "../components/page.tsx";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert.tsx";
import { Button } from "../components/ui/button.tsx";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../components/ui/empty.tsx";
import { Spinner } from "../components/ui/spinner.tsx";
import {
	agentById,
	bearerMcpSnippet,
	cursorMcpInstallUrl,
	displayMcpUrl,
	grantDisplayName,
	grantMatchesAgent,
	grantRowDetail,
	isAgentId,
	type McpClientId,
	mcpSnippetForClient,
	remoteMcpSnippet,
	stdioMcpRemoteSnippet,
} from "../content/catalog.ts";

export const Route = createFileRoute("/agents_/$id")({
	beforeLoad: () => requireAuth(),
	loader: async ({ params }) => {
		if (!isAgentId(params.id)) {
			throw notFound();
		}
		const context = await getAgentsContext();
		return { ...context, id: params.id };
	},
	component: AgentManagePage,
});

function AgentManagePage() {
	const initial = Route.useLoaderData();
	const agent = agentById(initial.id);

	return (
		<Page>
			<PageCrumb current={agent.name} label="Agents" to="/agents" />
			<PageHeader title={agent.name} description={agent.summary} />
			{initial.id === "http" ? <HttpManage /> : <McpManage id={initial.id} />}
		</Page>
	);
}

function McpManage({ id }: { id: McpClientId }) {
	const initial = Route.useLoaderData();
	const [grants, setGrants] = useState(initial.grants);
	const [busy, setBusy] = useState<string | null>(null);
	const [origin, setOrigin] = useState("");
	useEffect(() => {
		setOrigin(window.location.origin);
	}, []);
	const mcpUrl = displayMcpUrl(origin, initial.mcpPath);
	const snippet = useMemo(() => mcpSnippetForClient(id, mcpUrl), [id, mcpUrl]);
	const mine = grants.filter((grant) => grantMatchesAgent(id, grant));
	const installUrl = id === "cursor" ? cursorMcpInstallUrl(mcpUrl) : null;

	const revoke = async (grantId: string) => {
		setBusy(grantId);
		try {
			await revokeGrant({ data: { id: grantId } });
			setGrants((current) => current.filter((item) => item.id !== grantId));
			toast.success("Revoked");
		} catch (error) {
			toast.error(error instanceof Error ? error.message : String(error));
		} finally {
			setBusy(null);
		}
	};

	return (
		<div className="flex flex-col gap-8">
			<McpSetup
				help={<McpHelp id={id} />}
				mcpUrl={mcpUrl}
				scopes={initial.scopes}
				snippet={snippet}
				actions={
					installUrl ? (
						<Button
							nativeButton={false}
							render={
								// biome-ignore lint/a11y/useAnchorContent: Button children supply the label
								<a href={installUrl} />
							}
							size="sm"
						>
							Add to Cursor
						</Button>
					) : null
				}
			/>
			{id === "claude" ? (
				<details className="flex flex-col gap-2">
					<summary className="cursor-pointer text-sm text-muted-foreground">
						Remote URL config (if the host supports HTTP MCP)
					</summary>
					<pre className="overflow-x-auto bg-muted p-3 font-mono text-xs text-muted-foreground">
						{remoteMcpSnippet(mcpUrl)}
					</pre>
					<Button
						className="self-start"
						size="sm"
						variant="outline"
						onClick={() => void copyText("Copied config", remoteMcpSnippet(mcpUrl))}
					>
						Copy remote config
					</Button>
				</details>
			) : null}
			{id === "mcp" ? (
				<details className="flex flex-col gap-2">
					<summary className="cursor-pointer text-sm text-muted-foreground">
						stdio via mcp-remote (hosts that cannot speak HTTP MCP)
					</summary>
					<pre className="overflow-x-auto bg-muted p-3 font-mono text-xs text-muted-foreground">
						{stdioMcpRemoteSnippet(mcpUrl)}
					</pre>
					<Button
						className="self-start"
						size="sm"
						variant="outline"
						onClick={() => void copyText("Copied config", stdioMcpRemoteSnippet(mcpUrl))}
					>
						Copy mcp-remote config
					</Button>
				</details>
			) : null}
			<section className="flex flex-col gap-4">
				<h2 className="font-heading text-base font-medium">Connected</h2>
				{mine.length === 0 ? (
					<Empty className="border">
						<EmptyHeader>
							<EmptyTitle>
								{id === "mcp" ? "No other MCP grant yet" : `No ${agentById(id).name} grant yet`}
							</EmptyTitle>
							<EmptyDescription>Add the config, then approve OAuth.</EmptyDescription>
						</EmptyHeader>
					</Empty>
				) : (
					<CatalogList>
						{mine.map((grant) => (
							<CatalogRow
								key={grant.id}
								title={grantDisplayName(grant)}
								detail={grantRowDetail(grant, formatTimestamp(grant.createdAt))}
								action={
									<Button
										disabled={busy !== null}
										size="sm"
										variant="ghost"
										onClick={() => void revoke(grant.id)}
									>
										{busy === grant.id ? <Spinner data-icon="inline-start" /> : null}
										Revoke
									</Button>
								}
							/>
						))}
					</CatalogList>
				)}
			</section>
		</div>
	);
}

function McpHelp({ id }: { id: McpClientId }) {
	if (id === "cursor") {
		return (
			<p className="text-sm text-muted-foreground">
				Paste this into Cursor MCP settings, or use Add to Cursor. Cursor opens a browser for OAuth
				and returns to <code>http://localhost:8787/callback</code> on your machine — that is
				Cursor's loopback, not this Worker. Do not put an API key in this config.
			</p>
		);
	}
	if (id === "claude") {
		return (
			<p className="text-sm text-muted-foreground">
				Paste this URL into Claude connectors (Customize → Connectors → Add custom connector), or
				use the mcp-remote config below in Claude Desktop. Claude opens this site to allow access,
				then the browser must return to Claude. Click Allow access once and wait — do not press it
				again. Do not put an API key in this config.
			</p>
		);
	}
	return (
		<p className="text-sm text-muted-foreground">
			Use this URL in Windsurf, Codex, Continue, or any other MCP host that speaks remote HTTP MCP.
			The host opens a browser for OAuth; after you allow access it returns to that client. Grants
			Horizon cannot classify as Cursor or Claude Desktop show up here. Do not put an API key in
			this config.
		</p>
	);
}

function HttpManage() {
	const initial = Route.useLoaderData();
	const [keys, setKeys] = useState(initial.keys);
	const [mintedToken, setMintedToken] = useState("");
	const [busy, setBusy] = useState<string | null>(null);
	const [origin, setOrigin] = useState("");
	useEffect(() => {
		setOrigin(window.location.origin);
	}, []);
	const mcpUrl = displayMcpUrl(origin, initial.mcpPath);
	const headlessSnippet = useMemo(
		() => bearerMcpSnippet(mcpUrl, mintedToken || "ym_…"),
		[mcpUrl, mintedToken],
	);

	return (
		<div className="flex flex-col gap-8">
			<p className="text-sm text-muted-foreground">
				Mint a <code>ym_</code> key for curl, scripts, or other headless clients that send{" "}
				<code>Authorization: Bearer</code>. Not for MCP OAuth — Cursor, Claude Desktop, and other
				MCP hosts use the MCP section. The full token is shown once.
			</p>
			<Button
				disabled={busy !== null}
				onClick={async () => {
					setBusy("mint");
					try {
						const created = await mintKey();
						setMintedToken(created.token);
						setKeys((current) => [created, ...current.filter((key) => key.id !== created.id)]);
						toast.success("API key minted");
					} catch (error) {
						toast.error(error instanceof Error ? error.message : String(error));
					} finally {
						setBusy(null);
					}
				}}
			>
				{busy === "mint" ? <Spinner data-icon="inline-start" /> : null}
				{busy === "mint" ? "Minting…" : "Mint API key"}
			</Button>
			{mintedToken ? (
				<Alert>
					<AlertTitle>Copy this token now</AlertTitle>
					<AlertDescription>
						<code className="break-all">{mintedToken}</code>
					</AlertDescription>
				</Alert>
			) : null}
			<pre className="overflow-x-auto bg-muted p-3 font-mono text-xs text-muted-foreground">
				{headlessSnippet}
			</pre>
			{keys.length === 0 ? (
				<Empty className="border">
					<EmptyHeader>
						<EmptyTitle>No API keys yet</EmptyTitle>
						<EmptyDescription>Mint a key for headless clients.</EmptyDescription>
					</EmptyHeader>
				</Empty>
			) : (
				<CatalogList>
					{keys.map((key) => (
						<CatalogRow
							key={key.id}
							title={`${key.prefix}…`}
							detail={`created ${formatTimestamp(key.createdAt)}`}
							action={
								<Button
									disabled={busy !== null}
									size="sm"
									variant="ghost"
									onClick={async () => {
										setBusy(key.id);
										try {
											await revokeKey({ data: { id: key.id } });
											setKeys((current) => current.filter((item) => item.id !== key.id));
											if (mintedToken.startsWith(key.prefix)) {
												setMintedToken("");
											}
											toast.success("Revoked");
										} catch (error) {
											toast.error(error instanceof Error ? error.message : String(error));
										} finally {
											setBusy(null);
										}
									}}
								>
									{busy === key.id ? <Spinner data-icon="inline-start" /> : null}
									Revoke
								</Button>
							}
						/>
					))}
				</CatalogList>
			)}
		</div>
	);
}
