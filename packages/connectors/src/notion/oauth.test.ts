import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { type FetchFn, fetchHttpLayer } from "../http.ts";
import { exchangeNotionCode, notionAuthorizeUrl, refreshNotionToken } from "./oauth.ts";

describe("Notion OAuth", () => {
	test("builds the public-integration authorize URL", () => {
		const url = new URL(
			notionAuthorizeUrl(
				{
					clientId: "client-1",
					redirectUri: "http://localhost:3000/api/sources/notion/callback",
				},
				"signed-state",
			),
		);
		expect(url.origin + url.pathname).toBe("https://api.notion.com/v1/oauth/authorize");
		expect(url.searchParams.get("client_id")).toBe("client-1");
		expect(url.searchParams.get("response_type")).toBe("code");
		expect(url.searchParams.get("owner")).toBe("user");
		expect(url.searchParams.get("state")).toBe("signed-state");
		expect(url.searchParams.get("redirect_uri")).toBe(
			"http://localhost:3000/api/sources/notion/callback",
		);
	});

	test("exchanges an authorization code for tokens", async () => {
		const fetchImpl: FetchFn = async (input) => {
			expect(String(input)).toBe("https://api.notion.com/v1/oauth/token");
			return Response.json({
				access_token: "ntn_access",
				refresh_token: "ntn_refresh",
				workspace_id: "ws-1",
				workspace_name: "Yumeoi HQ",
				bot_id: "bot-1",
			});
		};
		const token = await Effect.runPromise(
			exchangeNotionCode(
				{
					clientId: "client-1",
					clientSecret: "secret",
					redirectUri: "http://localhost:3000/api/sources/notion/callback",
				},
				"code-1",
			).pipe(Effect.provide(fetchHttpLayer(fetchImpl))),
		);
		expect(token).toEqual({
			accessToken: "ntn_access",
			refreshToken: "ntn_refresh",
			workspaceId: "ws-1",
			workspaceName: "Yumeoi HQ",
			botId: "bot-1",
		});
	});

	test("refreshes an access token", async () => {
		const fetchImpl: FetchFn = async (_input, init) => {
			const body = JSON.parse(String(init?.body ?? "{}")) as { grant_type?: string };
			expect(body.grant_type).toBe("refresh_token");
			return Response.json({
				access_token: "ntn_access_2",
				refresh_token: "ntn_refresh_2",
				workspace_id: "ws-1",
				workspace_name: "Yumeoi HQ",
				bot_id: "bot-1",
			});
		};
		const token = await Effect.runPromise(
			refreshNotionToken(
				{
					clientId: "client-1",
					clientSecret: "secret",
					redirectUri: "http://localhost:3000/api/sources/notion/callback",
				},
				"ntn_refresh",
			).pipe(Effect.provide(fetchHttpLayer(fetchImpl))),
		);
		expect(token.accessToken).toBe("ntn_access_2");
		expect(token.refreshToken).toBe("ntn_refresh_2");
	});
});
