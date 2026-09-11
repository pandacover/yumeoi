import { env } from "cloudflare:workers";
import { RiNotionLine } from "@remixicon/react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import type { SourceView } from "@yumeoi/domain";
import { appUserId } from "../api/sources.ts";
import { CatalogList, CatalogRow } from "../components/catalog-row.tsx";
import { Page, PageHeader } from "../components/page.tsx";
import { Button } from "../components/ui/button.tsx";
import { isFixtureSourceId } from "../content/catalog.ts";

const getIntegrations = createServerFn({ method: "GET" }).handler(async () => {
	const userId = appUserId(env);
	const sources = await env.MemoryAgent.getByName(userId).listSources();
	return {
		notionConfigured: Boolean(env.NOTION_CLIENT_ID && env.NOTION_CLIENT_SECRET),
		sources: sources.filter((source) => !isFixtureSourceId(source.id)),
	};
});

export const Route = createFileRoute("/integrations")({
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
					icon={<RiNotionLine />}
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
							<Button
								nativeButton={false}
								render={
									// biome-ignore lint/a11y/useAnchorContent: link text is the Button children
									<a href="/api/sources/notion/authorize" />
								}
								size="sm"
							>
								Connect
							</Button>
						)
					}
				/>
			</CatalogList>
		</Page>
	);
}
