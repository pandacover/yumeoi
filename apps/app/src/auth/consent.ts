import {
	AuthorizationError,
	type AuthRequest,
	type ClientInfo,
} from "@cloudflare/workers-oauth-provider";
import { upsertMcpGrant } from "./grants.ts";
import { oauthHelpers } from "./oauth.ts";
import { grantedScopes } from "./scopes.ts";
import { resolveClerkUserId, signInUrl } from "./session.ts";

const csrfCookieName = (secure: boolean) => (secure ? "__Host-HORIZON_CSRF" : "horizon_csrf");

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

const OAUTH_QUERY_KEYS = new Set([
	"response_type",
	"client_id",
	"redirect_uri",
	"scope",
	"state",
	"code_challenge",
	"code_challenge_method",
	"resource",
]);

export const isLoopbackRedirect = (url: string): boolean => {
	try {
		const host = new URL(url).hostname.toLowerCase();
		return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
	} catch {
		return false;
	}
};

export const requestWithOAuthForm = (request: Request, form: FormData): Request => {
	const url = new URL(request.url);
	for (const [key, value] of form.entries()) {
		if (!OAUTH_QUERY_KEYS.has(key) || typeof value !== "string" || value.length === 0) {
			continue;
		}
		if (key === "resource") {
			if (!url.searchParams.getAll("resource").includes(value)) {
				url.searchParams.append(key, value);
			}
			continue;
		}
		if (!url.searchParams.has(key)) {
			url.searchParams.set(key, value);
		}
	}
	return new Request(url.toString(), {
		method: request.method,
		headers: request.headers,
	});
};

const hiddenInput = (name: string, value: string) =>
	`<input type="hidden" name="${sanitizeText(name)}" value="${sanitizeText(value)}" />`;

const hiddenOAuthFields = (oauthRequest: AuthRequest): string => {
	const fields: Array<[string, string]> = [
		["response_type", oauthRequest.responseType],
		["client_id", oauthRequest.clientId],
		["redirect_uri", oauthRequest.redirectUri],
		["scope", oauthRequest.scope.join(" ")],
		["state", oauthRequest.state],
	];
	if (oauthRequest.codeChallenge) {
		fields.push(["code_challenge", oauthRequest.codeChallenge]);
	}
	if (oauthRequest.codeChallengeMethod) {
		fields.push(["code_challenge_method", oauthRequest.codeChallengeMethod]);
	}
	const resources = oauthRequest.resource
		? Array.isArray(oauthRequest.resource)
			? oauthRequest.resource
			: [oauthRequest.resource]
		: [];
	for (const resource of resources) {
		if (resource) {
			fields.push(["resource", resource]);
		}
	}
	return fields
		.filter(([, value]) => value.length > 0)
		.map(([name, value]) => hiddenInput(name, value))
		.join("");
};

const redirectHint = (redirectUri: string): string => {
	if (isLoopbackRedirect(redirectUri)) {
		return `<p>After you allow access, this browser must open your MCP client on this computer (<code>${sanitizeText(redirectUri)}</code>). That address is Claude or Cursor on your machine, not this Worker. Click once and wait.</p>`;
	}
	return `<p>After you allow access, this browser returns to <code>${sanitizeText(redirectUri)}</code>. Click once and wait.</p>`;
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
				"default-src 'none'; style-src 'unsafe-inline'; img-src 'self' https:; script-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'self'",
			...headers,
		},
	});

