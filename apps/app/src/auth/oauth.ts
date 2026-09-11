import {
	getOAuthApi,
	type OAuthHelpers,
	OAuthProvider,
	type OAuthProviderOptions,
} from "@cloudflare/workers-oauth-provider";
import { mcpApiHandler } from "../mcp/server.ts";
import { authenticateToken } from "./api-key.ts";
import { MCP_SCOPES } from "./scopes.ts";

const dummyHandler: ExportedHandler<Env> = {
	fetch: () => new Response("not found", { status: 404 }),
};

export const oauthProviderOptions = (
	defaultHandler: ExportedHandler<Env>,
): OAuthProviderOptions<Env> => ({
	apiRoute: "/mcp",
	apiHandler: mcpApiHandler,
	defaultHandler,
	authorizeEndpoint: "/authorize",
	tokenEndpoint: "/token",
	clientRegistrationEndpoint: "/register",
	scopesSupported: [...MCP_SCOPES],
	clientIdMetadataDocumentEnabled: true,
	resourceMetadata: {
		scopes_supported: [...MCP_SCOPES],
		bearer_methods_supported: ["header"],
		resource_name: "horizon memories",
	},
	resolveExternalToken: async ({ token, env }) => {
		const auth = await authenticateToken(token, env);
		if (!auth) {
			return null;
		}
		return {
			props: {
				userId: auth.userId,
				clientId: `apikey:${auth.keyPrefix}`,
			},
		};
	},
});

export const createYumeoiOAuthProvider = (defaultHandler: ExportedHandler<Env>) =>
	new OAuthProvider(oauthProviderOptions(defaultHandler));

export const oauthHelpers = (env: Env): OAuthHelpers => {
	if (env.OAUTH_PROVIDER) {
		return env.OAUTH_PROVIDER;
	}
	return getOAuthApi(oauthProviderOptions(dummyHandler), env);
};
