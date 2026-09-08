import {
	AuthorizationError,
	type AuthRequest,
	type ClientInfo,
} from "@cloudflare/workers-oauth-provider";
import { appUserId } from "../api/sources.ts";
import { upsertMcpGrant } from "./grants.ts";
import { oauthHelpers } from "./oauth.ts";
import { grantedScopes } from "./scopes.ts";

const csrfCookieName = (secure: boolean) => (secure ? "__Host-YUMEOI_CSRF" : "yumeoi_csrf");

export const sanitizeText = (text: string): string =>
	text
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#039;");

export const sanitizeUrl = (url: string): string => {
	if (!url) {
		return "";
	}
	try {
		const parsed = new URL(url);
		return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : "";
	} catch {
		return "";
	}
};

const cookieValue = (header: string | null, name: string): string | null => {
	if (!header) {
		return null;
	}
	for (const part of header.split(";")) {
		const [rawName, ...rest] = part.trim().split("=");
		if (rawName === name) {
			return rest.join("=");
		}
	}
	return null;
};

const setCsrfCookie = (token: string, secure: boolean): string => {
	const parts = [
		`${csrfCookieName(secure)}=${token}`,
		"HttpOnly",
		"Path=/",
		"SameSite=Lax",
		"Max-Age=600",
	];
	if (secure) {
		parts.push("Secure");
	}
	return parts.join("; ");
};

const clearCsrfCookie = (secure: boolean): string => {
	const parts = [`${csrfCookieName(secure)}=`, "HttpOnly", "Path=/", "SameSite=Lax", "Max-Age=0"];
	if (secure) {
		parts.push("Secure");
	}
	return parts.join("; ");
};

const htmlResponse = (body: string, status = 200, headers?: HeadersInit) =>
	new Response(body, {
		status,
		headers: {
			"content-type": "text/html; charset=utf-8",
			"cache-control": "no-store",
			"x-frame-options": "DENY",
			"x-content-type-options": "nosniff",
			"content-security-policy":
				"default-src 'none'; style-src 'unsafe-inline'; img-src 'self' https:; form-action 'self'; frame-ancestors 'none'; base-uri 'self'",
			...headers,
		},
	});

const pageShell = (title: string, inner: string) => `<!doctype html>
<html lang="en">
<head>
	<meta charset="utf-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1" />
	<title>${sanitizeText(title)}</title>
	<style>
		:root { color-scheme: dark; --bg:#0b0d10; --fg:#e8edf2; --muted:#9aa7b4; --card:#14181e; --accent:#7dd3c7; --line:#232a33; --danger:#f0a0a0; }
		html, body { background: var(--bg); color: var(--fg); margin: 0; font-family: ui-sans-serif, system-ui, sans-serif; }
		main { max-width: 36rem; margin: 0 auto; padding: 3rem 1.5rem; }
		.card { background: var(--card); border: 1px solid var(--line); border-radius: 1rem; padding: 1.5rem; }
		.kicker { color: var(--accent); letter-spacing: 0.2em; text-transform: uppercase; font-size: 0.8rem; }
		h1 { font-size: 1.75rem; margin: 0.5rem 0 0; }
		p, li { color: var(--muted); line-height: 1.5; }
		.client { font-size: 1.1rem; color: var(--fg); margin-top: 1rem; }
		.scopes { margin: 1rem 0 0; padding-left: 1.2rem; }
		.actions { display: flex; gap: 0.75rem; margin-top: 1.5rem; }
		button, .ghost { border-radius: 0.6rem; padding: 0.6rem 1rem; font-size: 0.9rem; cursor: pointer; }
		button[name="decision"][value="approve"] { background: var(--accent); color: var(--bg); border: 0; font-weight: 600; }
		button[name="decision"][value="deny"] { background: transparent; color: var(--fg); border: 1px solid var(--line); }
		.ghost { color: var(--accent); text-decoration: none; display: inline-block; margin-top: 1.5rem; }
		.error { color: var(--danger); }
		code { color: var(--fg); }
	</style>
</head>
<body>
	<main>${inner}</main>
</body>
</html>`;

const errorRedirect = (request: AuthRequest, code: string, description: string) => {
	const redirect = new URL(request.redirectUri);
	redirect.searchParams.set("error", code);
	redirect.searchParams.set("error_description", description);
	if (request.state) {
		redirect.searchParams.set("state", request.state);
	}
	if (request.issuer) {
		redirect.searchParams.set("iss", request.issuer);
	}
	return Response.redirect(redirect.toString(), 302);
};

