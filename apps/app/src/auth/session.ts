import { createClerkClient } from "@clerk/backend";
import { authenticateRequest as authenticateApiKey } from "./api-key.ts";

export const clerkPublishableKey = (env: Env): string =>
	(env.CLERK_PUBLISHABLE_KEY || env.VITE_CLERK_PUBLISHABLE_KEY || "").trim();

export const signInUrl = (request: Request, returnTo?: string): string => {
	const url = new URL("/sign-in", request.url);
	if (returnTo) {
		url.searchParams.set("redirect_url", returnTo);
	}
	return url.toString();
};

export const resolveClerkUserId = async (request: Request, env: Env): Promise<string | null> => {
	const testUser = env.CLERK_TEST_USER_ID?.trim();
	if (testUser) {
		return testUser;
	}
	const secretKey = env.CLERK_SECRET_KEY?.trim();
	const publishableKey = clerkPublishableKey(env);
	if (secretKey && publishableKey) {
		const clerk = createClerkClient({ secretKey, publishableKey });
		const state = await clerk.authenticateRequest(request, { secretKey, publishableKey });
		if (!state.isAuthenticated) {
			return null;
		}
		return state.toAuth().userId ?? null;
	}
	return null;
};

export const resolveAppUserId = async (request: Request, env: Env): Promise<string | null> => {
	const sessionUser = await resolveClerkUserId(request, env);
	if (sessionUser) {
		return sessionUser;
	}
	const keyAuth = await authenticateApiKey(request, env);
	return keyAuth?.userId ?? null;
};

export const isMemoryAgentPath = (pathname: string): boolean =>
	/^\/agents\/memory-agent\//i.test(pathname);

export const isSourceAgentPath = (pathname: string): boolean =>
	/^\/agents\/source-agent\//i.test(pathname);

export const agentInstanceName = (pathname: string): string | null => {
	const match = pathname.match(/^\/agents\/(?:memory-agent|source-agent)\/([^/]+)/i);
	if (!match?.[1]) {
		return null;
	}
	try {
		return decodeURIComponent(match[1]);
	} catch {
		return match[1];
	}
};
