import { createFileRoute, notFound } from "@tanstack/react-router";
import { useMemo, useState } from "react";
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
import { Page, PageCrumb, PageHeader } from "../components/page.tsx";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert.tsx";
import { Button } from "../components/ui/button.tsx";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../components/ui/empty.tsx";
import { Spinner } from "../components/ui/spinner.tsx";
import { agentCatalog, grantMatchesAgent, isAgentId } from "../content/catalog.ts";

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
	const agent = agentCatalog.find((item) => item.id === initial.id);
	if (!agent) {
		return null;
	}

	return (
		<Page>
			<PageCrumb current={agent.name} label="Agents" to="/agents" />
			<PageHeader title={agent.name} description={agent.detail} />
			{initial.id === "http" ? <HttpManage /> : <McpManage id={initial.id} />}
		</Page>
	);
}

function McpManage({ id }: { id: "cursor" | "claude" }) {
	const initial = Route.useLoaderData();
	const [grants, setGrants] = useState(initial.grants);
	const [busy, setBusy] = useState<string | null>(null);
	const origin = typeof window === "undefined" ? "" : window.location.origin;
	const mcpUrl = `${origin}${initial.mcpPath}`;
	const snippet = useMemo(() => {
		if (id === "claude") {
			return JSON.stringify(
				{
					mcpServers: {
						horizon: {
							command: "npx",
							args: ["mcp-remote", mcpUrl || "https://<your-worker>/mcp"],
						},
					},
				},
				null,
				2,
			);
		}
		return JSON.stringify(
			{
				mcpServers: {
					horizon: {
						url: mcpUrl || "https://<your-worker>/mcp",
					},
				},
			},
			null,
			2,
		);
	}, [id, mcpUrl]);
	const mine = grants.filter((grant) => grantMatchesAgent(id, grant));
	const others = grants.filter(
		(grant) => !grantMatchesAgent("cursor", grant) && !grantMatchesAgent("claude", grant),
	);

	const copy = async (label: string, value: string) => {
		try {
			await navigator.clipboard.writeText(value);
			toast.success(label === "url" ? "Copied URL" : "Copied config");
		} catch {
			toast.error("Could not copy to the clipboard.");
		}
	};

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
			<p className="text-sm text-muted-foreground">
				{id === "cursor"
					? "Paste this into Cursor MCP settings. Cursor opens a browser for OAuth and returns to http://localhost:8787/callback on your machine — that is Cursor's loopback, not this Worker. Do not put an API key in this config."
					: "Paste this URL into Claude connectors (Customize → Connectors → Add custom connector), or use the config below in Claude Desktop. Claude opens this site to allow access, then the browser must return to Claude. Click Allow access once and wait — do not press it again. Do not put an API key in this config."}
			</p>
			<p className="font-mono text-sm break-all">{mcpUrl || initial.mcpPath}</p>
			<div className="flex flex-wrap gap-2">
				<Button size="sm" variant="outline" onClick={() => copy("url", mcpUrl || initial.mcpPath)}>
					Copy URL
				</Button>
				<Button size="sm" variant="outline" onClick={() => copy("snippet", snippet)}>
					Copy config
				</Button>
			</div>
			<pre className="overflow-x-auto bg-muted p-3 font-mono text-xs text-muted-foreground">
				{snippet}
			</pre>
			<section className="flex flex-col gap-4">
				<h2 className="font-heading text-base font-medium">Connected</h2>
				{mine.length === 0 ? (
					<Empty className="border">
						<EmptyHeader>
							<EmptyTitle>No {agentLabel(id)} grant yet</EmptyTitle>
							<EmptyDescription>Add the config, then approve OAuth.</EmptyDescription>
						</EmptyHeader>
					</Empty>
				) : (
					<CatalogList>
						{mine.map((grant) => (
							<CatalogRow
								key={grant.id}
								title={grant.clientName}
								detail={`${grant.scopes.join(", ")} · ${formatTimestamp(grant.createdAt)}`}
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
			{id === "cursor" && others.length > 0 ? (
				<section className="flex flex-col gap-4">
					<h2 className="font-heading text-base font-medium">Other MCP clients</h2>
					<CatalogList>
						{others.map((grant) => (
							<CatalogRow
								key={grant.id}
								title={grant.clientName}
								detail={grant.clientId}
								action={
									<Button
										disabled={busy !== null}
										size="sm"
										variant="ghost"
										onClick={() => void revoke(grant.id)}
									>
										Revoke
									</Button>
								}
							/>
						))}
					</CatalogList>
				</section>
			) : null}
		</div>
	);
}

function HttpManage() {
	const initial = Route.useLoaderData();
	const [keys, setKeys] = useState(initial.keys);
	const [mintedToken, setMintedToken] = useState("");
	const [busy, setBusy] = useState<string | null>(null);
	const origin = typeof window === "undefined" ? "" : window.location.origin;
	const mcpUrl = `${origin}${initial.mcpPath}`;
	const headlessSnippet = useMemo(
		() =>
			JSON.stringify(
				{
					mcpServers: {
						horizon: {
							url: mcpUrl || "https://<your-worker>/mcp",
							headers: {
								Authorization: "Bearer ym_…",
							},
						},
					},
				},
				null,
				2,
			),
		[mcpUrl],
	);

	return (
		<div className="flex flex-col gap-8">
			<p className="text-sm text-muted-foreground">
				Mint a <code>ym_</code> key for curl, scripts, or other headless clients that send{" "}
				<code>Authorization: Bearer</code>. Not for Cursor or Claude OAuth. The full token is shown
				once.
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
				{mintedToken ? headlessSnippet.replace("ym_…", mintedToken) : headlessSnippet}
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

const agentLabel = (id: "cursor" | "claude"): string => (id === "cursor" ? "Cursor" : "Claude");
