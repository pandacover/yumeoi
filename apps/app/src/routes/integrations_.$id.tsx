import { env } from "cloudflare:workers";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import type { SourceView } from "@yumeoi/domain";
import { useAgent } from "agents/react";
import { useEffect, useState } from "react";
import type { MemoryAgentState } from "../agents/memory-agent.ts";
import { appUserId, disconnectSource, syncSource } from "../api/sources.ts";
import { isFixtureSourceId, isIntegrationId } from "../content/catalog.ts";

const getIntegration = createServerFn({ method: "POST" })
	.validator((data: { id: string }) => data)
	.handler(async ({ data }) => {
		if (!isIntegrationId(data.id)) {
			throw new Error("Unknown integration");
		}
		const userId = appUserId(env);
		const sources = await env.MemoryAgent.getByName(userId).listSources();
		return {
			id: data.id,
			userId,
			notionConfigured: Boolean(env.NOTION_CLIENT_ID && env.NOTION_CLIENT_SECRET),
			notionRedirectUri: env.NOTION_REDIRECT_URI || null,
			sources: sources.filter((source) => source.kind === data.id && !isFixtureSourceId(source.id)),
		};
	});

const syncOne = createServerFn({ method: "POST" })
	.validator((data: { sourceId: string }) => data)
	.handler(async ({ data }) => syncSource(env, data.sourceId));

const disconnectOne = createServerFn({ method: "POST" })
	.validator((data: { sourceId: string }) => data)
	.handler(async ({ data }) => disconnectSource(env, data.sourceId));

export const Route = createFileRoute("/integrations_/$id")({
	loader: async ({ params }) => {
		if (!isIntegrationId(params.id)) {
			throw notFound();
		}
		return getIntegration({ data: { id: params.id } });
	},
	component: IntegrationManagePage,
});

function IntegrationManagePage() {
	const initial = Route.useLoaderData();
	const [sources, setSources] = useState<SourceView[]>(initial.sources);
	const [busy, setBusy] = useState<string | null>(null);
	const [message, setMessage] = useState("");
	const [mounted, setMounted] = useState(false);
	useEffect(() => {
		setMounted(true);
	}, []);

	return (
		<main className="page">
			<p className="crumb">
				<Link className="ui-link" to="/integrations">
					Integrations
				</Link>
			</p>
			<header>
				<h1 className="hero-heading">Notion</h1>
				<p className="hero-sub">Sync a Notion workspace into memories. Disconnect stops polling.</p>
			</header>
			{mounted ? <IntegrationLive userId={initial.userId} onSources={setSources} /> : null}
			{initial.notionConfigured ? (
				<a className="ui-btn" href="/api/sources/notion/authorize">
					{sources.some((source) => source.status !== "disconnected")
						? "Connect another workspace"
						: "Connect Notion"}
				</a>
			) : (
				<p className="body-copy">
					Set <code>NOTION_CLIENT_ID</code> and <code>NOTION_CLIENT_SECRET</code> to enable OAuth.
				</p>
			)}
			{initial.notionRedirectUri ? (
				<p className="body-copy">
					Redirect URI:{" "}
					<code className="break-all text-[var(--fg)]">{initial.notionRedirectUri}</code>
				</p>
			) : null}
			{message ? <p className="mt-4 text-sm text-[var(--accent)]">{message}</p> : null}
			<ul className="manage-list">
				{sources.length === 0 ? (
					<li className="body-copy">No Notion workspace connected.</li>
				) : (
					sources.map((source) => (
						<li key={source.id} className="manage-item">
							<div>
								<p className="catalog-name">{source.label}</p>
								<p className="catalog-detail">
									{source.status}
									{source.lastSyncedAt
										? ` · last sync ${new Date(source.lastSyncedAt).toLocaleString()}`
										: " · never synced"}
									{` · ${source.documentsIngested} ingested`}
								</p>
								{source.lastError ? (
									<p className="mt-2 text-sm text-[var(--color-danger)]">{source.lastError}</p>
								) : null}
							</div>
							<div className="catalog-action">
								<button
									className="catalog-cta"
									disabled={busy !== null || source.status === "disconnected"}
									type="button"
									onClick={async () => {
										setBusy(source.id);
										try {
											const result = await syncOne({ data: { sourceId: source.id } });
											setMessage(
												`Poll ${result.sourceId}: ${result.ingested} ingested, ${result.unchanged} unchanged`,
											);
										} catch (error) {
											setMessage(error instanceof Error ? error.message : String(error));
										} finally {
											setBusy(null);
										}
									}}
								>
									{busy === source.id ? "Syncing…" : "Sync"}
								</button>
								<button
									className="catalog-cta"
									disabled={busy !== null}
									type="button"
									onClick={async () => {
										setBusy(`off-${source.id}`);
										try {
											const next = await disconnectOne({ data: { sourceId: source.id } });
											setSources((current) =>
												current.map((item) => (item.id === next.id ? next : item)),
											);
										} catch (error) {
											setMessage(error instanceof Error ? error.message : String(error));
										} finally {
											setBusy(null);
										}
									}}
								>
									Disconnect
								</button>
							</div>
						</li>
					))
				)}
			</ul>
		</main>
	);
}

function IntegrationLive({
	userId,
	onSources,
}: {
	userId: string;
	onSources: (sources: SourceView[]) => void;
}) {
	useAgent<MemoryAgentState>({
		agent: "MemoryAgent",
		name: userId,
		onStateUpdate: (state) => {
			if (state.sources) {
				onSources(
					state.sources.filter(
						(source) => source.kind === "notion" && !isFixtureSourceId(source.id),
					),
				);
			}
		},
	});
	return null;
}
