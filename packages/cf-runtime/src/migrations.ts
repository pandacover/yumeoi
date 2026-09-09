import { Effect } from "effect";
import { SqlClient } from "effect/unstable/sql/SqlClient";

const statements = [
	`CREATE TABLE IF NOT EXISTS documents (
		id TEXT PRIMARY KEY NOT NULL,
		source_id TEXT NOT NULL,
		external_id TEXT NOT NULL,
		content_hash TEXT NOT NULL,
		title TEXT NOT NULL,
		markdown TEXT NOT NULL,
		url TEXT,
		r2_key TEXT,
		created_at INTEGER NOT NULL,
		updated_at INTEGER NOT NULL
	)`,
	`CREATE TABLE IF NOT EXISTS chunks (
		id TEXT PRIMARY KEY NOT NULL,
		document_id TEXT NOT NULL,
		text TEXT NOT NULL,
		content_hash TEXT NOT NULL,
		byte_start INTEGER NOT NULL,
		byte_end INTEGER NOT NULL,
		FOREIGN KEY (document_id) REFERENCES documents(id)
	)`,
	`CREATE TABLE IF NOT EXISTS memories (
		id TEXT PRIMARY KEY NOT NULL,
		kind TEXT NOT NULL,
		text TEXT NOT NULL,
		confidence REAL NOT NULL,
		valid_from TEXT,
		valid_to TEXT,
		supersedes TEXT,
		created_at INTEGER NOT NULL
	)`,
	`CREATE TABLE IF NOT EXISTS memory_sources (
		memory_id TEXT NOT NULL,
		source_id TEXT NOT NULL,
		document_id TEXT NOT NULL,
		chunk_id TEXT NOT NULL,
		PRIMARY KEY (memory_id, chunk_id)
	)`,
	`CREATE TABLE IF NOT EXISTS sync_runs (
		id TEXT PRIMARY KEY NOT NULL,
		source_id TEXT NOT NULL,
		started_at INTEGER NOT NULL,
		finished_at INTEGER,
		status TEXT NOT NULL,
		error TEXT
	)`,
	`CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
		text,
		content='memories',
		content_rowid='rowid'
	)`,
	`CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
		text,
		content='chunks',
		content_rowid='rowid'
	)`,
	`CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
		INSERT INTO memories_fts(rowid, text) VALUES (new.rowid, new.text);
	END`,
	`CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
		INSERT INTO memories_fts(memories_fts, rowid, text) VALUES('delete', old.rowid, old.text);
	END`,
	`CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
		INSERT INTO memories_fts(memories_fts, rowid, text) VALUES('delete', old.rowid, old.text);
		INSERT INTO memories_fts(rowid, text) VALUES (new.rowid, new.text);
	END`,
	`CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
		INSERT INTO chunks_fts(rowid, text) VALUES (new.rowid, new.text);
	END`,
	`CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
		INSERT INTO chunks_fts(chunks_fts, rowid, text) VALUES('delete', old.rowid, old.text);
	END`,
	`CREATE TRIGGER IF NOT EXISTS chunks_au AFTER UPDATE ON chunks BEGIN
		INSERT INTO chunks_fts(chunks_fts, rowid, text) VALUES('delete', old.rowid, old.text);
		INSERT INTO chunks_fts(rowid, text) VALUES (new.rowid, new.text);
	END`,
];

export const memoryStoreMigration = Effect.gen(function* () {
	const sql = yield* SqlClient;
	for (const statement of statements) {
		yield* sql.unsafe(statement);
	}
});

const v2Statements = [
	`CREATE TABLE IF NOT EXISTS sources (
		id TEXT PRIMARY KEY NOT NULL,
		kind TEXT NOT NULL,
		label TEXT NOT NULL,
		created_at INTEGER NOT NULL
	)`,
	`CREATE UNIQUE INDEX IF NOT EXISTS documents_source_external ON documents(source_id, external_id)`,
];

export const memoryStoreV2Migration = Effect.gen(function* () {
	const sql = yield* SqlClient;
	for (const statement of v2Statements) {
		yield* sql.unsafe(statement);
	}
});

