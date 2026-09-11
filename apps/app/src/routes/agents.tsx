import { RiCursorLine, RiKeyLine, RiRobotLine } from "@remixicon/react";
import { createFileRoute, Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { getAgentsContext } from "../api/agent-rpc.ts";
import { CatalogList, CatalogRow } from "../components/catalog-row.tsx";
import { Page, PageHeader } from "../components/page.tsx";
import { Button } from "../components/ui/button.tsx";
import { agentCatalog, grantMatchesAgent } from "../content/catalog.ts";

export const Route = createFileRoute("/agents")({
	loader: () => getAgentsContext(),
	component: AgentsPage,
});

const agentIcons: Record<(typeof agentCatalog)[number]["id"], ReactNode> = {
	cursor: <RiCursorLine />,
	claude: <RiRobotLine />,
	http: <RiKeyLine />,
};

function AgentsPage() {
	const { grants, keys } = Route.useLoaderData();
	const connected = {
		cursor: grants.some((grant) => grantMatchesAgent("cursor", grant)),
		claude: grants.some((grant) => grantMatchesAgent("claude", grant)),
		http: keys.length > 0,
	};

	return (
		<Page>
			<PageHeader title="Agents" description="Clients that read and write the same memory store." />
			<CatalogList>
				{agentCatalog.map((agent) => (
					<CatalogRow
						key={agent.id}
						icon={agentIcons[agent.id]}
						title={agent.name}
						detail={agent.detail}
						action={
							<Button
								nativeButton={false}
								render={<Link params={{ id: agent.id }} to="/agents/$id" />}
								size="sm"
								variant={connected[agent.id] ? "outline" : "default"}
							>
								{connected[agent.id] ? "Manage" : "Connect"}
							</Button>
						}
					/>
				))}
			</CatalogList>
		</Page>
	);
}
