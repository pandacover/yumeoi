const encoder = new TextEncoder();

const hex = (buffer: ArrayBuffer): string =>
	[...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");

export const hashApiKey = async (key: string): Promise<string> => {
	const digest = await crypto.subtle.digest("SHA-256", encoder.encode(key));
	return hex(digest);
};

export const timingSafeEqual = (left: string, right: string): boolean => {
	if (left.length !== right.length) {
		return false;
	}
	let diff = 0;
	for (let i = 0; i < left.length; i++) {
		diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
	}
	return diff === 0;
};

export type AuthContext = {
	readonly userId: string;
	readonly keyPrefix: string;
};

const bearer = (request: Request): string | null => {
	const header = request.headers.get("authorization");
	if (!header) {
		return null;
	}
	const match = header.match(/^Bearer\s+(.+)$/i);
	return match?.[1]?.trim() ?? null;
};

export const unauthorized = () =>
	Response.json(
		{ error: "unauthorized", message: "API key required (Authorization: Bearer ym_…)" },
		{ status: 401, headers: { "www-authenticate": "Bearer" } },
	);

export const authenticateToken = async (token: string, env: Env): Promise<AuthContext | null> => {
	if (env.YUMEOI_API_KEY && timingSafeEqual(token, env.YUMEOI_API_KEY)) {
		return {
			userId: env.YUMEOI_USER_ID || "default",
			keyPrefix: token.slice(0, 6),
		};
	}

	if (env.DB && token.startsWith("ym_")) {
		try {
			const digest = await hashApiKey(token);
			const row = await env.DB.prepare(
				"SELECT user_id, prefix FROM api_keys WHERE hash = ? LIMIT 1",
			)
				.bind(digest)
				.first<{ user_id: string; prefix: string }>();
			if (row) {
				return { userId: row.user_id, keyPrefix: row.prefix };
			}
		} catch {
			// D1 may be unbound or not yet migrated; env key still authenticates above.
		}
	}

	return null;
};

export const authenticateRequest = async (
	request: Request,
	env: Env,
): Promise<AuthContext | null> => {
	const token = bearer(request);
	if (!token) {
		return null;
	}
	return authenticateToken(token, env);
};
