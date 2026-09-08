import {
	listMcpGrantRows,
	type McpGrantView,
	markMcpGrantRevoked,
	upsertMcpGrant,
} from "./grants.ts";
import { oauthHelpers } from "./oauth.ts";

const toView = (grant: {
	id: string;
	userId: string;
	clientId: string;
	scope: string[];
	metadata: unknown;
	createdAt: number;
	redirectUri?: string;
}): McpGrantView => {
	const metadata =
		grant.metadata && typeof grant.metadata === "object"
			? (grant.metadata as { clientName?: string })
			: {};
	return {
		id: grant.id,
		userId: grant.userId,
		clientId: grant.clientId,
		clientName: metadata.clientName || grant.clientId,
		scopes: grant.scope,
		redirectUri: grant.redirectUri ?? null,
		createdAt: grant.createdAt,
	};
};

export const listConnectedMcpClients = async (
	env: Env,
	userId: string,
): Promise<ReadonlyArray<McpGrantView>> => {
	if (env.OAUTH_KV || env.OAUTH_PROVIDER) {
		try {
			const listed = await oauthHelpers(env).listUserGrants(userId, { limit: 100 });
			const views = listed.items.map(toView);
			await Promise.all(views.map((grant) => upsertMcpGrant(env, grant)));
			return views;
		} catch {
			// Fall through to the D1 projection.
		}
	}
	return listMcpGrantRows(env, userId);
};

export const revokeConnectedMcpClient = async (
	env: Env,
	userId: string,
	grantId: string,
): Promise<boolean> => {
	if (env.OAUTH_KV || env.OAUTH_PROVIDER) {
		try {
			await oauthHelpers(env).revokeGrant(grantId, userId);
		} catch {
			return false;
		}
	}
	await markMcpGrantRevoked(env, userId, grantId);
	return true;
};
