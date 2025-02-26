import Sqlite from "better-sqlite3";
import knex from "knex";
import { join } from "path";
import { appDir } from "./configuration.js";
import { migrations } from "./migrations/migrations.js";

const filename = join(appDir(), "cross-seed.db");
const rawSqliteHandle = new Sqlite(filename);
rawSqliteHandle.pragma("journal_mode = WAL");
rawSqliteHandle.close();

export const db = knex({
	client: "better-sqlite3",
	connection: { filename },
	migrations: { migrationSource: migrations },
	useNullAsDefault: true,
});

export const memDB = knex({
	client: "better-sqlite3",
	connection: ":memory:",
	useNullAsDefault: true,
});
await memDB.schema.createTable("torrent", (table) => {
	table.string("client_host");
	table.string("info_hash").index();
	table.primary(["client_host", "info_hash"]);
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
	table.string("client_host");
	table.string("path").index();
	table.primary(["client_host", "path"]);
	table.string("info_hash").index();
	table.string("ensemble");
	table.string("element");
});
