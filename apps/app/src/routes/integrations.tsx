import { env } from "cloudflare:workers";
import { createFileRoute, Link } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import type { SourceView } from "@yumeoi/domain";
import { appUserId } from "../api/sources.ts";
import { CatalogList, CatalogRow } from "../components/catalog-row.tsx";
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
		<main className="page">
			<header>
				<h1 className="hero-heading">Integrations</h1>
				<p className="hero-sub">External apps that write into your memory store.</p>
			</header>
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
						notionConnected ? (
							<Link className="catalog-cta" params={{ id: "notion" }} to="/integrations/$id">
								Manage
							</Link>
						) : notionConfigured ? (
							<a className="catalog-cta" href="/api/sources/notion/authorize">
								Connect
							</a>
						) : (
							<span className="catalog-detail">Unavailable</span>
						)
					}
				/>
			</CatalogList>
		</main>
	);
}
