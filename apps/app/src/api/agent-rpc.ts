import { env } from "cloudflare:workers";
import { createServerFn } from "@tanstack/react-start";
import { listApiKeys, mintApiKey, revokeApiKey } from "../auth/api-keys.ts";
import { listConnectedMcpClients, revokeConnectedMcpClient } from "../auth/mcp-clients.ts";
import { MCP_SCOPES } from "../auth/scopes.ts";
import { appUserId } from "./sources.ts";

export const getAgentsContext = createServerFn({ method: "GET" }).handler(async () => {
	const userId = appUserId(env);
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

export const mintKey = createServerFn({ method: "POST" }).handler(async () =>
	mintApiKey(env, appUserId(env)),
);

export const revokeKey = createServerFn({ method: "POST" })
	.validator((data: { id: string }) => data)
	.handler(async ({ data }) => {
		const ok = await revokeApiKey(env, appUserId(env), data.id);
		if (!ok) {
			throw new Error("Key not found");
		}
		return { ok: true, id: data.id };
	});

export const revokeGrant = createServerFn({ method: "POST" })
	.validator((data: { id: string }) => data)
	.handler(async ({ data }) => {
		const ok = await revokeConnectedMcpClient(env, appUserId(env), data.id);
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
