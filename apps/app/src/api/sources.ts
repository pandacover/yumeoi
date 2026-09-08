import { signPayload, tokenEncryptionKey, verifyPayload } from "@yumeoi/cf-runtime";
import {
	exchangeNotionCode,
	fetchHttpLayer,
	isFixtureToken,
	type NotionOAuthConfig,
	notionAuthorizeUrl,
} from "@yumeoi/connectors";
import type { SourceView } from "@yumeoi/domain";
import { Effect } from "effect";

export type OAuthState = {
	readonly userId: string;
	readonly nonce: string;
};

export const resolveNotionRedirectUri = (env: Env, request: Request): string =>
	env.NOTION_REDIRECT_URI || `${new URL(request.url).origin}/api/sources/notion/callback`;

export const notionOAuthConfig = (env: Env, request: Request): NotionOAuthConfig | null => {
	if (!env.NOTION_CLIENT_ID || !env.NOTION_CLIENT_SECRET) {
		return null;
	}
	return {
		clientId: env.NOTION_CLIENT_ID,
		clientSecret: env.NOTION_CLIENT_SECRET,
		redirectUri: resolveNotionRedirectUri(env, request),
	};
};

export const appUserId = (env: Env): string => env.YUMEOI_USER_ID || "default";

export const startNotionAuthorize = async (
	env: Env,
	request: Request,
	userId: string,
): Promise<string> => {
	const config = notionOAuthConfig(env, request);
	if (!config) {
		throw new Error("Notion OAuth is not configured");
	}
	const state = await signPayload(tokenEncryptionKey(env), {
		userId,
		nonce: crypto.randomUUID(),
	} satisfies OAuthState);
	return notionAuthorizeUrl(config, state);
};

export const finishNotionCallback = async (
	env: Env,
	request: Request,
	code: string,
	state: string,
): Promise<SourceView> => {
	const config = notionOAuthConfig(env, request);
	if (!config) {
		throw new Error("Notion OAuth is not configured");
	}
	const payload = await verifyPayload<OAuthState>(tokenEncryptionKey(env), state);
	if (!payload) {
		throw new Error("invalid OAuth state");
	}
	const token = await Effect.runPromise(
		exchangeNotionCode(config, code).pipe(Effect.provide(fetchHttpLayer())),
	);
	const sourceId = `notion:${token.workspaceId}`;
	return env.SourceAgent.getByName(sourceId).attach({
		userId: payload.userId,
		kind: "notion",
		label: token.workspaceName || "Notion",
		accessToken: token.accessToken,
		refreshToken: token.refreshToken,
	});
};

export const connectFixtureSource = async (env: Env, userId: string): Promise<SourceView> => {
	const sourceId = `notion:fixture:${userId}`;
	await env.SourceAgent.getByName(sourceId).attach({
		userId,
		kind: "notion",
		label: "Demo Notion",
		accessToken: "fixture",
	});
	await env.SourceAgent.getByName(sourceId).poll();
	return env.SourceAgent.getByName(sourceId).status();
};

export const syncSource = async (env: Env, sourceId: string) =>
	env.SourceAgent.getByName(sourceId).poll();

export const disconnectSource = async (env: Env, sourceId: string) =>
	env.SourceAgent.getByName(sourceId).disconnect();

export const isFixtureConnect = (body: Record<string, unknown>): boolean =>
	body.fixture === true ||
	isFixtureToken(typeof body.accessToken === "string" ? body.accessToken : "");
