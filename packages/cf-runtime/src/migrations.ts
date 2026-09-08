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
