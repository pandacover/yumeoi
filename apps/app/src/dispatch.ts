import { routeAgentRequest } from "agents";
import { handleApi } from "./api/http.ts";
import { handleAuthorize } from "./auth/consent.ts";
import {
	agentInstanceName,
	isMemoryAgentPath,
	isSourceAgentPath,
	resolveAppUserId,
} from "./auth/session.ts";

const unauthorizedAgent = () => new Response("Unauthorized", { status: 401 });
const forbiddenAgent = () => new Response("Forbidden", { status: 403 });

const gateAgentRequest = async (request: Request, env: Env): Promise<Response | null> => {
	const { pathname } = new URL(request.url);
	if (!isMemoryAgentPath(pathname) && !isSourceAgentPath(pathname)) {
		return null;
	}
	const userId = await resolveAppUserId(request, env);
	if (!userId) {
		return unauthorizedAgent();
	}
	const name = agentInstanceName(pathname);
	if (!name) {
		return unauthorizedAgent();
	}
	if (isMemoryAgentPath(pathname) && name !== userId) {
		return forbiddenAgent();
	}
	if (isSourceAgentPath(pathname)) {
		const source = await env.SourceAgent.getByName(name).status();
		if (source.userId && source.userId !== userId) {
			return forbiddenAgent();
		}
	}
	return null;
};

export async function dispatch(
	request: Request,
	env: Env,
	ctx: ExecutionContext,
): Promise<Response | null> {
	const url = new URL(request.url);

	if (url.pathname === "/authorize") {
		return handleAuthorize(request, env);
	}

	const blocked = await gateAgentRequest(request, env);
	if (blocked) {
		return blocked;
	}

	const agentResponse = await routeAgentRequest(request, env);
	if (agentResponse) {
		return agentResponse;
	}

	if (url.pathname.startsWith("/api/") || url.pathname === "/ingest") {
		return handleApi(request, env, ctx);
	}

	return null;
}