/** Existing DOs created before r2_key was in 0001 still need the column. */
export const memoryStoreV3Migration = Effect.gen(function* () {
	const sql = yield* SqlClient;
	const columns = yield* sql<{ name: string }>`PRAGMA table_info(documents)`;
	if (!columns.some((column) => column.name === "r2_key")) {
		yield* sql.unsafe("ALTER TABLE documents ADD COLUMN r2_key TEXT");
	}
});

export const memoryStoreV4Migration = Effect.gen(function* () {
	const sql = yield* SqlClient;
	const columns = yield* sql<{ name: string }>`PRAGMA table_info(memories)`;
	const names = new Set(columns.map((column) => column.name));
	const add = (name: string, definition: string) =>
		names.has(name)
			? Effect.void
			: sql.unsafe(`ALTER TABLE memories ADD COLUMN ${name} ${definition}`);
	yield* add("type", "TEXT NOT NULL DEFAULT 'semantic'");
	yield* add("state", "TEXT NOT NULL DEFAULT 'active'");
	yield* add("importance", "REAL NOT NULL DEFAULT 0.5");
	yield* add("event_at", "INTEGER");
	yield* add("observed_at", "INTEGER");
	yield* add("updated_at", "INTEGER");
	yield* add("last_accessed_at", "INTEGER");
	yield* add("access_count", "INTEGER NOT NULL DEFAULT 0");
	yield* add("retention", "REAL NOT NULL DEFAULT 1.0");
	yield* add("origin", "TEXT NOT NULL DEFAULT 'extracted'");
	yield* add("client_ref", "TEXT");
	for (const statement of v4Statements) {
		yield* sql.unsafe(statement);
	}
	yield* sql.unsafe(`
		UPDATE memories SET type = CASE kind
			WHEN 'event' THEN 'episodic'
			WHEN 'task' THEN 'episodic'
			WHEN 'procedure' THEN 'procedural'
			WHEN 'rule' THEN 'procedural'
			ELSE 'semantic'
		END
	`);
	yield* sql.unsafe(`
		UPDATE memories SET state = CASE WHEN valid_to IS NOT NULL THEN 'superseded' ELSE state END
	`);
	yield* sql.unsafe(`
		UPDATE memories SET observed_at = COALESCE(observed_at, created_at),
			updated_at = COALESCE(updated_at, created_at),
			importance = COALESCE(importance, confidence)
	`);
	yield* sql.unsafe(`
		UPDATE memories SET origin = 'agent'
		WHERE id IN (
			SELECT memory_sources.memory_id FROM memory_sources
			JOIN sources ON sources.id = memory_sources.source_id
			WHERE sources.kind = 'agent'
		)
	`);
	yield* sql.unsafe(`
		INSERT OR IGNORE INTO memory_edges (src, dst, relation, created_at)
		SELECT id, supersedes, 'supersedes', created_at FROM memories WHERE supersedes IS NOT NULL
	`);
});

