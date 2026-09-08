CREATE TABLE IF NOT EXISTS mcp_grants (
	id TEXT PRIMARY KEY NOT NULL,
	user_id TEXT NOT NULL,
	client_id TEXT NOT NULL,
	client_name TEXT,
	scopes TEXT NOT NULL,
	redirect_uri TEXT,
	created_at INTEGER NOT NULL,
	revoked_at INTEGER
);

CREATE INDEX IF NOT EXISTS mcp_grants_user ON mcp_grants (user_id, created_at DESC);
