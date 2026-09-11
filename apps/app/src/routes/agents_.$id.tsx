import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
	formatTimestamp,
	getAgentsContext,
	mintKey,
	revokeGrant,
	revokeKey,
} from "../api/agent-rpc.ts";
import { agentCatalog, grantMatchesAgent, isAgentId } from "../content/catalog.ts";

export const Route = createFileRoute("/agents_/$id")({
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
		<main className="page">
			<p className="crumb">
				<Link className="ui-link" to="/agents">
					Agents
				</Link>
			</p>
			<header>
				<h1 className="hero-heading">{agent.name}</h1>
				<p className="hero-sub">{agent.detail}</p>
			</header>
			{initial.id === "http" ? <HttpManage /> : <McpManage id={initial.id} />}
		</main>
	);
}

function McpManage({ id }: { id: "cursor" | "claude" }) {
	const initial = Route.useLoaderData();
	const [grants, setGrants] = useState(initial.grants);
	const [busy, setBusy] = useState<string | null>(null);
	const [message, setMessage] = useState("");
	const [copied, setCopied] = useState("");
	const origin = typeof window === "undefined" ? "" : window.location.origin;
	const mcpUrl = `${origin}${initial.mcpPath}`;
	const snippet = useMemo(() => {
		if (id === "claude") {
			return JSON.stringify(
				{
					mcpServers: {
						yumeoi: {
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
					yumeoi: {
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
			setCopied(label);
		} catch {
			setCopied("");
			setMessage("Could not copy to the clipboard.");
		}
	};

	return (
		<>
			<p className="body-copy">
				{id === "cursor"
					? "Paste this into Cursor MCP settings. Cursor opens a browser for OAuth and returns to http://localhost:8787/callback on your machine — that is Cursor's loopback, not this Worker. Do not put an API key in this config."
					: "Paste this into Claude Desktop MCP settings. Claude connects over OAuth. Do not put an API key in this config."}
			</p>
			<p className="mt-4 font-mono text-sm">{mcpUrl || initial.mcpPath}</p>
			<div className="mt-4 flex flex-wrap gap-4">
				<button
					className="catalog-cta"
					type="button"
					onClick={() => copy("url", mcpUrl || initial.mcpPath)}
				>
					{copied === "url" ? "Copied URL" : "Copy URL"}
				</button>
				<button className="catalog-cta" type="button" onClick={() => copy("snippet", snippet)}>
					{copied === "snippet" ? "Copied" : "Copy config"}
				</button>
			</div>
			<pre className="ui-pre mt-6">{snippet}</pre>
			<h2 className="section-heading mt-10">Connected</h2>
			<ul className="manage-list">
				{mine.length === 0 ? (
					<li className="body-copy">
						No {agentLabel(id)} grant yet. Add the config, then approve OAuth.
					</li>
				) : (
					mine.map((grant) => (
						<li key={grant.id} className="manage-item">
							<div>
								<p className="catalog-name">{grant.clientName}</p>
								<p className="catalog-detail">
									{grant.scopes.join(", ")} · {formatTimestamp(grant.createdAt)}
								</p>
							</div>
							<button
								className="catalog-cta"
								disabled={busy !== null}
								type="button"
								onClick={async () => {
									setBusy(grant.id);
									setMessage("");
									try {
										await revokeGrant({ data: { id: grant.id } });
										setGrants((current) => current.filter((item) => item.id !== grant.id));
									} catch (error) {
										setMessage(error instanceof Error ? error.message : String(error));
									} finally {
										setBusy(null);
									}
								}}
							>
								Revoke
							</button>
						</li>
					))
				)}
			</ul>
			{id === "cursor" && others.length > 0 ? (
				<>
					<h2 className="section-heading mt-10">Other MCP clients</h2>
					<ul className="manage-list">
						{others.map((grant) => (
							<li key={grant.id} className="manage-item">
								<div>
									<p className="catalog-name">{grant.clientName}</p>
									<p className="catalog-detail">{grant.clientId}</p>
								</div>
								<button
									className="catalog-cta"
									disabled={busy !== null}
									type="button"
									onClick={async () => {
										setBusy(grant.id);
										try {
											await revokeGrant({ data: { id: grant.id } });
											setGrants((current) => current.filter((item) => item.id !== grant.id));
										} catch (error) {
											setMessage(error instanceof Error ? error.message : String(error));
										} finally {
											setBusy(null);
										}
									}}
								>
									Revoke
								</button>
							</li>
						))}
					</ul>
				</>
			) : null}
			{message ? <p className="mt-4 text-sm text-[var(--color-danger)]">{message}</p> : null}
		</>
	);
}

function HttpManage() {
	const initial = Route.useLoaderData();
	const [keys, setKeys] = useState(initial.keys);
	const [mintedToken, setMintedToken] = useState("");
	const [busy, setBusy] = useState<string | null>(null);
	const [message, setMessage] = useState("");
	const origin = typeof window === "undefined" ? "" : window.location.origin;
	const mcpUrl = `${origin}${initial.mcpPath}`;
	const headlessSnippet = useMemo(
		() =>
			JSON.stringify(
				{
					mcpServers: {
						yumeoi: {
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
		<>
			<p className="body-copy">
				Mint a <code>ym_</code> key for curl, scripts, or other headless clients that send{" "}
				<code>Authorization: Bearer</code>. Not for Cursor or Claude OAuth. The full token is shown
				once.
			</p>
			<button
				className="ui-btn mt-6"
				disabled={busy !== null}
				type="button"
				onClick={async () => {
					setBusy("mint");
					setMessage("");
					try {
						const created = await mintKey();
						setMintedToken(created.token);
						setKeys((current) => [created, ...current.filter((key) => key.id !== created.id)]);
					} catch (error) {
						setMessage(error instanceof Error ? error.message : String(error));
					} finally {
						setBusy(null);
					}
				}}
			>
				{busy === "mint" ? "Minting…" : "Mint API key"}
			</button>
			{mintedToken ? <p className="mt-4 break-all font-mono text-sm">{mintedToken}</p> : null}
			<pre className="ui-pre mt-6">
				{mintedToken ? headlessSnippet.replace("ym_…", mintedToken) : headlessSnippet}
			</pre>
			<ul className="manage-list">
				{keys.length === 0 ? (
					<li className="body-copy">No API keys yet.</li>
				) : (
					keys.map((key) => (
						<li key={key.id} className="manage-item">
							<div>
								<p className="catalog-name font-mono">{key.prefix}…</p>
								<p className="catalog-detail">created {formatTimestamp(key.createdAt)}</p>
							</div>
							<button
								className="catalog-cta"
								disabled={busy !== null}
								type="button"
								onClick={async () => {
									setBusy(key.id);
									setMessage("");
									try {
										await revokeKey({ data: { id: key.id } });
										setKeys((current) => current.filter((item) => item.id !== key.id));
										if (mintedToken.startsWith(key.prefix)) {
											setMintedToken("");
										}
									} catch (error) {
										setMessage(error instanceof Error ? error.message : String(error));
									} finally {
										setBusy(null);
									}
								}}
							>
								Revoke
							</button>
						</li>
					))
				)}
			</ul>
			{message ? <p className="mt-4 text-sm text-[var(--color-danger)]">{message}</p> : null}
		</>
	);
}

const agentLabel = (id: "cursor" | "claude"): string => (id === "cursor" ? "Cursor" : "Claude");
