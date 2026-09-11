import { createFileRoute, Link } from "@tanstack/react-router";
import { getAgentsContext } from "../api/agent-rpc.ts";
import { CatalogList, CatalogRow } from "../components/catalog-row.tsx";
import { agentCatalog, grantMatchesAgent } from "../content/catalog.ts";

export const Route = createFileRoute("/agents")({
	loader: () => getAgentsContext(),
	component: AgentsPage,
});

function AgentsPage() {
	const { grants, keys } = Route.useLoaderData();
	const connected = {
		cursor: grants.some((grant) => grantMatchesAgent("cursor", grant)),
		claude: grants.some((grant) => grantMatchesAgent("claude", grant)),
		http: keys.length > 0,
	};

	return (
		<main className="page">
			<header>
				<h1 className="hero-heading">Agents</h1>
				<p className="hero-sub">Clients that read and write the same memory store.</p>
			</header>
			<CatalogList>
				{agentCatalog.map((agent) => (
					<CatalogRow
						key={agent.id}
						title={agent.name}
						detail={agent.detail}
						action={
							<Link className="catalog-cta" params={{ id: agent.id }} to="/agents/$id">
								{connected[agent.id] ? "Manage" : "Connect"}
							</Link>
						}
					/>
				))}
			</CatalogList>
		</main>
	);
}
