import { routeAgentRequest } from "agents";
import { handleApi } from "./api/spikes.ts";
import { mcpHandler } from "./mcp/server.ts";

export async function dispatch(
	request: Request,
	env: Env,
	ctx: ExecutionContext,
): Promise<Response | null> {
	const url = new URL(request.url);

	if (url.pathname === "/mcp" || url.pathname.startsWith("/mcp/")) {
		return mcpHandler(request, env, ctx);
	}

	const agentResponse = await routeAgentRequest(request, env);
	if (agentResponse) {
		return agentResponse;
	}

	if (url.pathname.startsWith("/api/") || url.pathname === "/ingest") {
		return handleApi(request, env);
	}

	return null;
}
