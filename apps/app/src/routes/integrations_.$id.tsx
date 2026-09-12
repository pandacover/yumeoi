import { env } from "cloudflare:workers";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import type { SourceView } from "@yumeoi/domain";
import { useAgent } from "agents/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { MemoryAgentState } from "../agents/memory-agent.ts";
import { assertSourceOwner, disconnectSource, syncSource } from "../api/sources.ts";
import { requireAuth, requireUserId } from "../auth/page-user.ts";
import { CatalogList, CatalogRow } from "../components/catalog-row.tsx";
import { Page, PageCrumb, PageHeader } from "../components/page.tsx";
import { PendingHrefButton } from "../components/pending-href-button.tsx";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert.tsx";
import { Button } from "../components/ui/button.tsx";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../components/ui/empty.tsx";
import { Spinner } from "../components/ui/spinner.tsx";
import { isFixtureSourceId, isIntegrationId } from "../content/catalog.ts";

const getIntegration = createServerFn({ method: "POST" })
	.validator((data: { id: string }) => data)
	.handler(async ({ data }) => {
		if (!isIntegrationId(data.id)) {
			throw new Error("Unknown integration");
		}
		const userId = await requireUserId();
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
	.handler(async ({ data }) => {
		await assertSourceOwner(env, data.sourceId, await requireUserId());
		return syncSource(env, data.sourceId);
	});

const disconnectOne = createServerFn({ method: "POST" })
	.validator((data: { sourceId: string }) => data)
	.handler(async ({ data }) => {
		await assertSourceOwner(env, data.sourceId, await requireUserId());
		return disconnectSource(env, data.sourceId);
	});

export const Route = createFileRoute("/integrations_/$id")({
	beforeLoad: () => requireAuth(),
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
	const [mounted, setMounted] = useState(false);
	useEffect(() => {
		setMounted(true);
	}, []);

	return (
		<Page>
			<PageCrumb current="Notion" label="Integrations" to="/integrations" />
			<PageHeader
				title="Notion"
				description="Sync a Notion workspace into memories. Disconnect stops polling."
			/>
			{mounted ? <IntegrationLive onSources={setSources} userId={initial.userId} /> : null}
			{initial.notionConfigured ? (
				<PendingHrefButton href="/api/sources/notion/authorize">
					{sources.some((source) => source.status !== "disconnected")
						? "Connect another workspace"
						: "Connect Notion"}
				</PendingHrefButton>
			) : (
				<Alert>
					<AlertTitle>OAuth is not configured</AlertTitle>
					<AlertDescription>
						Set <code>NOTION_CLIENT_ID</code> and <code>NOTION_CLIENT_SECRET</code> to enable OAuth.
					</AlertDescription>
				</Alert>
			)}
			{initial.notionRedirectUri ? (
				<p className="text-sm text-muted-foreground">
					Redirect URI: <code className="break-all">{initial.notionRedirectUri}</code>
				</p>
			) : null}
			{sources.length === 0 ? (
				<Empty className="border">
					<EmptyHeader>
						<EmptyTitle>No Notion workspace connected</EmptyTitle>
						<EmptyDescription>Connect a workspace to start ingesting pages.</EmptyDescription>
					</EmptyHeader>
				</Empty>
			) : (
				<CatalogList>
					{sources.map((source) => (
						<CatalogRow
							key={source.id}
							title={source.label}
							detail={`${source.status}${
								source.lastSyncedAt
									? ` · last sync ${new Date(source.lastSyncedAt).toLocaleString()}`
									: " · never synced"
							} · ${source.documentsIngested} ingested${source.lastError ? ` · ${source.lastError}` : ""}`}
							action={
								<>
									<Button
										disabled={busy !== null || source.status === "disconnected"}
										size="sm"
										variant="outline"
										onClick={async () => {
											setBusy(source.id);
											try {
												const result = await syncOne({ data: { sourceId: source.id } });
												toast.success(
													`Poll ${result.sourceId}: ${result.ingested} ingested, ${result.unchanged} unchanged`,
												);
											} catch (error) {
												toast.error(error instanceof Error ? error.message : String(error));
											} finally {
												setBusy(null);
											}
										}}
									>
										{busy === source.id ? <Spinner data-icon="inline-start" /> : null}
										{busy === source.id ? "Syncing…" : "Sync"}
									</Button>
									<Button
										disabled={busy !== null}
										size="sm"
										variant="ghost"
										onClick={async () => {
											setBusy(`off-${source.id}`);
											try {
												const next = await disconnectOne({ data: { sourceId: source.id } });
												setSources((current) =>
													current.map((item) => (item.id === next.id ? next : item)),
												);
												toast.success("Disconnected");
											} catch (error) {
												toast.error(error instanceof Error ? error.message : String(error));
											} finally {
												setBusy(null);
											}
										}}
									>
										Disconnect
									</Button>
								</>
							}
						/>
					))}
				</CatalogList>
			)}
		</Page>
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
