// eslint-disable-next-line @typescript-eslint/no-unused-vars
import Sqlite from "better-sqlite3";
import Knex from "knex";
import { join } from "path";
import { appDir } from "./configuration.js";
import { migrations } from "./migrations/migrations.js";

const filename = join(appDir(), "cross-seed.db");
const rawSqliteHandle = new Sqlite(filename);
rawSqliteHandle.pragma("journal_mode = WAL");
rawSqliteHandle.close();

export const db = Knex.knex({
	client: "better-sqlite3",
	connection: { filename },
	migrations: { migrationSource: migrations },
	useNullAsDefault: true,
});

export const memDB = Knex.knex({
	client: "better-sqlite3",
	connection: ":memory:",
	useNullAsDefault: true,
});
await memDB.schema.createTable("torrent", (table) => {
	table.string("info_hash").primary();
	table.string("name");
	table.string("title");
	table.json("files");
	table.integer("length");
	table.string("save_path");
	table.string("category");
	table.json("tags");
	table.json("trackers");
});
await memDB.schema.createTable("data", (table) => {
	table.string("path").primary();
	table.string("title");
});
await memDB.schema.createTable("ensemble", (table) => {
	table.string("path").primary();
	table.string("info_hash").unique();
	table.string("ensemble");
	table.string("element");
});

const BATCH_SIZE_DB = 100;
export async function bulkMergeIntoDB(
	database: Knex.Knex,
	table: string,
	rows: any[], // eslint-disable-line @typescript-eslint/no-explicit-any
	conflictKey: string,
): Promise<void> {
	for (let i = 0; i < rows.length; i += BATCH_SIZE_DB) {
		const batch = rows.slice(i, i + BATCH_SIZE_DB);
		if (!batch.length) break;
		await database(table).insert(batch).onConflict(conflictKey).merge();
	}
}
export async function bulkIgnoreIntoDB(
	database: Knex.Knex,
	table: string,
	rows: any[], // eslint-disable-line @typescript-eslint/no-explicit-any
	conflictKey: string,
): Promise<void> {
	for (let i = 0; i < rows.length; i += BATCH_SIZE_DB) {
		const batch = rows.slice(i, i + BATCH_SIZE_DB);
		if (!batch.length) break;
		await database(table).insert(batch).onConflict(conflictKey).ignore();
	}
}
export async function bulkDeleteFromDB(
	database: Knex.Knex,
	table: string,
	column: string,
	values: any[], // eslint-disable-line @typescript-eslint/no-explicit-any
): Promise<void> {
	for (let i = 0; i < values.length; i += BATCH_SIZE_DB) {
		const batch = values.slice(i, i + BATCH_SIZE_DB);
		if (!batch.length) break;
		await database(table).whereIn(column, batch).del();
	}
}
