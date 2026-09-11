import { env } from "cloudflare:workers";
import { createServerFn } from "@tanstack/react-start";
import { listApiKeys, mintApiKey, revokeApiKey } from "../auth/api-keys.ts";
import { listConnectedMcpClients, revokeConnectedMcpClient } from "../auth/mcp-clients.ts";
import { requireUserId } from "../auth/page-user.ts";
import { MCP_SCOPES } from "../auth/scopes.ts";

export const getAgentsContext = createServerFn({ method: "GET" }).handler(async () => {
	const userId = await requireUserId();
	const [keys, grants] = await Promise.all([
		listApiKeys(env, userId).catch(() => []),
		listConnectedMcpClients(env, userId).catch(() => []),
	]);
	return {
		userId,
		mcpPath: "/mcp",
		scopes: [...MCP_SCOPES],
		keys,
		grants,
	};
});

export const mintKey = createServerFn({ method: "POST" }).handler(async () => {
	const userId = await requireUserId();
	return mintApiKey(env, userId);
});

export const revokeKey = createServerFn({ method: "POST" })
	.validator((data: { id: string }) => data)
	.handler(async ({ data }) => {
		const userId = await requireUserId();
		const ok = await revokeApiKey(env, userId, data.id);
		if (!ok) {
			throw new Error("Key not found");
		}
		return { ok: true, id: data.id };
	});

export const revokeGrant = createServerFn({ method: "POST" })
	.validator((data: { id: string }) => data)
	.handler(async ({ data }) => {
		const userId = await requireUserId();
		const ok = await revokeConnectedMcpClient(env, userId, data.id);
		if (!ok) {
			throw new Error("Grant not found");
		}
		return { ok: true, id: data.id };
	});

export const formatTimestamp = (timestamp: number): string =>
	new Intl.DateTimeFormat("en-GB", {
		dateStyle: "medium",
		timeStyle: "short",
		timeZone: "UTC",
	}).format(new Date(timestamp));
