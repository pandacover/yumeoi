import { routeAgentRequest } from "agents";
import { handleApi } from "./api/http.ts";
import { handleAuthorize } from "./auth/consent.ts";

export async function dispatch(
	request: Request,
	env: Env,
	_ctx: ExecutionContext,
): Promise<Response | null> {
	const url = new URL(request.url);

	if (url.pathname === "/authorize") {
		return handleAuthorize(request, env);
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
