import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { consentContentSecurityPolicy, formActionCspSource } from "../src/auth/consent.ts";

const auth = { authorization: `Bearer ${env.YUMEOI_API_KEY}` };
const redirectUri = "http://127.0.0.1:9999/callback";

const b64url = (bytes: Uint8Array) =>
	btoa(String.fromCharCode(...bytes))
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replaceAll("=", "");

const pkce = async () => {
	const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
	return { verifier, challenge: b64url(new Uint8Array(digest)) };
};

const registerClient = async (name = "yumeoi-tests") => {
	const response = await SELF.fetch("https://example.com/register", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			client_name: name,
			redirect_uris: [redirectUri],
			token_endpoint_auth_method: "none",
			grant_types: ["authorization_code", "refresh_token"],
			response_types: ["code"],
		}),
	});
	expect(response.status).toBeLessThan(400);
	return (await response.json()) as { client_id: string };
};

const authorizeUrl = (clientId: string, challenge: string, state = "state-1") => {
	const url = new URL("https://example.com/authorize");
	url.searchParams.set("response_type", "code");
	url.searchParams.set("client_id", clientId);
	url.searchParams.set("redirect_uri", redirectUri);
	url.searchParams.set("scope", "memories:read memories:write");
	url.searchParams.set("state", state);
	url.searchParams.set("code_challenge", challenge);
	url.searchParams.set("code_challenge_method", "S256");
	url.searchParams.set("resource", "https://example.com/mcp");
	return url;
};

const cookieHeader = (response: Response) => {
	const getSetCookie = response.headers.getSetCookie?.();
	if (getSetCookie && getSetCookie.length > 0) {
		return getSetCookie.map((entry) => entry.split(";", 1)[0]).join("; ");
	}
	const single = response.headers.get("set-cookie");
	return single ? single.split(";", 1)[0] : "";
};

const csrfFromHtml = (html: string) => {
	const match = html.match(/name="csrf_token" value="([^"]+)"/);
	expect(match?.[1]).toBeTruthy();
	return match?.[1] ?? "";
};

const oauthRedirect = (response: Response, html = "") => {
	const header = response.headers.get("location");
	if (header) {
		return new URL(header);
	}
	const match = html.match(/id="oauth-redirect" href="([^"]+)"/);
	expect(match?.[1]).toBeTruthy();
	return new URL(
		(match?.[1] ?? "")
			.replaceAll("&quot;", '"')
			.replaceAll("&#039;", "'")
			.replaceAll("&lt;", "<")
			.replaceAll("&gt;", ">")
			.replaceAll("&amp;", "&"),
	);
};

const hiddenFields = (html: string) => {
	const body = new URLSearchParams();
	for (const match of html.matchAll(/name="([^"]+)" value="([^"]*)"/g)) {
		const name = match[1] ?? "";
		const value = (match[2] ?? "")
			.replaceAll("&quot;", '"')
			.replaceAll("&#039;", "'")
			.replaceAll("&lt;", "<")
			.replaceAll("&gt;", ">")
			.replaceAll("&amp;", "&");
		body.append(name, value);
	}
	return body;
};

const approve = async (clientId: string, challenge: string) => {
	const url = authorizeUrl(clientId, challenge);
	const page = await SELF.fetch(url);
	expect(page.status).toBe(200);
	const csp = page.headers.get("content-security-policy") ?? "";
	expect(csp).toContain("form-action 'self' http://127.0.0.1:9999");
	const html = await page.text();
	expect(html).toContain("Connect an agent");
	expect(html).toContain("this computer");
	expect(html).toContain("horizon");
	expect(html).toContain("approve-spinner");
	expect(html).toContain("Allow access");
	expect(html).toContain("test-user");
	const body = hiddenFields(html);
	body.set("decision", "approve");
	return SELF.fetch("https://example.com/authorize", {
		method: "POST",
		redirect: "manual",
		headers: {
			"content-type": "application/x-www-form-urlencoded",
			cookie: cookieHeader(page),
		},
		body,
	});
};

const exchange = async (clientId: string, code: string, verifier: string) => {
	const response = await SELF.fetch("https://example.com/token", {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "authorization_code",
			code,
			redirect_uri: redirectUri,
			client_id: clientId,
			code_verifier: verifier,
			resource: "https://example.com/mcp",
		}),
	});
	expect(response.ok).toBe(true);
	return (await response.json()) as { access_token: string; refresh_token?: string };
};

const mcp = (token: string, body: unknown) =>
	SELF.fetch("https://example.com/mcp", {
		method: "POST",
		headers: {
			"content-type": "application/json",
			accept: "application/json, text/event-stream",
			authorization: `Bearer ${token}`,
		},
		body: JSON.stringify(body),
	});