const v4Statements = [
	`CREATE TABLE IF NOT EXISTS memory_edges (
		src TEXT NOT NULL,
		dst TEXT NOT NULL,
		relation TEXT NOT NULL,
		created_at INTEGER NOT NULL,
		PRIMARY KEY (src, dst, relation)
	)`,
	`CREATE TABLE IF NOT EXISTS memory_history (
		id TEXT PRIMARY KEY NOT NULL,
		memory_id TEXT NOT NULL,
		text TEXT NOT NULL,
		type TEXT NOT NULL,
		kind TEXT NOT NULL,
		confidence REAL NOT NULL,
		valid_from TEXT,
		valid_to TEXT,
		state TEXT NOT NULL,
		changed_at INTEGER NOT NULL,
		reason TEXT NOT NULL
	)`,
	`CREATE TABLE IF NOT EXISTS memory_feedback (
		id TEXT PRIMARY KEY NOT NULL,
		memory_id TEXT NOT NULL,
		client_id TEXT NOT NULL,
		signal INTEGER NOT NULL,
		note TEXT,
		created_at INTEGER NOT NULL
	)`,
	`CREATE TABLE IF NOT EXISTS memories_archive (
		id TEXT PRIMARY KEY NOT NULL,
		kind TEXT NOT NULL,
		text TEXT NOT NULL,
		confidence REAL NOT NULL,
		valid_from TEXT,
		valid_to TEXT,
		supersedes TEXT,
		created_at INTEGER NOT NULL,
		type TEXT NOT NULL DEFAULT 'semantic',
		state TEXT NOT NULL DEFAULT 'archived',
		importance REAL NOT NULL DEFAULT 0.5,
		event_at INTEGER,
		observed_at INTEGER,
		updated_at INTEGER,
		last_accessed_at INTEGER,
		access_count INTEGER NOT NULL DEFAULT 0,
		retention REAL NOT NULL DEFAULT 1.0,
		origin TEXT NOT NULL DEFAULT 'extracted',
		client_ref TEXT
	)`,
	`CREATE TABLE IF NOT EXISTS entities (
		id TEXT PRIMARY KEY NOT NULL,
		name TEXT NOT NULL,
		canonical TEXT NOT NULL,
		type TEXT NOT NULL,
		description TEXT,
		first_seen INTEGER NOT NULL,
		last_seen INTEGER NOT NULL,
		mention_count INTEGER NOT NULL DEFAULT 0,
		state TEXT NOT NULL DEFAULT 'active'
	)`,
	`CREATE UNIQUE INDEX IF NOT EXISTS entities_canonical ON entities(canonical, type)`,
	`CREATE TABLE IF NOT EXISTS entity_aliases (
		alias TEXT NOT NULL,
		entity_id TEXT NOT NULL,
		PRIMARY KEY (alias)
	)`,
	`CREATE TABLE IF NOT EXISTS memory_entities (
		memory_id TEXT NOT NULL,
		entity_id TEXT NOT NULL,
		role TEXT NOT NULL,
		PRIMARY KEY (memory_id, entity_id)
	)`,
	`CREATE INDEX IF NOT EXISTS memory_entities_entity ON memory_entities(entity_id)`,
	`CREATE TABLE IF NOT EXISTS relations (
		id TEXT PRIMARY KEY NOT NULL,
		src_entity TEXT NOT NULL,
		dst_entity TEXT NOT NULL,
		predicate TEXT NOT NULL,
		memory_id TEXT NOT NULL,
		valid_from TEXT,
		valid_to TEXT,
		confidence REAL NOT NULL,
		created_at INTEGER NOT NULL
	)`,
	`CREATE INDEX IF NOT EXISTS relations_src ON relations(src_entity)`,
	`CREATE INDEX IF NOT EXISTS relations_dst ON relations(dst_entity)`,
	`CREATE VIRTUAL TABLE IF NOT EXISTS entities_fts USING fts5(
		name,
		description,
		content='entities',
		content_rowid='rowid'
	)`,
	`CREATE TRIGGER IF NOT EXISTS entities_ai AFTER INSERT ON entities BEGIN
		INSERT INTO entities_fts(rowid, name, description) VALUES (new.rowid, new.name, new.description);
	END`,
	`CREATE TRIGGER IF NOT EXISTS entities_ad AFTER DELETE ON entities BEGIN
		INSERT INTO entities_fts(entities_fts, rowid, name, description) VALUES('delete', old.rowid, old.name, old.description);
	END`,
	`CREATE TRIGGER IF NOT EXISTS entities_au AFTER UPDATE ON entities BEGIN
		INSERT INTO entities_fts(entities_fts, rowid, name, description) VALUES('delete', old.rowid, old.name, old.description);
		INSERT INTO entities_fts(rowid, name, description) VALUES (new.rowid, new.name, new.description);
	END`,
	`CREATE UNIQUE INDEX IF NOT EXISTS memories_client_ref ON memories(client_ref) WHERE client_ref IS NOT NULL`,
	`CREATE INDEX IF NOT EXISTS memories_state_type ON memories(state, type)`,
	`CREATE INDEX IF NOT EXISTS memories_event_at ON memories(event_at)`,
	`CREATE INDEX IF NOT EXISTS memories_retention ON memories(state, retention)`,
];
