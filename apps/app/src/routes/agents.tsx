import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { appUserId } from "../api/sources.ts";
import { listApiKeys, mintApiKey, revokeApiKey } from "../auth/api-keys.ts";
import { listConnectedMcpClients, revokeConnectedMcpClient } from "../auth/mcp-clients.ts";
import { MCP_SCOPES } from "../auth/scopes.ts";

const getAgentsContext = createServerFn({ method: "GET" }).handler(async () => {
	const userId = appUserId(env);
	const [keys, grants] = await Promise.all([
		listApiKeys(env, userId).catch(() => []),
		listConnectedMcpClients(env, userId).catch(() => []),
	]);
	return {
		userId,
		mcpPath: "/mcp",
		authorizePath: "/authorize",
		tokenPath: "/token",
		registerPath: "/register",
		scopes: [...MCP_SCOPES],
		keys,
		grants,
	};
});

const mintKey = createServerFn({ method: "POST" }).handler(async () =>
	mintApiKey(env, appUserId(env)),
);

const revokeKey = createServerFn({ method: "POST" })
	.validator((data: { id: string }) => data)
	.handler(async ({ data }) => {
		const ok = await revokeApiKey(env, appUserId(env), data.id);
		if (!ok) {
			throw new Error("Key not found");
		}
		return { ok: true, id: data.id };
	});

const revokeGrant = createServerFn({ method: "POST" })
	.validator((data: { id: string }) => data)
	.handler(async ({ data }) => {
		const ok = await revokeConnectedMcpClient(env, appUserId(env), data.id);
		if (!ok) {
			throw new Error("Grant not found");
		}
		return { ok: true, id: data.id };
	});

const formatTimestamp = (timestamp: number): string =>
	new Intl.DateTimeFormat("en-GB", {
		dateStyle: "medium",
		timeStyle: "short",
		timeZone: "UTC",
	}).format(new Date(timestamp));

export const Route = createFileRoute("/agents")({
	loader: () => getAgentsContext(),
	component: AgentsPage,
});

function AgentsPage() {
	const initial = Route.useLoaderData();
	const [keys, setKeys] = useState(initial.keys);
	const [grants, setGrants] = useState(initial.grants);
	const [mintedToken, setMintedToken] = useState("");
	const [busy, setBusy] = useState<string | null>(null);
	const [message, setMessage] = useState("");
	const [copied, setCopied] = useState("");
	const origin = typeof window === "undefined" ? "" : window.location.origin;
	const mcpUrl = `${origin}${initial.mcpPath}`;
	const cursorSnippet = useMemo(
		() =>
			JSON.stringify(
				{
					mcpServers: {
						yumeoi: {
							url: mcpUrl || "https://<your-worker>/mcp",
						},
					},
				},
				null,
				2,
			),
		[mcpUrl],
	);
	const claudeSnippet = useMemo(
		() =>
			JSON.stringify(
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
			),
		[mcpUrl],
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
		<main className="mx-auto flex max-w-5xl flex-col gap-8 px-6 py-12">
			<header className="flex flex-col gap-3">
				<p className="text-sm tracking-[0.2em] text-[var(--accent)] uppercase">M4 agents</p>
				<h1 className="text-3xl font-semibold tracking-tight">Agents</h1>
				<p className="max-w-2xl text-[var(--muted)]">
					Connect Cursor or Claude Desktop over MCP OAuth, or mint a <code>ym_</code> API key for
					headless agents. Grants can be revoked here.
				</p>
			</header>

			<section className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6">
				<h2 className="text-lg font-medium">MCP connection</h2>
				<p className="mt-2 text-sm text-[var(--muted)]">
					Remote MCP URL. Clients register at <code>{initial.registerPath}</code>, authorize at{" "}
					<code>{initial.authorizePath}</code>, and exchange tokens at{" "}
					<code>{initial.tokenPath}</code>. Scopes: {initial.scopes.join(", ")}.
				</p>
				<p className="mt-4 font-mono text-sm">{mcpUrl || initial.mcpPath}</p>
				<div className="mt-4 flex flex-wrap gap-3">
					<button
						className="rounded-lg border border-[var(--line)] px-4 py-2 text-sm"
						type="button"
						onClick={() => copy("url", mcpUrl || initial.mcpPath)}
					>
						{copied === "url" ? "Copied URL" : "Copy URL"}
					</button>
				</div>
				<div className="mt-6 grid gap-4 md:grid-cols-2">
					<div>
						<p className="text-sm text-[var(--muted)]">Cursor</p>
						<pre className="mt-2 overflow-x-auto rounded-lg border border-[var(--line)] bg-[var(--bg)] p-3 text-xs">
							{cursorSnippet}
						</pre>
						<button
							className="mt-2 rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs"
							type="button"
							onClick={() => copy("cursor", cursorSnippet)}
						>
							{copied === "cursor" ? "Copied" : "Copy Cursor config"}
						</button>
					</div>
					<div>
						<p className="text-sm text-[var(--muted)]">Claude Desktop</p>
						<pre className="mt-2 overflow-x-auto rounded-lg border border-[var(--line)] bg-[var(--bg)] p-3 text-xs">
							{claudeSnippet}
						</pre>
						<button
							className="mt-2 rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs"
							type="button"
							onClick={() => copy("claude", claudeSnippet)}
						>
							{copied === "claude" ? "Copied" : "Copy Claude config"}
						</button>
					</div>
				</div>
			</section>

			<section className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6">
				<div className="flex flex-wrap items-center justify-between gap-3">
					<h2 className="text-lg font-medium">API keys</h2>
					<button
						className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--bg)] disabled:opacity-50"
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
				</div>
				<p className="mt-2 text-sm text-[var(--muted)]">
					Headless MCP and <code>/ingest</code> use <code>Authorization: Bearer ym_…</code>. The
					full token is shown once.
				</p>
				{mintedToken ? (
					<p className="mt-3 break-all font-mono text-sm text-[var(--accent)]">{mintedToken}</p>
				) : null}
				<ul className="mt-4 flex flex-col gap-3">
					{keys.length === 0 ? (
						<li className="text-sm text-[var(--muted)]">No API keys yet.</li>
					) : (
						keys.map((key) => (
							<li
								key={key.id}
								className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--line)] px-4 py-3"
							>
								<div>
									<p className="font-mono text-sm">{key.prefix}…</p>
									<p className="text-xs text-[var(--muted)]">
										created {formatTimestamp(key.createdAt)}
									</p>
								</div>
								<button
									className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-sm disabled:opacity-50"
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
			</section>

			<section className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6">
				<h2 className="text-lg font-medium">Connected MCP clients</h2>
				<p className="mt-2 text-sm text-[var(--muted)]">
					OAuth grants for user <code>{initial.userId}</code>. Revoking drops the client&apos;s
					refresh and access tokens.
				</p>
				<ul className="mt-4 flex flex-col gap-3">
					{grants.length === 0 ? (
						<li className="text-sm text-[var(--muted)]">No connected agents yet.</li>
					) : (
						grants.map((grant) => (
							<li
								key={grant.id}
								className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--line)] px-4 py-3"
							>
								<div>
									<p className="text-sm">{grant.clientName}</p>
									<p className="font-mono text-xs text-[var(--muted)]">{grant.clientId}</p>
									<p className="mt-1 text-xs text-[var(--muted)]">
										{grant.scopes.join(", ")} · {formatTimestamp(grant.createdAt)}
									</p>
								</div>
								<button
									className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-sm disabled:opacity-50"
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
			</section>

			{message ? <p className="text-sm text-red-300">{message}</p> : null}
		</main>
	);
}
