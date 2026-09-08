import { hashApiKey } from "./api-key.ts";

export type ApiKeyListItem = {
	readonly id: string;
	readonly prefix: string;
	readonly createdAt: number;
};

export type MintedApiKey = ApiKeyListItem & {
	readonly token: string;
};

const ensureApiKeysTable = async (db: D1Database) => {
	await db
		.prepare(`
			CREATE TABLE IF NOT EXISTS api_keys (
				id TEXT PRIMARY KEY NOT NULL,
				user_id TEXT NOT NULL,
				prefix TEXT NOT NULL,
				hash TEXT NOT NULL UNIQUE,
				created_at INTEGER NOT NULL
			)
		`)
		.run();
};

const randomToken = (): string => {
	const bytes = crypto.getRandomValues(new Uint8Array(24));
	const encoded = btoa(String.fromCharCode(...bytes))
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replaceAll("=", "");
	return `ym_${encoded}`;
};

export const mintApiKey = async (env: Env, userId: string): Promise<MintedApiKey> => {
	if (!env.DB) {
		throw new Error("D1 is not bound");
	}
	await ensureApiKeysTable(env.DB);
	const id = crypto.randomUUID();
	const token = randomToken();
	const prefix = token.slice(0, 10);
	const createdAt = Date.now();
	await env.DB.prepare(
		"INSERT INTO api_keys (id, user_id, prefix, hash, created_at) VALUES (?, ?, ?, ?, ?)",
	)
		.bind(id, userId, prefix, await hashApiKey(token), createdAt)
		.run();
	return { id, token, prefix, createdAt };
};

export const listApiKeys = async (
	env: Env,
	userId: string,
): Promise<ReadonlyArray<ApiKeyListItem>> => {
	if (!env.DB) {
		throw new Error("D1 is not bound");
	}
	await ensureApiKeysTable(env.DB);
	const rows = await env.DB.prepare(
		"SELECT id, prefix, created_at FROM api_keys WHERE user_id = ? ORDER BY created_at DESC",
	)
		.bind(userId)
		.all<{ id: string; prefix: string; created_at: number }>();
	return (rows.results ?? []).map((row) => ({
		id: row.id,
		prefix: row.prefix,
		createdAt: row.created_at,
	}));
};

export const revokeApiKey = async (env: Env, userId: string, id: string): Promise<boolean> => {
	if (!env.DB) {
		throw new Error("D1 is not bound");
	}
	await ensureApiKeysTable(env.DB);
	const result = await env.DB.prepare("DELETE FROM api_keys WHERE id = ? AND user_id = ?")
		.bind(id, userId)
		.run();
	return (result.meta.changes ?? 0) > 0;
};
