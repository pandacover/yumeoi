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

/** Library default is 1 hour; Claude often fails to refresh before that. */
export const ACCESS_TOKEN_TTL_SECONDS = 12 * 60 * 60;
/** Same as workers-oauth-provider default; existing grants keep their stored expiry. */
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

export const withInvalidTokenChallenge = (wwwAuthenticate: string, description: string): string => {
	if (description.length === 0 || /error_description=/.test(wwwAuthenticate)) {
		return wwwAuthenticate;
	}
	const escaped = description.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
	return `${wwwAuthenticate}, error_description="${escaped}"`;
};

export const oauthErrorResponse = (error: {
	readonly code: string;
	readonly description: string;
	readonly status: number;
	readonly headers: Record<string, string>;
}): Response | undefined => {
	if (error.code !== "invalid_token" || error.status !== 401) {
		return undefined;
	}
	const headers = { ...error.headers };
	const headerName = "WWW-Authenticate" in headers ? "WWW-Authenticate" : "www-authenticate";
	const www = headers[headerName];
	if (typeof www === "string") {
		headers[headerName] = withInvalidTokenChallenge(www, error.description);
	}
	return new Response(JSON.stringify({ error: error.code, error_description: error.description }), {
		status: error.status,
		headers: {
			"Content-Type": "application/json",
			...headers,
		},
	});
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
	accessTokenTTL: ACCESS_TOKEN_TTL_SECONDS,
	refreshTokenTTL: REFRESH_TOKEN_TTL_SECONDS,
	scopesSupported: [...MCP_SCOPES],
	clientIdMetadataDocumentEnabled: true,
	resourceMetadata: {
		scopes_supported: [...MCP_SCOPES],
		bearer_methods_supported: ["header"],
		resource_name: "horizon memories",
	},
	onError: (error) => oauthErrorResponse(error),
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
