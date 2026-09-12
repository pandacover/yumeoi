import { env } from "cloudflare:workers";
import { createFileRoute, Link } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import type { SourceView } from "@yumeoi/domain";
import { requireAuth, requireUserId } from "../auth/page-user.ts";
import { CatalogList, CatalogRow } from "../components/catalog-row.tsx";
import { Page, PageHeader } from "../components/page.tsx";
import { PendingHrefButton } from "../components/pending-href-button.tsx";
import { Button } from "../components/ui/button.tsx";
import { isFixtureSourceId } from "../content/catalog.ts";

const getIntegrations = createServerFn({ method: "GET" }).handler(async () => {
	const userId = await requireUserId();
	const sources = await env.MemoryAgent.getByName(userId).listSources();
	return {
		notionConfigured: Boolean(env.NOTION_CLIENT_ID && env.NOTION_CLIENT_SECRET),
		sources: sources.filter((source) => !isFixtureSourceId(source.id)),
	};
});

export const Route = createFileRoute("/integrations")({
	beforeLoad: () => requireAuth(),
	loader: () => getIntegrations(),
	component: IntegrationsPage,
});

const isNotionLive = (source: SourceView): boolean =>
	source.kind === "notion" && source.status !== "disconnected";

function IntegrationsPage() {
	const { notionConfigured, sources } = Route.useLoaderData();
	const notion = sources.filter((source) => source.kind === "notion");
	const notionConnected = notion.some(isNotionLive);

	return (
		<Page>
			<PageHeader
				title="Integrations"
				description="External apps that write into your memory store."
			/>
			<CatalogList>
				<CatalogRow
					title="Notion"
					detail={
						notionConnected
							? (notion.find(isNotionLive)?.label ?? "Connected")
							: notionConfigured
								? "Workspace via OAuth"
								: "OAuth is not configured"
					}
					action={
						notionConnected || !notionConfigured ? (
							<Button
								nativeButton={false}
								render={<Link params={{ id: "notion" }} to="/integrations/$id" />}
								size="sm"
								variant="outline"
							>
								Manage
							</Button>
						) : (
							<PendingHrefButton href="/api/sources/notion/authorize" size="sm">
								Connect
							</PendingHrefButton>
						)
					}
				/>
			</CatalogList>
		</Page>
	);
}