const renderConsent = (
	oauthRequest: AuthRequest,
	client: ClientInfo,
	userId: string,
	csrfToken: string,
	secure: boolean,
) => {
	const name = sanitizeText(client.clientName || client.clientId);
	const clientUri = client.clientUri ? sanitizeUrl(client.clientUri) : "";
	const redirectUri = sanitizeText(oauthRequest.redirectUri);
	const scopes = grantedScopes(oauthRequest.scope);
	const inner = `
		<p class="kicker">MCP consent</p>
		<h1>Connect an agent</h1>
		<p class="client">${name} wants access to your yumeoi memories.</p>
		${clientUri ? `<p><a class="ghost" href="${sanitizeText(clientUri)}">${sanitizeText(clientUri)}</a></p>` : ""}
		<p>Signed in as <code>${sanitizeText(userId)}</code>. Redirect: <code>${redirectUri}</code></p>
		<ul class="scopes">
			${scopes.map((scope) => `<li><code>${sanitizeText(scope)}</code></li>`).join("")}
		</ul>
		<form method="post">
			<input type="hidden" name="csrf_token" value="${sanitizeText(csrfToken)}" />
			<div class="actions">
				<button type="submit" name="decision" value="approve">Approve</button>
				<button type="submit" name="decision" value="deny">Deny</button>
			</div>
		</form>
		<a class="ghost" href="/agents">Manage connected agents</a>
	`;
	return htmlResponse(pageShell("Approve MCP client — yumeoi", inner), 200, {
		"set-cookie": setCsrfCookie(csrfToken, secure),
	});
};

const parseOrError = async (request: Request, env: Env): Promise<AuthRequest | Response> => {
	try {
		return await oauthHelpers(env).parseAuthRequest(request);
	} catch (error) {
		if (error instanceof AuthorizationError) {
			if (!error.redirectUri) {
				return htmlResponse(
					pageShell(
						"Invalid authorize request — yumeoi",
						`<p class="kicker">MCP consent</p><h1>Invalid request</h1><p class="error">${sanitizeText(error.description)}</p><a class="ghost" href="/agents">Agents</a>`,
					),
					400,
				);
			}
			const redirect = new URL(error.redirectUri);
			redirect.searchParams.set("error", error.code);
			redirect.searchParams.set("error_description", error.description);
			if (error.state) {
				redirect.searchParams.set("state", error.state);
			}
			if (error.issuer) {
				redirect.searchParams.set("iss", error.issuer);
			}
			return Response.redirect(redirect.toString(), 302);
		}
		throw error;
	}
};

const recordGrant = async (
	env: Env,
	userId: string,
	clientId: string,
	clientName: string,
): Promise<void> => {
	try {
		const listed = await oauthHelpers(env).listUserGrants(userId, { limit: 100 });
		const match = listed.items.find((grant) => grant.clientId === clientId);
		if (!match) {
			return;
		}
		const metadata =
			match.metadata && typeof match.metadata === "object"
				? (match.metadata as { clientName?: string })
				: {};
		await upsertMcpGrant(env, {
			id: match.id,
			userId,
			clientId: match.clientId,
			clientName: metadata.clientName || clientName || match.clientId,
			scopes: match.scope,
			redirectUri: match.redirectUri ?? null,
			createdAt: match.createdAt,
		});
	} catch {
		// KV grant is authoritative; D1 is a projection for the Agents screen.
	}
};

export async function handleAuthorize(request: Request, env: Env): Promise<Response> {
	const url = new URL(request.url);
	const secure = url.protocol === "https:";
	const parsed = await parseOrError(request, env);
	if (parsed instanceof Response) {
		return parsed;
	}

	const helpers = oauthHelpers(env);
	const client = await helpers.lookupClient(parsed.clientId);
	if (!client) {
		return htmlResponse(
			pageShell(
				"Unknown client — yumeoi",
				`<p class="kicker">MCP consent</p><h1>Unknown client</h1><p class="error">This MCP client is not registered.</p>`,
			),
			400,
		);
	}

	const userId = appUserId(env);

	if (request.method === "GET") {
		return renderConsent(parsed, client, userId, crypto.randomUUID(), secure);
	}

	if (request.method !== "POST") {
		return htmlResponse(
			pageShell(
				"Method not allowed — yumeoi",
				`<p class="kicker">MCP consent</p><h1>Method not allowed</h1>`,
			),
			405,
		);
	}

	const form = await request.formData();
	const csrfForm = String(form.get("csrf_token") ?? "");
	const csrfCookie = cookieValue(request.headers.get("cookie"), csrfCookieName(secure));
	if (!csrfForm || !csrfCookie || csrfForm !== csrfCookie) {
		return htmlResponse(
			pageShell(
				"Consent failed — yumeoi",
				`<p class="kicker">MCP consent</p><h1>Consent expired</h1><p class="error">Reload the authorize page and try again.</p>`,
			),
			403,
			{ "set-cookie": clearCsrfCookie(secure) },
		);
	}

	const decision = String(form.get("decision") ?? "");
	if (decision !== "approve") {
		const denied = errorRedirect(parsed, "access_denied", "The user denied the request");
		denied.headers.append("set-cookie", clearCsrfCookie(secure));
		return denied;
	}

	const scope = grantedScopes(parsed.scope);
	const clientName = client.clientName || client.clientId;
	const { redirectTo } = await helpers.completeAuthorization({
		request: parsed,
		userId,
		metadata: { clientName },
		scope,
		props: {
			userId,
			clientId: client.clientId,
			clientName,
		},
	});
	await recordGrant(env, userId, client.clientId, clientName);
	const approved = Response.redirect(redirectTo, 302);
	approved.headers.append("set-cookie", clearCsrfCookie(secure));
	return approved;
}
