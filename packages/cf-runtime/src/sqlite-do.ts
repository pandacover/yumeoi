import * as SqliteClient from "@effect/sql-sqlite-do/SqliteClient";
import * as SqliteMigrator from "@effect/sql-sqlite-do/SqliteMigrator";
import { Effect, Layer, ManagedRuntime } from "effect";
import { SqlClient } from "effect/unstable/sql/SqlClient";
import {
	memoryStoreMigration,
	memoryStoreV2Migration,
	memoryStoreV3Migration,
	memoryStoreV4Migration,
	memoryStoreV5Migration,
	memoryStoreV6Migration,
} from "./migrations.ts";

export const sqliteDoLayer = (storage: DurableObjectStorage) => SqliteClient.layer({ storage });

const migrationLayer = SqliteMigrator.layer({
	loader: SqliteMigrator.fromRecord({
		"0001_memory_store": memoryStoreMigration,
		"0002_sources": memoryStoreV2Migration,
		"0003_documents_r2_key": memoryStoreV3Migration,
		"0004_memory_model_v2": memoryStoreV4Migration,
		"0005_fts_porter": memoryStoreV5Migration,
		"0006_memory_stats": memoryStoreV6Migration,
	}),
});

export const memoryStoreLayer = (storage: DurableObjectStorage) =>
	Layer.provideMerge(migrationLayer, sqliteDoLayer(storage));

export const makeMemoryStoreRuntime = (storage: DurableObjectStorage) =>
	ManagedRuntime.make(memoryStoreLayer(storage));

export const runMemoryStoreMigrations = (storage: DurableObjectStorage) =>
	Effect.provide(
		SqliteMigrator.run({
			loader: SqliteMigrator.fromRecord({
				"0001_memory_store": memoryStoreMigration,
				"0002_sources": memoryStoreV2Migration,
				"0003_documents_r2_key": memoryStoreV3Migration,
				"0004_memory_model_v2": memoryStoreV4Migration,
				"0005_fts_porter": memoryStoreV5Migration,
				"0006_memory_stats": memoryStoreV6Migration,
			}),
		}),
		sqliteDoLayer(storage),
	);

export { SqlClient, SqliteClient, SqliteMigrator };
