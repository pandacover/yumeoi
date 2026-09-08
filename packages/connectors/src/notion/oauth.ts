import { ProviderUnavailable, Unauthorized } from "@yumeoi/domain";
import { Effect } from "effect";
import { ConnectorHttp } from "../http.ts";

export const NOTION_AUTHORIZE_URL = "https://api.notion.com/v1/oauth/authorize";
export const NOTION_TOKEN_URL = "https://api.notion.com/v1/oauth/token";
export const NOTION_API_BASE = "https://api.notion.com/v1";
export const NOTION_VERSION = "2022-06-28";

export type NotionOAuthConfig = {
	readonly clientId: string;
	readonly clientSecret: string;
	readonly redirectUri: string;
};

export type NotionTokenResponse = {
	readonly accessToken: string;
	readonly refreshToken: string | null;
	readonly workspaceId: string;
	readonly workspaceName: string;
	readonly botId: string;
};

export const notionAuthorizeUrl = (
	config: Pick<NotionOAuthConfig, "clientId" | "redirectUri">,
	state: string,
): string => {
	const url = new URL(NOTION_AUTHORIZE_URL);
	url.searchParams.set("client_id", config.clientId);
	url.searchParams.set("redirect_uri", config.redirectUri);
	url.searchParams.set("response_type", "code");
	url.searchParams.set("owner", "user");
	url.searchParams.set("state", state);
	return url.toString();
};

const basicAuth = (clientId: string, clientSecret: string): string =>
	`Basic ${btoa(`${clientId}:${clientSecret}`)}`;

const readToken = (raw: unknown): NotionTokenResponse => {
	if (!raw || typeof raw !== "object") {
		throw new Error("invalid token payload");
	}
	const body = raw as Record<string, unknown>;
	if (typeof body.access_token !== "string") {
		throw new Error("token response missing access_token");
	}
	return {
		accessToken: body.access_token,
		refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : null,
		workspaceId: typeof body.workspace_id === "string" ? body.workspace_id : "unknown",
		workspaceName: typeof body.workspace_name === "string" ? body.workspace_name : "Notion",
		botId: typeof body.bot_id === "string" ? body.bot_id : "",
	};
};

export const exchangeNotionCode = (config: NotionOAuthConfig, code: string) =>
	Effect.gen(function* () {
		const http = yield* ConnectorHttp;
		const response = yield* http.fetch(NOTION_TOKEN_URL, {
			method: "POST",
			headers: {
				authorization: basicAuth(config.clientId, config.clientSecret),
				"content-type": "application/json",
				"Notion-Version": NOTION_VERSION,
			},
			body: JSON.stringify({
				grant_type: "authorization_code",
				code,
				redirect_uri: config.redirectUri,
			}),
		});
		if (!response.ok) {
			return yield* Effect.fail(
				new Unauthorized({ message: `notion token exchange failed (${response.status})` }),
			);
		}
		const raw = yield* Effect.tryPromise({
			try: () => response.json(),
			catch: (cause) => new ProviderUnavailable({ provider: "notion", cause }),
		});
		return readToken(raw);
	});

export const refreshNotionToken = (config: NotionOAuthConfig, refreshToken: string) =>
	Effect.gen(function* () {
		const http = yield* ConnectorHttp;
		const response = yield* http.fetch(NOTION_TOKEN_URL, {
			method: "POST",
			headers: {
				authorization: basicAuth(config.clientId, config.clientSecret),
				"content-type": "application/json",
				"Notion-Version": NOTION_VERSION,
			},
			body: JSON.stringify({
				grant_type: "refresh_token",
				refresh_token: refreshToken,
			}),
		});
		if (!response.ok) {
			return yield* Effect.fail(
				new Unauthorized({ message: `notion token refresh failed (${response.status})` }),
			);
		}
		const raw = yield* Effect.tryPromise({
			try: () => response.json(),
			catch: (cause) => new ProviderUnavailable({ provider: "notion", cause }),
		});
		return readToken(raw);
	});
