import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import type { SourceView } from "@yumeoi/domain";
import { useAgent } from "agents/react";
import { useEffect, useMemo, useState } from "react";
import type { MemoryAgentState } from "../agents/memory-agent.ts";
import { appUserId, connectFixtureSource, disconnectSource, syncSource } from "../api/sources.ts";

const getSourcesContext = createServerFn({ method: "GET" }).handler(async () => {
	const userId = appUserId(env);
	const sources = await env.MemoryAgent.getByName(userId).listSources();
	return {
		userId,
		notionConfigured: Boolean(env.NOTION_CLIENT_ID && env.NOTION_CLIENT_SECRET),
		notionRedirectUri: env.NOTION_REDIRECT_URI || null,
		sources,
	};
});

const connectDemo = createServerFn({ method: "POST" }).handler(async () => {
	return connectFixtureSource(env, appUserId(env));
});

const syncOne = createServerFn({ method: "POST" })
	.validator((data: { sourceId: string }) => data)
	.handler(async ({ data }) => syncSource(env, data.sourceId));

const disconnectOne = createServerFn({ method: "POST" })
	.validator((data: { sourceId: string }) => data)
	.handler(async ({ data }) => disconnectSource(env, data.sourceId));

export const Route = createFileRoute("/sources")({
	loader: () => getSourcesContext(),
	component: SourcesPage,
});

function SourcesPage() {
	const initial = Route.useLoaderData();
	const [sources, setSources] = useState<SourceView[]>(initial.sources);
	const [busy, setBusy] = useState<string | null>(null);
	const [message, setMessage] = useState("");
	const [mounted, setMounted] = useState(false);
	useEffect(() => {
		setMounted(true);
	}, []);
	const live = useMemo(() => sources, [sources]);

	return (
		<main className="mx-auto flex max-w-5xl flex-col gap-8 px-6 py-12">
			<header className="flex flex-col gap-3">
				<p className="text-sm tracking-[0.2em] text-[var(--accent)] uppercase">M2 sources</p>
				<h1 className="text-3xl font-semibold tracking-tight">Sources</h1>
				<p className="max-w-2xl text-[var(--muted)]">
					Connect Notion, poll with a cursor, and stream sync status through MemoryAgent via{" "}
					<code>useAgent</code>.
				</p>
				{mounted ? (
					<SourcesLive userId={initial.userId} onSources={setSources} />
				) : (
					<p className="text-sm text-[var(--muted)]">Connecting to MemoryAgent…</p>
				)}
			</header>

			<section className="flex flex-wrap gap-3">
				{initial.notionConfigured ? (
					<a
						className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--bg)]"
						href="/api/sources/notion/authorize"
					>
						Connect Notion
					</a>
				) : (
					<p className="rounded-lg border border-[var(--line)] px-4 py-2 text-sm text-[var(--muted)]">
						Set <code>NOTION_CLIENT_ID</code> and <code>NOTION_CLIENT_SECRET</code> to enable OAuth.
					</p>
				)}
				<button
					className="rounded-lg border border-[var(--line)] px-4 py-2 text-sm disabled:opacity-50"
					disabled={busy !== null}
					type="button"
					onClick={async () => {
						setBusy("demo");
						setMessage("");
						try {
							const source = await connectDemo();
							setSources((current) => [...current.filter((item) => item.id !== source.id), source]);
							setMessage(`Synced ${source.label}`);
						} catch (error) {
							setMessage(error instanceof Error ? error.message : String(error));
						} finally {
							setBusy(null);
						}
					}}
				>
					{busy === "demo" ? "Connecting…" : "Connect demo workspace"}
				</button>
			</section>

			{initial.notionConfigured && initial.notionRedirectUri ? (
				<p className="max-w-2xl text-sm text-[var(--muted)]">
					If Notion reports a missing or invalid redirect URI, add this exact value to the public
					connection under Redirect URIs:{" "}
					<code className="break-all text-[var(--fg)]">{initial.notionRedirectUri}</code>
				</p>
			) : null}

			{message ? <p className="text-sm text-[var(--accent)]">{message}</p> : null}

			<section className="grid gap-4">
				{live.length === 0 ? (
					<p className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6 text-[var(--muted)]">
						No sources yet. Connect Notion or load the demo workspace.
					</p>
				) : (
					live.map((source) => (
						<article
							key={source.id}
							className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6"
						>
							<div className="flex flex-wrap items-start justify-between gap-4">
								<div>
									<h2 className="text-lg font-medium">{source.label}</h2>
									<p className="mt-1 font-mono text-sm text-[var(--muted)]">{source.id}</p>
								</div>
								<span className="rounded-full border border-[var(--line)] px-3 py-1 text-xs uppercase tracking-wide text-[var(--accent)]">
									{source.status}
								</span>
							</div>
							<dl className="mt-4 grid gap-2 text-sm text-[var(--muted)] md:grid-cols-2">
								<div>kind {source.kind}</div>
								<div>
									last sync{" "}
									{source.lastSyncedAt ? new Date(source.lastSyncedAt).toLocaleString() : "never"}
								</div>
								<div>seen {source.documentsSeen}</div>
								<div>ingested {source.documentsIngested}</div>
							</dl>
							{source.lastError ? (
								<p className="mt-3 text-sm text-red-300">last error: {source.lastError}</p>
							) : null}
							<div className="mt-4 flex flex-wrap gap-3">
								<button
									className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-sm disabled:opacity-50"
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
									{busy === source.id ? "Syncing…" : "Sync now"}
								</button>
								<button
									className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-sm disabled:opacity-50"
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
						</article>
					))
				)}
			</section>
		</main>
	);
}

function SourcesLive({
	userId,
	onSources,
}: {
	userId: string;
	onSources: (sources: SourceView[]) => void;
}) {
	const agent = useAgent<MemoryAgentState>({
		agent: "MemoryAgent",
		name: userId,
		onStateUpdate: (state) => {
			if (state.sources) {
				onSources(state.sources);
			}
		},
	});
	return (
		<p className="text-sm text-[var(--muted)]">
			useAgent MemoryAgent/{agent.name}
			{agent.state?.ready ? " · live" : ""}
		</p>
	);
}
