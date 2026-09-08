export type McpGrantView = {
	readonly id: string;
	readonly userId: string;
	readonly clientId: string;
	readonly clientName: string;
	readonly scopes: readonly string[];
	readonly redirectUri: string | null;
	readonly createdAt: number;
};

const ensureGrantsTable = async (db: D1Database) => {
	await db
		.prepare(`
			CREATE TABLE IF NOT EXISTS mcp_grants (
				id TEXT PRIMARY KEY NOT NULL,
				user_id TEXT NOT NULL,
				client_id TEXT NOT NULL,
				client_name TEXT,
				scopes TEXT NOT NULL,
				redirect_uri TEXT,
				created_at INTEGER NOT NULL,
				revoked_at INTEGER
			)
		`)
		.run();
};

const parseScopes = (value: string): string[] => {
	try {
		const parsed: unknown = JSON.parse(value);
		return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
	} catch {
		return value
			.split(/\s+/)
			.map((item) => item.trim())
			.filter(Boolean);
	}
};

export const upsertMcpGrant = async (env: Env, grant: McpGrantView): Promise<void> => {
	if (!env.DB) {
		return;
	}
	await ensureGrantsTable(env.DB);
	await env.DB.prepare(
		`
			INSERT INTO mcp_grants (id, user_id, client_id, client_name, scopes, redirect_uri, created_at, revoked_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
			ON CONFLICT(id) DO UPDATE SET
				client_name = excluded.client_name,
				scopes = excluded.scopes,
				redirect_uri = excluded.redirect_uri,
				revoked_at = NULL
		`,
	)
		.bind(
			grant.id,
			grant.userId,
			grant.clientId,
			grant.clientName,
			JSON.stringify(grant.scopes),
			grant.redirectUri,
			grant.createdAt,
		)
		.run();
};

export const listMcpGrantRows = async (
	env: Env,
	userId: string,
): Promise<ReadonlyArray<McpGrantView>> => {
	if (!env.DB) {
		return [];
	}
	await ensureGrantsTable(env.DB);
	const rows = await env.DB.prepare(
		`
			SELECT id, user_id, client_id, client_name, scopes, redirect_uri, created_at
			FROM mcp_grants
			WHERE user_id = ? AND revoked_at IS NULL
			ORDER BY created_at DESC
		`,
	)
		.bind(userId)
		.all<{
			id: string;
			user_id: string;
			client_id: string;
			client_name: string | null;
			scopes: string;
			redirect_uri: string | null;
			created_at: number;
		}>();
	return (rows.results ?? []).map((row) => ({
		id: row.id,
		userId: row.user_id,
		clientId: row.client_id,
		clientName: row.client_name || row.client_id,
		scopes: parseScopes(row.scopes),
		redirectUri: row.redirect_uri,
		createdAt: row.created_at,
	}));
};

export const markMcpGrantRevoked = async (
	env: Env,
	userId: string,
	grantId: string,
): Promise<boolean> => {
	if (!env.DB) {
		return false;
	}
	await ensureGrantsTable(env.DB);
	const result = await env.DB.prepare(
		"UPDATE mcp_grants SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL",
	)
		.bind(Date.now(), grantId, userId)
		.run();
	return (result.meta.changes ?? 0) > 0;
};