const pageShell = (title: string, inner: string, extraHead = "") => `<!doctype html>
<html lang="en">
<head>
	<meta charset="utf-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1" />
	<title>${sanitizeText(title)}</title>
	<link rel="icon" href="/favicon.ico?v=2" sizes="any" />
	<link rel="icon" href="/favicon.png?v=2" type="image/png" sizes="192x192" />
	<link rel="apple-touch-icon" href="/apple-touch-icon.png?v=2" sizes="180x180" />
	${extraHead}
	<style>
		:root { color-scheme: light; --background: oklch(1 0 0); --foreground: oklch(0.145 0 0); --muted-foreground: oklch(0.556 0 0); --border: oklch(0.922 0 0); --primary: oklch(0.553 0.195 38.402); --primary-foreground: oklch(0.98 0.016 73.684); --destructive: oklch(0.577 0.245 27.325); }
		@media (prefers-color-scheme: dark) {
			:root { color-scheme: dark; --background: oklch(0.145 0 0); --foreground: oklch(0.985 0 0); --muted-foreground: oklch(0.708 0 0); --border: oklch(1 0 0 / 10%); --primary: oklch(0.47 0.157 37.304); --primary-foreground: oklch(0.98 0.016 73.684); --destructive: oklch(0.704 0.191 22.216); }
		}
		html, body { background: var(--background); color: var(--foreground); margin: 0; font-family: ui-sans-serif, system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
		main { max-width: 32rem; margin: 0 auto; padding: 4.5rem 1.5rem; }
		.kicker { color: var(--muted-foreground); font-size: 12px; margin: 0 0 8px; }
		h1 { font-size: 32px; font-weight: 500; letter-spacing: -0.45px; line-height: 40px; margin: 0; }
		p, li { color: var(--muted-foreground); font-size: 14px; line-height: 22px; }
		.client { font-size: 14px; color: var(--foreground); margin-top: 1.5rem; }
		.scopes { margin: 1rem 0 0; padding-left: 1.2rem; }
		.actions { display: flex; gap: 0.75rem; margin-top: 1.5rem; flex-wrap: wrap; }
		button, .ghost { font-family: inherit; font-size: 13px; cursor: pointer; }
		button[name="decision"][value="approve"] { background: var(--primary); color: var(--primary-foreground); border: 0; border-radius: 0; padding: 11px 22px; min-width: 8rem; display: inline-flex; align-items: center; justify-content: center; gap: 0.5rem; }
		button[name="decision"][value="deny"] { background: transparent; color: var(--foreground); border: 1px solid var(--border); border-radius: 0; padding: 10px 18px; min-width: 8rem; }
		.ghost { color: var(--foreground); text-decoration: underline; text-decoration-color: var(--border); text-underline-offset: 3px; display: inline-block; margin-top: 1.5rem; }
		.error { color: var(--destructive); }
		.notice { color: var(--foreground); }
		code { color: var(--foreground); font-size: 0.92em; }
		.approve-spinner { display: none; width: 14px; height: 14px; }
		form[data-busy="1"] .approve-spinner { display: block; animation: horizon-spin 0.7s linear infinite; }
		form[data-busy="1"] button { opacity: 0.7; pointer-events: none; }
		@keyframes horizon-spin { to { transform: rotate(360deg); } }
	</style>
</head>
<body>
	<main>${inner}</main>
</body>
</html>`;

const redirectResponse = (location: string, headers?: HeadersInit) =>
	new Response(null, {
		status: 302,
		headers: { location, ...headers },
	});

const errorRedirect = (
	request: AuthRequest,
	code: string,
	description: string,
	headers?: HeadersInit,
) => {
	const redirect = new URL(request.redirectUri);
	redirect.searchParams.set("error", code);
	redirect.searchParams.set("error_description", description);
	if (request.state) {
		redirect.searchParams.set("state", request.state);
	}
	if (request.issuer) {
		redirect.searchParams.set("iss", request.issuer);
	}
	return redirectResponse(redirect.toString(), headers);
};

const renderConsent = (
	oauthRequest: AuthRequest,
	client: ClientInfo,
	userId: string,
	csrfToken: string,
	secure: boolean,
	notice?: string,
) => {
	const name = sanitizeText(client.clientName || client.clientId);
	const clientUri = client.clientUri ? sanitizeUrl(client.clientUri) : "";
	const scopes = grantedScopes(oauthRequest.scope);
	const inner = `
		<p class="kicker">MCP consent</p>
		<h1>Connect an agent</h1>
		${notice ? `<p class="notice">${sanitizeText(notice)}</p>` : ""}
		<p class="client">${name} wants access to your horizon memories.</p>
		${clientUri ? `<p><a class="ghost" href="${sanitizeText(clientUri)}">${sanitizeText(clientUri)}</a></p>` : ""}
		<p>Signed in as <code>${sanitizeText(userId)}</code>.</p>
		${redirectHint(oauthRequest.redirectUri)}
		<ul class="scopes">
			${scopes.map((scope) => `<li><code>${sanitizeText(scope)}</code></li>`).join("")}
		</ul>
		<form method="post" action="/authorize" onsubmit="if(this.dataset.busy){event.preventDefault();return false;} this.dataset.busy='1'; var label=this.querySelector('.approve-label'); if(label) label.textContent='Allowing access…';">
			${hiddenOAuthFields(oauthRequest)}
			<input type="hidden" name="csrf_token" value="${sanitizeText(csrfToken)}" />
			<div class="actions">
				<button type="submit" name="decision" value="approve">
					<svg class="approve-spinner" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 1 0 10 10h-2.2A7.8 7.8 0 1 1 12 4.2V2z"/></svg>
					<span class="approve-label">Allow access</span>
				</button>
				<button type="submit" name="decision" value="deny">Deny</button>
			</div>
		</form>
		<a class="ghost" href="/agents">Manage connected agents</a>
	`;
	return htmlResponse(pageShell("Approve MCP client — horizon", inner), 200, {
		"set-cookie": setCsrfCookie(csrfToken, secure),
	});
};