describe("M4 MCP OAuth", () => {
	it("allows Claude's callback origin in consent form-action CSP", () => {
		expect(formActionCspSource("https://claude.ai/api/mcp/auth_callback")).toBe(
			"https://claude.ai",
		);
		expect(formActionCspSource("http://127.0.0.1:9999/callback")).toBe("http://127.0.0.1:9999");
		expect(formActionCspSource("javascript:alert(1)")).toBe("");
		expect(consentContentSecurityPolicy("https://claude.ai/api/mcp/auth_callback")).toContain(
			"form-action 'self' https://claude.ai",
		);
	});

	it("serves health for m4 with OAuth endpoints", async () => {
		const response = await SELF.fetch("https://example.com/api/health");
		expect(response.status).toBe(200);
		const body = (await response.json()) as {
			milestone: string;
			memory: unknown;
			mcp: { oauth: boolean; authorize: string; token: string; register: string; scopes: string[] };
		};
		expect(body.milestone).toBe("m4");
		expect(body.memory).toBeNull();
		expect(body.mcp.oauth).toBe(true);
		expect(body.mcp.authorize).toBe("/authorize");
		expect(body.mcp.token).toBe("/token");
		expect(body.mcp.register).toBe("/register");
		expect(body.mcp.scopes).toEqual(["memories:read", "memories:write"]);
	});

	it("advertises protected-resource and authorization-server metadata", async () => {
		const unauth = await SELF.fetch("https://example.com/mcp", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				accept: "application/json, text/event-stream",
			},
			body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
		});
		expect(unauth.status).toBe(401);
		expect(unauth.headers.get("www-authenticate") ?? "").toMatch(/resource_metadata/i);

		const resource = await SELF.fetch("https://example.com/.well-known/oauth-protected-resource");
		expect(resource.ok).toBe(true);
		const resourceBody = await resource.text();
		expect(resourceBody).toContain("memories:read");

		const server = await SELF.fetch("https://example.com/.well-known/oauth-authorization-server");
		expect(server.ok).toBe(true);
		const serverBody = (await server.json()) as {
			authorization_endpoint: string;
			token_endpoint: string;
			registration_endpoint: string;
		};
		expect(serverBody.authorization_endpoint).toContain("/authorize");
		expect(serverBody.token_endpoint).toContain("/token");
		expect(serverBody.registration_endpoint).toContain("/register");
	});

	it("completes PKCE OAuth and calls MCP with the access token", async () => {
		const { verifier, challenge } = await pkce();
		const { client_id: clientId } = await registerClient("Cursor Test");
		const approved = await approve(clientId, challenge);
		expect(approved.status).toBe(302);
		const html = await approved.text();
		expect(html).toContain("Return to your MCP client");
		const redirected = oauthRedirect(approved, html);
		expect(redirected.searchParams.get("state")).toBe("state-1");
		const code = redirected.searchParams.get("code");
		expect(code).toBeTruthy();

		const tokens = await exchange(clientId, code ?? "", verifier);
		expect(tokens.access_token).toBeTruthy();

		const listed = await mcp(tokens.access_token, {
			jsonrpc: "2.0",
			id: 2,
			method: "tools/list",
			params: {},
		});
		expect(listed.ok).toBe(true);
		const listedBody = await listed.text();
		expect(listedBody).toContain("search_memories");
		expect(listedBody).toContain("recall_context");

		const grants = await SELF.fetch("https://example.com/api/grants", { headers: auth });
		expect(grants.ok).toBe(true);
		const grantBody = (await grants.json()) as {
			grants: Array<{ id: string; clientName: string; clientId: string; createdAt: number }>;
		};
		const grant = grantBody.grants.find((item) => item.clientId === clientId);
		expect(grant?.clientName).toBe("Cursor Test");
		expect(grant?.id).toBeTruthy();
		expect(grant?.createdAt).toBeGreaterThan(1_600_000_000_000);
		expect(grant?.createdAt).toBeLessThan(2_000_000_000_000);

		const revoked = await SELF.fetch(`https://example.com/api/grants/${grant?.id}`, {
			method: "DELETE",
			headers: auth,
		});
		expect(revoked.ok).toBe(true);

		const after = await mcp(tokens.access_token, {
			jsonrpc: "2.0",
			id: 3,
			method: "tools/list",
			params: {},
		});
		expect(after.status).toBe(401);
	});

	it("denies consent with access_denied and rejects CSRF mismatches", async () => {
		const { challenge } = await pkce();
		const { client_id: clientId } = await registerClient("Denied Client");
		const url = authorizeUrl(clientId, challenge, "deny-state");
		const page = await SELF.fetch(url);
		const html = await page.text();
		const denied = await SELF.fetch(url, {
			method: "POST",
			redirect: "manual",
			headers: {
				"content-type": "application/x-www-form-urlencoded",
				cookie: cookieHeader(page),
			},
			body: new URLSearchParams({
				csrf_token: csrfFromHtml(html),
				decision: "deny",
			}),
		});
		expect(denied.status).toBeGreaterThanOrEqual(300);
		const location = new URL(denied.headers.get("location") ?? "http://invalid");
		expect(location.searchParams.get("error")).toBe("access_denied");
		expect(location.searchParams.get("state")).toBe("deny-state");

		const forged = await SELF.fetch(url, {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				csrf_token: "not-the-cookie",
				decision: "approve",
			}),
		});
		expect(forged.status).toBe(200);
		const forgedHtml = await forged.text();
		expect(forgedHtml).toContain("Connect an agent");
		expect(forgedHtml).toContain("That approval expired");
	});

	it("still accepts the env API key on /mcp", async () => {
		const listed = await SELF.fetch("https://example.com/mcp", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				accept: "application/json, text/event-stream",
				...auth,
			},
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: 1,
				method: "tools/list",
				params: {},
			}),
		});
		expect(listed.ok).toBe(true);
		expect(await listed.text()).toContain("list_sources");
	});

	it("exposes remember and forget on tools/list", async () => {
		const listed = await SELF.fetch("https://example.com/mcp", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				accept: "application/json, text/event-stream",
				...auth,
			},
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: 1,
				method: "tools/list",
				params: {},
			}),
		});
		expect(listed.ok).toBe(true);
		const text = await listed.text();
		expect(text).toContain("remember");
		expect(text).toContain("forget");
	});

	it("rejects MemoryAgent requests for a different user", async () => {
		const response = await SELF.fetch("https://example.com/agents/memory-agent/other-user");
		expect(response.status).toBe(403);
	});
});
