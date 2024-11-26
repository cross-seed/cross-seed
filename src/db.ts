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