const loopbackHandoff = (redirectTo: string, secure: boolean) => {
	const href = sanitizeUrl(redirectTo);
	if (!href) {
		return htmlResponse(
			pageShell(
				"Return to your MCP client — horizon",
				`<p class="kicker">MCP consent</p><h1>Return to your MCP client</h1><p class="error">Missing loopback redirect.</p>`,
			),
			400,
			{ "set-cookie": clearCsrfCookie(secure) },
		);
	}
	const extraHead = `<meta http-equiv="refresh" content="0;url=${sanitizeText(href)}" /><script>location.replace(${JSON.stringify(href)});</script>`;
	const inner = `
		<p class="kicker">MCP consent</p>
		<h1>Return to your MCP client</h1>
		<p>Access approved. Opening Claude or Cursor on this computer.</p>
		<p><a id="oauth-redirect" class="ghost" href="${sanitizeText(href)}">Continue if the app does not open</a></p>
	`;
	return htmlResponse(pageShell("Return to your MCP client — horizon", inner, extraHead), 302, {
		location: href,
		"set-cookie": clearCsrfCookie(secure),
		refresh: `0;url=${href}`,
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
						"Invalid authorize request — horizon",
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
			return redirectResponse(redirect.toString());
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

	if (request.method === "GET") {
		const parsed = await parseOrError(request, env);
		if (parsed instanceof Response) {
			return parsed;
		}
		const client = await oauthHelpers(env).lookupClient(parsed.clientId);
		if (!client) {
			return htmlResponse(
				pageShell(
					"Unknown client — horizon",
					`<p class="kicker">MCP consent</p><h1>Unknown client</h1><p class="error">This MCP client is not registered.</p>`,
				),
				400,
			);
		}
		const userId = await resolveClerkUserId(request, env);
		if (!userId) {
			return Response.redirect(signInUrl(request, request.url), 302);
		}
		return renderConsent(parsed, client, userId, crypto.randomUUID(), secure);
	}

	if (request.method !== "POST") {
		return htmlResponse(
			pageShell(
				"Method not allowed — horizon",
				`<p class="kicker">MCP consent</p><h1>Method not allowed</h1>`,
			),
			405,
		);
	}

	const form = await request.formData();
	const parsed = await parseOrError(requestWithOAuthForm(request, form), env);
	if (parsed instanceof Response) {
		return parsed;
	}

	const helpers = oauthHelpers(env);
	const client = await helpers.lookupClient(parsed.clientId);
	if (!client) {
		return htmlResponse(
			pageShell(
				"Unknown client — horizon",
				`<p class="kicker">MCP consent</p><h1>Unknown client</h1><p class="error">This MCP client is not registered.</p>`,
			),
			400,
		);
	}

	const userId = await resolveClerkUserId(request, env);
	if (!userId) {
		return Response.redirect(signInUrl(request, request.url), 302);
	}
	const csrfForm = String(form.get("csrf_token") ?? "");
	const csrfCookie = cookieValue(request.headers.get("cookie"), csrfCookieName(secure));
	if (!csrfForm || !csrfCookie || csrfForm !== csrfCookie) {
		return renderConsent(
			parsed,
			client,
			userId,
			crypto.randomUUID(),
			secure,
			"That approval expired. Click Allow access once and wait for the browser to return to Claude or Cursor.",
		);
	}

	const decision = String(form.get("decision") ?? "");
	if (decision !== "approve") {
		return errorRedirect(parsed, "access_denied", "The user denied the request", {
			"set-cookie": clearCsrfCookie(secure),
		});
	}

	const scope = grantedScopes(parsed.scope);
	const clientName = client.clientName || client.clientId;
	let redirectTo: string;
	try {
		({ redirectTo } = await helpers.completeAuthorization({
			request: parsed,
			userId,
			metadata: { clientName },
			scope,
			props: {
				userId,
				clientId: client.clientId,
				clientName,
			},
		}));
	} catch (error) {
		if (error instanceof AuthorizationError && error.redirectUri) {
			return errorRedirect(parsed, error.code, error.description, {
				"set-cookie": clearCsrfCookie(secure),
			});
		}
		const message = error instanceof Error ? error.message : String(error);
		return htmlResponse(
			pageShell(
				"Consent failed — horizon",
				`<p class="kicker">MCP consent</p><h1>Could not finish</h1><p class="error">${sanitizeText(message)}</p><a class="ghost" href="/agents">Agents</a>`,
			),
			400,
			{ "set-cookie": clearCsrfCookie(secure) },
		);
	}
	await recordGrant(env, userId, client.clientId, clientName);
	if (isLoopbackRedirect(redirectTo)) {
		return loopbackHandoff(redirectTo, secure);
	}
	return redirectResponse(redirectTo, { "set-cookie": clearCsrfCookie(secure) });
}
